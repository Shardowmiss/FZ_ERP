import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { MemberWalletUpstreamService, walletEventKey } from './member-wallet-upstream.service';
import { posWalletEvent } from '@server/database/schema';
import { eq } from 'drizzle-orm';

/**
 * S3 收口的核心不变量：POS 只「产出钱包事件」，ERP 是唯一账本方。
 * 本 spec 锁死四件事：
 *   1. enqueue 在库内落 pending 行，且同一 event_key 幂等去重（不会双写）；
 *   2. 缺 ERP 锚点（门店本地会员未打通）的行落 skipped，不进推送队列；
 *   3. flushPending 推送成功后把行置 sent，且 ERP 收到的 payload 字段正确；
 *   4. 推送失败（HTTP 非 2xx）累加 attemptCount 并保留 pending 待重试，不丢事件。
 *
 * 不依赖真实 ERP：用 vi.stubGlobal 替换 fetch，断言上行 payload。
 */
describe('MemberWalletUpstreamService (S3 出箱 + 幂等 + 推送)', () => {
  let testDb: TestDb;
  let svc: MemberWalletUpstreamService;
  const ERP_BASE = 'http://mock-erp.test';

  // pos_wallet_event.member_id / erp_member_id 均为 uuid 列，必须用合法 UUID，
  // 否则 pglite 报 invalid input syntax for type uuid（与真库行为一致）。
  const UUID = {
    m1: '11111111-1111-4111-8111-111111111111',
    erp1: '22222222-2222-4222-8222-222222222222',
    m2: '33333333-3333-4333-8333-333333333333',
    m3: '44444444-4444-4444-8444-444444444444',
    erp3: '55555555-5555-4555-8555-555555555555',
    m4: '66666666-6666-4666-8666-666666666666',
    erp4: '77777777-7777-4777-8777-777777777777',
  };

  beforeEach(async () => {
    testDb = await setupTestDb();
    svc = new MemberWalletUpstreamService(testDb.db);
    process.env.ERP_UPSTREAM_BASE_URL = ERP_BASE;
    process.env.ERP_UPSTREAM_TOKEN = 'test-token';
    process.env.POS_WALLET_UPSTREAM = 'shadow';
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await testDb.pg.close();
  });

  it('enqueue 落 pending 行，幂等键重复时静默忽略（不双写）', async () => {
    const key = walletEventKey('sale', 'ORD-1', 'points');
    const rows1 = [
      {
        eventKey: key,
        memberId: UUID.m1,
        erpMemberId: UUID.erp1,
        kind: 'points' as const,
        changeValue: 10,
        sourceType: 'sale' as const,
        sourceNo: 'ORD-1',
        storeId: 'ST-1',
      },
    ];
    const n1 = await svc.enqueue(testDb.db, rows1);
    expect(n1).toBe(1);
    // 同一业务事实重放（离线补传/业务重试）→ 不应再产生一行
    const n2 = await svc.enqueue(testDb.db, rows1);
    expect(n2).toBe(0);

    const rows = await testDb.db.select().from(posWalletEvent).where(eq(posWalletEvent.eventKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(Number(rows[0].changeValue)).toBe(10);
  });

  it('缺 ERP 锚点时落 skipped，不进推送队列（避免无限重试打满日志）', async () => {
    const key = walletEventKey('sale', 'ORD-2', 'points');
    const n = await svc.enqueue(testDb.db, [
      {
        eventKey: key,
        memberId: UUID.m2,
        erpMemberId: null,
        kind: 'points',
        changeValue: 5,
        sourceType: 'sale',
        sourceNo: 'ORD-2',
        storeId: 'ST-1',
      },
    ]);
    expect(n).toBe(1);
    const rows = await testDb.db.select().from(posWalletEvent).where(eq(posWalletEvent.eventKey, key));
    expect(rows[0].status).toBe('skipped');
  });

  it('flushPending 推送成功后置 sent，且 ERP 收到正确 payload', async () => {
    const key = walletEventKey('sale', 'ORD-3', 'stored_value');
    await svc.enqueue(testDb.db, [
      {
        eventKey: key,
        memberId: UUID.m3,
        erpMemberId: UUID.erp3,
        kind: 'stored_value',
        changeValue: -500,
        sourceType: 'sale',
        sourceNo: 'ORD-3',
        storeId: 'ST-9',
      },
    ]);

    const received: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      received.push(JSON.parse(init.body));
      return { ok: true, status: 200, text: async () => '{}' } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await svc.flushPending();
      expect(res.sent).toBe(1);
      expect(received).toHaveLength(1);
      expect(received[0].eventKey).toBe(key);
      expect(received[0].memberId).toBe(UUID.erp3); // ERP 只认自己的主键
      expect(received[0].changeValue).toBe(-500);
      expect(received[0].storeCode).toBe('ST-9');
    } finally {
      vi.unstubAllGlobals();
    }

    const rows = await testDb.db.select().from(posWalletEvent).where(eq(posWalletEvent.eventKey, key));
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sentAt).not.toBeNull();
  });

  it('推送失败（HTTP 非 2xx）累加 attemptCount 并保留 pending 待重试', async () => {
    const key = walletEventKey('sale', 'ORD-4', 'points');
    await svc.enqueue(testDb.db, [
      {
        eventKey: key,
        memberId: UUID.m4,
        erpMemberId: UUID.erp4,
        kind: 'points',
        changeValue: 7,
        sourceType: 'sale',
        sourceNo: 'ORD-4',
        storeId: 'ST-1',
      },
    ]);
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    try {
      const res = await svc.flushPending();
      expect(res.failed).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
    const rows = await testDb.db.select().from(posWalletEvent).where(eq(posWalletEvent.eventKey, key));
    expect(rows[0].status).toBe('pending'); // 未超重试上限，仍 pending
    expect(Number(rows[0].attemptCount)).toBe(1);
  });
});
