/**
 * 【S3】会员钱包上行（POS → ERP）——POS 侧出箱表（outbox）与推送器。
 *
 * ── 背景：为什么要这块代码 ────────────────────────────────────────────────
 * 门店每笔消费/退货原先在**本地**直接改 `pos_member.points / stored_value`
 * （sales.service.ts / returns.service.ts / omnichannel.service.ts 三处各自写），
 * 而 ERP 侧的积分只在「零售单**结算**」时才加，POS 上行销售单走
 * `pos-receiver.receiveSales` 建的是 `status='completed'` 的 retail_order，
 * 压根不经过 settleRetailOrder → ERP 从来不为门店消费记分。
 * 结果两端各记一套、互不打通。
 *
 * ── 收口：ERP 作为会员钱包唯一账本方 ──────────────────────────────────────
 * POS 只负责「如实上报发生了什么」，不再自行裁决余额。三步：
 *   ① 事务内写 outbox（本文件的 enqueue）——保证「单成立 ⇒ 事件必存在」；
 *   ② 事务提交后异步 flush——网络抖动不影响开单；
 *   ③ ERP 侧 member_wallet_event 用 event_key 去重后原子入账。
 *
 * ── 模式开关 POS_WALLET_UPSTREAM（资金类改造必须可灰度、可回滚） ──────────
 *   off     完全不介入（等同改造前，纯本地记账）
 *   shadow  **默认**。本地余额照旧更新（零行为变化）+ 同时产出事件并推送。
 *           用途：线上双跑对账——比对两端增量是否一致；即便上行失败也只影响
 *           对账数据，门店收银链路完全不受牵连。
 *   strict  本地**不再**改 points / stored_value，余额以 ERP 下行为准。
 *           切换前置：shadow 期连续对账无差异 + 下行链路验证过。
 *
 * ⚠ 为什么 shadow 默认而不是直接 strict：
 *   这是资金字段。直接切 strict 而 ERP 上行不通或延迟，门店当场看不到会员余额，
 *   收银员无法判断能否积分抵扣/储值支付。先双跑是对业务的最小代价路径。
 */
import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { posWalletEvent } from '@server/database/schema';
import { RequestContext } from '@server/common/logging/request-context';
import { asc, eq, sql } from 'drizzle-orm';

/** 积分口径：points 为整数；储值单位「分」 */
export type WalletEventKind = 'points' | 'stored_value';

export type WalletSourceType = 'sale' | 'return' | 'omnichannel' | 'adjust';

export interface WalletEventInput {
  eventKey: string;
  /** POS 本地会员主键 */
  memberId: string;
  /** ERP 会员主键快照；为空表示门店本地会员尚未打通（见 S2 锚点） */
  erpMemberId?: string | null;
  kind: WalletEventKind;
  /** 增量，可为负（退货回冲） */
  changeValue: number;
  sourceType: WalletSourceType;
  sourceNo?: string;
  storeId?: string;
}

export interface FlushResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
  skippedNoAnchor: number;
}

/**
 * 幂等键构造。必须与 ERP member_wallet_event.event_key 的约定完全一致
 * （见 erp migrations/0022 注释：`{sourceType}:{sourceNo}:{kind}`）——
 * 两端判定「同一业务事实」的标准若不统一，幂等就形同虚设。
 */
export function walletEventKey(
  sourceType: WalletSourceType,
  sourceNo: string,
  kind: WalletEventKind,
): string {
  return `${sourceType}:${sourceNo}:${kind}`;
}

/** flush 单批次上限：门店断网重连后可能积压很多，一次处理太多会拖住主进程 */
const FLUSH_BATCH_SIZE = 100;
/** 重试上限：超过即转 failed，等待人工/定时重推（避免毒丸事件无限占用 flush 配额） */
const MAX_ATTEMPTS = 8;

@Injectable()
export class MemberWalletUpstreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MemberWalletUpstream');
  /** 并发保护：flush 是幂等的，重入只会重复扫同一批 pending */
  private flushing = false;
  /** 定期补推定时器（unref，不阻止进程退出） */
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * 定期补推。为什么不能只依赖「写入时立即推」：
   * 门店断网期间开出的单只会落在 outbox，恢复后必须有自愈通道把这段空窗补上。
   * 用零依赖 setInterval（与 ERP replenish-scheduler 同风格，本项目装不上 @nestjs/schedule）。
   */
  onModuleInit(): void {
    const intervalMs = Number(process.env.POS_WALLET_FLUSH_INTERVAL_MS ?? 60_000);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    this.timer = setInterval(() => {
      this.flushPending().catch((e) => {
        this.logger.warn(
          `[S3] 定时补推异常: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }, intervalMs);
    // 不能让这个定时器吊住进程退出（尤其是跑批/测试场景）
    this.timer.unref?.();
    this.logger.log(`[S3] 会员钱包补推任务已启动，间隔 ${intervalMs}ms，模式 ${this.mode}`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * 当前模式。每次调用都读 env —— 支持不停机改模式（配合重启亦可），
   * 也让单元测试可以直接改 process.env 控制分支。
   */
  get mode(): 'off' | 'shadow' | 'strict' {
    const m = (process.env.POS_WALLET_UPSTREAM ?? 'shadow').toLowerCase();
    return m === 'off' || m === 'strict' ? m : 'shadow';
  }

  /** 是否需要参与钱包上行（off 模式下调用方完全不用改代码路径） */
  get enabled(): boolean {
    return this.mode !== 'off';
  }

  /** strict 模式：本地不得自行改动会员资金余额 */
  get erpAuthoritative(): boolean {
    return this.mode === 'strict';
  }

  /**
   * 在**业务事务内**写入 outbox 行。
   *
   * 为什么必须跟着业务事务：若事务提交后在异步里补写，崩溃/断电窗口就会出现
   * 「销售单已成立但没有对应钱包事件」的资金缺口，且事后无法发现。
   *
   * 幂等：同一 eventKey 重复写（离线补传回放、业务重试）静默忽略。
   *
   * @returns 本次真正新增的行数（0 表示已存在）
   */
  async enqueue(tx: PostgresJsDatabase | PgTransaction<any, any, any>, rows: WalletEventInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    const inserted = await tx
      .insert(posWalletEvent)
      .values(
        rows.map((r) => ({
          eventKey: r.eventKey,
          memberId: r.memberId,
          erpMemberId: r.erpMemberId ?? null,
          kind: r.kind,
          changeValue: r.changeValue,
          sourceType: r.sourceType,
          sourceNo: r.sourceNo ?? null,
          storeId: r.storeId ?? null,
          // 无 ERP 锚点时不进 pending 队列——推上去 ERP 会因找不到会员而拒收，
          // 无限重试只会打满日志。落 skipped 便于 S2 回填锚点后重置为 pending 重推。
          status: r.erpMemberId ? 'pending' : 'skipped',
          attemptCount: 0,
        })),
      )
      .onConflictDoNothing({ target: posWalletEvent.eventKey })
      .returning({ id: posWalletEvent.id });
    return inserted.length;
  }

  /** 入队后立即尝试推送（失败不影响业务，留给 flush 重试） */
  kick(): void {
    this.flushPending().catch((e) => {
      this.logger.warn(
        `[S3] 钱包事件补推异常（不影响业务）: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }

  /**
   * 批量补推待办行。幂等且可重入：
   * - 选中 pending / failed 且未超重试上限的最早一批；
   * - 逐条 POST 到 ERP；成功转 sent，失败累加 attemptCount（超限转 failed）。
   */
  async flushPending(limit = FLUSH_BATCH_SIZE): Promise<FlushResult> {
    const result: FlushResult = { scanned: 0, sent: 0, failed: 0, skipped: 0, skippedNoAnchor: 0 };
    if (this.flushing) {
      result.skipped += 1;
      return result;
    }
    this.flushing = true;
    try {
      const rows = await this.db
        .select()
        .from(posWalletEvent)
        .where(
          sql`${posWalletEvent.status} IN ('pending','failed') AND ${posWalletEvent.attemptCount} < ${MAX_ATTEMPTS}`,
        )
        .orderBy(asc(posWalletEvent.createdAt))
        .limit(limit);
      result.scanned = rows.length;

      for (const row of rows) {
        // 缺少 ERP 锚点（门店本地新建会员尚未回流）→ 不推送，也不计失败
        if (!row.erpMemberId) {
          await this.db
            .update(posWalletEvent)
            .set({ status: 'skipped', lastError: '缺少 ERP 会员锚点（erp_member_id 为空）' })
            .where(eq(posWalletEvent.id, row.id));
          result.skippedNoAnchor += 1;
          continue;
        }
        try {
          await this.pushOne(row);
          await this.db
            .update(posWalletEvent)
            .set({
              status: 'sent',
              sentAt: sql`CURRENT_TIMESTAMP`,
              lastError: null,
            })
            .where(eq(posWalletEvent.id, row.id));
          result.sent += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const attempts = Number(row.attemptCount ?? 0) + 1;
          await this.db
            .update(posWalletEvent)
            .set({
              status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
              attemptCount: attempts,
              lastError: msg.slice(0, 500),
            })
            .where(eq(posWalletEvent.id, row.id));
          result.failed += 1;
        }
      }
      return result;
    } finally {
      this.flushing = false;
    }
  }

  /** 单条上行。与 RealErpAdapter.pushToErp 保持同一套鉴权/链路头。 */
  private async pushOne(row: {
    eventKey: string;
    erpMemberId?: string | null;
    kind: string;
    changeValue: number;
    sourceType: string;
    sourceNo?: string | null;
    storeId?: string | null;
  }): Promise<void> {
    const baseUrl = process.env.ERP_UPSTREAM_BASE_URL ?? '';
    if (!baseUrl) {
      throw new Error('ERP 上游未配置（请设置环境变量 ERP_UPSTREAM_BASE_URL）');
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/pos-receiver/member-wallet-events`;
    const traceId =
      RequestContext.getTraceId() ?? RequestContext.getRequestId() ?? `wallet:${row.eventKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 幂等语义以 body.eventKey 为准：HTTP 头每次重试 attempt 会变，
          // 不足以表达「同一业务事实」（见 ERP pos-receiver.controller 注释）。
          'Idempotency-Key': row.eventKey,
          'X-Erp-Upstream-Token': process.env.ERP_UPSTREAM_TOKEN ?? '',
          'X-Request-Id': traceId,
          'X-Trace-Id': traceId,
        },
        body: JSON.stringify({
          eventKey: row.eventKey,
          memberId: row.erpMemberId,
          kind: row.kind,
          changeValue: Number(row.changeValue),
          sourceType: row.sourceType,
          sourceNo: row.sourceNo ?? undefined,
          storeCode: row.storeId ?? undefined,
        }),
        signal: controller.signal,
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`ERP 返回 ${resp.status}: ${text.slice(0, 200)}`);
      }
      // ERP 侧业务性拒收（会员不存在 / 储值透支）返回 200 + status=rejected。
      // 这里**不抛错**：重试也救不回来，交给运营对账补单；但要在日志里留痕。
      try {
        const json = JSON.parse(text) as { status?: string; message?: string };
        if (json?.status === 'rejected') {
          this.logger.warn(
            `[S3] 钱包事件被 ERP 拒收（需人工对账）eventKey=${row.eventKey} reason=${json.message ?? ''}`,
          );
        }
      } catch {
        // 非 JSON 响应：2xx 视为成功，与既有上行口径一致
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
