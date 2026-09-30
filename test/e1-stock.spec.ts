/**
 * E.1 库存现存量 StockService —— 直连 erp_db 真实数据。
 *
 * StockService 仅依赖 db，是四个核心 service 里隔离成本最低的一个：
 *   · getStock 读取真实库存量，与裸 SQL 交叉验证；
 *   · batchChangeStock(+N) 在事务内生效，并验证 ROLLBACK 后开发库数据不变。
 */
import { describe, it, expect } from 'vitest';
import { StockService } from '@server/modules/inventory/stock/stock.service';
import {
  createErpClient,
  withErpIsolatedTransaction,
  raw,
} from './utils/erp-db';

// 真实存在：仓库 REAL_WH 下该 SKU 库存 qty=999（来自内省 erp_db）
const REAL_WH = 'c4d74dd9-cfd5-4ab1-bfec-e418ba73ad4c';
const STOCK_SKU = '98758fd0-10d6-45f6-a8fa-1ab4e3cd4949';

function qtyOf(client: any, sku: string, wh: string) {
  return client<{ quantity: number }>`
    select quantity from inventory_stock where sku_id=${sku} and warehouse_id=${wh}
  `;
}

describe('E.1 库存现存量 StockService（直连 erp_db）', () => {
  it('getStock 读取真实库存量，与裸 SQL 一致', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const rows = (await db.execute(
        raw`select quantity from inventory_stock where sku_id=${STOCK_SKU} and warehouse_id=${REAL_WH}` as never,
      )) as { quantity: number }[];
      const real = Number(rows[0]?.quantity ?? 0);

      const svc = new StockService(db as any);
      const got = await svc.getStock(db as any, REAL_WH, STOCK_SKU, 'sku');
      expect(got).toBe(real);
    });
  });

  it('batchChangeStock(+5)：事务内 +5，ROLLBACK 后开发库不改', async () => {
    // 事务外读 before（独立连接）
    const probe = createErpClient();
    let before = 0;
    try {
      const r = await qtyOf(probe, STOCK_SKU, REAL_WH);
      before = Number(r[0]?.quantity ?? 0);
    } finally {
      await probe.end();
    }

    // 在 ROLLBACK 事务内 +5
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = new StockService(db as any);
      await svc.batchChangeStock(db as any, [
        {
          itemType: 'sku',
          skuId: STOCK_SKU,
          warehouseId: REAL_WH,
          warehouseName: '杭州湖滨直营店仓',
          qtyDelta: 5,
          flowType: 'purchase_inbound',
          bizNo: 'E1-0001',
        },
      ]);
      const mid = Number(
        ((await db.execute(
          raw`select quantity from inventory_stock where sku_id=${STOCK_SKU} and warehouse_id=${REAL_WH}` as never,
        )) as { quantity: number }[])[0]?.quantity ?? 0,
      );
      expect(mid).toBe(before + 5);
    });

    // 事务外复核：必须恢复 before（证明写入被回滚，开发库未被污染）
    const probe2 = createErpClient();
    try {
      const r = await qtyOf(probe2, STOCK_SKU, REAL_WH);
      expect(Number(r[0]?.quantity ?? 0)).toBe(before);
    } finally {
      await probe2.end();
    }
  });
});
