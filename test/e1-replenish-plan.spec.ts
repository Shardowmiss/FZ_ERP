/**
 * E.1 补货计算 ReplenishPlanService —— 直连 erp_db 真实数据。
 *
 * 依赖：db + NumberGeneratorService + AnalyticsService（仅 useForecast 时用到）。
 *   · calc 读取真实销量（retail_order）+ 真实库存（inventory_stock），按增强版
 *     重订货点公式给出补货建议；本用例在事务内播种近 30 天零售销量，使公式真
 *     正触发并计算确定值（REAL_SKU 在 REAL_STORE 仓库无库存 → currentStock=0）。
 *   · list 返回结构化分页结果。
 *
 * 公式（service 注释）：dailyAvg=近N天销量/N；target=dailyAvg×(leadTime+expectedDays)+safety；
 *   raw=target−当前库存−在途；suggestedQty=raw<=0?0:ceil(raw/caseQty)*caseQty。
 *   本用例：10/30=0.333；target=0.333×7=2.331；raw=2.331；ceil→3。
 */
import { describe, it, expect } from 'vitest';
import { ReplenishPlanService } from '@server/modules/inventory/replenish-plan/replenish-plan.service';
import { NumberGeneratorService } from '@server/modules/system/code-rule/number-generator.service';
import { AnalyticsService } from '@server/modules/analytics/analytics.service';
import { withErpIsolatedTransaction, raw } from './utils/erp-db';

const REAL_STORE = '86fc6904-4ab9-485f-9862-73ec1c0a0809'; // 直营门店，warehouse_id 非空
const REAL_SKU = '50e0cc56-e788-4953-a600-a6604eb34770';

function makeSvc(db: any) {
  return new ReplenishPlanService(
    db as any,
    new NumberGeneratorService() as any,
    new AnalyticsService(db as any) as any,
  );
}

describe('E.1 补货计算 ReplenishPlanService（直连 erp_db）', () => {
  it('calc：读取真实销量+库存，按公式给出确定补货建议', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      // 播种近 30 天该门店该 SKU 的零售销量 10 件（settled）
      const ro = (await db.execute(raw`
        insert into retail_order
          (id, retail_no, store_id, store_name, sale_date, source, total_amount, discount_amount, receivable_amount, received_amount, change_amount, pay_methods, item_count, status, _created_at, _updated_at)
        values
          (gen_random_uuid(), ${'E1RO-' + Date.now()}, ${REAL_STORE}, 'E1门店', current_date, 'pos', 100, 0, 100, 100, 0, '["cash"]'::json, 1, 'settled', now(), now())
        returning id
      ` as never)) as { id: string }[];
      const roId = ro[0].id;

      await db.execute(raw`
        insert into retail_order_item
          (id, retail_id, sku_id, sku_code, style_no, color, size, quantity, tag_price, deal_price, line_amount, _created_at, _updated_at)
        values
          (gen_random_uuid(), ${roId}, ${REAL_SKU}, 'ST-SPRING-黑-S', 'ST-SPRING', '黑', 'S', 10, 10, 10, 100, now(), now())
      ` as never);

      const svc = makeSvc(db);
      const res = await svc.calc({
        storeId: REAL_STORE,
        n: 30,
        expectedDays: 7,
        caseQty: 1,
        leadTimeDays: 0,
        safetyDays: 0,
        useForecast: false,
      });

      const item = res.items.find((i) => i.skuId === REAL_SKU);
      expect(item).toBeTruthy();
      expect(item!.recentSalesQty).toBe(10);
      expect(item!.currentStock).toBe(0); // REAL_SKU 在该门店仓库无库存
      expect(item!.suggestedQty).toBe(3); // 公式确定值
      // 时效字段存在
      expect('dataAsOf' in res).toBe(true);
      expect('salesStoreCount' in res).toBe(true);
    });
  });

  it('list：返回结构化分页结果', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = makeSvc(db);
      const res = await svc.list({ page: 1, pageSize: 10 });
      expect(res).toHaveProperty('list');
      expect(res).toHaveProperty('total');
      expect(Array.isArray(res.list)).toBe(true);
    });
  });
});
