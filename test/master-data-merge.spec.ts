/**
 * P0-3 通用主数据合并引擎（3b/3c：商品 style / 客户 customer）—— 真库 erp_test 回归。
 *
 * 为什么跑真库（trust-but-verify，拒绝 mock 假绿）：
 *   · 合并触碰 PG 事务 + FOR UPDATE 加锁 + 多表改指 + 审计日志 + 解标回滚；
 *   · 关键断言「依赖行改指到 survivor」「被合并方仅打标不删」「回滚解标不回指历史归属」
 *     「sku 唯一键冲突前置拦截」只有真 PG 能验证。
 *
 * 为什么不用 withIsolatedTransaction：
 *   merge() / reverse() 内部各自开事务，嵌套 BEGIN 会失败；故每个用例造唯一主数据天然隔离
 *   （与 member-merge.spec 同一约定），erp_test 由 scripts/setup-test-db.sh 在跑前整体重建。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { createTestClient, createTestDb, TEST_DB_NAME } from './utils/db';
import { MasterDataMergeService } from '@server/modules/master-data-merge/master-data-merge.service';
import {
  style,
  customer,
  sku,
  bom,
  preOrder,
  masterDataMergeLog,
  salesReconciliation,
  receivable,
  salesOrder,
  colorGroup,
  sizeGroup,
  color,
  size,
  allocationItem,
} from '@server/database/schema';

const client = createTestClient();
const db = createTestDb(client);
const svc = new MasterDataMergeService(db as never);

afterAll(async () => {
  await client.end().catch(() => undefined);
});

let seq = 0;
/** 生成全局唯一业务编码，避免跨用例撞唯一约束 */
const uniq = (p: string) => `${p}-${Date.now()}-${++seq}-${randomUUID().slice(0, 6)}`;

async function makeColorGroup(): Promise<string> {
  const [r] = await db
    .insert(colorGroup)
    .values({ code: uniq('cg'), name: 'CG', colors: '[]' })
    .returning({ id: colorGroup.id });
  return r.id;
}
async function makeSizeGroup(): Promise<string> {
  const [r] = await db
    .insert(sizeGroup)
    .values({ code: uniq('sg'), name: 'SG', sizes: '[]' })
    .returning({ id: sizeGroup.id });
  return r.id;
}
async function makeStyle(styleNo: string) {
  const [r] = await db
    .insert(style)
    .values({
      styleNo,
      name: `款${styleNo}`,
      colorGroupId: await makeColorGroup(),
      sizeGroupId: await makeSizeGroup(),
    })
    .returning({ id: style.id, styleNo: style.styleNo });
  return r;
}
async function makeCustomer(code: string) {
  const [r] = await db
    .insert(customer)
    .values({ code, name: `客${code}` })
    .returning({ id: customer.id, code: customer.code, name: customer.name });
  return r;
}
async function styleRow(id: string) {
  const [r] = await db.select().from(style).where(eq(style.id, id)).limit(1);
  return r;
}
async function customerRow(id: string) {
  const [r] = await db.select().from(customer).where(eq(customer.id, id)).limit(1);
  return r;
}

describe('P0-3 MasterDataMergeService（3b/3c 真库 erp_test）', () => {
  it('测试库不是开发库（防止误擦 erp_db）', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
  });

  it('1) style 合并：依赖改指 survivor + 打标 + 审计；被合并方不删', async () => {
    const survivor = await makeStyle(uniq('S-S'));
    const merged = await makeStyle(uniq('S-M'));

    // 依赖行（均指向 merged）
    await db
      .insert(sku)
      .values({ skuCode: uniq('sku'), styleId: merged.id, styleNo: merged.styleNo, color: '红', size: 'M' });
    await db.insert(bom).values({ styleId: merged.id, styleNo: merged.styleNo });
    await db.insert(preOrder).values({
      preOrderNo: uniq('po'),
      tradeShowId: randomUUID(),
      tradeShowName: '展',
      submitterType: 'dealer',
      styleId: merged.id,
      styleNo: merged.styleNo,
      styleName: merged.styleNo,
    });
    // 经 sku 间接归属的 allocation_item（不应被直接改指，仅验证不被破坏）
    const [sk] = await db
      .insert(sku)
      .values({ skuCode: uniq('sku2'), styleId: merged.id, styleNo: merged.styleNo, color: '蓝', size: 'L' })
      .returning({ id: sku.id, skuCode: sku.skuCode });
    await db
      .insert(allocationItem)
      .values({ allocationId: randomUUID(), submitterType: 'dealer', skuId: sk.id, skuCode: sk.skuCode, preQty: '1' });

    const res = await svc.merge({
      entityType: 'style',
      survivorId: survivor.id,
      mergedIds: [merged.id],
      reason: '重复录入',
    });
    expect(res.mergedCount).toBe(1);
    expect(res.entityType).toBe('style');

    // sku 改指 survivor + style_no 更新
    const skus = await db.select().from(sku).where(eq(sku.styleId, survivor.id));
    expect(skus.length).toBe(2);
    expect(skus.every((s) => s.styleNo === survivor.styleNo)).toBe(true);

    // bom 改指
    const boms = await db.select().from(bom).where(eq(bom.styleId, survivor.id));
    expect(boms.length).toBe(1);

    // pre_order 改指 + style_no 更新
    const pos = await db.select().from(preOrder).where(eq(preOrder.styleId, survivor.id));
    expect(pos.length).toBe(1);
    expect(pos[0].styleNo).toBe(survivor.styleNo);

    // 被合并方打标（不删、自身编码不变）
    const m = await styleRow(merged.id);
    expect(m).toBeDefined();
    expect(m!.mergedInto).toBe(survivor.id);
    expect(m!.mergedAt).not.toBeNull();
    expect(m!.styleNo).toBe(merged.styleNo);

    // survivor 未打标
    const s = await styleRow(survivor.id);
    expect(s!.mergedInto).toBeNull();

    // 审计日志
    const [log] = await db
      .select()
      .from(masterDataMergeLog)
      .where(eq(masterDataMergeLog.id, res.logs[0].logId))
      .limit(1);
    expect(log.entityType).toBe('style');
    expect(log.survivorId).toBe(survivor.id);
    expect(log.mergedId).toBe(merged.id);
    expect(log.reversedAt).toBeNull();
  });

  it('2) style 回滚：解标（依赖保持归属 survivor，不回指），日志置 reversedAt，幂等', async () => {
    const survivor = await makeStyle(uniq('S-S2'));
    const merged = await makeStyle(uniq('S-M2'));
    await db
      .insert(sku)
      .values({ skuCode: uniq('sku'), styleId: merged.id, styleNo: merged.styleNo, color: '红', size: 'M' });

    const res = await svc.merge({ entityType: 'style', survivorId: survivor.id, mergedIds: [merged.id] });
    const rv = await svc.reverse({ logId: res.logs[0].logId });
    expect(rv.reversed).toBe(1);

    // 被合并方解标还原
    const m = await styleRow(merged.id);
    expect(m!.mergedInto).toBeNull();
    expect(m!.mergedAt).toBeNull();

    // 依赖仍指向 survivor（不回指历史归属，避免误伤 survivor 合并后自身业务）
    const skus = await db.select().from(sku).where(eq(sku.styleId, survivor.id));
    expect(skus.length).toBe(1);

    // 日志标记已回滚
    const [log] = await db
      .select()
      .from(masterDataMergeLog)
      .where(eq(masterDataMergeLog.id, res.logs[0].logId))
      .limit(1);
    expect(log.reversedAt).not.toBeNull();

    // 重复回滚幂等：不再反向
    const rv2 = await svc.reverse({ logId: res.logs[0].logId });
    expect(rv2.reversed).toBe(0);
  });

  it('3) style 合并冲突预校验：被合并款与 survivor 撞 (color,size) SKU → 抛错且未改指', async () => {
    const [c] = await db
      .insert(color)
      .values({ code: uniq('C'), name: '红', hex: '#f00' })
      .returning({ id: color.id });
    const [sz] = await db
      .insert(size)
      .values({ code: uniq('Z'), name: 'M' })
      .returning({ id: size.id });

    const survivor = await makeStyle(uniq('S-S3'));
    const merged = await makeStyle(uniq('S-M3'));
    await db.insert(sku).values({
      skuCode: uniq('skuA'),
      styleId: merged.id,
      styleNo: merged.styleNo,
      color: '红',
      size: 'M',
      colorId: c.id,
      sizeId: sz.id,
    });
    await db.insert(sku).values({
      skuCode: uniq('skuB'),
      styleId: survivor.id,
      styleNo: survivor.styleNo,
      color: '红',
      size: 'M',
      colorId: c.id,
      sizeId: sz.id,
    });

    await expect(
      svc.merge({ entityType: 'style', survivorId: survivor.id, mergedIds: [merged.id] }),
    ).rejects.toThrow(/冲突|sku/i);

    // 未改指：merged 的 sku 仍指向 merged，被合并方未打标
    const skus = await db.select().from(sku).where(eq(sku.styleId, merged.id));
    expect(skus.length).toBe(1);
    const m = await styleRow(merged.id);
    expect(m!.mergedInto).toBeNull();
  });

  it('4) customer 合并：依赖改指 + customer_name 更新 + 打标 + 审计', async () => {
    const survivor = await makeCustomer(uniq('C-S'));
    const merged = await makeCustomer(uniq('C-M'));

    await db.insert(salesReconciliation).values({
      reconNo: uniq('r'),
      customerId: merged.id,
      customerName: merged.name,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await db.insert(receivable).values({
      receivableNo: uniq('rn'),
      customerId: merged.id,
      customerName: merged.name,
      bizType: 'sales_outbound',
      bizNo: uniq('b'),
      amount: '100',
      balance: '100',
    });
    await db.insert(salesOrder).values({
      orderNo: uniq('o'),
      customerId: merged.id,
      customerName: merged.name,
      orderDate: '2026-01-15',
    });

    const res = await svc.merge({
      entityType: 'customer',
      survivorId: survivor.id,
      mergedIds: [merged.id],
      reason: '重复客户',
    });
    expect(res.mergedCount).toBe(1);

    const srs = await db
      .select()
      .from(salesReconciliation)
      .where(eq(salesReconciliation.customerId, survivor.id));
    expect(srs.length).toBe(1);
    expect(srs[0].customerName).toBe(survivor.name);

    const recs = await db.select().from(receivable).where(eq(receivable.customerId, survivor.id));
    expect(recs.length).toBe(1);
    expect(recs[0].customerName).toBe(survivor.name);

    const sos = await db.select().from(salesOrder).where(eq(salesOrder.customerId, survivor.id));
    expect(sos.length).toBe(1);
    expect(sos[0].customerName).toBe(survivor.name);

    // 被合并方打标（自身 code 不变）
    const m = await customerRow(merged.id);
    expect(m!.mergedInto).toBe(survivor.id);
    expect(m!.mergedAt).not.toBeNull();
    expect(m!.code).toBe(merged.code);

    const [log] = await db
      .select()
      .from(masterDataMergeLog)
      .where(eq(masterDataMergeLog.id, res.logs[0].logId))
      .limit(1);
    expect(log.entityType).toBe('customer');
    expect(log.mergedId).toBe(merged.id);
  });

  it('5) customer 回滚：解标，依赖保持归属 survivor', async () => {
    const survivor = await makeCustomer(uniq('C-S2'));
    const merged = await makeCustomer(uniq('C-M2'));
    await db.insert(salesReconciliation).values({
      reconNo: uniq('r'),
      customerId: merged.id,
      customerName: merged.name,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const res = await svc.merge({ entityType: 'customer', survivorId: survivor.id, mergedIds: [merged.id] });
    await svc.reverse({ logId: res.logs[0].logId });

    const m = await customerRow(merged.id);
    expect(m!.mergedInto).toBeNull();
    const srs = await db
      .select()
      .from(salesReconciliation)
      .where(eq(salesReconciliation.customerId, survivor.id));
    expect(srs.length).toBe(1);
  });

  it('6) 已合并方不可再次作为被合并方（抛错）', async () => {
    const survivor = await makeStyle(uniq('S-S4'));
    const merged = await makeStyle(uniq('S-M4'));
    const other = await makeStyle(uniq('S-O4'));
    await svc.merge({ entityType: 'style', survivorId: survivor.id, mergedIds: [merged.id] });

    await expect(
      svc.merge({ entityType: 'style', survivorId: other.id, mergedIds: [merged.id] }),
    ).rejects.toThrow(/已被合并/);
  });

  it('7) survivor 不能出现在 mergedIds（抛错）', async () => {
    const a = await makeStyle(uniq('S-A5'));
    await expect(
      svc.merge({ entityType: 'style', survivorId: a.id, mergedIds: [a.id] }),
    ).rejects.toThrow(/不可自我合并/);
  });

  it('8) 不支持的 entityType 抛错（store 不在本次范围）', async () => {
    await expect(
      svc.merge({ entityType: 'store' as never, survivorId: randomUUID(), mergedIds: [randomUUID()] }),
    ).rejects.toThrow(/不支持/);
  });

  it('9) candidates：同归一名称的客户被识别为重复组，按关联单据数推荐 survivor', async () => {
    const base = `dupname-${randomUUID().slice(0, 8)}`;
    const a = await makeCustomer(uniq('C-A9'));
    const b = await makeCustomer(uniq('C-B9'));
    // 强制同名（覆盖默认 name），触发归一名称分组
    await db.update(customer).set({ name: base }).where(eq(customer.id, a.id));
    await db.update(customer).set({ name: base }).where(eq(customer.id, b.id));

    // a 有 2 张关联单据，b 有 1 张 → 推荐 a 为 survivor
    await db.insert(salesReconciliation).values({
      reconNo: uniq('r'),
      customerId: a.id,
      customerName: base,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    await db.insert(receivable).values({
      receivableNo: uniq('rn'),
      customerId: a.id,
      customerName: base,
      bizType: 'sales_outbound',
      bizNo: uniq('b'),
      amount: '1',
      balance: '1',
    });
    await db.insert(salesOrder).values({
      orderNo: uniq('o'),
      customerId: b.id,
      customerName: base,
      orderDate: '2026-01-15',
    });

    const groups = await svc.candidates('customer');
    const hit = groups.filter(
      (g) => g.keyType === 'name' && g.members.some((m) => m.id === a.id || m.id === b.id),
    );
    expect(hit.length).toBeGreaterThanOrEqual(1);
    const g = hit[0];
    expect(g.memberCount).toBe(2);
    expect(g.members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());

    const suggested = g.members.find((m) => m.suggested);
    const other = g.members.find((m) => !m.suggested);
    expect(suggested!.id).toBe(a.id); // a 关联单据更多
    expect(suggested!.relatedCount).toBe(2);
    expect(other!.relatedCount).toBe(1);
  });

  it('10) candidates：同归一电话的客户被识别为重复组，电话键脱敏展示（不泄露完整号码）', async () => {
    // 每 run 唯一电话（避免跨 run 累积污染共享库 erp_test 导致组内成员数漂移）
    const digits = randomUUID().replace(/-/g, '').replace(/[a-f]/g, '').slice(0, 8).padStart(8, '0');
    const phone = `138${digits}`;
    const a = await makeCustomer(uniq('C-PA'));
    const b = await makeCustomer(uniq('C-PB'));
    await db.update(customer).set({ name: uniq('pnA'), phone }).where(eq(customer.id, a.id));
    await db.update(customer).set({ name: uniq('pnB'), phone }).where(eq(customer.id, b.id));

    const groups = await svc.candidates('customer');
    const pg = groups.find(
      (g) => g.keyType === 'phone' && g.members.some((m) => m.id === a.id || m.id === b.id),
    );
    expect(pg).toBeDefined();
    expect(pg!.memberCount).toBe(2);
    expect(pg!.members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    // 电话键脱敏展示：格式 138****XXXX，非完整号码
    expect(pg!.key).toMatch(/^138\*{4}\d{4}$/);
    expect(pg!.key).not.toBe(phone);
    // 成员 phone 也应脱敏
    expect(pg!.members.every((m) => m.phone === pg!.key)).toBe(true);
  });

  it('11) listLogs：合并后被列出(reversedAt=null)，回滚后状态翻转（reversed 过滤生效）', async () => {
    const survivor = await makeCustomer(uniq('C-S11'));
    const merged = await makeCustomer(uniq('C-M11'));
    const res = await svc.merge({ entityType: 'customer', survivorId: survivor.id, mergedIds: [merged.id], reason: '测试' });

    // 默认(全部)与 reversed:false 都应包含该批次，且 reversedAt 为空
    const all = await svc.listLogs('customer');
    const hitAll = all.filter((l) => l.runId === res.runId);
    expect(hitAll.length).toBe(1);
    expect(hitAll[0].survivorName).toBe(survivor.name);
    expect(hitAll[0].mergedName).toBe(merged.name);
    expect(hitAll[0].reason).toBe('测试');
    expect(hitAll[0].reversedAt).toBeNull();

    const activeOnly = await svc.listLogs('customer', { reversed: false });
    expect(activeOnly.some((l) => l.runId === res.runId)).toBe(true);

    const reversedOnly = await svc.listLogs('customer', { reversed: true });
    expect(reversedOnly.some((l) => l.runId === res.runId)).toBe(false);

    // 回滚后：reversed:true 能查到，且 reversedAt 非空
    await svc.reverse({ logId: res.logs[0].logId });
    const reversedNow = await svc.listLogs('customer', { reversed: true });
    const hitRev = reversedNow.find((l) => l.runId === res.runId);
    expect(hitRev).toBeDefined();
    expect(hitRev!.reversedAt).not.toBeNull();

    const activeAfter = await svc.listLogs('customer', { reversed: false });
    expect(activeAfter.some((l) => l.runId === res.runId)).toBe(false);
  });
});
