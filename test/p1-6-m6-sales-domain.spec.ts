/**
 * P1-6 / M6 Batch1 —— 销售域业务 service 写入 color_id / size_id（真实 erp_db）。
 *
 * 验证方式：直接实例化 SalesOrderService 建单（非 mock），再查落库的
 * sales_order_item，断言 color_id/size_id 等于 sku 主数据的 id。
 * 这证明 M6「Pattern P：继承 sku 主数据 id」在真实路径上生效，而非仅类型通过。
 */
import { describe, it, expect } from 'vitest';
import { SalesOrderService } from '@server/modules/sales/order/sales-order.service';
import { NumberGeneratorService } from '@server/modules/system/code-rule/number-generator.service';
import { withErpIsolatedTransaction, raw } from './utils/erp-db';

const REAL_CUSTOMER = 'cfdc5f61-3446-4722-9f47-611802c4e061';
const REAL_SKU = '50e0cc56-e788-4953-a600-a6604eb34770';

type SkuRow = {
  id: string;
  color: string | null;
  size: string | null;
  color_id: string | null;
  size_id: string | null;
};
type ItemRow = {
  color: string | null;
  size: string | null;
  color_id: string | null;
  size_id: string | null;
};

function makeSvc(db: any) {
  return new SalesOrderService(db as any, new NumberGeneratorService() as any, null as any);
}

describe('M6 Batch1 销售域：单据明细继承 sku 主数据 id', () => {
  it('create 销售订单：sales_order_item 应带上 sku 的 color_id / size_id', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      // 基线：sku 主数据必须已被 P1-2 回填出 color_id/size_id
      const skuRows = (await db.execute(
        raw`select id, color, size, color_id, size_id from sku where id=${REAL_SKU}` as never,
      )) as SkuRow[];
      const s = skuRows[0];
      expect(s, '基线 sku 必须存在').toBeTruthy();
      expect(s.color_id, '基线 sku 应有 color_id（P1-2 回填结果）').toBeTruthy();
      expect(s.size_id, '基线 sku 应有 size_id（P1-2 回填结果）').toBeTruthy();

      const svc = makeSvc(db);
      const created = await svc.create({
        customerId: REAL_CUSTOMER,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [{ skuId: REAL_SKU, quantity: 2, price: 10 }],
      } as any);

      const items = (await db.execute(
        raw`select color, size, color_id, size_id from sales_order_item where order_id=${created.id}` as never,
      )) as ItemRow[];
      expect(items.length).toBe(1);
      const it0 = items[0];

      // 过渡期 varchar 镜像仍在（M8 才删）
      expect(it0.color).toBe(s.color);
      expect(it0.size).toBe(s.size);

      // M6 核心断言：id 轨道已写入，且与 sku 主数据一致
      expect(it0.color_id, 'sales_order_item.color_id 应等于 sku.color_id').toBe(s.color_id);
      expect(it0.size_id, 'sales_order_item.size_id 应等于 sku.size_id').toBe(s.size_id);
    });
  });

  it('update 销售订单：重建明细同样继承 sku 主数据 id', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const skuRows = (await db.execute(
        raw`select id, color, size, color_id, size_id from sku where id=${REAL_SKU}` as never,
      )) as SkuRow[];
      const s = skuRows[0];

      const svc = makeSvc(db);
      const created = await svc.create({
        customerId: REAL_CUSTOMER,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [{ skuId: REAL_SKU, quantity: 2, price: 10 }],
      } as any);

      // update 会先删旧明细再重建，走的第二处 push
      await svc.update(created.id, {
        customerId: REAL_CUSTOMER,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [{ skuId: REAL_SKU, quantity: 3, price: 12 }],
      } as any);

      const items = (await db.execute(
        raw`select color_id, size_id from sales_order_item where order_id=${created.id}` as never,
      )) as ItemRow[];
      expect(items.length).toBe(1);
      expect(items[0].color_id).toBe(s.color_id);
      expect(items[0].size_id).toBe(s.size_id);
    });
  });
});
