#!/usr/bin/env node
/**
 * 权限码拆分后的「授权零回归」同步脚本（幂等，可重复执行）。
 *
 * ── 背景 ─────────────────────────────────────────────────────────────
 * 2026-10-11 治理：权限目录此前存在两类问题——
 *   (1) 一码多菜单复用：多个功能页面共用同一资源码，权限树里只显示其中一条
 *       （label 被后声明者覆盖），用户「看不到某些功能」也无法分别授权；
 *   (2) 菜单声明码 ≠ 后端真实守卫码：页面能开、接口却 403（或反向越权）。
 * 本轮为下列功能拆出独立权限码，并把「菜单 permission」对齐到「页面实际调用接口的守卫码」。
 *
 * 拆分后，原先靠旧码进入这些页面的角色会失去访问（回归）。本脚本把
 * 「持有旧码的角色」按映射表补授对应新码，保持既有授权范围不变；
 * 之后再由管理员在「权限管理」界面按需收窄。
 *
 * ── 第一批（商品资料/库存域）─────────────────────────────────────────
 *   base:style      → base:color-group / base:style-attribute / base:code-rule
 *   base:sku        → base:size-group
 *   base:size       → base:size-group
 *   inventory:query → inventory:hangtag
 *
 * ── 第二批（页面声明码 ↔ 后端守卫码 对齐）────────────────────────────
 *   sales:order            → sales:retail（零售单）、report:retail_report（零售报表）
 *   sales:return           → sales:retail_return（零售退货单）
 *   retail:view            → sales:retail / sales:retail_return
 *                            （零售接口此前误用 retail:view 守卫，真正的使用者需平移到新码）
 *   finance:profit         → finance:month_close（月结）
 *   inventory:warning      → inventory:replenish（补货建议）
 *   inventory:query        → inventory:barcode（条码/批次）、inventory:unique_code（溯源）
 *   inventory:stocktake    → inventory:stocktake_mobile（移动盘点）、inventory:barcode
 *   inventory:inbound      → inventory:flow（入库单页内联调用流水接口，跨页依赖）
 *   inventory:outbound     → inventory:flow（出库单页内联调用流水接口）
 *   dashboard:view         → analytics:forecast / analytics:lifecycle / analytics:bi
 *   system:config          → report:semantic（透视字段配置）
 *   tradeshow:preorder     → tradeshow:manage（订货会主单）
 *   distribution:portal    → portal_overview / portal_po / portal_pr / portal_recon / portal_partners
 *   report:garment_purchase→ report:purchase
 *   report:material_purchase → report:purchase
 *
 * ── 全量补授 ─────────────────────────────────────────────────────────
 * dashboard:view：数据看板 4 个端点此前无守卫（人人可看），补守卫后必须全员补授，否则回归。
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
  // —— 第一批 ——
  { from: 'base:style', to: ['base:color-group', 'base:style-attribute', 'base:code-rule'] },
  { from: 'base:sku', to: ['base:size-group'] },
  { from: 'base:size', to: ['base:size-group'] },
  { from: 'inventory:query', to: ['inventory:hangtag'] },

  // —— 第二批 ——
  { from: 'sales:order', to: ['sales:retail', 'report:retail_report'] },
  { from: 'sales:return', to: ['sales:retail_return'] },
  { from: 'retail:view', to: ['sales:retail', 'sales:retail_return'] },
  { from: 'finance:profit', to: ['finance:month_close'] },
  { from: 'inventory:warning', to: ['inventory:replenish'] },
  { from: 'inventory:query', to: ['inventory:barcode', 'inventory:unique_code'] },
  { from: 'inventory:stocktake', to: ['inventory:stocktake_mobile', 'inventory:barcode'] },
  { from: 'inventory:inbound', to: ['inventory:flow'] },
  { from: 'inventory:outbound', to: ['inventory:flow'] },
  { from: 'dashboard:view', to: ['analytics:forecast', 'analytics:lifecycle', 'analytics:bi'] },
  { from: 'system:config', to: ['report:semantic'] },
  { from: 'tradeshow:preorder', to: ['tradeshow:manage'] },
  {
    from: 'distribution:portal',
    to: [
      'distribution:portal_overview',
      'distribution:portal_po',
      'distribution:portal_pr',
      'distribution:portal_recon',
      'distribution:portal_partners',
    ],
  },
  { from: 'report:garment_purchase', to: ['report:purchase'] },
  { from: 'report:material_purchase', to: ['report:purchase'] },
];

/** 需要补授给「全部角色」的码（历史上无守卫、人人可访问，补守卫后必须全员补授） */
const GRANT_ALL_ROLES = ['dashboard:view'];

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

  async function grantToRole(roleCode, code) {
    const [toRow] = await sql`select id from rbac_permission where code = ${code}`;
    if (!toRow) {
      console.log(`  ! 目标码 ${code} 尚不存在（请先启动一次服务让目录同步）`);
      return 0;
    }
    const ins = await sql`
      insert into rbac_role_permission (role_id, permission_id)
      select r.id, ${toRow.id} from rbac_role r where r.code = ${roleCode}
      on conflict (role_id, permission_id) do nothing
      returning id
    `;
    if (ins.length) {
      console.log(`  + ${roleCode}: 补授 ${code}`);
      return 1;
    }
    return 0;
  }

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
          const n = await grantToRole(role_code, code);
          added += n;
          if (n) console.log(`    （因持有 ${from}）`);
        }
      }
    }

    // 全员补授
    const allRoles = await sql`select code from rbac_role order by code`;
    for (const code of GRANT_ALL_ROLES) {
      for (const { code: roleCode } of allRoles) {
        added += await grantToRole(roleCode, code);
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
