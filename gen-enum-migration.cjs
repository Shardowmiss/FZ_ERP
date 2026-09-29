/**
 * 生成幂等迁移 0013_enum_constraints.sql
 * - Tier1：枚举族逐表精确 CHECK（flowType/direction/itemType/submitterType/bizType/docType/type/source）
 * - Tier2：58 个 status 列共享联合白名单安全网（含代码未覆盖的 ongoing）
 * PG 不支持 ADD CONSTRAINT IF NOT EXISTS，故每个约束用 DO $$ 判存在性后添加。
 * 允许列表 = 代码候选值 ∪ dev 实测值（数据探针已确认现状数据全部合规）。
 */
const fs = require('fs');
const path = require('path');

const MIG = path.join(__dirname, 'migrations/0013_enum_constraints.sql');

// ---- Tier1 逐表精确白名单 ----
const tier1 = [
  { table: 'inventory_flow', col: 'flow_type', vals: [
    'finish_in','garment_purchase_inbound','garment_purchase_return','out','production_inbound',
    'production_issue','production_outbound','purchase_inbound','purchase_return','retail_outbound',
    'retail_return_in','sales_outbound','sales_return','stocktake_adjust','subcontract_issue',
    'subcontract_receipt','transfer_in','transfer_in_complete','transfer_in_transit','transfer_out'] },
  { table: 'month_close_detail', col: 'flow_type', vals: [
    'finish_in','garment_purchase_inbound','garment_purchase_return','out','production_inbound',
    'production_issue','production_outbound','purchase_inbound','purchase_return','retail_outbound',
    'retail_return_in','sales_outbound','sales_return','stocktake_adjust','subcontract_issue',
    'subcontract_receipt','transfer_in','transfer_in_complete','transfer_in_transit','transfer_out'] },
  { table: 'inventory_flow', col: 'direction', vals: ['in','out','inbound'] },
  { table: 'inventory_stocktake', col: 'item_type', vals: ['sku','material'] },
  { table: 'inventory_transfer', col: 'item_type', vals: ['sku','material'] },
  { table: 'inventory_flow', col: 'item_type', vals: ['sku','material'] },
  { table: 'allocation_item', col: 'submitter_type', vals: ['dealer','direct'] },
  { table: 'pre_order', col: 'submitter_type', vals: ['dealer','direct'] },
  { table: 'payable', col: 'biz_type', vals: [
    'garment_purchase_inbound','material_purchase_inbound','purchase_inbound','sales_outbound','subcontract_fee','pos_checkout'] },
  { table: 'receivable', col: 'biz_type', vals: [
    'garment_purchase_inbound','material_purchase_inbound','purchase_inbound','sales_outbound','subcontract_fee','pos_checkout'] },
  { table: 'pos_idempotency', col: 'biz_type', vals: [
    'garment_purchase_inbound','material_purchase_inbound','purchase_inbound','sales_outbound','subcontract_fee','pos_checkout'] },
  { table: 'doc_unique_code', col: 'doc_type', vals: ['retail','sales','transfer'] },
  { table: 'doc_unique_code_archive', col: 'doc_type', vals: ['retail','sales','transfer'] },
  { table: 'rbac_permission', col: 'type', vals: ['api','menu','button','data','group','catalog'] },
  { table: 'warehouse', col: 'type', vals: ['dealer','finished','main','self','store'] },
  { table: 'price_list', col: 'type', vals: ['store','system','global','channel'] },
  { table: 'promotion', col: 'type', vals: ['full_reduction','discount'] },
  { table: 'coupon', col: 'type', vals: ['full_reduction','cash','discount'] },
  { table: 'retail_order', col: 'source', vals: ['pos','store_pos','outbound','manual','system'] },
];

// ---- Tier2 status 安全网（28 值：代码 27 + ongoing）----
const STATUS_UNION = [
  'accepted','active','approved','booked','cancelled','closed','completed','confirmed','disabled',
  'done','draft','finished','in_stock','in_transit','inactive','open','out','pending','processing',
  'refunded','returned','settled','skipped','sold','submitted','unpaid','wait_confirm','ongoing',
];
const STATUS_TABLES = [
  'member','omni_order','sales_channel','subcontract_fee','subcontract_receipt','subcontract_issue',
  'subcontract_order','inventory_batch','style_attr_value','style_attr_def','sales_reconciliation',
  'purchase_reconciliation','finance_payment','finance_receipt','production_finish_receipt',
  'production_material_issue','production_work_order','material_purchase_inbound','material_purchase_order',
  'garment_purchase_return','garment_purchase_inbound','garment_purchase_order','rbac_role','rbac_user',
  'month_close','retail_return','retail_order','allocation_order','pre_order','trade_show','store','dealer',
  'style_attribute','payable','receivable','inventory_stocktake','inventory_transfer','sales_return',
  'sales_outbound','sales_order','purchase_return','purchase_inbound','purchase_order','bom','warehouse',
  'supplier','customer','material','sku','style','price_list','price_list_item','promotion','coupon',
  'pos_session','pos_idempotency','hangtag_template','unique_code_stock',
];

function inList(vals) { return vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(', '); }
function block(cname, table, col, vals) {
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${cname}') THEN
    ALTER TABLE ${table}
      ADD CONSTRAINT ${cname}
      CHECK (${col} IN (${inList(vals)}));
  END IF;
END $$;`;
}

const lines = [];
lines.push('-- =============================================================================');
lines.push('-- 服装ERP 数据质量治理（P1-④）：枚举约束');
lines.push('-- 目标：');
lines.push('--   Tier1 对枚举型列（flowType/direction/itemType/submitterType/bizType/docType/');
lines.push('--         type/source）按"代码候选值 ∪ dev 实测值"精确白名单加 CHECK 约束；');
lines.push('--   Tier2 对全部 58 个 status 列加共享联合白名单安全网（挡垃圾值/注入，含 ongoing）。');
lines.push('-- 全部幂等（DO $$ 判存在性后添加），可重复执行。');
lines.push('-- 数据兼容性：dev 库探针已确认现状数据全部合规，可安全 ALTER。');
lines.push('-- 注意：ALTER ADD CONSTRAINT 取 ACCESS EXCLUSIVE 锁并校验全表，建议在低峰期执行；');
lines.push('--       超大表可改为 NOT VALID + 后续 VALIDATE CONSTRAINT 以降低锁时长。');
lines.push('-- =============================================================================');
lines.push('');
lines.push('BEGIN;');
lines.push('');

lines.push('-- ---------- Tier1：枚举族逐表精确 CHECK ----------');
for (const t of tier1) {
  const cname = `ck_${t.table}_${t.col}`;
  lines.push(`-- ${t.table}.${t.col}`);
  lines.push(block(cname, t.table, t.col, t.vals));
  lines.push('');
}

lines.push('-- ---------- Tier2：status 共享联合白名单安全网（58 列）----------');
for (const table of STATUS_TABLES) {
  const cname = `ck_${table}_status`;
  lines.push(`-- ${table}.status`);
  lines.push(block(cname, table, 'status', STATUS_UNION));
  lines.push('');
}

lines.push('COMMIT;');

fs.writeFileSync(MIG, lines.join('\n') + '\n');
console.log(`已生成 ${MIG}`);
console.log(`  Tier1 精确 CHECK：${tier1.length} 个`);
console.log(`  Tier2 status 安全网：${STATUS_TABLES.length} 个`);
console.log(`  status 白名单取值数：${STATUS_UNION.length}`);
