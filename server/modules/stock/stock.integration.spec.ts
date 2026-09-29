import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { setupTestDb, type TestDb } from '@server/test-utils/pglite';
import { StockService } from './stock.service';
import {
  posStyle,
  posColor,
  posSize,
  posSku,
  posStock,
  posStockAdjust,
} from '@server/database/schema';
import { eq } from 'drizzle-orm';

/**
 * P1-4 引用完整性：库存调整明细子表（pos_stock_adjust_item）落库验证。
 * 历史实现 adjustStock 消费 dto.items 改完库存后直接丢弃明细，无法追溯调整内容；
 * 本次新增子表 + 批量落库，本测试覆盖「库存变动 + 明细可追溯」以及批量分片。
 */
describe('StockService 库存调整 — P1-4 引用完整性', () => {
  let t: TestDb;
  let svc: StockService;

  beforeAll(async () => {
    t = await setupTestDb();
    svc = new StockService(t.db as never);
    await t.db.insert(posStyle).values({ id: 'S1', name: 'T恤', category: '上衣', colorIds: ['C1'], sizeIds: ['SZ1'] });
    await t.db.insert(posColor).values({ id: 'C1', name: '红', hex: '#f00' });
    await t.db.insert(posSize).values({ id: 'SZ1', sortOrder: 1 });
    await t.db.insert(posSku).values({ id: 'SKU1', styleId: 'S1', colorId: 'C1', sizeId: 'SZ1', barcode: 'B1' });
    await t.db.insert(posStock).values({
      storeId: 'ST1', skuId: 'SKU1', styleId: 'S1', colorId: 'C1', sizeId: 'SZ1', qty: 100, inTransitQty: 0,
    });
  });

  afterAll(async () => {
    await t.pg.close();
  });

  const baseItem = { skuId: 'SKU1', styleId: 'S1', colorId: 'C1', sizeId: 'SZ1', qty: 5 };
  const principal = { storeId: 'ST1' } as never;

  it('increase：库存 +N 且明细落库（P1-4 修复点）', async () => {
    const res = await svc.adjustStock(
      { type: 'increase', reason: '补货', storeId: 'ST1', items: [baseItem] },
      principal,
    );
    expect(res.success).toBe(true);

    const stock = await t.db.select().from(posStock).where(eq(posStock.skuId, 'SKU1'));
    expect(stock[0].qty).toBe(105);

    const detail = await svc.getStockAdjustDetail(res.adjustNo, 'ST1');
    expect(detail.items.length).toBe(1);
    expect(detail.items[0].qty).toBe(5);
    expect(detail.storeId).toBe('ST1');
  });

  it('decrease：库存 -N 且明细落库', async () => {
    const res = await svc.adjustStock(
      { type: 'decrease', reason: '损耗', storeId: 'ST1', items: [{ ...baseItem, qty: 3 }] },
      principal,
    );
    const stock = await t.db.select().from(posStock).where(eq(posStock.skuId, 'SKU1'));
    expect(stock[0].qty).toBe(102);

    const detail = await svc.getStockAdjustDetail(res.adjustNo, 'ST1');
    expect(detail.items[0].qty).toBe(3);
  });

  it('明细批量分片落库（>500 行，验证 P1-5 chunk 批写）', async () => {
    const items = Array.from({ length: 600 }, () => ({ ...baseItem, qty: 1 }));
    const res = await svc.adjustStock(
      { type: 'increase', reason: '批量', storeId: 'ST1', items },
      principal,
    );
    const detail = await svc.getStockAdjustDetail(res.adjustNo, 'ST1');
    expect(detail.items.length).toBe(600);
  });

  it('跨店查询隐藏存在性（P0-1 越权防护）', async () => {
    const res = await svc.adjustStock(
      { type: 'increase', reason: 'r', storeId: 'ST1', items: [baseItem] },
      principal,
    );
    await expect(svc.getStockAdjustDetail(res.adjustNo, 'OTHER')).rejects.toThrow();
  });

  it('空明细拒绝', async () => {
    await expect(
      svc.adjustStock({ type: 'increase', reason: 'r', storeId: 'ST1', items: [] }, principal),
    ).rejects.toThrow();
  });
});
