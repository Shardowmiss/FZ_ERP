/**
 * W2-1 纯 PG 事件总线（outbox + LISTEN/NOTIFY + 轮询派发）—— 真库 erp_test 回归。
 *
 * 为什么跑真库（trust-but-verify，拒绝 mock 假绿）：
 *   · 验证点全部落在 PG 语义上：INSERT ... RETURNING 落 outbox、status 状态机
 *     （pending→processing→dispatched / failed）、FOR UPDATE SKIP LOCKED 认领、
 *     pg_notify 唤醒、死信重试次数上限；
 *   · 这些只有真 PG 能验证，mock 只能验证"我们拼的 SQL 长什么样"。
 *
 * 隔离策略：与 master-data-merge.spec 同一约定——模块级 client/db，beforeEach 清空
 * domain_event 保证用例互不影响；EventBusService 不触发 onModuleInit（不 Leader 选举 /
 * 不 LISTEN / 不轮询），直接 new 后调 publish()+dispatchPending()，避免后台计时器干扰。
 * afterAll 再 truncate 一次，确保对 erp_test 零残留（0 泄漏）。
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestClient, createTestDb, TEST_DB_NAME } from './utils/db';
import { EventBusService } from '@server/modules/events/event-bus.service';
import { CacheInvalidationSubscriber } from '@server/modules/events/cache-invalidation.subscriber';
import { domainEvent } from '@server/database/schema';

const client = createTestClient();
const db = createTestDb(client);
// 模块级单例：仅用于 publish/dispatchPending 单测，不触发 Leader 选举（不调 onModuleInit）。
const bus = new EventBusService(db as never);

afterAll(async () => {
  await db.execute(sql`truncate domain_event`).catch(() => undefined); // 0 泄漏收尾
  await client.end().catch(() => undefined);
});

beforeEach(async () => {
  await db.execute(sql`truncate domain_event`).catch(() => undefined); // 用例隔离
});

describe('W2-1 EventBusService（纯 PG 事件总线，真库 erp_test）', () => {
  it('测试库不是开发库（防止误擦 erp_db）', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
  });

  it('1) publish 落 pending 行；无 handler 时 dispatchPending 仍置 dispatched（终态）', async () => {
    const id = await bus.publish({
      aggregateType: 'pricing',
      aggregateId: 'active',
      eventType: 'cache.invalidate',
      payload: { keys: ['pricing:activeLists:2026-10-05'] },
    });
    expect(id).toBeTruthy();

    let rows = await db.select().from(domainEvent);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].attempts).toBe(0);

    const processed = await bus.dispatchPending(10);
    expect(processed).toBe(1);

    rows = await db.select().from(domainEvent);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('dispatched');
    expect(rows[0].dispatchedAt).not.toBeNull();
    expect(rows[0].attempts).toBe(1);
  });

  it('2) 失败路径：handler 抛错达上限 → failed 死信（last_error 记录，重试停止）', async () => {
    // 用极低重试上限验证死信阈值。
    // 注意：MAX_ATTEMPTS / STUCK_THRESHOLD_MIN 是模块级常量（模块加载时定格），
    // 运行期改 process.env 无效；测试直接覆盖实例字段以隔离验证阈值逻辑。
    const bus2 = new EventBusService(db as never);
    (bus2 as unknown as { maxAttempts: number }).maxAttempts = 3;
    bus2.registerHandler('boom', async () => {
      throw new Error('kaboom');
    });

    await bus2.publish({
      aggregateType: 'x',
      aggregateId: '1',
      eventType: 'boom',
      payload: {},
    });

    // 每次 dispatchPending 失败 +1 attempts，达上限转 failed。
    await bus2.dispatchPending(10);
    await bus2.dispatchPending(10);
    await bus2.dispatchPending(10);

    // 超过上限后不再重试（无法升级为 dispatched）。
    await bus2.dispatchPending(10);

    const rows = await db.select().from(domainEvent);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempts).toBe(3);
    expect(String(rows[0].lastError)).toContain('kaboom');
  });

  it('3) 幂等：dispatched 行不会被重复派发', async () => {
    await bus.publish({
      aggregateType: 'p',
      aggregateId: '1',
      eventType: 'noop',
      payload: {},
    });
    const p1 = await bus.dispatchPending(10);
    expect(p1).toBe(1);
    const p2 = await bus.dispatchPending(10);
    expect(p2).toBe(0); // 已全 dispatched，无可派发
  });

  it('4) 限流（limit）只认领 N 条；其余留待下个周期', async () => {
    for (let i = 0; i < 5; i += 1) {
      await bus.publish({
        aggregateType: 'p',
        aggregateId: `k${i}`,
        eventType: 'noop',
        payload: {},
      });
    }
    expect((await db.select().from(domainEvent)).length).toBe(5);
    const processed = await bus.dispatchPending(2); // 只派发 2 条
    expect(processed).toBe(2);
    const remain = await db.select().from(domainEvent).where(sql`status = 'pending'`);
    expect(remain.length).toBe(3);
  });

  it('5) cache.invalidate 集成：发布 → 派发 → CacheInvalidationSubscriber 失效键', async () => {
    // 内存缓存替身：满足 @nestjs/cache-manager 的 Cache 接口（get/set/del）。
    const store = new Map<string, unknown>();
    store.set('pricing:activeLists:2026-10-05', 'stale');
    store.set('pricing:activePromos:2026-10-05', 'stale');
    const fakeCache = {
      get: async (k: string) => store.get(k),
      set: async (k: string, v: unknown) => {
        store.set(k, v);
      },
      del: async (k: string) => {
        store.delete(k);
      },
    } as any;

    const sub = new CacheInvalidationSubscriber(fakeCache, bus);
    sub.onModuleInit(); // 注册 'cache.invalidate' handler

    await bus.publish({
      aggregateType: 'pricing',
      aggregateId: 'active',
      eventType: 'cache.invalidate',
      payload: {
        keys: ['pricing:activeLists:2026-10-05', 'pricing:activePromos:2026-10-05'],
      },
    });

    const processed = await bus.dispatchPending(10);
    expect(processed).toBe(1);

    // 订阅者已真正删除这两个键（验证事件总线首切片端到端打通）。
    expect(store.has('pricing:activeLists:2026-10-05')).toBe(false);
    expect(store.has('pricing:activePromos:2026-10-05')).toBe(false);

    const rows = await db.select().from(domainEvent);
    expect(rows[0].status).toBe('dispatched');
  });
});
