/**
 * P1-4 / M8 前置验证（B.1 颜色尺码双轨统一）—— M8「收紧约束」的先决条件
 *
 * M8 计划把 26 张业务表的 color_id/size_id 改为 NOT NULL + FK，并删除 varchar 镜像列。
 * 这一破坏性变更的安全前提是：**没有任何一行「color/size 自由串存在，但 color_id/size_id 为空」**，
 * 否则 ALTER ... NOT NULL 会直接失败、或写出后无法回填。
 *
 * 本用例不执行任何 DDL，只读校验 erp_db 的「脏行」（varchar 有值但 FK 列空）= 0。
 * 这是 M8 可否推进的硬闸门：
 *   · 本库(erp_db)回归后应为 0（M5 已 100% 回填）；
 *   · 生产库未知，必须先跑本用例确认 0 脏行，才能执行 M8 的 NOT NULL + 删列 DDL。
 * 直连 erp_db，纯 SELECT，事务 ROLLBACK（实际无写，零残留）。
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { withErpIsolatedTransaction } from './utils/erp-db';

// 与 M3（schema.ts 注入列）保持一致的 26 张业务表物理名
const TABLES = [
  'omni_order_item', 'subcontract_receipt_item', 'subcontract_order_item', 'inventory_batch',
  'production_finish_receipt_item', 'garment_purchase_return_sku', 'garment_purchase_inbound_sku',
  'garment_purchase_order_sku', 'retail_order_item', 'allocation_item', 'pre_order_item',
  'inventory_stocktake_item', 'inventory_transfer_item', 'replenish_plan_item', 'inventory_stock',
  'inventory_flow', 'sales_return_item', 'sales_outbound_item', 'sales_order_item', 'sku',
  'hangtag_print_item', 'unique_code_stock', 'doc_unique_code', 'doc_unique_code_archive',
  'pos_return_item', 'pos_requisition_item',
];

describe('P1-4 M8 前置：erp_db 颜色/尺码「脏行」= 0（收紧约束先决条件）', () => {
  it('每张表的 (color 有值且 color_id 空) 与 (size 有值且 size_id 空) 均为 0', async () => {
    const result = await withErpIsolatedTransaction(async (ctx) => {
      const perTable: Record<string, { colorDirty: number; sizeDirty: number }> = {};
      let totalColorDirty = 0;
      let totalSizeDirty = 0;

      for (const t of TABLES) {
        // 表名是受控常量（本次迭代固定集合），直接拼进 SQL 字符串再包 sql 原始片段，
        // 避免 drizzle 把标识符当参数转义。
        const q = sql`
          select
            (select count(*) from ${sql.raw(t)} where color is not null and color_id is null) as color_dirty,
            (select count(*) from ${sql.raw(t)} where size is not null and size_id is null) as size_dirty
        `;
        const r: any = await ctx.db.execute(q);
        const rows = Array.isArray(r) ? r : r?.rows ?? [];
        const row = rows[0] ?? { color_dirty: 0, size_dirty: 0 };
        const colorDirty = Number(row.color_dirty ?? 0);
        const sizeDirty = Number(row.size_dirty ?? 0);
        perTable[t] = { colorDirty, sizeDirty };
        totalColorDirty += colorDirty;
        totalSizeDirty += sizeDirty;
      }

      return { perTable, totalColorDirty, totalSizeDirty };
    });

    // 断言：全库脏行必须为 0
    expect(result.totalColorDirty).toBe(0);
    expect(result.totalSizeDirty).toBe(0);

    // 同时逐表断言，便于定位哪张表有残留（若有）
    for (const t of TABLES) {
      expect(result.perTable[t].colorDirty, `${t} color dirty`).toBe(0);
      expect(result.perTable[t].sizeDirty, `${t} size dirty`).toBe(0);
    }
  });
});
