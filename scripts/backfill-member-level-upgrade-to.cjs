#!/usr/bin/env node
'use strict';
/**
 * 会员等级「升级后等级」回填（0036 配套）。
 *
 * 业务链：会员卡(normal)→银卡(silver)→金卡(gold)→钻石卡(diamond)；diamond 为顶级，upgrade_to 置空。
 * 迁移 0036 仅为 member_level 新增可空列 upgrade_to（varchar，存目标等级 code），本脚本把存量 4 行按规则回填。
 *
 * 设计要点（trust-but-verify，对齐 backfill-member-phone-enc.cjs 范式）：
 *   - 连接串复用 .env 的 SUDA_DATABASE_URL，与运行时完全一致；
 *   - 用 psql 直连 erp_db 执行，避免引入第二个 ORM 实现；
 *   - WHERE 仅触碰「当前值与目标值不一致」的行，幂等、可重复跑；
 *   - 支持 --dry-run，先打印待变更再决定是否写入。
 *
 * 用法：
 *   node scripts/backfill-member-level-upgrade-to.cjs
 *   node scripts/backfill-member-level-upgrade-to.cjs --dry-run
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

// 升级规则：当前 code -> 目标 code（null 表示顶级不再升级）
const RULES = [
  { code: 'normal',  target: 'silver'  },
  { code: 'silver',  target: 'gold'    },
  { code: 'gold',    target: 'diamond' },
  { code: 'diamond', target: null      },
];

// 解析 .env 的 SUDA_DATABASE_URL
if (!fs.existsSync(path.join(ROOT, '.env'))) {
  console.error('[backfill] 找不到 .env，无法解析数据库连接串');
  process.exit(1);
}
const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const m = envText.match(/^SUDA_DATABASE_URL=(.*)$/m);
if (!m) {
  console.error('[backfill] .env 中未找到 SUDA_DATABASE_URL');
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
  throw new Error('[backfill] 找不到 psql，请设置 PSQL_BIN 环境变量');
}
const PSQL = findPsql();
const baseArgs = ['-h', HOST, '-p', String(PORT), '-U', USER, '-d', DB, '-t', '-A', '-F\t'];

function psqlQuery(sqlText) {
  return execFileSync(PSQL, [...baseArgs, '-c', sqlText], {
    env: { ...process.env, PGPASSWORD: PW },
    encoding: 'utf8',
  });
}

// 1) 读当前 4 行
const curRaw = psqlQuery(
  `SELECT code, name, COALESCE(upgrade_to, '') FROM member_level ORDER BY sort_order, code`,
).trim();
if (!curRaw) {
  console.log('[backfill] member_level 无数据，无需回填');
  process.exit(0);
}
const cur = curRaw.split('\n').map((line) => {
  const [code, name, upgradeTo] = line.split('\t');
  return { code, name, upgradeTo: upgradeTo || null };
});

console.log('[backfill] 当前 member_level 升级设定：');
let pendingCount = 0;
const plan = cur.map((r) => {
  const rule = RULES.find((x) => x.code === r.code);
  const target = rule ? rule.target : null;
  const changed = r.upgradeTo !== target;
  if (changed) pendingCount += 1;
  console.log(
    `  ${r.code.padEnd(8)} ${String(r.name).padEnd(8)} upgrade_to=${String(r.upgradeTo).padEnd(8)} -> ${String(target).padEnd(8)} ${changed ? 'CHANGED' : 'unchanged'}`,
  );
  return { code: r.code, target };
});

if (pendingCount === 0) {
  console.log('[backfill] 无需回填（upgrade_to 已符合规则）');
  process.exit(0);
}
console.log(`[backfill] 待回填 ${pendingCount} 行`);

if (DRY) {
  console.log('[backfill] dry-run 完成，未写入数据库');
  process.exit(0);
}

// 2) 单语句幂等 UPDATE：仅触碰「当前值与目标值不一致」的行
const cases = RULES.map((r) => `WHEN '${r.code}' THEN ${r.target ? `'${r.target}'` : 'NULL'}`).join(' ');
const where = RULES.map((r) => {
  if (r.target) {
    return `(code = '${r.code}' AND (upgrade_to IS NULL OR upgrade_to <> '${r.target}'))`;
  }
  return `(code = '${r.code}' AND upgrade_to IS NOT NULL)`;
}).join(' OR ');

const sql = `UPDATE member_level
SET upgrade_to = CASE code ${cases} ELSE upgrade_to END
WHERE ${where}`;
psqlQuery(sql);

// 3) 核验
const afterRaw = psqlQuery(
  `SELECT code, COALESCE(upgrade_to, '') FROM member_level ORDER BY sort_order, code`,
).trim();
const after = {};
afterRaw.split('\n').forEach((line) => {
  const [code, upgradeTo] = line.split('\t');
  after[code] = upgradeTo || null;
});
console.log('[backfill] 回填后核验：');
let ok = true;
for (const p of plan) {
  const got = after[p.code];
  const good = got === p.target;
  if (!good) ok = false;
  console.log(`  ${p.code.padEnd(8)} upgrade_to=${String(got).padEnd(8)} expect=${String(p.target).padEnd(8)} ${good ? 'OK' : 'MISMATCH'}`);
}
console.log(ok ? '[backfill] 回填成功并校验通过' : '[backfill] 回填后校验存在不一致，请检查');
process.exit(ok ? 0 : 1);
