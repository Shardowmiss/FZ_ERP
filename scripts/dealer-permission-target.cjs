#!/usr/bin/env node
/**
 * #814 dealer 授权最小化（pilot）—— 计算并（可选）应用 dealer 的目标授权集。
 *
 * 背景：dealer 当前 173 条授权中，53 个是资源级粗码（来自未入库的 onboard-dealer.cjs），
 *       这些粗码在 canDo 语义下隐式授予全部动作（如 base:size:create），造成越权。
 *       本脚本把 dealer 的授权收敛为「显式动作码」：
 *         · 持有的每个资源粗码 → 仅保留 ${res}:view（保留可见性，去除写能力）
 *         · 已动作级持有的码 → 原样保留
 *         · 追加少量经核实的经销写操作（见 WRITES）
 *       结果写入 OPERATIONAL_ROLES.dealer.permissions（可审计、可重装复现），
 *       并清空 dealer 在库中的既有授权后由 ensureOperationalRoles 幂等重放。
 *
 * 用法：
 *   NODE_OPTIONS= node scripts/dealer-permission-target.cjs          # 仅打印方案(diff)
 *   MODE=apply NODE_OPTIONS= node scripts/dealer-permission-target.cjs # 清空并写入目标集
 */
const postgres = require('postgres');

const sql = postgres({
  host: '127.0.0.1',
  port: 5434,
  database: 'erp_db',
  username: 'erp',
  password: 'erp',
});

// 经核实的经销商写操作（默认最小集；如需更多写能力，在此追加并经业务确认）
const WRITES = [
  'purchase:order:submit', // 经销商提交采购订单
  'distribution:portal_po:create', // 门户：创建我的采购单
  'distribution:portal_po:edit', // 门户：编辑我的采购单
];

// 已知动作动词（用于区分「资源:动作」与「两段资源码」）
const ACTION_VERBS = new Set([
  'view', 'create', 'edit', 'delete', 'approve',
  'accept', 'void', 'print', 'submit',
]);

// 把任意持有码归约到其「资源根码」
//   3 段(base:size:create)      → base:size（两段资源）
//   2 段且动词+父为资源(dashboard:view) → dashboard（一段资源）
//   2 段其余(base:size/md:merge/portal_po) → 自身即资源
//   1 段(dashboard/md)          → 自身即资源
function resourceOf(code, catalogSet) {
  const segs = code.split(':');
  if (segs.length <= 1) return code;
  if (segs.length === 2) {
    if (ACTION_VERBS.has(segs[1]) && catalogSet.has(segs[0])) return segs[0];
    return code;
  }
  return segs.slice(0, 2).join(':');
}

async function main() {
  const dealer = await sql`
    SELECT p.code AS perm_code
    FROM rbac_role_permission rp
    JOIN rbac_role r ON r.id = rp.role_id
    JOIN rbac_permission p ON p.id = rp.permission_id
    WHERE r.code = 'dealer'
    ORDER BY p.code
  `;
  const held = dealer.map((d) => d.perm_code);

  const catalog = await sql`SELECT code FROM rbac_permission`;
  const catalogSet = new Set(catalog.map((c) => c.code));

  // 计算目标集：每个 dealer 触及的资源 → 仅 :view；叠加最小写操作集
  const resources = new Set();
  for (const code of held) resources.add(resourceOf(code, catalogSet));

  const target = new Set();
  const removed = [];
  const viewAdded = [];
  for (const res of resources) {
    if (res.startsWith('mod:')) continue; // 模块容器码，非可授权权限，跳过
    const v = `${res}:view`;
    if (catalogSet.has(v)) {
      target.add(v);
      viewAdded.push(`${res} → ${v}`);
      removed.push(res);
    } else if (catalogSet.has(res)) {
      // 该资源目录无 :view（极少见），保守保留资源粗码
      target.add(res);
      console.log(`  ! 资源 ${res} 目录无 :view，保守保留粗码`);
    }
  }
  for (const w of WRITES) {
    if (catalogSet.has(w)) target.add(w);
    else console.log(`  ! 警告：写码 ${w} 不在目录中，跳过`);
  }

  const targetArr = [...target].sort();
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' dealer 授权最小化方案（资源根 → :view，叠加最小写集）');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`当前持有: ${held.length} 码；触及资源: ${resources.size} 个；目标集: ${targetArr.length} 码`);
  console.log(`粗码/动作码 → :view: ${viewAdded.length} 条`);
  viewAdded.forEach((v) => console.log(`   ${v}`));
  console.log(`追加写操作: ${WRITES.filter((w) => catalogSet.has(w)).join(', ') || '(无)'}`);
  console.log('');
  console.log('── 目标集（将写入 OPERATIONAL_ROLES.dealer.permissions）──');
  console.log(JSON.stringify(targetArr, null, 0));

  if (process.env.MODE === 'apply') {
    console.log('');
    console.log('══════ APPLY 模式：清空 dealer 既有授权并重放目标集 ══════');
    const del = await sql`
      DELETE FROM rbac_role_permission
      WHERE role_id = (SELECT id FROM rbac_role WHERE code = 'dealer')
    `;
    console.log(`  删除 dealer 既有授权 ${del.length} 条`);
    let added = 0;
    for (const code of targetArr) {
      const ins = await sql`
        INSERT INTO rbac_role_permission (role_id, permission_id)
        SELECT r.id, p.id FROM rbac_role r, rbac_permission p
        WHERE r.code = 'dealer' AND p.code = ${code}
        ON CONFLICT (role_id, permission_id) DO NOTHING
        RETURNING id
      `;
      added += ins.length;
    }
    console.log(`  写入目标授权 ${added} 条`);
    console.log('  （下次服务启动 ensureOperationalRoles 会幂等确认，无需重复）');
  } else {
    console.log('');
    console.log('（dry-run）加 MODE=apply 执行清空+写入。');
  }
}

main()
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  })
  .finally(() => sql.end());
