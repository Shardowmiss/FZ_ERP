import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { hostname } from 'node:os';

/**
 * 事件处理器签名：拿到载荷与事件元信息，执行幂等副作用。
 * 抛错会被 dispatcher 计入重试；达到上限后该事件转 failed（死信）。
 */
export type EventHandler = (
  payload: any,
  event: { id: string; eventType: string },
) => Promise<void> | void;

/** 发布事件的入参。 */
export interface DomainEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload?: unknown;
}

/**
 * Wave 2-1 纯 PG 事件总线（outbox 模式，零新基础设施）。
 *
 * 为什么是 outbox：业务写路径在「同一个事务」里把领域事件落进 domain_event 表，
 * 再由本服务异步派发。相比直接调 MQ / Redis，它复用既有 PG、满足平台 anon_ 权限模型、
 * 单/多实例均正确，且后续接 Redis 只需把派发目标换掉，表结构不变。
 *
 * 派发模型：
 *   · 业务侧 `publish()` 同步 INSERT 一条 status='pending' 的事件，并 `pg_notify` 唤醒。
 *   · 本服务作为 Dispatcher：通过 `pg_try_advisory_lock` 做 Leader 选举（多实例只有
 *     一个 Leader 真正派发），Leader 上 `LISTEN domain_event` 即时唤醒 + 周期轮询兜底。
 *   · `dispatchPending()` 在事务内 `SELECT ... FOR UPDATE SKIP LOCKED` 认领单条、置
 *     processing，再调注册的处理器；成功置 dispatched，失败按重试次数置回 pending 或
 *     failed（死信，需人工/对账）。崩溃卡住的 processing 行超阈值复位回 pending。
 *
 * 幂等：dispatched / failed 不会被重新选中；同一事件只会被一个 Leader 认领（行锁）。
 * 可测：测试可直接 `new EventBusService(db)` 后调 `publish()` + `dispatchPending()`，
 *       不依赖 Leader / 轮询（onModuleInit 由 Nest 触发，单测不触发即无后台干扰）。
 */
const POLL_INTERVAL_MS = Number(process.env.EVENT_BUS_POLL_MS ?? 5000);
const MAX_ATTEMPTS = Number(process.env.EVENT_BUS_MAX_ATTEMPTS ?? 5);
const STUCK_THRESHOLD_MIN = Number(process.env.EVENT_BUS_STUCK_MIN ?? 10);
// 与补货调度器 Leader 锁错开，避免两把锁互相干扰。
const ADVISORY_LOCK_KEY = 915037127n;

@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly handlers = new Map<string, EventHandler>();
  private readonly nodeId = `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly maxAttempts = MAX_ATTEMPTS > 0 ? MAX_ATTEMPTS : 5;
  private readonly stuckThresholdMin = STUCK_THRESHOLD_MIN > 0 ? STUCK_THRESHOLD_MIN : 10;
  private pollTimer?: NodeJS.Timeout;
  private reelectionTimer?: NodeJS.Timeout;
  private reservedConn?: any;
  private isLeader = false;
  private listenHandler?: (payload: string) => void;

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 注册某事件类型的处理器；dispatcher 派发时回调（'*' 为兜底通配）。 */
  registerHandler(eventType: string, handler: EventHandler): void {
    this.handlers.set(eventType, handler);
    this.logger.log(`注册事件处理器: ${eventType}（当前共 ${this.handlers.size} 个）`);
  }

  async onModuleInit(): Promise<void> {
    await this.tryBecomeLeader();
  }

  onModuleDestroy(): void {
    this.stopTimers();
    void this.releaseLeadership().catch(() => undefined);
  }

  /* ---------------- Leader 选举（复用补货调度器范式） ---------------- */

  private async tryBecomeLeader(): Promise<void> {
    try {
      const client = (this.db as any).$client;
      if (!client?.reserve) {
        this.logger.warn('底层客户端不支持 reserve，事件总线降级为单实例运行（仍正常派发）');
        this.isLeader = true;
        this.startPolling();
        return;
      }
      this.reservedConn = await client.reserve();
      const res = await this.reservedConn`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
      if (res?.[0]?.locked === true) {
        this.isLeader = true;
        this.logger.log(`成为事件总线 Dispatcher Leader（node=${this.nodeId}）`);
        await this.startListening();
        this.startPolling();
      } else {
        this.isLeader = false;
        this.logger.log(`未获取事件总线锁，作为 Follower 待命（node=${this.nodeId}）`);
        this.startReelection();
      }
    } catch (e: any) {
      this.logger.error(`事件总线 Leader 选举失败，降级单实例：${e?.message}`, e?.stack);
      this.isLeader = true;
      this.startPolling();
    }
  }

  private async startListening(): Promise<void> {
    if (!this.reservedConn) return;
    try {
      await this.reservedConn`LISTEN domain_event`;
      this.listenHandler = () => {
        void this.dispatchPending(50).catch((e) => this.logger.error('LISTEN 唤醒 dispatch 失败', e));
      };
      this.reservedConn.on('domain_event', this.listenHandler);
      this.logger.log('已 LISTEN domain_event（NOTIFY 即时唤醒 dispatcher）');
    } catch (e: any) {
      this.logger.warn(`LISTEN domain_event 失败，仅依赖轮询：${e?.message}`);
    }
  }

  private startReelection(): void {
    if (this.reelectionTimer) return;
    this.reelectionTimer = setInterval(() => {
      void this.tryAcquireLockOnly().catch((e) => this.logger.error('事件总线重选异常', e));
    }, 30_000);
  }

  private async tryAcquireLockOnly(): Promise<void> {
    if (this.isLeader || !this.reservedConn) return;
    const res = await this.reservedConn`select pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) as locked`;
    if (res?.[0]?.locked === true) {
      this.isLeader = true;
      this.logger.log(`Follower 提升为事件总线 Leader（node=${this.nodeId}），开始派发`);
      if (this.reelectionTimer) {
        clearInterval(this.reelectionTimer);
        this.reelectionTimer = undefined;
      }
      await this.startListening();
      this.startPolling();
    }
  }

  private async releaseLeadership(): Promise<void> {
    if (this.reservedConn) {
      try {
        if (this.listenHandler) await this.reservedConn.unlisten?.('domain_event');
      } catch {
        /* ignore */
      }
      try {
        await this.reservedConn`select pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
      } catch {
        /* 锁可能已随连接释放 */
      }
      try {
        await this.reservedConn.release();
      } catch {
        /* 连接已断 */
      }
      this.reservedConn = undefined;
    }
  }

  private startPolling(): void {
    if (this.pollTimer || POLL_INTERVAL_MS <= 0) return;
    this.pollTimer = setInterval(() => {
      void this.dispatchPending(50).catch((e) => this.logger.error('事件总线轮询派发异常', e));
    }, POLL_INTERVAL_MS);
    this.logger.log(`事件总线轮询派发已启动（周期 ${POLL_INTERVAL_MS}ms）`);
  }

  private stopTimers(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.reelectionTimer) {
      clearInterval(this.reelectionTimer);
      this.reelectionTimer = undefined;
    }
  }

  /* ---------------- 发布 ---------------- */

  /** 同步落一条 pending 事件到 outbox，并尝试唤醒 dispatcher（LISTEN 即时 / 轮询兜底）。 */
  async publish(input: DomainEventInput): Promise<string> {
    const rows = (await this.db.execute(sql`
      INSERT INTO domain_event (aggregate_type, aggregate_id, event_type, payload, status, attempts)
      VALUES (
        ${input.aggregateType},
        ${input.aggregateId},
        ${input.eventType},
        ${JSON.stringify(input.payload ?? {})}::jsonb,
        'pending',
        0
      )
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    const id = rows[0]?.id;
    // 唤醒 dispatcher：Listener 即时触发；若无 Listener（降级单实例）则靠轮询兜底。
    await this.db.execute(sql`SELECT pg_notify('domain_event', ${input.eventType})`).catch(() => undefined);
    return id;
  }

  /* ---------------- 派发 ---------------- */

  /**
   * 派发最多 limit 条 pending 事件。每条在事务内认领（FOR UPDATE SKIP LOCKED + 置
   * processing），再由注册的处理器执行；成功置 dispatched，失败按重试次数置回 pending
   * 或 failed（死信）。幂等：已 dispatched/failed 不会被重新选中。
   * 测试可直接调用本方法（不依赖 Leader / 轮询）。
   */
  async dispatchPending(limit = 50): Promise<number> {
    // 兜底：把崩溃中卡住的 processing 行复位为 pending（超过阈值才复位，避免误伤在途事件）。
    const intervalExpr = `${this.stuckThresholdMin} minutes`;
    await this.db
      .execute(sql`
        UPDATE domain_event
        SET status = 'pending', processing_since = NULL
        WHERE status = 'processing'
          AND processing_since < now() - (${intervalExpr})::interval
      `)
      .catch(() => undefined);

    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      let claimed: any = null;
      try {
        claimed = await this.db.transaction(async (tx) => {
          const rows = (await tx.execute(sql`
            SELECT id, aggregate_type, aggregate_id, event_type, payload, attempts
            FROM domain_event
            WHERE status = 'pending'
            ORDER BY _created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `)) as unknown as Array<any>;
          if (!rows.length) return null;
          const ev = rows[0];
          await tx.execute(
            sql`UPDATE domain_event SET status = 'processing', processing_since = now() WHERE id = ${ev.id}`,
          );
          return ev;
        });
      } catch (e: any) {
        this.logger.error(`认领事件失败（本轮停止，下个周期重试）：${e?.message}`, e?.stack);
        break;
      }
      if (!claimed) break;
      await this.handleOne(claimed);
      processed += 1;
    }
    return processed;
  }

  private async handleOne(ev: any): Promise<void> {
    const handler = this.handlers.get(ev.event_type) ?? this.handlers.get('*');
    try {
      if (handler) await handler(ev.payload, { id: ev.id, eventType: ev.event_type });
      await this.db.execute(sql`
        UPDATE domain_event
        SET status = 'dispatched', dispatched_at = now(), attempts = ${ev.attempts + 1},
            processing_since = NULL, last_error = NULL
        WHERE id = ${ev.id}
      `);
      this.logger.debug(`事件已派发 ${ev.id} (${ev.event_type})`);
    } catch (e: any) {
      const attempts = ev.attempts + 1;
      const failed = attempts >= this.maxAttempts;
      const msg = String(e?.message ?? e).slice(0, 2000);
      await this.db.execute(sql`
        UPDATE domain_event
        SET status = ${failed ? 'failed' : 'pending'}, attempts = ${attempts},
            last_error = ${msg}, processing_since = NULL
        WHERE id = ${ev.id}
      `);
      this.logger.error(`事件处理失败 ${ev.id} (${ev.event_type}) 第 ${attempts} 次：${msg}`);
    }
  }
}
