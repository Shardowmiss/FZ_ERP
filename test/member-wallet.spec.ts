/**
 * S3 会员钱包入账 —— 幂等与资金正确性回归（真库 erp_test）。
 *
 * 为什么必须跑真库：
 *   幂等的唯一依赖是 **PG 唯一索引 + ON CONFLICT DO NOTHING 的返回空数组** 这一语义，
 *   用 mock 只能验证"我们写了什么 SQL"，验证不了"PG 到底有没有拦住第二次"。
 *   而"重复加分"恰恰是资金事故，绝不接受 mock 绿灯。
 *
 * 为什么不用 withIsolatedTransaction：
 *   applyWalletEvent 内部自己开事务（事务包裹「占位 → 改余额 → 写流水」三步，
 *   必须原子），嵌套 BEGIN 会失败。故改用「每个用例新建唯一会员」天然隔离。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestClient, createTestDb, TEST_DB_NAME } from './utils/db';
import { MemberWalletService } from '@server/modules/member/member-wallet.service';
import { member, memberPoint, memberWalletEvent } from '@server/database/schema';

const client = createTestClient();
const db = createTestDb(client);
// 测试基座的 db 带 schema 泛型，服务构造参数不带；行为一致，仅类型收窄差异
const svc = new MemberWalletService(db as never);

afterAll(async () => {
  await client.end().catch(() => undefined);
});

let seq = 0;

/** 每个用例造一个全新会员，保证互不污染 */
async function newMember(points = 0, storedValue = '0') {
  const [m] = await db
    .insert(member)
    .values({
      memberNo: `WT-${Date.now()}-${++seq}`,
      name: `钱包用例${seq}`,
      points,
      storedValue,
      status: 'active',
    })
    .returning({ id: member.id, memberNo: member.memberNo });
  return m;
}

async function pointsOf(memberId: string): Promise<number> {
  const [r] = await db
    .select({ points: member.points })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  return Number(r?.points ?? -1);
}

async function storedValueOf(memberId: string): Promise<number> {
  const [r] = await db
    .select({ storedValue: member.storedValue })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  return Number(r?.storedValue ?? -1);
}

async function countEvents(key: string): Promise<number> {
  const rows = await db
    .select({ id: memberWalletEvent.id })
    .from(memberWalletEvent)
    .where(eq(memberWalletEvent.eventKey, key));
  return rows.length;
}

describe('S3 MemberWalletService.applyWalletEvent（真库）', () => {
  it('测试库不是开发库（防止误擦 erp_db）', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
  });

  it('1) 积分入账：applied，钱包余额与账面余额一致', async () => {
    const m = await newMember(10);
    const key = `${m.memberNo}:IDEM-A:points`;

    const r = await svc.applyWalletEvent({
      eventKey: key,
      memberId: m.id,
      kind: 'points',
      changeValue: 100,
      sourceType: 'sale',
      sourceNo: `${m.memberNo}-SO-1`,
      storeCode: 'ST001',
    });

    expect(r.status).toBe('applied');
    expect(r.duplicated).toBe(false);
    expect(r.balanceAfter).toBe(110);
    // 账面（member.points）必须同步更新，否则只是记了流水没改钱
    expect(await pointsOf(m.id)).toBe(110);

    // 且冗余写入 member_point 流水，与既有 adjustPoints 口径一致
    const logs = await db
      .select()
      .from(memberPoint)
      .where(eq(memberPoint.memberId, m.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].changeValue).toBe(100);
    expect(logs[0].balance).toBe(110);
  });

  it('2) ★核心：同一 eventKey 重放 → duplicated=true 且不重复加分', async () => {
    const m = await newMember(10);
    const key = `${m.memberNo}:REPLAY:points`;
    const payload = {
      eventKey: key,
      memberId: m.id,
      kind: 'points' as const,
      changeValue: 100,
      sourceType: 'sale',
      sourceNo: `${m.memberNo}-SO-2`,
    };

    await svc.applyWalletEvent(payload);
    await svc.applyWalletEvent(payload);
    const third = await svc.applyWalletEvent(payload);

    expect(third.duplicated).toBe(true);
    // 三次请求只应入账一次：10 + 100 = 110
    expect(await pointsOf(m.id)).toBe(110);
    expect(third.balanceAfter).toBe(110);
    // 幂等的关键是「只有一条事件记录」，否则说明占位失败
    expect(await countEvents(key)).toBe(1);
    // 流水也只能有一条
    const logs = await db
      .select()
      .from(memberPoint)
      .where(eq(memberPoint.memberId, m.id));
    expect(logs).toHaveLength(1);
  });

  it('3) 退货回冲：负增量使余额递减（写流水与改余额同一原子路径）', async () => {
    const m = await newMember(200);
    const key = `${m.memberNo}:RETURN:points`;

    const r = await svc.applyWalletEvent({
      eventKey: key,
      memberId: m.id,
      kind: 'points',
      changeValue: -50,
      sourceType: 'return',
      sourceNo: `${m.memberNo}-RT-1`,
    });

    expect(r.status).toBe('applied');
    expect(r.balanceAfter).toBe(150);
    expect(await pointsOf(m.id)).toBe(150);
  });

  it('4) 储值入账与透支防护：余额不足时 rejected 且钱不动', async () => {
    const m = await newMember(0, '5000'); // 50.00 元
    const key = `${m.memberNo}:SV-OVERDRAW:stored_value`;

    // 正常消费
    const ok = await svc.applyWalletEvent({
      eventKey: `${m.memberNo}:SV-OK:stored_value`,
      memberId: m.id,
      kind: 'stored_value',
      changeValue: -2000,
      sourceType: 'sale',
      sourceNo: `${m.memberNo}-SO-3`,
    });
    expect(ok.status).toBe('applied');
    expect(await storedValueOf(m.id)).toBe(3000);

    // 再扣 5000 → 透支
    const bad = await svc.applyWalletEvent({
      eventKey: key,
      memberId: m.id,
      kind: 'stored_value',
      changeValue: -5000,
      sourceType: 'sale',
      sourceNo: `${m.memberNo}-SO-4`,
    });
    expect(bad.status).toBe('rejected');
    expect(bad.message).toContain('透支');
    // 钱必须纹丝不动
    expect(await storedValueOf(m.id)).toBe(3000);
  });

  it('5) 会员不存在 → rejected 并占位，重放不再产生第二条事件（防毒丸无限重试）', async () => {
    const ghostId = '00000000-0000-4000-8000-000000000001';
    const key = `ghost:GHOST-1:points`;

    const first = await svc.applyWalletEvent({
      eventKey: key,
      memberId: ghostId,
      kind: 'points',
      changeValue: 10,
      sourceType: 'sale',
      sourceNo: 'GHOST-SO-1',
    });
    expect(first.status).toBe('rejected');
    expect(first.message).toContain('会员不存在');

    const again = await svc.applyWalletEvent({
      eventKey: key,
      memberId: ghostId,
      kind: 'points',
      changeValue: 10,
      sourceType: 'sale',
      sourceNo: 'GHOST-SO-1',
    });
    expect(again.duplicated).toBe(true);
    expect(await countEvents(key)).toBe(1);
  });

  it('6) 不同 eventKey 的正常并发=多次独立入账（幂等不该误伤不同事实）', async () => {
    const m = await newMember(0);
    await svc.applyWalletEvent({
      eventKey: `${m.memberNo}:A:points`,
      memberId: m.id,
      kind: 'points',
      changeValue: 10,
      sourceType: 'sale',
      sourceNo: `${m.memberNo}-1`,
    });
    await svc.applyWalletEvent({
      eventKey: `${m.memberNo}:B:points`,
      memberId: m.id,
      kind: 'points',
      changeValue: 20,
      sourceType: 'sale',
      sourceNo: `${m.memberNo}-2`,
    });
    expect(await pointsOf(m.id)).toBe(30);
  });
});
