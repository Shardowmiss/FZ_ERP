/**
 * E.1 安全护栏：先证明「对 erp_db 的事务回滚真的生效」，
 * 否则任何 E.1 用例都可能静默污染开发库 —— 那比没有测试更危险。
 *
 * 用 inventory_stock 做探针（无外键、NOT NULL 列已知）。
 */
import { describe, it, expect } from 'vitest';
import {
  createErpClient,
  withErpIsolatedTransaction,
  raw,
} from './utils/erp-db';

const MARKER = `E1GUARD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// inventory_stock.sku_id / warehouse_id 均有外键约束，探针必须用真实存在的 id
const REAL_SKU = '50e0cc56-e788-4953-a600-a6604eb34770';
const REAL_WH = 'c4d74dd9-cfd5-4ab1-bfec-e418ba73ad4c';

describe('E.1 安全护栏：erp_db 事务回滚', () => {
  it('事务内写入可见，事务外必须消失（回滚真的生效）', async () => {
    // 1) 事务内插入探针行
    const seenInTx = await withErpIsolatedTransaction(async ({ db }) => {
      await db.execute(raw`
        insert into inventory_stock
          (id, sku_id, sku_code, style_no, color, size, warehouse_id, warehouse_name, quantity, in_transit_qty, _created_at, _updated_at)
        values
          (gen_random_uuid(), ${REAL_SKU}, ${MARKER}, 'G', '黑', 'S', ${REAL_WH}, '探针仓', 1, 0, now(), now())
      ` as never);

      const rows = await db.execute(
        raw`select count(*)::int as c from inventory_stock where sku_code = ${MARKER}` as never,
      );
      const arr = Array.isArray(rows) ? (rows as { c: number }[]) : [];
      return Number(arr[0]?.c ?? 0);
    });

    expect(seenInTx).toBe(1); // 事务内确实写进去了

    // 2) 事务外（全新连接）复核：探针行必须不存在
    const client = createErpClient();
    try {
      const rows = await client<{ c: number }>`
        select count(*)::int as c from inventory_stock where sku_code = ${MARKER}
      `;
      expect(Number(rows[0]?.c ?? 0)).toBe(0); // ROLLBACK 生效，开发库未被污染
    } finally {
      await client.end().catch(() => undefined);
    }
  });

  it('目标库确实是 erp_db（用户要求直连开发库）', async () => {
    const client = createErpClient();
    try {
      const rows = await client<{ current_database: string }>`select current_database()`;
      expect(rows[0]?.current_database).toBe('erp_db');
    } finally {
      await client.end().catch(() => undefined);
    }
  });
});
