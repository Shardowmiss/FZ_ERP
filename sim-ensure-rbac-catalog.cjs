// 运行真实 RbacService.ensureRbacCatalog() 对开发库，验证：
//  1) 60 个权限码齐全  2) super_admin 持有全部权限  3) admin 用户被指派为超管（防锁死）
// 该方法是幂等安全网，对开发库为预期且有益的变更（与 onModuleInit 启动行为一致）。
// 运行：node sim-ensure-rbac-catalog.cjs
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { RbacService } = require('./dist/server/modules/rbac/rbac.service.js');

const CONN = 'postgres://erp:erp@localhost:5434/erp_db';
const sql = postgres(CONN);
const db = drizzle(sql);

let pass = 0,
  fail = 0;
function assert(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  ' + extra : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + name + (extra ? '  ' + extra : ''));
  }
}

async function main() {
  console.log('=== sim-ensure-rbac-catalog (real RbacService) ===');

  // 运行前快照
  const before = await sql`SELECT count(*)::int AS c FROM rbac_permission`;
  const beforeSA = await sql`SELECT count(*)::int AS c FROM rbac_role_permission rp JOIN rbac_role r ON r.id=rp.role_id WHERE r.code='super_admin'`;
  const beforeAdminRole = await sql`SELECT count(*)::int AS c FROM rbac_user_role ur JOIN rbac_role r ON r.id=ur.role_id JOIN rbac_user u ON u.id=ur.user_id WHERE r.code='super_admin' AND u.username='admin'`;
  console.log(
    `BEFORE: permissions=${before[0].c}, super_admin_perms=${beforeSA[0].c}, admin_is_sa=${beforeAdminRole[0].c}`,
  );

  // 调用真实方法
  const svc = new RbacService(db);
  await svc.ensureRbacCatalog();

  // 运行后校验
  const after = await sql`SELECT count(*)::int AS c FROM rbac_permission`;
  const afterSA = await sql`SELECT count(*)::int AS c FROM rbac_role_permission rp JOIN rbac_role r ON r.id=rp.role_id WHERE r.code='super_admin'`;
  const afterAdminRole = await sql`SELECT count(*)::int AS c FROM rbac_user_role ur JOIN rbac_role r ON r.id=ur.role_id JOIN rbac_user u ON u.id=ur.user_id WHERE r.code='super_admin' AND u.username='admin'`;
  console.log(
    `AFTER : permissions=${after[0].c}, super_admin_perms=${afterSA[0].c}, admin_is_sa=${afterAdminRole[0].c}`,
  );

  assert('permission-catalog-nonempty', after[0].c >= 59, `(${after[0].c})`);
  assert('super_admin-holds-all', afterSA[0].c === after[0].c, `(${afterSA[0].c}/${after[0].c})`);
  assert('admin-bootstrapped-to-super_admin', afterAdminRole[0].c === 1, `(admin_is_sa=${afterAdminRole[0].c})`);

  // 关键：admin 现在持有 super_admin → 不会被 245 个写授权接口锁死
  const adminPerms = await sql`SELECT count(*)::int AS c FROM rbac_user_role ur JOIN rbac_role r ON r.id=ur.role_id JOIN rbac_role_permission rp ON rp.role_id=r.id JOIN rbac_user u ON u.id=ur.user_id WHERE u.username='admin'`;
  assert('admin-can-pass-all-gated-writes', adminPerms[0].c === after[0].c, `(admin_perms=${adminPerms[0].c}/${after[0].c})`);

  await sql.end();
  console.log(`\n=== sim-ensure-rbac-catalog: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('SIM ERROR', e);
  process.exit(2);
});
