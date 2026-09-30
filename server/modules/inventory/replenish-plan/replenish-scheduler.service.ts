import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { hostname } from 'node:os';
import { ReplenishTemplateService } from './replenish-template.service';

/**
 * 补货定时生成调度器（零依赖实现）。
 *
 * 设计取舍：本仓库未引入 @nestjs/schedule / cron 依赖，故以
 * `setInterval` + 轻量 5 字段 cron 匹配实现等价能力。每 30s 轮询一次，
 * 命中“当前分钟”且本分钟尚未执行过的启用模板即触发自动生成。
 *
 * 优点：无新依赖、易本地验证（把 cron 设为 `* * * * *` 可每分钟触发）；
 * 缺点：进程重启后未执行的历史分钟不会补跑（对“生成草稿”这类容错场景可接受）。
 *
 * 集群化（2026-09-30 补强）：原生 `setInterval` 在“多实例部署”场景下会导致
 * 多个节点同时触发同一模板，重复生成补货单。本实现用 Postgres 会话级咨询锁
 * （`pg_try_advisory_lock`）做 Leader 选举——只有持有锁的节点（Leader）才轮询与生成，
 * 其余节点作为 Follower 待命并周期性重试夺锁（实现故障切换）。锁在节点退出时由
 * 保留连接释放、自动失效，无需额外表或依赖。
 * 单实例（本地/dev）行为与原先完全一致；若底层客户端不支持 reserve，则降级为
 * 单实例运行并打日志，不阻断业务。
 */
const ADVISORY_LOCK_KEY = 915037126n; // 补货调度器 Leader 选举锁（固定 bigint 键）

@Injectable()
export class ReplenishSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplenishSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private reelectionTimer?: NodeJS.Timeout;
  private readonly running = new Set<string>();
  private lastMinuteKey = '';
  private isLeader = false;
  private lockConn?: { release: () => Promise<void> } & ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>);
  private readonly nodeId = `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private readonly templateService: ReplenishTemplateService,
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async onModuleInit() {
    await this.tryBecomeLeader();
  }

  onModuleDestroy() {
    this.stop();
    void this.releaseLeadership().catch(() => undefined);
  }

  /** 尝试获取 Leader 锁；成功则成为 Leader 并开始轮询，失败则作为 Follower 待命。 */
  private async tryBecomeLeader() {
    try {
      const client = (this.db as unknown as { $client?: any }).$client;
      if (!client?.reserve) {
        this.logger.warn('底层数据库客户端不支持 reserve，降级为单实例运行（仍正常调度）');
        this.isLeader = true;
        this.start();
        return;
      }
      this.lockConn = await client.reserve();
      const res = await (this.lockConn as any)`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
      if (res?.[0]?.locked === true) {
        this.isLeader = true;
        this.logger.log(`成为补货调度 Leader（node=${this.nodeId}），开始轮询`);
        this.start();
      } else {
        this.isLeader = false;
        this.logger.log(`未获取调度锁，作为 Follower 待命（node=${this.nodeId}）`);
        this.startReelection();
      }
    } catch (e: any) {
      this.logger.error(`Leader 选举失败，降级为单实例运行：${e?.message}`, e?.stack);
      this.isLeader = true;
      this.start();
    }
  }

  /** Follower 每 30s 重试夺锁，实现 Leader 故障切换。 */
  private startReelection() {
    if (this.reelectionTimer) return;
    this.reelectionTimer = setInterval(() => {
      void this.tryAcquireLockOnly().catch((e) => this.logger.error('重新选举异常', e));
    }, 30_000);
  }

  private async tryAcquireLockOnly() {
    if (this.isLeader || !this.lockConn) return;
    const res = await (this.lockConn as any)`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
    if (res?.[0]?.locked === true) {
      this.isLeader = true;
      this.logger.log(`Follower 提升为 Leader（node=${this.nodeId}），开始轮询`);
      if (this.reelectionTimer) {
        clearInterval(this.reelectionTimer);
        this.reelectionTimer = undefined;
      }
      this.start();
    }
  }

  private async releaseLeadership() {
    if (this.lockConn) {
      try {
        await (this.lockConn as any)`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
      } catch {
        /* 锁可能已随连接释放，忽略 */
      }
      try {
        await this.lockConn.release();
      } catch {
        /* 连接已断开，忽略 */
      }
      this.lockConn = undefined;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.logger.error('补货调度轮询异常', e));
    }, 30_000);
    this.logger.log('补货定时生成调度器已启动（轮询周期 30s）');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.reelectionTimer) {
      clearInterval(this.reelectionTimer);
      this.reelectionTimer = undefined;
    }
    this.logger.log('补货定时生成调度器已停止');
  }

  /** 供手动触发与测试：立即执行某个模板一次。 */
  async manualRun(templateId: string) {
    return this.runTemplate(templateId, true);
  }

  async tick() {
    const now = new Date();
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (this.lastMinuteKey === minuteKey) return; // 本分钟已评估过
    this.lastMinuteKey = minuteKey;

    const templates = await this.templateService.listEnabled();
    for (const tpl of templates) {
      if (tpl.cron && matchCron(tpl.cron, now)) {
        this.logger.log(`触发模板[${tpl.code}]的定时补货生成`);
        // 不 await，避免阻塞轮询；失败已在 runTemplate 内记录
        void this.runTemplate(tpl.id, false);
      }
    }
  }

  private async runTemplate(templateId: string, manual: boolean) {
    if (this.running.has(templateId)) {
      this.logger.warn(`模板[${templateId}]已有生成任务在运行，跳过`);
      return;
    }
    this.running.add(templateId);
    try {
      const summary = await this.templateService.executeTemplate(templateId);
      if (manual) {
        this.logger.log(
          `手动执行模板完成：${summary.successStores}/${summary.totalStores} 门店成功，生成 ${summary.totalDocs} 单`,
        );
      }
      return summary;
    } catch (e: any) {
      this.logger.error(`模板[${templateId}]执行失败: ${e?.message}`, e?.stack);
    } finally {
      this.running.delete(templateId);
    }
  }
}

/**
 * 轻量 5 字段 cron 匹配（分 时 日 月 周）。
 * 支持：* (通配)、a (单值)、a-b (区间)、a,b (列表)、a-b/step (步长) 等写法，以及逗号组合。
 * 字段取值：分 0-59 / 时 0-23 / 日 1-31 / 月 1-12 / 周 0-6（0=周日）。
 * 当“日”与“周”均非 * 时按标准 cron 取 OR。
 */
export function matchCron(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [m, h, dom, mon, dow] = fields;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1;
  const dayOfWeek = date.getDay();

  if (!matchField(m, minute, 0, 59)) return false;
  if (!matchField(h, hour, 0, 23)) return false;
  if (!matchField(mon, month, 1, 12)) return false;

  const domStar = dom === '*';
  const dowStar = dow === '*';
  const domMatch = matchField(dom, dayOfMonth, 1, 31);
  const dowMatch = matchField(dow, dayOfWeek, 0, 6);
  if (domStar && dowStar) return true;
  if (domStar) return dowMatch;
  if (dowStar) return domMatch;
  return domMatch && dowMatch;
}

function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (!Number.isFinite(step) || step <= 0) continue;
      let start = min;
      let end = max;
      if (range !== '*' && range.includes('-')) {
        [start, end] = range.split('-').map((x) => parseInt(x, 10));
      }
      if (range !== '*' && !range.includes('-')) start = end = parseInt(range, 10);
      if (
        value >= start &&
        value <= end &&
        (value - start) % step === 0
      )
        return true;
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map((x) => parseInt(x, 10));
      if (value >= a && value <= b) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}
