/**
 * 枚举列侦察：
 * 1) 解析 schema.ts，提取所有枚举型列（status/type/flowType/direction/itemType/
 *    submitterType/bizType/docType/source/level/gender/category/unit）及其所属表与默认值。
 * 2) 扫描 server 源码，收集每个列名被赋值的字符串字面量，作为候选合法值。
 *
 * 输出：按表—列组织的清单 + 代码中出现过的候选值集合（供人工/后续 curate 成 CHECK 白名单）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const schemaPath = path.join(ROOT, 'server/database/schema.ts');
const serverDir = path.join(ROOT, 'server');

const schemaSrc = fs.readFileSync(schemaPath, 'utf8').split('\n');

// 枚举候选列（按性质分族）
const ENUM_COLS = [
  'status', 'type', 'flowType', 'direction', 'itemType',
  'submitterType', 'bizType', 'docType', 'source', 'level', 'gender', 'category',
];

// 解析 schema.ts：跟踪当前 pgTable
const tableRe = /pgTable\(\s*['"]([^'"]+)['"]/g;
const colRe = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*varchar\(\s*['"]([^'"]+)['"]/;

const columns = []; // { table, prop, dbCol, line, def }
let currentTable = null;
for (let i = 0; i < schemaSrc.length; i++) {
  const line = schemaSrc[i];
  const tM = tableRe.exec(line);
  if (tM) currentTable = tM[1];
  const cM = colRe.exec(line);
  if (cM && currentTable) {
    const prop = cM[1];
    if (ENUM_COLS.includes(prop)) {
      // 提取 default 值
      const defM = /default\(\s*['"]([^'"]+)['"]\s*\)/.exec(line);
      columns.push({
        table: currentTable,
        prop,
        dbCol: cM[2],
        line: i + 1,
        def: defM ? defM[1] : null,
      });
    }
  }
  tableRe.lastIndex = 0;
}

// 扫描 server 源码收集每个 prop 的候选值
function walk(dir, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (ent.name.endsWith('.ts')) {
      acc.push(p);
    }
  }
  return acc;
}
const files = walk(serverDir, []);
const litRe = /(?:^|[^A-Za-z0-9_])(status|type|flowType|direction|itemType|submitterType|bizType|docType|source|level|gender|category)\s*[:=]\s*['"]([^'"]{1,40})['"]/g;

const valuesByProp = {};
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  let m;
  while ((m = litRe.exec(src))) {
    const prop = m[1];
    const val = m[2];
    (valuesByProp[prop] ||= new Set()).add(val);
  }
  litRe.lastIndex = 0;
}

// 输出
console.log('=== 枚举列清单（schema.ts）===');
console.log(`共 ${columns.length} 个候选枚举列，涉及 ${new Set(columns.map((c) => c.table)).size} 张表`);
console.log();

const byProp = {};
for (const c of columns) (byProp[c.prop] ||= []).push(c);

for (const prop of ENUM_COLS) {
  const cols = byProp[prop];
  if (!cols || cols.length === 0) continue;
  console.log(`## ${prop}  （${cols.length} 列）`);
  const codeVals = [...(valuesByProp[prop] || [])].sort();
  for (const c of cols) {
    console.log(`  - ${c.table}.${c.dbCol}  (schema line ${c.line})  default=${c.def ?? '∅'}`);
  }
  console.log(`  代码出现过的候选值: ${codeVals.join(', ') || '(无)'}`);
  console.log();
}
