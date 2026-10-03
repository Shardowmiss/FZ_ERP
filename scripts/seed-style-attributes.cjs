#!/usr/bin/env node
'use strict';
/**
 * 款号属性维护（style_attribute）默认编码种子化。
 *
 * 背景：款号编码规则的「编码映射配置」页 season/category/subCategory/fit/brand 长期空白，
 * 根因是 style_attribute 全空且无种子数据；服务端 getMappingConfig() 此前对这些类型
 * 缺少默认回退（DEFAULT_* 成死代码），已在前序提交 0ba722a 中恢复为回退值。
 *
 * 本脚本把与代码 DEFAULT_* 完全一致的默认编码**物理写入** style_attribute，
 * 使「款号属性维护」页可直接看到并编辑这些数据；写入后 getMappingConfig() 将读取
 * DB 数据（不再走回退），与默认值等价但可被运营维护。
 *
 * 幂等：唯一约束 uk_style_attr_type_code (attr_type, attr_code)，
 *       INSERT ... ON CONFLICT (attr_type, attr_code) DO NOTHING → 已存在则跳过，可重复执行。
 *
 * 注：years 默认即为空数组，无需种子；colors/sizes 不在本表（存于 code_mapping_config，
 * 由「编码映射配置」页维护），不在本脚本范围。
 *
 * 用法：
 *   node --env-file=.env scripts/seed-style-attributes.cjs
 *   node --env-file=.env scripts/seed-style-attributes.cjs --dry-run
 *
 * 前置：.env 含 SUDA_DATABASE_URL；erp_db 已启动（端口见连接串）。
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

// [attrType, attrCode, attrName, sortOrder, parentCode|null, remark|null]
// 数据与 code-rule.service.ts 的 DEFAULT_* 完全一致。
const SEED = [
  // season
  ['season', 'SP', '春', 1, null, null],
  ['season', 'SU', '夏', 2, null, null],
  ['season', 'AW', '秋', 3, null, null],
  ['season', 'WI', '冬', 4, null, null],
  // category
  ['category', 'SY', '上衣', 1, null, null],
  ['category', 'KZ', '裤装', 2, null, null],
  ['category', 'QZ', '裙装', 3, null, null],
  ['category', 'WT', '外套', 4, null, null],
  // sub_category（parent_code 指向 category 的 attr_code）
  ['sub_category', 'TX', 'T恤', 1, 'SY', null],
  ['sub_category', 'CS', '衬衫', 2, 'SY', null],
  ['sub_category', 'NZ', '牛仔裤', 3, 'KZ', null],
  ['sub_category', 'XK', '休闲裤', 4, 'KZ', null],
  ['sub_category', 'LQ', '连衣裙', 5, 'QZ', null],
  ['sub_category', 'JK', '夹克', 6, 'WT', null],
  // fit
  ['fit', 'X', '修身', 1, null, null],
  ['fit', 'B', '常规', 2, null, null],
  ['fit', 'K', '宽松', 3, null, null],
  ['fit', 'O', 'Oversize', 4, null, null],
  // brand
  ['brand', 'DEF', '默认品牌', 0, null, '系统默认品牌'],
];

const TYPES = ['season', 'category', 'sub_category', 'fit', 'brand'];

function countByType(attrType) {
  const out = psqlQuery(
    `SELECT COUNT(*) FROM style_attribute WHERE attr_type = '${esc(attrType)}'`,
  ).trim();
  return parseInt(out, 10) || 0;
}

console.log('[seed] 数据库连接: %s:%s/%s user=%s', HOST, PORT, DB, USER);
console.log('[seed] 模式: %s', DRY ? 'DRY-RUN（不写入）' : 'REAL');
console.log('[seed] 各类型种子前存量:');
for (const t of TYPES) {
  console.log('        ' + t.padEnd(12) + ' ' + countByType(t));
}

const values = SEED.map(
  ([type, code, name, sort, parent, remark]) =>
    `('${esc(type)}','${esc(code)}','${esc(name)}',${sort},` +
    `${parent ? `'${esc(parent)}'` : 'NULL'},` +
    `${remark ? `'${esc(remark)}'` : 'NULL'},'active')`,
).join(',\n');

const sql = `INSERT INTO style_attribute
  (attr_type, attr_code, attr_name, sort_order, parent_code, remark, status)
VALUES
${values}
ON CONFLICT (attr_type, attr_code) DO NOTHING;`;

if (DRY) {
  console.log('\n[seed] ---- DRY-RUN SQL ----\n%s\n[seed] ---- END ----\n', sql);
  console.log('[seed] dry-run 完成，未写入数据库');
  process.exit(0);
}

psqlQuery(sql);
console.log('[seed] 写入完成（已存在行按唯一约束跳过）。');

console.log('[seed] 各类型种子后存量:');
for (const t of TYPES) {
  console.log('        ' + t.padEnd(12) + ' ' + countByType(t));
}

process.exit(0);
