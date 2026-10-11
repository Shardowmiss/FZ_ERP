#!/usr/bin/env node
/**
 * 权限码拆分后的「授权零回归」同步脚本（幂等，可重复执行）。
 *
 * ── 背景 ─────────────────────────────────────────────────────────────
 * 2026-10-11 治理：权限目录此前存在「一码多菜单复用」——多个功能页面共用同一资源码，
 * 导致权限树里只显示其中一条（label 被后声明者覆盖），用户「看不到某些功能」，
 * 也无法对它们分别授权。本次为下列功能拆出独立权限码：
 *
 *   旧码               → 新码
 *   base:style         → base:color-group（颜色组）、base:style-attribute（款号属性维护）、
 *                        base:code-rule（款号编码规则）
 *   base:sku           → base:size-group（尺码组）
 *   base:size          → base:size-group（尺码组与尺码关系）
 *   inventory:query    → inventory:hangtag（吊牌打印，原无后端守卫、页面错挂 query 码）
 *
 * 拆分后，原先靠旧码进入这些页面的角色会失去访问（回归）。本脚本把
 * 「持有旧码的角色」按上表补授对应新码，保持既有授权范围不变；
 * 之后再由管理员在「权限管理」界面按需收窄。
 *
 * 前置：先启动一次服务（AppModule.onModuleInit → ensureRbacCatalog），
 *       让 rbac_permission 里已经有这些新码。
 *
 * 用法：NODE_OPTIONS= node scripts/sync-permission-split.cjs
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const SPLIT = [
  { from: 'base:style', to: ['base:color-group', 'base:style-attribute', 'base:code-rule'] },
  { from: 'base:sku', to: ['base:size-group'] },
  { from: 'base:size', to: ['base:size-group'] },
  { from: 'inventory:query', to: ['inventory:hangtag'] },
];

function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return env;
}

(async () => {
  const url = process.env.SUDA_DATABASE_URL || loadEnv().SUDA_DATABASE_URL;
  if (!url) {
    console.error('缺少 SUDA_DATABASE_URL');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1 });
  let added = 0;
  try {
    for (const { from, to } of SPLIT) {
      const [fromRow] = await sql`select id from rbac_permission where code = ${from}`;
      if (!fromRow) {
        console.log(`- ${from}: 权限表中不存在，跳过`);
        continue;
      }
      // 持有旧码的角色
      const roles = await sql`
        select r.code as role_code
        from rbac_role_permission rp
        join rbac_role r on r.id = rp.role_id
        where rp.permission_id = ${fromRow.id}
      `;
      for (const { role_code } of roles) {
        for (const code of to) {
          const [toRow] = await sql`select id from rbac_permission where code = ${code}`;
          if (!toRow) {
            console.log(`  ! 目标码 ${code} 尚不存在（请先启动一次服务让目录同步）`);
            continue;
          }
          const ins = await sql`
            insert into rbac_role_permission (role_id, permission_id)
            select r.id, ${toRow.id} from rbac_role r where r.code = ${role_code}
            on conflict (role_id, permission_id) do nothing
            returning id
          `;
          if (ins.length) {
            added++;
            console.log(`  + ${role_code}: 补授 ${code}（因持有 ${from}）`);
          }
        }
      }
    }
    console.log(`\n完成：新增授权 ${added} 条（已存在的自动跳过）。`);
  } catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 1;
  }
  await sql.end();
  process.exit();
})();
