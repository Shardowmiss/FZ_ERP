/**
 * E.1 销售订单 SalesOrderService —— 直连 erp_db 真实数据。
 *
 * 依赖：db + NumberGeneratorService（无参）+ distributionMirror（create 不触碰，传 null）。
 *   · list / getDetail 读取真实订单（erp_db 现有 1 张订单）；
 *   · create 在事务内建单（内部自开嵌套事务），并验证 ROLLBACK 后开发库无该单。
 */
import { describe, it, expect } from 'vitest';
import { SalesOrderService } from '@server/modules/sales/order/sales-order.service';
import { NumberGeneratorService } from '@server/modules/system/code-rule/number-generator.service';
import {
  createErpClient,
  withErpIsolatedTransaction,
  raw,
} from './utils/erp-db';

const REAL_CUSTOMER = 'cfdc5f61-3446-4722-9f47-611802c4e061'; // 真实客户
const REAL_SKU = '50e0cc56-e788-4953-a600-a6604eb34770'; // 真实 SKU（含 sku_code/style_no/color/size）

function makeSvc(db: any) {
  return new SalesOrderService(db as any, new NumberGeneratorService() as any, null as any);
}

describe('E.1 销售订单 SalesOrderService（直连 erp_db）', () => {
  it('list 读取真实订单，结构自洽', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = makeSvc(db);
      const res = await svc.list({ page: 1, pageSize: 10 });
      expect(res.total).toBeGreaterThanOrEqual(1);
      const first = res.items[0];
      expect(first.orderNo).toBeTruthy();
      expect(first.customerId).toBeTruthy();
      expect(first.status).toBeTruthy();
    });
  });

  it('getDetail 读回真实订单明细', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = makeSvc(db);
      const list = await svc.list({ page: 1, pageSize: 1 });
      const id = list.items[0].id;
      const detail = await svc.getDetail(id);
      expect(detail.id).toBe(id);
      expect(detail.orderNo).toBe(list.items[0].orderNo);
    });
  });

  it('create：事务内建单成功，ROLLBACK 后开发库无该单', async () => {
    let createdId = '';
    let createdStatus = '';
    await withErpIsolatedTransaction(async ({ db }) => {
      const svc = makeSvc(db);
      const created = await svc.create({
        customerId: REAL_CUSTOMER,
        orderDate: new Date().toISOString().slice(0, 10),
        items: [{ skuId: REAL_SKU, quantity: 2, price: 10 }],
      } as any);
      createdId = created.id;
      createdStatus = created.status as string;
      expect(created.orderNo).toBeTruthy();
      expect(createdStatus).toBeTruthy();

      // 事务内可见 + 状态落库正确
      const rows = (await db.execute(
        raw`select status from sales_order where id=${createdId}` as never,
      )) as { status: string }[];
      expect(rows[0]?.status).toBe(createdStatus);

      const itemRows = (await db.execute(
        raw`select count(*)::int as c from sales_order_item where order_id=${createdId}` as never,
      )) as { c: number }[];
      expect(Number(itemRows[0]?.c ?? 0)).toBe(1);
    });

    // 事务外复核：订单与其明细都不应持久化
    const client = createErpClient();
    try {
      const o = await client<{ c: number }>`
        select count(*)::int as c from sales_order where id=${createdId}
      `;
      expect(Number(o[0]?.c ?? 0)).toBe(0);
      const i = await client<{ c: number }>`
        select count(*)::int as c from sales_order_item where order_id=${createdId}
      `;
      expect(Number(i[0]?.c ?? 0)).toBe(0);
    } finally {
      await client.end();
    }
  });
});
