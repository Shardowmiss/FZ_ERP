/**
 * 数据兼容性探针（只读）：针对枚举候选列，扫描 dev 库当前实际存在的不同值。
 * 目的：在落地 CHECK 约束前，确认是否已有"越界值"会导致 ALTER ADD CONSTRAINT 失败。
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const ROOT = __dirname;
const schemaPath = path.join(ROOT, 'server/database/schema.ts');
const schemaSrc = fs.readFileSync(schemaPath, 'utf8').split('\n');

const ENUM_COLS = ['status','type','flowType','direction','itemType','submitterType','bizType','docType','source','level','gender','category'];
const tableRe = /pgTable\(\s*['"]([^'"]+)['"]/g;
const colRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*varchar\(\s*['"]([^'"]+)['"]/;

const columns = [];
let currentTable = null;
for (let i = 0; i < schemaSrc.length; i++) {
  const line = schemaSrc[i];
  const tM = tableRe.exec(line); if (tM) currentTable = tM[1];
  const cM = colRe.exec(line);
  if (cM && currentTable && ENUM_COLS.includes(cM[1])) {
    columns.push({ table: currentTable, prop: cM[1], dbCol: cM[2] });
  }
  tableRe.lastIndex = 0;
}

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const sql = postgres(CONN, { max: 1 });

(async () => {
  console.log('=== dev 库枚举列实际取值（越界值 = CHECK 落地风险）===');
  const byProp = {};
  for (const c of columns) (byProp[c.prop] ||= []).push(c);

  for (const prop of ENUM_COLS) {
    const cols = byProp[prop];
    if (!cols || cols.length === 0) continue;
    console.log(`\n## ${prop}  (${cols.length} 列)`);
    for (const c of cols) {
      try {
        const rows = await sql.unsafe(`SELECT DISTINCT "${c.dbCol}" AS v FROM "${c.table}" WHERE "${c.dbCol}" IS NOT NULL`);
        const vals = rows.map((r) => r.v).sort();
        const flag = vals.length === 0 ? ' (空表/无值)' : '';
        console.log(`  - ${c.table}.${c.dbCol}: [${vals.join(', ')}]${flag}`);
      } catch (e) {
        console.log(`  - ${c.table}.${c.dbCol}: <查询失败: ${String(e.message).split('\n')[0]}>`);
      }
    }
  }
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
