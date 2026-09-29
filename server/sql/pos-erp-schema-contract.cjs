#!/usr/bin/env node
/**
 * P1-7 ERP↔POS 共享表契约校验脚本
 * --------------------------------------------------------------------------
 * 背景：POS 系统（TEST-P）经 real-erp.adapter.ts 的 tagged-template SQL 直接
 *       读取 ERP 同一 PostgreSQL 库的 8 张主数据/库存表（而非走接口）。一旦 ERP
 *       侧对这些表做改名、删列、改类型，POS 不会编译报错，而是在运行时静默失败
 *       （空数据 / 字段 undefined / 整页白屏）。本脚本把"POS 实际依赖的表+列"
 *       固化成一份机器可校验的契约，供 CI / 上线前卡点。
 *
 * 用法：node server/sql/pos-erp-schema-contract.cjs
 * 依赖：pg（POS 项目已装）。连接串取 .env DATABASE_URL，回退到本地 erp_db。
 */
const fs = require('fs');
const path = require('path');

// 优先用 POS 自己的 .env（与 ERP 同库）
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const postgres = require('postgres');

// ===== 契约定义：POS 直读 ERP 表 + 必依赖列（来自 real-erp.adapter.ts 真实引用）=====
const CONTRACT = {
  sku: ['id', 'style_no', 'sku_code', 'tag_price', 'cost_price', 'color', 'size'],
  style: ['style_no', 'name', 'category', 'status', 'tag_price', 'cost_price'],
  member: ['member_no', 'name', 'phone', 'gender', 'birthday', 'level', 'points', '_updated_at'],
  inventory_stock: ['style_no', 'color', 'size', 'quantity', 'warehouse_id'],
  warehouse: ['id', 'code', 'type', 'name'],
  inventory_transfer: ['id', 'transfer_no', 'from_warehouse_name', 'to_warehouse_name', 'status', 'to_warehouse_id'],
  inventory_transfer_item: ['transfer_id', 'quantity', 'sku_id'],
  promotion: ['id', 'code', 'type', 'name', 'begin_date', 'end_date', 'store_ids', 'priority', 'status', '_updated_at'],
};

async function main() {
  const url =
    process.env.DATABASE_URL ||
    'postgres://erp:erp@localhost:5434/erp_db';
  const sql = postgres(url, { max: 1 });

  let failures = 0;
  for (const [table, cols] of Object.entries(CONTRACT)) {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=${table}
    `;
    const existing = new Set(rows.map((r) => r.column_name));
    if (rows.length === 0) {
      console.log(`❌ 表缺失: ${table}`);
      failures++;
      continue;
    }
    const missing = cols.filter((c) => !existing.has(c));
    if (missing.length) {
      console.log(`❌ ${table} 缺少列: ${missing.join(', ')}`);
      failures++;
    } else {
      console.log(`✅ ${table} (${cols.length} 依赖列齐全)`);
    }
  }

  await sql.end();
  if (failures) {
    console.log(`\n契约校验失败：发现 ${failures} 处破坏。ERP 侧改动已破坏 POS 直读契约，须回滚或同步修改 POS adapter。`);
    process.exit(1);
  }
  console.log('\n✅ 所有共享表契约通过：POS 直读的 ERP 表/列均存在。');
}

main().catch((e) => {
  console.error('契约校验异常:', e.message);
  process.exit(2);
});
