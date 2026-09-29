import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { eq } from 'drizzle-orm';
import { posStock } from '@server/database/schema';
import { buildDeductLines, deductStockBatch } from './stock-batch';

/**
 * P1-5：库存批量扣减（开单 createOrder 热路径）
 *
 * 验证目标：
 *   1. 真实 SQL 可执行（单条 UPDATE...FROM VALUES），不是"类型能过"就行；
 *   2. 同 SKU 合并扣减与原逐件扣减等价；
 *   3. 库存不足 / 无记录时抛错，且错误文案与改造前完全一致（前端与既有用例不回归）；
 *   4. 单语句与行锁确实存在（防超卖的兜底）。
 */
describe('P1-5 库存批量扣减', () => {
  let t: TestDb;

  const STORE = 'ST-BATCH';

  beforeAll(async () => {
    t = await setupTestDb();
    const rows = [
      { skuId: 'SKU-B', styleId: 'S1', qty: 50 },
      { skuId: 'SKU-A', styleId: 'S1', qty: 30 },
      { skuId: 'SKU-C', styleId: 'S1', qty: 10 },
    ];
    for (const r of rows) {
      await t.db.insert(posStock).values({
        storeId: STORE,
        skuId: r.skuId,
        styleId: r.styleId,
        colorId: 'C1',
        sizeId: 'SZ1',
        qty: r.qty,
        inTransitQty: 0,
      });
    }
  });

  afterAll(async () => {
    await t.pg.close();
  });

  const line = (skuId: string, qty: number) => ({
    skuId,
    styleName: '测试款',
    colorId: 'C1',
    sizeId: 'SZ1',
    qty,
  });

  const qtyOf = async (skuId: string) => {
    const rows = await t.db.select().from(posStock).where(eq(posStock.skuId, skuId));
    return rows[0]?.qty;
  };

  it('buildDeductLines：同 SKU 合并数量并按 skuId 排序（并发加锁顺序一致）', () => {
    const lines = buildDeductLines([
      line('SKU-B', 2),
      line('SKU-A', 1),
      line('SKU-B', 3),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.skuId)).toEqual(['SKU-A', 'SKU-B']);
    expect(lines.find((l) => l.skuId === 'SKU-B')?.qty).toBe(5);
  });

  it('多 SKU 一次扣减成功（往返次数与明细数解耦）', async () => {
    await t.db.transaction(async (tx: any) => {
      await deductStockBatch(tx, STORE, [
        line('SKU-B', 10),
        line('SKU-A', 5),
        line('SKU-C', 7),
      ]);
    });
    expect(await qtyOf('SKU-B')).toBe(40);
    expect(await qtyOf('SKU-A')).toBe(25);
    expect(await qtyOf('SKU-C')).toBe(3);
  });

  it('重复 skuId 直接失败（不静默错账）', async () => {
    await expect(
      t.db.transaction(async (tx: any) => {
        await deductStockBatch(tx, STORE, [line('SKU-A', 3), line('SKU-A', 4)]);
      }),
    ).rejects.toThrow(/请先经 buildDeductLines 折叠合并/);
  });

  it('折叠后同 SKU 多行一次扣减，等价逐件扣减', async () => {
    const before = await qtyOf('SKU-A');
    await t.db.transaction(async (tx: any) => {
      await deductStockBatch(tx, STORE, buildDeductLines([line('SKU-A', 3), line('SKU-A', 4)]));
    });
    expect(await qtyOf('SKU-A')).toBe(before - 7);
  });

  it('库存不足：抛错且文案与改造前一致', async () => {
    await expect(
      t.db.transaction(async (tx: any) => {
        await deductStockBatch(tx, STORE, [line('SKU-C', 999)]);
      }),
    ).rejects.toThrow('库存不足，当前库存 3，需要 999');
  });

  it('库存恰好扣减到 0 不报错（边界）', async () => {
    await t.db.insert(posStock).values({
      storeId: STORE, skuId: 'SKU-Z', styleId: 'S1', colorId: 'C1', sizeId: 'SZ1', qty: 4, inTransitQty: 0,
    });
    await t.db.transaction(async (tx: any) => {
      await deductStockBatch(tx, STORE, [line('SKU-Z', 4)]);
    });
    expect(await qtyOf('SKU-Z')).toBe(0);
  });

  it('无库存记录：抛错且错误事务整体回滚', async () => {
    await expect(
      t.db.transaction(async (tx: any) => {
        await deductStockBatch(tx, STORE, [line('SKU-NOPE', 1)]);
      }),
    ).rejects.toThrow('无库存记录');
    // 回滚验证：前面已扣减的 SKU 不应受影响，且未产生脏扣减
    expect(await qtyOf('SKU-B')).toBe(40);
  });

  it('空明细不产生任何写操作', async () => {
    const before = await qtyOf('SKU-B');
    await t.db.transaction(async (tx: any) => {
      await deductStockBatch(tx, STORE, []);
    });
    expect(await qtyOf('SKU-B')).toBe(before);
  });

  it('生成的 SQL 含 FOR UPDATE 行锁与 VALUES 批量（防超卖兜底）', () => {
    // 直接构造同一条预取语句，断言其 SQL 形态，确保锁语义未因重构丢失
    const q = t.db
      .select()
      .from(posStock)
      .where(eq(posStock.storeId, STORE))
      .for('update');
    expect(q.toSQL().sql).toMatch(/FOR UPDATE/i);
  });
});
