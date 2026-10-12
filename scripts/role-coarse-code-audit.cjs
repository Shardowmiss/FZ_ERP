#!/usr/bin/env node
/**
 * 角色粗码体检（#813 / P0a）
 * ─────────────────────────────────────────────────────────────────────────
 * 目的：量化「资源级粗码授权」导致的静默越权面，作为 #811 全量改造（授权最小化
 *       + 守卫动作级细化）的精确范围基线。
 *
 * 越权根因（来自 shared/permission-match.ts 的 canDo 语义）：
 *   canDo(code, held): held 含 code 本身，或含任一前缀祖先 p 使 code.startsWith(p+':')
 *   ⇒ 角色只要持有资源粗码（如 base:size），就隐式拥有该资源下全部动作子码
 *     （base:size:create / edit / delete …），哪怕授权意图只是「查看」。
 *   ⇒ 在现模型下「只授查看」根本不存在；授权出现资源粗码 = 自动拥有全部动作。
 *
 * 本脚本不依赖任何 TS 源码，只读 erp_db 的 rbac_* 表（目录与授权的唯一真相源）：
 *   1) 取全量目录码 rbac_permission（已含 ensureRbacCatalog 运行期 prune 后的 428 码）
 *   2) 取 角色→持码  rbac_role_permission ⋈ rbac_permission
 *   3) 对每个角色：把其持有的「资源粗码」展开成 canDo 语义下的有效动作集，
 *      与目录中该资源显式动作码做差集 → 暴露静默越权（implicit grant）。
 *   4) 输出：逐角色越权明细 + 全局汇总（受影响角色数、各资源被多少角色粗码覆盖）。
 *
 * 运行：NODE_OPTIONS= node scripts/role-coarse-code-audit.cjs
 * 退出码 0 表示执行成功（不代表无越权；越权以报告为准）。
 */
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

const sql = postgres({
  host: '127.0.0.1',
  port: 5434,
  database: 'erp_db',
  username: 'erp',
  password: 'erp',
});

// 递归收集 server/modules 下所有 *.controller.ts
function listControllerFiles(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listControllerFiles(p, acc);
    else if (ent.name.endsWith('.controller.ts')) acc.push(p);
  }
  return acc;
}

// 枚举控制器中仍用「资源级粗码 / 顶层码」守卫的端点（#815 守卫动作级细化范围基线）
//   · 1 段码（如 dashboard, md:merge）→ 顶层原子码，归为粗码类
//   · 2 段码（如 base:size, sales:order）→ 资源级粗码，是越权放大载体
//   · 3+ 段码（如 base:color:view）→ 动作级，已达标
function scanControllerGuards(root) {
  const files = listControllerFiles(path.join(root, 'server', 'modules'));
  const coarse = new Map(); // code -> Set(file)
  const actionLevel = new Map(); // code -> count
  const guardRe = /@CheckPermission\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = guardRe.exec(src))) {
      const code = m[1];
      const segs = code.split(':').length;
      if (segs <= 2) {
        if (!coarse.has(code)) coarse.set(code, new Set());
        coarse.get(code).add(path.relative(root, f));
      } else {
        actionLevel.set(code, (actionLevel.get(code) || 0) + 1);
      }
    }
  }
  return { coarse, actionLevel, files: files.length };
}

// 判断 code 是否「资源级粗码」：恰好一个冒号（如 base:size），且目录中存在
// 形如 `${code}:xxx`（恰好多一段）的子码 —— 即它在 canDo 下会隐式授予这些子码。
function isCoarseCode(code, childrenIndex) {
  const segs = code.split(':');
  if (segs.length !== 2) return false; // 仅资源级（2 段）才算粗码
  return (childrenIndex[code] || []).length > 0;
}

async function main() {
  // 1) 全量目录
  const perms = await sql`SELECT code, type FROM rbac_permission`;
  const allCodes = perms.map((p) => p.code);

  // 子码索引：prefix(恰好 N 段) -> 直接子码(恰好 N+1 段)
  const childrenIndex = {};
  for (const c of allCodes) {
    const idx = c.lastIndexOf(':');
    if (idx <= 0) continue;
    const prefix = c.slice(0, idx);
    (childrenIndex[prefix] ||= []).push(c);
  }

  // 2) 角色 -> 持码
  const rows = await sql`
    SELECT r.code AS role_code, r.name AS role_name, r.status AS role_status,
           p.code AS perm_code, p.type AS perm_type
    FROM rbac_role r
    JOIN rbac_role_permission rp ON rp.role_id = r.id
    JOIN rbac_permission p ON p.id = rp.permission_id
    ORDER BY r.code, p.code
  `;

  const roleMap = new Map();
  for (const r of rows) {
    if (!roleMap.has(r.role_code)) {
      roleMap.set(r.role_code, {
        code: r.role_code,
        name: r.role_name,
        status: r.role_status,
        held: new Set(),
      });
    }
    roleMap.get(r.role_code).held.add(r.perm_code);
  }

  // 3) 逐角色体检
  const report = [];
  for (const role of roleMap.values()) {
    const held = [...role.held];
    const coarse = held.filter((c) => isCoarseCode(c, childrenIndex));
    const overGrant = []; // { resource, implicit:[...] }
    for (const h of coarse) {
      const kids = childrenIndex[h] || [];
      const implicit = kids.filter((k) => !role.held.has(k));
      if (implicit.length > 0) {
        overGrant.push({
          resource: h,
          implicit,
          explicit: kids.filter((k) => role.held.has(k)),
        });
      }
    }
    if (overGrant.length > 0) {
      report.push({
        role: role.code,
        name: role.name,
        status: role.status,
        heldCount: held.length,
        coarseCount: coarse.length,
        overGrantCount: overGrant.reduce((s, o) => s + o.implicit.length, 0),
        overGrant,
      });
    }
  }

  // 按越权动作数降序
  report.sort((a, b) => b.overGrantCount - a.overGrantCount);

  // 4) 输出
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 角色粗码体检报告  (canDo 隐式授权放大面)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`目录总码数: ${allCodes.length}`);
  console.log(`角色总数:   ${roleMap.size}`);
  console.log(`存在静默越权的角色数: ${report.length}`);
  console.log('');

  if (report.length === 0) {
    console.log('✅ 无角色持有会放大授权的资源级粗码。');
  } else {
    for (const r of report) {
      console.log(`────────────────────────────────────────────────────────`);
      console.log(
        `角色 ${r.role}  (${r.name || '-'}, status=${r.status})  ` +
          `持有=${r.heldCount} 粗码=${r.coarseCount} 隐式放大动作=${r.overGrantCount}`,
      );
      for (const o of r.overGrant) {
        console.log(`  · 资源粗码 ${o.resource} 隐式授予但未显式持有:`);
        console.log(`      ${o.implicit.join(', ')}`);
      }
    }
  }

  // 5) 全局：各资源被多少角色以粗码形式覆盖（= 改造范围）
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 全局：被角色「粗码持有」的资源（#811 守卫细化范围基线）');
  console.log('══════════════════════════════════════════════════════════════');
  const resourceRoleCount = {};
  for (const r of report) {
    for (const o of r.overGrant) {
      (resourceRoleCount[o.resource] ||= new Set()).add(r.role);
    }
  }
  const resList = Object.entries(resourceRoleCount).sort(
    (a, b) => b[1].size - a[1].size,
  );
  if (resList.length === 0) {
    console.log('（无）');
  } else {
    console.log(`共 ${resList.length} 个资源被粗码覆盖，涉及角色分布：`);
    for (const [res, roles] of resList) {
      console.log(`  · ${res}  ← ${roles.size} 个角色: ${[...roles].join(', ')}`);
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 说明：本报告的「隐式放大动作」即「授权意图之外的动作权限」');
  console.log('       修复路径见 #814(授权最小化) + #815(守卫动作级细化)。');
  console.log('══════════════════════════════════════════════════════════════');

  // 6) 控制器守卫枚举（#815 范围基线）
  const root = process.cwd();
  const { coarse, actionLevel, files } = scanControllerGuards(root);
  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(` 控制器粗码守卫枚举（#815 守卫动作级细化范围基线）`);
  console.log(` 扫描控制器文件: ${files} 个；已动作级守卫码: ${actionLevel.size} 种`);
  console.log('══════════════════════════════════════════════════════════════');
  const coarseList = [...coarse.keys()].sort();
  console.log(`仍为资源级/顶层粗码守卫的权限码（${coarseList.length} 种）：`);
  for (const c of coarseList) {
    const refs = [...coarse.get(c)];
    console.log(`  · ${c}  ← ${refs.length} 个控制器文件`);
  }
  console.log('');
  console.log('（这些码需拆分为 ${code}:view/create/edit/delete/... 等动作子码，');
  console.log(' 写端点改用动作子码守卫；配套 #814 把角色授权从粗码改为显式动作码。）');
}

main()
  .catch((e) => {
    console.error('AUDIT FAILED:', e);
    process.exit(1);
  })
  .finally(() => sql.end());
