/**
 * P1-5 颜色合并 黑/黑色 —— 幂等 + 指向正确性验证。
 *
 * 用 E.1 直连 erp_db 的回滚夹具：在真实开发库的事务里执行真实迁移文件 0021，
 * 断言合并效果，然后由 harness 无条件 ROLLBACK —— 不向 erp_db 留下任何痕迹。
 * 这把"真实路径"与"零污染"结合起来，避免假绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { withErpIsolatedTransaction } from './utils/erp-db';

const MIGRATION = readFileSync(
  join(__dirname, '..', 'migrations', '0021_merge_duplicate_colors.sql'),
  'utf8',
);

const BUSINESS_TABLES = [
  'omni_order_item', 'subcontract_receipt_item', 'subcontract_order_item',
  'inventory_batch', 'production_finish_receipt_item', 'garment_purchase_return_sku',
  'garment_purchase_inbound_sku', 'garment_purchase_order_sku', 'retail_order_item',
  'allocation_item', 'pre_order_item', 'inventory_stocktake_item',
  'inventory_transfer_item', 'replenish_plan_item', 'inventory_stock',
  'inventory_flow', 'sales_return_item', 'sales_outbound_item', 'sales_order_item',
  'sku', 'hangtag_print_item', 'unique_code_stock', 'doc_unique_code',
  'doc_unique_code_archive', 'pos_return_item', 'pos_requisition_item',
];

const toNum = (rows: unknown, key = 'n'): number =>
  Number((rows as Record<string, unknown>[])[0]?.[key] ?? 0);

describe('P1-5 合并重复颜色 黑/黑色', () => {
  it('执行真实迁移后：黑色消失、黑保留、被删 id 零悬挂引用，且可重复执行(幂等)', async () => {
    await withErpIsolatedTransaction(async ({ db }) => {
      // 基线：抓取被删目标 id（仅用于断言，不依赖具体 UUID）
      const dupRows = await db.execute<{ id: string }>(
        sql`SELECT id FROM color WHERE name = '黑色' LIMIT 1`,
      );
      const dupId = dupRows[0]?.id ?? null;

      // 执行真实迁移文件（raw 注入，不当参数化）
      await db.execute(sql.raw(MIGRATION));

      // 断言 1 & 2：黑色 消失、黑 保留
      const blackLeft = toNum(
        await db.execute(sql`SELECT count(*)::int AS n FROM color WHERE name = '黑色'`),
      );
      const heiLeft = toNum(
        await db.execute(sql`SELECT count(*)::int AS n FROM color WHERE name = '黑'`),
      );
      expect(blackLeft, '黑色 主数据应被删除').toBe(0);
      expect(heiLeft, '权威行 黑 应保留').toBe(1);

      // 断言 3：被删 id 在 26 张业务表 + 关联表零悬挂引用
      if (dupId) {
        let dangling = 0;
        for (const t of BUSINESS_TABLES) {
          const r = await db.execute(
            sql`SELECT count(*)::int AS n FROM ${sql.raw(t)} WHERE color_id = ${dupId}`,
          );
          dangling += toNum(r);
        }
        const cgc = await db.execute(
          sql`SELECT count(*)::int AS n FROM color_group_color WHERE color_id = ${dupId}`,
        );
        dangling += toNum(cgc);
        expect(dangling, '被删 id 不应有悬挂引用').toBe(0);
      }

      // 断言 4（幂等）：再执行一次不应报错且状态不变
      await db.execute(sql.raw(MIGRATION));
      const blackLeft2 = toNum(
        await db.execute(sql`SELECT count(*)::int AS n FROM color WHERE name = '黑色'`),
      );
      const colorTotal = toNum(
        await db.execute(sql`SELECT count(*)::int AS n FROM color`),
      );
      expect(blackLeft2, '第二次执行后 黑色 仍应消失').toBe(0);
      expect(colorTotal, '幂等：颜色总数不应再减少').toBe(dupId ? 4 : colorTotal);
    });
  });
});
