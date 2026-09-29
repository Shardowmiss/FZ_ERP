/**
 * 验证 0013 枚举约束迁移：
 *  1) 所有 ck_ 约束已在 pg_constraint 中存在（数量核对）
 *  2) 对迁移中每个约束，扫描"列值不在白名单"的现存行（应为 0）
 *  3) TEMP 表负向测试，证明 CHECK 机制在本库生效
 *  4) 重新执行迁移确认幂等（无报错、无重复）
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const MIG = path.join(__dirname, 'migrations/0013_enum_constraints.sql');
const content = fs.readFileSync(MIG, 'utf8');

// 解析 ALTER TABLE x ADD CONSTRAINT ck_x CHECK (col IN (...))
const re = /ALTER TABLE (\w+)\s+ADD CONSTRAINT (\w+)\s+CHECK\s*\((\w+)\s+IN\s*\(([^)]+)\)\)/g;
const checks = [];
let m;
while ((m = re.exec(content))) {
  const list = m[4].split(',').map((s) => s.trim().replace(/^'|'$/g, '').replace(/''/g, "'"));
  checks.push({ table: m[1], cname: m[2], col: m[3], vals: list });
}
re.lastIndex = 0;

const CONN = process.env.ERP_DB || 'postgres://erp:erp@localhost:5434/erp_db';
const sql = postgres(CONN, { max: 1 });

(async () => {
  // 1) 约束数量
  const cnt = await sql`SELECT count(*)::int AS c FROM pg_constraint WHERE conname LIKE 'ck_%'`;
  console.log(`1) pg_constraint 中 ck_ 约束数 = ${cnt[0].c}（期望 ${checks.length}）`);
  if (cnt[0].c !== checks.length) {
    console.log('   ⚠ 数量不符，列出缺失：');
    const existing = await sql`SELECT conname FROM pg_constraint WHERE conname LIKE 'ck_%'`;
    const have = new Set(existing.map((r) => r.conname));
    for (const c of checks) if (!have.has(c.cname)) console.log('     缺失', c.cname);
  }

  // 2) 越界扫描
  console.log('2) 逐约束越界行扫描（期望全部 0）：');
  let violations = 0;
  for (const c of checks) {
    try {
      const r = await sql.unsafe(
        `SELECT count(*)::int AS c FROM "${c.table}" WHERE "${c.col}" IS NOT NULL AND "${c.col}" NOT IN (${c.vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`
      );
      if (r[0].c > 0) { violations++; console.log(`   ✗ ${c.cname}: 越界 ${r[0].c} 行`); }
    } catch (e) {
      console.log(`   ! ${c.cname} 扫描失败: ${String(e.message).split('\n')[0]}`);
    }
  }
  console.log(violations === 0 ? '   全部 0 行越界 ✓' : `   共 ${violations} 个约束存在越界数据`);

  // 3) 负向测试 CHECK 机制
  console.log('3) TEMP 表负向测试（期望触发 check_violation）：');
  await sql.unsafe(`
    CREATE TEMP TABLE _chk_demo (status varchar(20));
    ALTER TABLE _chk_demo ADD CONSTRAINT ck_demo CHECK (status IN ('active','draft'));
  `);
  let enforced = false;
  try {
    await sql.unsafe(`INSERT INTO _chk_demo VALUES ('bogus_value')`);
  } catch (e) {
    if (String(e.message).includes('ck_demo')) enforced = true;
  }
  console.log(enforced ? '   ✓ CHECK 约束已生效（非法值被拒绝）' : '   ✗ 未拦截非法值');

  // 4) 幂等重跑
  console.log('4) 重新执行迁移确认幂等：');
  await sql.unsafe(content);
  const cnt2 = await sql`SELECT count(*)::int AS c FROM pg_constraint WHERE conname LIKE 'ck_%'`;
  console.log(`   重跑后 ck_ 约束数 = ${cnt2[0].c}（应仍 = ${checks.length}）`);

  await sql.end();
  console.log('\n验证完成。');
})().catch((e) => { console.error('验证异常：', e); process.exit(1); });
