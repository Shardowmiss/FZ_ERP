#!/usr/bin/env node
'use strict';
/**
 * 款号属性维护（style_attr_def + style_attr_value）默认编码种子化。
 *
 * ⚠️ 历史坑（已在 2026-10-03 纠正）：早期版本把种子写进了 `style_attribute` 表，
 * 但「款号属性维护」页（StyleAttrDefController → style-attr-def.service.ts）实际读取的是
 * `style_attr_def`（属性定义）与 `style_attr_value`（属性值，FK → style_attr_def.id）。
 * 两表不一致导致该页长期空白、且与「款号编码规则」的编码映射配置对不上。
 * 本脚本写对表，使两页共享同一份数据。
 *
 * 幂等：
 *   - style_attr_def 唯一约束在 attr_code → ON CONFLICT (attr_code) DO NOTHING
 *   - style_attr_value 唯一约束在 (attr_def_id, value_code)
 *       → ON CONFLICT (attr_def_id, value_code) DO NOTHING
 * 可重复执行，已存在行跳过。
 *
 * 用法：
 *   node --env-file=.env scripts/seed-style-attributes.cjs
 *   node --env-file=.env scripts/seed-style-attributes.cjs --dry-run
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

if (!fs.existsSync(path.join(ROOT, '.env'))) {
  console.error('[seed] 找不到 .env，无法解析数据库连接串');
  process.exit(1);
}
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const m = envText.match(/^SUDA_DATABASE_URL=(.*)$/m);
if (!m) {
  console.error('[seed] .env 中未找到 SUDA_DATABASE_URL');
  process.exit(1);
}
const u = new URL(m[1].trim());
const HOST = u.hostname;
const PORT = u.port || 5432;
const USER = decodeURIComponent(u.username);
const DB = decodeURIComponent(u.pathname.slice(1));
const PW = u.password ? decodeURIComponent(u.password) : process.env.PGPASSWORD || 'erp';

function findPsql() {
  const candidates = [
    process.env.PSQL_BIN,
    '/opt/homebrew/Cellar/postgresql@16/16.15/bin/psql',
    '/opt/homebrew/bin/psql',
    'psql',
  ];
  for (const c of candidates) {
    if (!c) continue;
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error('[seed] 找不到 psql，请设置 PSQL_BIN 环境变量');
}
const PSQL = findPsql();
const baseArgs = ['-h', HOST, '-p', String(PORT), '-U', USER, '-d', DB, '-t', '-A', '-F\t'];

function psqlQuery(sqlText) {
  return execFileSync(PSQL, [...baseArgs, '-c', sqlText], {
    env: { ...process.env, PGPASSWORD: PW },
    encoding: 'utf8',
  });
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

// [attrCode, attrName, sortOrder]
const DEFS = [
  ['SEASON', '季节', 1],
  ['CATEGORY', '品类', 2],
  ['SUBCATEGORY', '小类', 3],
  ['FIT', '版型', 4],
  ['BRAND', '品牌', 5],
];

// [defCode, valueCode, valueName, sortOrder]
const VALUES = [
  ['SEASON', 'SP', '春', 1],
  ['SEASON', 'SU', '夏', 2],
  ['SEASON', 'AW', '秋', 3],
  ['SEASON', 'WI', '冬', 4],
  ['CATEGORY', 'SY', '上衣', 1],
  ['CATEGORY', 'KZ', '裤装', 2],
  ['CATEGORY', 'QZ', '裙装', 3],
  ['CATEGORY', 'WT', '外套', 4],
  ['SUBCATEGORY', 'TX', 'T恤', 1],
  ['SUBCATEGORY', 'CS', '衬衫', 2],
  ['SUBCATEGORY', 'NZ', '牛仔裤', 3],
  ['SUBCATEGORY', 'XK', '休闲裤', 4],
  ['SUBCATEGORY', 'LQ', '连衣裙', 5],
  ['SUBCATEGORY', 'JK', '夹克', 6],
  ['FIT', 'X', '修身', 1],
  ['FIT', 'B', '常规', 2],
  ['FIT', 'K', '宽松', 3],
  ['FIT', 'O', 'Oversize', 4],
  ['BRAND', 'DEF', '默认品牌', 0],
];

function countDefs() {
  return parseInt(psqlQuery(`SELECT COUNT(*) FROM style_attr_def`).trim() || '0', 10);
}
function countValues() {
  return parseInt(psqlQuery(`SELECT COUNT(*) FROM style_attr_value`).trim() || '0', 10);
}

console.log('[seed] 数据库连接: %s:%s/%s user=%s', HOST, PORT, DB, USER);
console.log('[seed] 模式: %s', DRY ? 'DRY-RUN（不写入）' : 'REAL');
console.log('[seed] 种子前存量: style_attr_def=%d, style_attr_value=%d', countDefs(), countValues());

// 1) 写属性定义
const defRows = DEFS.map(
  ([code, name, sort]) =>
    `(gen_random_uuid(), '${esc(code)}', '${esc(name)}', ${sort}, 'active')`,
).join(',\n');
const defSql = `INSERT INTO style_attr_def (id, attr_code, attr_name, sort_order, status)
VALUES
${defRows}
ON CONFLICT (attr_code) DO NOTHING;`;

// 2) 写属性值（FK 通过 attr_code 子查询定位 def.id）
const valStmts = VALUES.map(([defCode, vCode, vName, sort]) => {
  return `INSERT INTO style_attr_value (id, attr_def_id, value_code, value_name, sort_order, status)
SELECT gen_random_uuid(),
       (SELECT id FROM style_attr_def WHERE attr_code = '${esc(defCode)}'),
       '${esc(vCode)}', '${esc(vName)}', ${sort}, 'active'
ON CONFLICT (attr_def_id, value_code) DO NOTHING;`;
}).join('\n');

if (DRY) {
  console.log('\n[seed] ---- DRY-RUN def SQL ----\n%s\n', defSql);
  console.log('[seed] ---- DRY-RUN value SQL (节选前 2 条) ----\n%s\n[seed] ---- END ----\n',
    valStmts.split('\n').slice(0, 3).join('\n'));
  process.exit(0);
}

psqlQuery(defSql);
psqlQuery(valStmts);

console.log('[seed] 写入完成（已存在行按唯一约束跳过）。');
console.log('[seed] 种子后存量: style_attr_def=%d, style_attr_value=%d', countDefs(), countValues());

// 校验：子类别值是否都挂到了存在的 def
const orphan = psqlQuery(
  `SELECT COUNT(*) FROM style_attr_value v LEFT JOIN style_attr_def d ON v.attr_def_id = d.id WHERE d.id IS NULL`,
).trim();
console.log('[seed] 孤儿属性值（def 不存在）= %s', orphan);

process.exit(0);
