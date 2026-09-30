// 只读探查：黑/黑色 重复颜色主数据的影响面
// 不修改任何数据。
const postgres = require('postgres');
const sql = postgres('postgres://erp:erp@localhost:5434/erp_db');

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

(async () => {
  try {
    // 1. 所有颜色主数据行（确认是否仅 黑/黑色 重复）
    const allColors = await sql`SELECT id, name, code, hex FROM color ORDER BY name`;
    console.log('=== ALL COLOR ROWS (count=' + allColors.length + ') ===');
    console.log(JSON.stringify(allColors, null, 2));

    const blacks = await sql`SELECT id, name, code, hex, _created_at FROM color WHERE name IN ('黑','黑色') ORDER BY name`;
    console.log('\n=== BLACK CANDIDATES ===');
    console.log(JSON.stringify(blacks, null, 2));
    if (blacks.length < 2) {
      console.log('\n[INFO] 没有重复的 黑/黑色 行，无需合并。');
      await sql.end();
      return;
    }
    const ids = blacks.map(b => b.id);

    // 2. 26 张业务表的 color_id 引用分布
    console.log('\n=== REFERENCE COUNTS PER BUSINESS TABLE ===');
    const refSummary = {};
    for (const t of BUSINESS_TABLES) {
      try {
        const rows = await sql.unsafe(
          `SELECT color_id, count(*)::int AS n FROM ${t} WHERE color_id = ANY($1) GROUP BY color_id`,
          [ids]
        );
        if (rows.length) refSummary[t] = rows;
      } catch (e) {
        refSummary[t] = 'ERR: ' + e.message.split('\n')[0];
      }
    }
    console.log(JSON.stringify(refSummary, null, 2));

    // 3. color_group_color 关联表引用
    console.log('\n=== color_group_color references ===');
    const cgc = await sql.unsafe(
      `SELECT color_group_id, color_id FROM color_group_color WHERE color_id = ANY($1)`,
      [ids]
    );
    console.log(JSON.stringify(cgc, null, 2));
    const cgcCount = await sql.unsafe(
      `SELECT color_id, count(*)::int AS n FROM color_group_color WHERE color_id = ANY($1) GROUP BY color_id`,
      [ids]
    );
    console.log('counts:', JSON.stringify(cgcCount, null, 2));

    // 4. color_group.jsonb 镜像结构（取一条含 黑/黑色 的样例）
    console.log('\n=== color_group.colors jsonb sample (groups touching black) ===');
    const groups = await sql.unsafe(
      `SELECT cg.id, cg.name, cg.colors
       FROM color_group cg
       WHERE EXISTS (SELECT 1 FROM color_group_color x WHERE x.color_group_id = cg.id AND x.color_id = ANY($1))
       LIMIT 5`,
      [ids]
    );
    console.log(JSON.stringify(groups, null, 2));
    const totalGroups = await sql`SELECT count(*)::int AS n FROM color_group`;
    console.log('total color_group rows:', JSON.stringify(totalGroups, null, 2));

    // 5. 仅在 color_group_color 出现、但 color 主表没有的孤儿引用（应为 0）
    console.log('\n=== orphan color_group_color refs (color_id not in color) ===');
    const orphan = await sql`SELECT count(*)::int AS n FROM color_group_color x WHERE NOT EXISTS (SELECT 1 FROM color c WHERE c.id = x.color_id)`;
    console.log(JSON.stringify(orphan, null, 2));

  } catch (e) {
    console.error('FATAL', e);
  } finally {
    await sql.end();
  }
})();
