#!/usr/bin/env node
'use strict';
/**
 * 存量 PII 联系电话回填（P0-2 切片 2b/2c）。
 *
 * 将 store / dealer / supplier / rbac_user 的 phone 明文加密为 AES-256-GCM 密文，
 * 并计算 phone_hmac 指纹列。复用编译产物 dist/server/common/crypto/field-encryption.js，
 * 以保证与运行时算法完全一致（trust-but-verify：回填与运行时同一份实现，杜绝两套实现不一致）。
 *
 * 幂等：已是 enc:: 或已回填 phone_hmac 的行跳过 → 可重复执行。
 *
 * 用法：
 *   node --env-file=.env scripts/backfill-pii-phone-enc.cjs
 *   node --env-file=.env scripts/backfill-pii-phone-enc.cjs --dry-run
 *
 * 前置：先 `npm run build`（生成 dist），并确保 .env 含 FIELD_ENC_KEY 与 SUDA_DATABASE_URL；
 *       且迁移 0026 已执行（phone_hmac 列已存在）。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST_CRYPTO = path.join(ROOT, 'dist', 'server', 'common', 'crypto', 'field-encryption.js');

if (!fs.existsSync(DIST_CRYPTO)) {
  console.error('[backfill] 未找到编译产物 %s，请先执行 npm run build', DIST_CRYPTO);
  process.exit(1);
}
const { encryptField, hmacField } = require(DIST_CRYPTO);

const DRY = process.argv.includes('--dry-run');

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

const TABLES = ['store', 'dealer', 'supplier', 'rbac_user'];

for (const t of TABLES) {
  const rowsRaw = psqlQuery(
    `SELECT id, phone FROM ${t} WHERE phone IS NOT NULL AND phone <> '' AND phone NOT LIKE 'enc::%' AND phone_hmac IS NULL`,
  ).trim();

  if (!rowsRaw) {
    console.log(`[backfill] ${t}: 无需回填（无明文电话）`);
    continue;
  }

  const rows = rowsRaw.split('\n').map((line) => {
    const [id, phone] = line.split('\t');
    return { id, phone };
  });
  console.log(`[backfill] ${t}: 待回填 ${rows.length} 条`);

  const values = [];
  for (const r of rows) {
    const enc = encryptField(r.phone);
    const hmac = hmacField(r.phone);
    console.log(
      `  ${t} ${r.id}  ${String(r.phone).slice(0, 3)}**** -> enc(${enc.length}b) hmac=${hmac ? hmac.slice(0, 8) : 'null'}...`,
    );
    values.push(`('${r.id}', '${enc.replace(/'/g, "''")}', '${hmac}')`);
  }

  if (DRY) {
    console.log(`[backfill] ${t}: dry-run 完成，未写入数据库`);
    continue;
  }

  // 单语句批量 UPDATE（VALUES 关联），避免逐行往返
  const sql = `UPDATE ${t} x SET phone = v.enc, phone_hmac = v.hmac
  FROM (VALUES ${values.join(', ')}) AS v(id, enc, hmac)
  WHERE x.id = v.id::uuid`;
  psqlQuery(sql);
  console.log(`[backfill] ${t}: 已加密回填 ${rows.length} 条`);
}
