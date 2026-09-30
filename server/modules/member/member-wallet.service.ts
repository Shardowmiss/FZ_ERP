import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { desc, eq, sql } from 'drizzle-orm';
import { member, memberPoint, memberWalletEvent } from '@server/database/schema';

/** POS 上行的一次钱包变动 */
export interface ApplyWalletEventDto {
  /** 幂等键：{sourceType}:{sourceNo}:{kind}，如 sale:SO20261001-0001:points */
  eventKey: string;
  /** ERP 会员主键（由 POS 侧 erp_member_id 身份锚点映射而来，见 S2） */
  memberId: string;
  /** points（整数积分）| stored_value（储值，单位=分） */
  kind: 'points' | 'stored_value';
  /** 增量，可为负（退货回冲） */
  changeValue: number;
  /** sale | return | omnichannel | adjust */
  sourceType: string;
  sourceNo?: string;
  storeCode?: string;
}

export interface WalletEventResult {
  eventKey: string;
  /** true = 该事件此前已处理过，本次直接返回原结果，未重复入账 */
  duplicated: boolean;
  /** applied（已入账）| rejected（被拒，见 message） */
  status: 'applied' | 'rejected';
  /** 入账后余额（rejected 时为 0） */
  balanceAfter: number;
  message?: string;
}

/**
 * S3 会员钱包入账服务 —— **ERP 作为会员钱包的唯一账本方**。
 *
 * 背景：POS 门店原先在 sales / returns / omnichannel 三处各自本地累加
 * `pos_member.points` / `stored_value`；而 ERP 只在「零售单结算」时加积分
 * （retail.service.ts:556），且 POS 上行销售单走 pos-receiver.receiveSales，
 * 建的是 status='completed' 的 retail_order，**不经过 settleRetailOrder**，
 * 因此 ERP 侧根本不会为门店消费加积分 —— 两端各记一套、互不打通。
 *
 * 本服务把门店每笔钱包变动收编为**幂等事件**，由 ERP 统一入账：
 *
 * 1. **幂等第一**：先以 `event_key`（唯一索引）占位。
 *    `ON CONFLICT DO NOTHING` 返回空 ⇒ 说明同一业务事实已入过账，
 *    直接返回原结果。因此「重试 / 离线补传 / 重放」都不会重复加。
 * 2. **余额原子更新**：在 SQL 层做 `column + value`，不用「读-算-写」，
 *    避免并发下丢失更新。
 * 3. **rejected 也占位**：会员不存在 / 储值透支这类**重试无意义**的情形，
 *    落 status='rejected' 而不是抛异常，防止 POS 端形成毒丸无限重试。
 *    ⚠ 副作用：若会员随后才被下行补齐，该事件不会自动重放，
 *      需由运营对账（可按 source_no 查本表）后补单。
 * 4. **流水留痕**：points 变动同步写 `member_point`，
 *    与既有 `MemberService.adjustPoints` 口径保持一致。
 */
@Injectable()
export class MemberWalletService {
  private readonly logger = new Logger(MemberWalletService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /**
   * 入账一条 POS 上行事件（幂等）。
   * 同一 eventKey 重复调用永远只入账一次。
   */
  async applyWalletEvent(dto: ApplyWalletEventDto): Promise<WalletEventResult> {
    return this.db.transaction(async (tx) => {
      // ① 幂等占位
      const [claimed] = await tx
        .insert(memberWalletEvent)
        .values({
          eventKey: dto.eventKey,
          memberId: dto.memberId,
          kind: dto.kind,
          changeValue: dto.changeValue,
          // 占位写 0；事务未提交前对其他会话不可见，最终由 ④ 回写真实余额
          balanceAfter: 0,
          sourceType: dto.sourceType,
          sourceNo: dto.sourceNo ?? null,
          storeCode: dto.storeCode ?? null,
          status: 'applied',
        })
        .onConflictDoNothing({ target: memberWalletEvent.eventKey })
        .returning({ id: memberWalletEvent.id });

      // ② 已处理过 → 原样返回，绝不重复加
      if (!claimed) {
        const [prev] = await tx
          .select({
            status: memberWalletEvent.status,
            balanceAfter: memberWalletEvent.balanceAfter,
            message: memberWalletEvent.message,
          })
          .from(memberWalletEvent)
          .where(eq(memberWalletEvent.eventKey, dto.eventKey))
          .limit(1);
        this.logger.warn(
          `[S3] 重复事件已跳过 eventKey=${dto.eventKey} prevStatus=${prev?.status ?? 'unknown'}`,
        );
        return {
          eventKey: dto.eventKey,
          duplicated: true,
          status: (prev?.status as WalletEventResult['status']) ?? 'applied',
          balanceAfter: Number(prev?.balanceAfter ?? 0),
          message: prev?.message ?? undefined,
        };
      }

      const reject = async (message: string): Promise<WalletEventResult> => {
        await tx
          .update(memberWalletEvent)
          .set({ status: 'rejected', message })
          .where(eq(memberWalletEvent.id, claimed.id));
        return { eventKey: dto.eventKey, duplicated: false, status: 'rejected', balanceAfter: 0, message };
      };

      // ③ 会员存在性
      const [m] = await tx
        .select({ id: member.id })
        .from(member)
        .where(eq(member.id, dto.memberId))
        .limit(1);
      if (!m) {
        return reject(
          `会员不存在（memberId=${dto.memberId}）：该会员尚未下行到 ERP，待主数据同步补齐后需人工补单`,
        );
      }

      let balanceAfter: number;

      if (dto.kind === 'points') {
        // ④ 原子余额更新（SQL 层加法，避免并发丢失更新）
        const [upd] = await tx
          .update(member)
          .set({ points: sql`${member.points} + ${dto.changeValue}` })
          .where(eq(member.id, dto.memberId))
          .returning({ points: member.points });
        balanceAfter = Number(upd?.points ?? 0);

        // ⑤ 流水留痕，与 MemberService.adjustPoints 口径一致
        await tx.insert(memberPoint).values({
          memberId: dto.memberId,
          changeType: dto.sourceType,
          changeValue: dto.changeValue,
          balance: balanceAfter,
          remark: `POS 上行：${dto.sourceNo ?? '-'}${dto.storeCode ? ` @${dto.storeCode}` : ''}`,
        });
      } else {
        // 储值：禁止透支
        const [cur] = await tx
          .select({ storedValue: member.storedValue })
          .from(member)
          .where(eq(member.id, dto.memberId))
          .limit(1);
        const curNum = Number(cur?.storedValue ?? 0);
        if (curNum + dto.changeValue < 0) {
          return reject(
            `储值透支：当前 ${curNum} 分，本次 ${dto.changeValue} 分（会员 ${dto.memberId}）`,
          );
        }
        const [upd] = await tx
          .update(member)
          .set({ storedValue: sql`${member.storedValue} + ${dto.changeValue}` })
          .where(eq(member.id, dto.memberId))
          .returning({ storedValue: member.storedValue });
        balanceAfter = Number(upd?.storedValue ?? 0);
      }

      await tx
        .update(memberWalletEvent)
        .set({ balanceAfter, status: 'applied' })
        .where(eq(memberWalletEvent.id, claimed.id));

      return { eventKey: dto.eventKey, duplicated: false, status: 'applied', balanceAfter };
    });
  }

  /**
   * 查询某会员的钱包事件流水（对账用）。
   * 典型用法：POS 侧怀疑某笔单据没加分 → 按 sourceNo 查这条是否有 applied 记录。
   */
  async listWalletEvents(memberId: string, limit = 50) {
    const rows = await this.db
      .select()
      .from(memberWalletEvent)
      .where(eq(memberWalletEvent.memberId, memberId))
      .orderBy(desc(memberWalletEvent.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      eventKey: r.eventKey,
      kind: r.kind,
      changeValue: r.changeValue,
      balanceAfter: r.balanceAfter,
      sourceType: r.sourceType,
      sourceNo: r.sourceNo,
      storeCode: r.storeCode,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
    }));
  }
}
