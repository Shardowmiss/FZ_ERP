// 执行 migrations/0021_merge_duplicate_colors.sql 到 erp_db / erp_test。
// 每个库包在事务里：先跑合并 DO 块，再做断言；断言不过则整库回滚，绝不留下半成品。
// 备份请用独立命令（pg_dump）在调用本脚本之前完成。
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const MIGRATION = path.join(__dirname, '..', 'migrations', '0021_merge_duplicate_colors.sql');
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
const BASE = process.env.PG_URL ?? 'postgres://erp:erp@localhost:5434';
const DBS = ['erp_db', 'erp_test'];

const sqlText = fs.readFileSync(MIGRATION, 'utf8');

async function danglingRefsOf(sql, dupId) {
  let total = 0;
  const detail = {};
  for (const t of BUSINESS_TABLES) {
    const r = await sql.unsafe(
      `SELECT count(*)::int AS n FROM ${t} WHERE color_id = $1`,
      [dupId]
    );
    const n = r[0].n;
    if (n) { detail[t] = n; total += n; }
  }
  const cgc = await sql.unsafe(
    `SELECT count(*)::int AS n FROM color_group_color WHERE color_id = $1`,
    [dupId]
  );
  if (cgc[0].n) { detail.color_group_color = cgc[0].n; total += cgc[0].n; }
  return { total, detail };
}

async function runOne(dbName) {
  const sql = postgres(`${BASE}/${dbName}`, { max: 1, onnotice: () => {} });
  try {
    // 先取删除目标 id（在事务外先读一次，仅用于断言基线）
    const pre = await sql`SELECT id FROM color WHERE name = '黑色' LIMIT 1`;
    const dupId = pre[0]?.id ?? null;
    const preCount = (await sql`SELECT count(*)::int AS n FROM color`)[0].n;

    if (!dupId) {
      // 该库无 黑色 重复行 → 期望 DO 块 no-op
      await sql.begin(async (tx) => {
        await tx.unsafe(sqlText);
      });
      const postCount = (await sql`SELECT count(*)::int AS n FROM color`)[0].n;
      await sql.end();
      return {
        db: dbName, status: 'SKIP(no 黑色 row)',
        preCount, postCount, merged: false,
      };
    }

    let verify;
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlText);

      // 断言 1：黑色 主数据已消失
      const blackLeft = (await tx`SELECT count(*)::int AS n FROM color WHERE name = '黑色'`)[0].n;
      // 断言 2：权威行 黑 仍在
      const heiLeft = (await tx`SELECT count(*)::int AS n FROM color WHERE name = '黑'`)[0].n;
      // 断言 3：被删 id 零悬挂引用
      const { total, detail } = await danglingRefsOf(tx, dupId);
      // 断言 4：color 总数恰好 -1
      const postCount = (await tx`SELECT count(*)::int AS n FROM color`)[0].n;

      verify = { blackLeft, heiLeft, dangling: total, detail, postCount };
      if (blackLeft !== 0) throw new Error(`${dbName}: 黑色 主数据未被删除`);
      if (heiLeft !== 1) throw new Error(`${dbName}: 权威行 黑 不存在 (heiLeft=${heiLeft})`);
      if (total !== 0) throw new Error(`${dbName}: 删除的 id 仍有 ${total} 处悬挂引用 ${JSON.stringify(detail)}`);
      if (postCount !== preCount - 1) throw new Error(`${dbName}: color 总数应为 ${preCount - 1}，实际 ${postCount}`);
    });

    await sql.end();
    return {
      db: dbName, status: 'MERGED',
      preCount, postCount: verify.postCount,
      danglingBeforeMerge: 'see detail', verify, merged: true,
    };
  } catch (e) {
    try { await sql.end(); } catch {}
    return { db: dbName, status: 'ROLLBACK', error: e.message };
  }
}

(async () => {
  console.log('=== 执行颜色合并迁移 0021 (erp_db + erp_test) ===');
  const results = [];
  for (const db of DBS) {
    const r = await runOne(db);
    results.push(r);
    console.log(JSON.stringify(r, null, 2));
  }
  const anyFail = results.some(r => r.status === 'ROLLBACK');
  console.log(anyFail ? '\n[FAIL] 存在回滚，未改动任何库' : '\n[OK] 全部库合并完成/确认无需合并');
  process.exit(anyFail ? 1 : 0);
})();
