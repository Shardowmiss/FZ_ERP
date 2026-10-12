/**
 * P1-1（原「颜色组关系化 color_group_color」）—— 2026-10-12 颜色组整体下线后的**防复发护栏**。
 *
 * 背景：产品决策「颜色只在 SKU 层选择」⇒ 颜色组（`color_group` / `color_group_color`
 * 两张表、`style.color_group_id` 列、`color-group` 模块目录、`/base/color-group` 页面）
 * 已于迁移 `0066_drop_color_group.sql` 彻底删除。
 * 本用例改为断言该结构确实不存在，防止后续改动/回滚误把颜色组带回来。
 *
 * 复用 E.1 harness（test/utils/erp-db.ts）直连 erp_db，事务 ROLLBACK 隔离。
 */
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { withErpIsolatedTransaction } from './utils/erp-db';

async function execRows(db: any, query: ReturnType<typeof sql>) {
  const r: any = await db.execute(query);
  return Array.isArray(r) ? r : r?.rows ?? [];
}

describe('P1-1 颜色组已下线（防复发护栏）', () => {
  it('color_group / color_group_color 两张表均已不存在', async () => {
    const rows = await withErpIsolatedTransaction(async ({ db }) =>
      execRows(
        db,
        sql`select table_name from information_schema.tables
            where table_schema = 'public'
              and table_name in ('color_group', 'color_group_color')`,
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('style.color_group_id 列已不存在', async () => {
    const rows = await withErpIsolatedTransaction(async ({ db }) =>
      execRows(
        db,
        sql`select column_name from information_schema.columns
            where table_schema = 'public'
              and table_name = 'style'
              and column_name = 'color_group_id'`,
      ),
    );
    expect(rows).toHaveLength(0);
  });

  it('style 既有数据未受影响（款号仍可正常读取）', async () => {
    const n = await withErpIsolatedTransaction(async ({ db }) => {
      const rows = await execRows(db, sql`select count(*)::int as n from style`);
      return Number(rows[0]?.n ?? 0);
    });
    expect(n).toBeGreaterThan(0);
  });

  it('color 颜色主数据保留（颜色改由 SKU 层选择，主数据未受影响）', async () => {
    const n = await withErpIsolatedTransaction(async ({ db }) => {
      const rows = await execRows(db, sql`select count(*)::int as n from color`);
      return Number(rows[0]?.n ?? 0);
    });
    expect(n).toBeGreaterThan(0);
  });
});
