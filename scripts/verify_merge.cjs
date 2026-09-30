// 只读确认 erp_db 合并后的真实落库状态
const postgres = require('postgres');
const sql = postgres('postgres://erp:erp@localhost:5434/erp_db', { onnotice: () => {} });

const TABLES = [
  'omni_order_item', 'production_finish_receipt_item', 'inventory_transfer_item',
  'replenish_plan_item', 'inventory_stock', 'sales_return_item', 'sales_outbound_item',
  'sales_order_item', 'sku', 'pos_requisition_item',
];

(async () => {
  const colors = await sql`SELECT id, name, code FROM color ORDER BY name`;
  console.log('color 主数据(现在):', JSON.stringify(colors, null, 2));

  const heiId = (await sql`SELECT id FROM color WHERE name = '黑'`)[0]?.id;
  let total = 0;
  for (const t of TABLES) {
    const r = await sql.unsafe(`SELECT count(*)::int AS n FROM ${t} WHERE color_id = $1`, [heiId]);
    total += r[0].n;
  }
  console.log(`黑(=${heiId}) 在抽样 ${TABLES.length} 张表的被引用总行数:`, total);

  const blackLeft = (await sql`SELECT count(*)::int AS n FROM color WHERE name = '黑色'`)[0].n;
  console.log("黑色 主数据残留:", blackLeft);
  await sql.end();
})();
