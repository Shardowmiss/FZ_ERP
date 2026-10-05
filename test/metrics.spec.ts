/**
 * W2-2 指标物化视图层（mv_store_sales_daily / mv_inventory_by_store / mv_member_summary）
 * —— 真库 erp_test 回归（trust-but-verify，拒绝 mock 假绿）。
 *
 * 验证点全部落在 PG 语义：
 *   · MV 聚合口径（金额/件数/会员单/折扣额、库存数量金额、会员按等级汇总）；
 *   · status 过滤（仅 settled/returned 计入销量）；
 *   · 已合并会员（merged_into 非空）被排除避免双计（P0-3 铁律）；
 *   · SECURITY DEFINER 刷新函数 refresh_metrics_materialized_views() 在 erp 角色下可调用。
 *
 * 隔离策略：用 withIsolatedTransaction 在单事务内「插入源数据 → refresh → 断言 → 回滚」，
 * MV 数据随事务回滚，对 erp_test 零残留、且不与并发 spec 互相污染（无需 truncate 共享表）。
 * MetricsService 不触发 onModuleInit（不启动后台刷新计时器），直接 new 后调 refresh()/查询。
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { withIsolatedTransaction, TEST_DB_NAME } from './utils/db';
import { MetricsService } from '@server/modules/metrics/metrics.service';

const num = (v: unknown): number => Number(v);

describe('W2-2 MetricsService（指标物化视图层，真库 erp_test）', () => {
  it('测试库不是开发库（防止误擦 erp_db）', () => {
    expect(TEST_DB_NAME).not.toBe('erp_db');
  });

  it('1) mv_store_sales_daily 聚合门店日销量（金额/件数/会员单/折扣额 + status 过滤）', async () => {
    const rows = await withIsolatedTransaction(async ({ db: tx }) => {
      const store = (await tx.execute(
        sql`INSERT INTO store (code, name, store_type) VALUES ('MVS1','指标店','direct') RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const storeId = store[0].id;
      const order = (await tx.execute(
        sql`INSERT INTO retail_order (retail_no, store_id, store_name, sale_date, status, total_amount, member_id)
            VALUES ('MVO1', ${storeId}, '指标店', '2026-10-07', 'settled', 80, 'M1') RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const orderId = order[0].id;
      await tx.execute(
        sql`INSERT INTO retail_order_item (retail_id, sku_id, sku_code, style_no, color, size, quantity, tag_price, deal_price, line_amount)
            VALUES (${orderId}, ${storeId}, 'K1', 'ST1', '红', 'L', 2, 50, 40, 80)`,
      );
      // 草稿单不应计入（status 过滤）
      await tx.execute(
        sql`INSERT INTO retail_order (retail_no, store_id, store_name, sale_date, status, total_amount)
            VALUES ('MVO2', ${storeId}, '指标店', '2026-10-07', 'draft', 0)`,
      );
      const svc = new MetricsService(tx as never);
      await svc.refresh();
      return await svc.storeSalesDaily({ storeId });
    });

    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(num(r.order_count)).toBe(1);
    expect(num(r.member_order_count)).toBe(1);
    expect(num(r.item_qty)).toBe(2);
    expect(num(r.tag_amount)).toBe(100); // 2 * 50
    expect(num(r.net_amount)).toBe(80);
    expect(num(r.discount_amount)).toBe(20); // 100 - 80
  });

  it('2) mv_inventory_by_store 聚合门店库存（仓→店→库存 FK 链）', async () => {
    const rows = await withIsolatedTransaction(async ({ db: tx }) => {
      await tx.execute(
        sql`INSERT INTO color_group (id, code, name) VALUES ('11111111-1111-1111-1111-111111111111','CG1','色组1')`,

      );
      await tx.execute(
        sql`INSERT INTO size_group (id, code, name) VALUES ('22222222-2222-2222-2222-222222222222','SG1','尺组1')`,
      );
      await tx.execute(
        sql`INSERT INTO style (id, style_no, name, color_group_id, size_group_id)
            VALUES ('33333333-3333-3333-3333-333333333333','ST1','款1',
                    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222')`,
      );
      await tx.execute(
        sql`INSERT INTO sku (id, sku_code, style_id, style_no, color, size)
            VALUES ('44444444-4444-4444-4444-444444444444','K1','33333333-3333-3333-3333-333333333333','ST1','红','L')`,
      );
      await tx.execute(
        sql`INSERT INTO warehouse (id, code, name, type) VALUES ('55555555-5555-5555-5555-555555555555','WH1','仓1','main')`,
      );
      await tx.execute(
        sql`INSERT INTO store (id, code, name, store_type, warehouse_id)
            VALUES ('66666666-6666-6666-6666-666666666666','SH1','店1','direct','55555555-5555-5555-5555-555555555555')`,
      );
      await tx.execute(
        sql`INSERT INTO inventory_stock (sku_id, sku_code, style_no, color, size, warehouse_id, warehouse_name, quantity, amount)
            VALUES ('44444444-4444-4444-4444-444444444444','K1','ST1','红','L','55555555-5555-5555-5555-555555555555','仓1', 10, 500)`,
      );
      const svc = new MetricsService(tx as never);
      await svc.refresh();
      return await svc.inventoryByStore({ storeId: '66666666-6666-6666-6666-666666666666' });
    });

    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(num(r.quantity)).toBe(10);
    expect(num(r.amount)).toBe(500);
    expect(r.sku_id).toBe('44444444-4444-4444-4444-444444444444');
    expect(r.style_no).toBe('ST1');
  });

  it('3) mv_member_summary 按等级聚合，排除已合并会员（避免双计）', async () => {
    const rows = await withIsolatedTransaction(async ({ db: tx }) => {
      const m1 = (await tx.execute(
        sql`INSERT INTO member (member_no, name, level, points, total_spent, order_count, stored_value)
            VALUES ('M001','A','normal',10,100,2,50) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      const m1Id = m1[0].id;
      await tx.execute(
        sql`INSERT INTO member (member_no, name, level, points, total_spent, order_count, stored_value)
            VALUES ('M002','B','vip',20,200,3,80)`,
      );
      // 被合并会员：merged_into 指向 m1，汇总应排除（其余额已并入 m1）
      await tx.execute(
        sql`INSERT INTO member (member_no, name, level, points, total_spent, order_count, stored_value, merged_into)
            VALUES ('M003','C','normal',5,30,1,10, ${m1Id})`,
      );
      const svc = new MetricsService(tx as never);
      await svc.refresh();
      return await svc.memberSummary();
    });

    const byLevel: Record<string, any> = {};
    for (const r of rows) byLevel[r.level] = r;

    expect(byLevel.normal).toBeTruthy();
    expect(num(byLevel.normal.member_count)).toBe(1); // M003 被排除
    expect(num(byLevel.normal.points)).toBe(10);
    expect(num(byLevel.normal.total_spent)).toBe(100);
    expect(num(byLevel.normal.stored_value)).toBe(50);

    expect(byLevel.vip).toBeTruthy();
    expect(num(byLevel.vip.member_count)).toBe(1);
    expect(num(byLevel.vip.points)).toBe(20);
    expect(num(byLevel.vip.stored_value)).toBe(80);
  });
});
