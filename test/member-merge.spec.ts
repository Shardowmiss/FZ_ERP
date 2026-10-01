/**
 * P0-3 主数据合并引擎（member 切片）—— 资金安全回归（真库 erp_test）。
 *
 * 为什么跑真库（trust-but-verify，拒绝 mock 假绿）：
 *   · 合并触碰积分/储值（资金），且依赖 PG 事务 + FOR UPDATE 加锁 + 账本事件原子累加；
 *   · 关键断言「无级联清空钱包流水」「回滚无双计」「重合并无漏转」只有真 PG 能验证。
 *
 * 为什么不用 withIsolatedTransaction：
 *   merge() / applyWalletEvent() 内部各自开事务（合并须原子），嵌套 BEGIN 会失败；
 *   故每个用例造唯一会员天然隔离（与 member-wallet.spec 同一约定）。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { createTestClient, createTestDb, TEST_DB_NAME } from './utils/db';
import { MemberWalletService } from '@server/modules/member/member-wallet.service';
import { MemberMergeService } from '@server/modules/member/member-merge.service';
import {
  member,
  memberMergeLog,
  memberWalletEvent,
  memberPoint,
  retailOrder,
} from '@server/database/schema';

const client = createTestClient();
const db = createTestDb(client);
const wallet = new MemberWalletService(db as never);
const svc = new MemberMergeService(db as never, wallet);

afterAll(async () => {
  await client.end().catch(() => undefined);
});

let seq = 0;

async function newMember(opts: {
  points?: number;
  storedValue?: string;
  totalSpent?: string;
  orderCount?: number;
  hmac: string;
}) {
  const [m] = await db
    .insert(member)
    .values({
      memberNo: `MG-${Date.now()}-${++seq}`,
      name: `合并用例${seq}`,
      phoneHmac: opts.hmac,
      points: opts.points ?? 0,
      storedValue: opts.storedValue ?? '0',
      totalSpent: opts.totalSpent ?? '0',
      orderCount: opts.orderCount ?? 0,
      status: 'active',
    })
    .returning({ id: member.id, memberNo: member.memberNo });
  return m;
}

async function snapshot(memberId: string) {
  const [r] = await db
    .select({
      points: member.points,
      storedValue: member.storedValue,
      totalSpent: member.totalSpent,
      orderCount: member.orderCount,
      mergedInto: member.mergedInto,
      mergedAt: member.mergedAt,
    })
    .from(member)
    .where(eq(member.id, memberId))
    .limit(1);
  return {
    points: Number(r?.points ?? -1),
    storedValue: Number(r?.storedValue ?? -1),
    totalSpent: Number(r?.totalSpent ?? -1),
    orderCount: Number(r?.orderCount ?? -1),
    mergedInto: r?.mergedInto ?? null,
    mergedAt: r?.mergedAt ?? null,
  };
}

async function countWalletEvents(memberId: string): Promise<number> {
  const rows = await db
    .select({ id: memberWalletEvent.id })
    .from(memberWalletEvent)
    .where(eq(memberWalletEvent.memberId, memberId));
  return rows.length;
}

async function makeRetailOrder(memberId: string) {
  await db.insert(retailOrder).values({
    retailNo: `RO-${seq}-${randomUUID().slice(0, 8)}`,
    storeId: randomUUID(),
    storeName: 'ZT',
    saleDate: '2026-01-01',
    memberId,
  });
}

describe('P0-3 MemberMergeService（真库）', () => {
  it('测试库不是开发库（防止误擦 erp_db）', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
  });

  it('1) 检测：candidates() 按 phone_hmac 分组返回重复会员', async () => {
    const hmac = `dup_hmac_${Date.now()}_${seq}`;
    const a = await newMember({ points: 1, hmac });
    const b = await newMember({ points: 2, hmac });

    const groups = await svc.candidates(1000);
    const hit = groups.find((g) => g.phoneHmac === hmac);
    expect(hit).toBeDefined();
    const ids = hit!.members.map((m) => m.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
    expect(hit!.members.length).toBe(2);

    // 清理：标记已合并，避免污染后续候选预览
    await db.update(member).set({ mergedInto: a.id, mergedAt: sql`CURRENT_TIMESTAMP` }).where(eq(member.id, b.id));
  });

  it('2) 合并：资金/计数器转移 + 依赖行改指 + 写日志，且被合并方仅打标不删', async () => {
    const hmac = `merge_hmac_${Date.now()}_${seq}`;
    const merged = await newMember({
      points: 30,
      storedValue: '500',
      totalSpent: '2000',
      orderCount: 2,
      hmac,
    });
    const survivor = await newMember({ points: 50, storedValue: '1000', hmac });

    // 依赖行：零售单 + 钱包事件 + 积分流水，均指向 merged
    await makeRetailOrder(merged.id);
    await db.insert(memberWalletEvent).values({
      eventKey: `seed:${merged.id}:points`,
      memberId: merged.id,
      kind: 'points',
      changeValue: 30,
      balanceAfter: 30,
      sourceType: 'seed',
    });
    await db.insert(memberPoint).values({
      memberId: merged.id,
      changeType: 'seed',
      changeValue: 30,
      balance: 30,
    });

    const res = await svc.merge({ survivorId: survivor.id, mergedIds: [merged.id], reason: '手机号重复' });

    // 资金自洽：survivor = 50+30 / 1000+500
    const s = await snapshot(survivor.id);
    expect(s.points).toBe(80);
    expect(s.storedValue).toBe(1500);
    expect(s.totalSpent).toBe(2000);
    expect(s.orderCount).toBe(2);

    // 被合并方清零 + 打标，且未被删除（mergedInto 指向 survivor）
    const m = await snapshot(merged.id);
    expect(m.points).toBe(0);
    expect(m.storedValue).toBe(0);
    expect(m.totalSpent).toBe(0);
    expect(m.orderCount).toBe(0);
    expect(m.mergedInto).toBe(survivor.id);
    expect(m.mergedAt).not.toBeNull();

    // 依赖行改指 survivor（无级联清空：wallet 事件计数保留，仅换归属）
    const orders = await db
      .select({ id: retailOrder.id })
      .from(retailOrder)
      .where(eq(retailOrder.memberId, survivor.id));
    expect(orders.length).toBe(1);
    expect(await countWalletEvents(survivor.id)).toBeGreaterThanOrEqual(1); // 含 seed 事件 + 合并事件
    expect(await countWalletEvents(merged.id)).toBe(0); // 全部改指走，无残留、无删除

    // 审计日志
    const [log] = await db
      .select()
      .from(memberMergeLog)
      .where(eq(memberMergeLog.id, res.logs[0].logId))
      .limit(1);
    expect(log.survivorId).toBe(survivor.id);
    expect(log.mergedId).toBe(merged.id);
    expect(Number(log.movedPoints)).toBe(30);
    expect(Number(log.movedStoredValue)).toBe(500);
    expect(log.reversedAt).toBeNull();
  });

  it('3) 回滚：survivor 还原、被合并方解标还原、日志置 reversedAt，无双计', async () => {
    const hmac = `rev_hmac_${Date.now()}_${seq}`;
    const merged = await newMember({ points: 30, storedValue: '500', totalSpent: '2000', orderCount: 2, hmac });
    const survivor = await newMember({ points: 50, storedValue: '1000', hmac });
    await makeRetailOrder(merged.id);

    const res = await svc.merge({ survivorId: survivor.id, mergedIds: [merged.id] });
    const beforeReverseSurvivorPoints = (await snapshot(survivor.id)).points;
    expect(beforeReverseSurvivorPoints).toBe(80); // 合并后

    const rv = await svc.reverse({ logId: res.logs[0].logId });
    expect(rv.reversed).toBe(1);

    // survivor 还原到合并前
    const s = await snapshot(survivor.id);
    expect(s.points).toBe(50);
    expect(s.storedValue).toBe(1000);
    expect(s.totalSpent).toBe(0);
    expect(s.orderCount).toBe(0);

    // 被合并方完整还原（可再次作为独立会员）
    const m = await snapshot(merged.id);
    expect(m.points).toBe(30);
    expect(m.storedValue).toBe(500);
    expect(m.totalSpent).toBe(2000);
    expect(m.orderCount).toBe(2);
    expect(m.mergedInto).toBeNull();
    expect(m.mergedAt).toBeNull();

    // 日志标记已回滚
    const [log] = await db
      .select()
      .from(memberMergeLog)
      .where(eq(memberMergeLog.id, res.logs[0].logId))
      .limit(1);
    expect(log.reversedAt).not.toBeNull();

    // 重复回滚幂等：不再反向（不会把 survivor 再扣一次）
    const rv2 = await svc.reverse({ logId: res.logs[0].logId });
    expect(rv2.reversed).toBe(0);
    expect((await snapshot(survivor.id)).points).toBe(50);
  });

  it('4) ★回滚后可重合并：新 run_id 产生新 eventKey，不漏转、无双计', async () => {
    const hmac = `remerge_hmac_${Date.now()}_${seq}`;
    const merged = await newMember({ points: 30, storedValue: '500', hmac });
    const survivor = await newMember({ points: 50, storedValue: '1000', hmac });

    const r1 = await svc.merge({ survivorId: survivor.id, mergedIds: [merged.id] });
    await svc.reverse({ logId: r1.logs[0].logId });
    expect((await snapshot(survivor.id)).points).toBe(50); // 回滚后

    // 再次合并同一 merged（新 run_id）
    const r2 = await svc.merge({ survivorId: survivor.id, mergedIds: [merged.id] });
    expect((await snapshot(survivor.id)).points).toBe(80); // 50 + 30，未漏转
    expect((await snapshot(merged.id)).points).toBe(0);

    // 两条合并账本事件（不同 run_id），证明不是被判重跳过
    const events = await db
      .select({ id: memberWalletEvent.id })
      .from(memberWalletEvent)
      .where(sql`${memberWalletEvent.eventKey} LIKE ${`merge:%:${merged.id}:points`}`);
    expect(events.length).toBe(2);
  });

  it('5) 已合并会员不可再次作为被合并方（抛错）', async () => {
    const hmac = `already_hmac_${Date.now()}_${seq}`;
    const merged = await newMember({ points: 10, hmac });
    const survivor = await newMember({ points: 10, hmac });
    const other = await newMember({ points: 10, hmac });
    await svc.merge({ survivorId: survivor.id, mergedIds: [merged.id] });

    await expect(svc.merge({ survivorId: other.id, mergedIds: [merged.id] })).rejects.toThrow(/已被合并/);
  });

  it('6) survivor 不能出现在 mergedIds（抛错）', async () => {
    const hmac = `self_hmac_${Date.now()}_${seq}`;
    const a = await newMember({ points: 10, hmac });
    await expect(svc.merge({ survivorId: a.id, mergedIds: [a.id] })).rejects.toThrow(/不可自我合并/);
  });
});
