#!/usr/bin/env node
/**
 * 读接口守卫安全性分析（#811 ② 主数据 GET 补 :view 的前置评估）
 * ─────────────────────────────────────────────────────────────────────────
 * 背景（审计 P1「主数据先行」）：size/size-group/sku/color-group 的 GET 仅 @NeedLogin，
 * 与 color.controller（GET 挂 base:color:view、options 留开放）不一致，建议按 color 范式
 * 给主数据 GET 补 res:view。
 *
 * 本脚本回答一个决策问题：**若给资源 res 的未守卫 GET 补 res:view 守卫，谁会 403？**
 *   读接口走 PermissionGuard 的 checkAccess（宽松）：
 *     canAccess(code, held) = held 含 code / 其前缀祖先，或含 code 的子码
 *   ⇒ 补 res:view 后，**只有完全不持 res、res:view、res:* 的角色**会被 403。
 *   再叠加「该资源的 GET 被哪些前端页面调用」→ 判断该资源是否可以安全加守卫：
 *     · 调用方全在『本资源所属模块』内 ⇒ SAFE 候选（页面已受 res 菜单门控）
 *     · 存在跨模块调用方 ⇒ UNSAFE（那些页面所属角色未必持 res → 会 403）
 *
 * 只读脚本：仅扫描源码 + 查询 erp_db 授权表，不修改任何东西。
 * 运行：NODE_OPTIONS= node scripts/analyze-read-guard-safety.cjs
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const ROOT = path.join(__dirname, '..');
const CLIENT_SRC = path.join(ROOT, 'client/src');
const MODULES_DIR = path.join(ROOT, 'server/modules');

const sql = postgres({
  host: '127.0.0.1',
  port: 5434,
  database: 'erp_db',
  username: 'erp',
  password: 'erp',
});

function walk(dir, filter, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, filter, out);
    else if (filter(ent.name)) out.push(p);
  }
  return out;
}

// 在控制器源码中提取：类级 @Controller 路径、类级粗码守卫、未守卫的 GET 路由
function analyzeController(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const ctrl = lines.find((l) => l.includes('@Controller('));
  const ctrlPath = ctrl ? (ctrl.match(/@Controller\(\s*['"]([^'"]+)['"]/) || [])[1] : null;

  // 类级守卫（@Controller 之前的 @CheckPermission）
  let classGuard = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('@Controller(')) break;
    const m = lines[i].match(/@CheckPermission\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) classGuard = m[1];
  }

  const unguardedGets = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/@Get\(/.test(lines[i])) continue;
    // 向上找紧邻守卫（跳过空行/注释）
    let j = i - 1;
    while (j >= 0 && (lines[j].trim() === '' || lines[j].trim().startsWith('//'))) j--;
    const gm = j >= 0 ? lines[j].match(/@CheckPermission\(\s*['"]([^'"]+)['"]\s*\)/) : null;
    if (!gm) {
      const route = (lines[i].match(/@Get\(\s*([^)]*)\)/) || [])[1] || '';
      unguardedGets.push({ line: i + 1, route: route.trim() });
    }
  }

  // 推断资源：类级粗码优先；否则取本文件写守卫里的 2 段资源前缀（唯一者）
  let resource = classGuard && classGuard.split(':').length === 2 ? classGuard : null;
  if (!resource) {
    const resSet = new Set();
    for (const l of lines) {
      const m = l.match(/@CheckPermission\(\s*['"]([a-z_-]+:[a-z_-]+)(:[a-z_-]+)?['"]\s*\)/);
      if (m) resSet.add(m[1]);
    }
    if (resSet.size === 1) resource = [...resSet][0];
  }
  return { ctrlPath, resource, unguardedGets, rel: path.relative(ROOT, file) };
}

async function main() {
  // 1) 全量目录 + 子码索引
  const perms = await sql`SELECT code FROM rbac_permission`;
  const allCodes = new Set(perms.map((p) => p.code));

  // 2) 角色 -> 持码
  const rows = await sql`
    SELECT r.code AS role, p.code AS perm
    FROM rbac_role r
    JOIN rbac_role_permission rp ON rp.role_id = r.id
    JOIN rbac_permission p ON p.id = rp.permission_id
  `;
  const roleHeld = new Map();
  for (const r of rows) {
    if (!roleHeld.has(r.role)) roleHeld.set(r.role, new Set());
    roleHeld.get(r.role).add(r.perm);
  }
  const allRoles = [...roleHeld.keys()];

  // 3) 控制器扫描
  const files = walk(MODULES_DIR, (n) => n.endsWith('.controller.ts'));
  const controllers = files.map(analyzeController).filter((c) => c.unguardedGets.length > 0);

  // 4) 前端调用方索引（按 URL 前缀扫一次）
  const clientFiles = walk(CLIENT_SRC, (n) => /\.(ts|tsx)$/.test(n));
  const clientSrcCache = clientFiles.map((f) => ({
    rel: path.relative(CLIENT_SRC, f),
    src: fs.readFileSync(f, 'utf8'),
  }));

  console.log('══════════════════════════════════════════════════════════════');
  console.log(' 读接口守卫安全性分析（#811 ② — 主数据 GET 补 :view 前置评估）');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`控制器(含未守卫 GET): ${controllers.length} 个 | 角色: ${allRoles.length} | 目录码: ${allCodes.size}`);
  console.log('');

  const safeCandidates = [];
  const unsafeCandidates = [];

  for (const c of controllers) {
    const res = c.resource;
    // 角色持有情况
    let holders = [];
    let gaps = [];
    if (res) {
      for (const role of allRoles) {
        const held = roleHeld.get(role);
        const has = [...held].some((p) => p === res || p.startsWith(res + ':'));
        if (has) holders.push(role);
        else gaps.push(role);
      }
    }
    // 前端调用方：本仓调用方用类型化 API 函数（如 baseApi.size.list），非裸 URL。
    // 故按「API 函数名前缀 .<camelName>.(list|get|options)」+ URL 前缀联合匹配，只看 pages/。
    const camelName = res ? res.split(':')[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : null;
    const fnRe = camelName ? new RegExp(`\\.${camelName}\\.(list|get|options)\\s*\\(`) : null;
    const urlPrefix = res ? '/api/' + res.replace(':', '/') : null;
    const callers = [];
    for (const f of clientSrcCache) {
      if (!f.rel.startsWith('pages/')) continue;
      if ((fnRe && fnRe.test(f.src)) || (urlPrefix && f.src.includes(urlPrefix))) callers.push(f.rel);
    }
    const ownModule = res ? res.split(':')[0] : null;
    const ownPrefix = ownModule ? `pages/${ownModule}/` : null;
    const crossModule = callers.filter((f) => !f.startsWith(ownPrefix));
    const verdict = res && crossModule.length === 0 ? 'SAFE?' : 'UNSAFE';
    const entry = { c, res, holders, gaps, callers, crossModule };
    (verdict === 'UNSAFE' ? unsafeCandidates : safeCandidates).push(entry);
  }

  const render = (e) => {
    console.log(`──────────────────────────────────────────────────────────────`);
    console.log(`控制器 ${e.c.rel}`);
    console.log(`  路由前缀: ${e.c.ctrlPath || '(无)'}   资源: ${e.res || '(无法推断)'}   未守卫GET: ${e.c.unguardedGets.length} 处`);
    if (e.res) {
      console.log(`  持有 ${e.res} 的角色: ${e.holders.join(', ') || '(无)'}`);
      console.log(`  未持有(加守卫后会 403): ${e.gaps.join(', ') || '(无)'}`);
      console.log(`  前端调用方(${e.callers.length}): ${e.callers.join(', ') || '(无)'}`);
      if (e.crossModule.length)
        console.log(`  ⚠ 跨模块调用方(${e.crossModule.length}): ${e.crossModule.join(', ')}`);
    }
  };

  console.log('══════════════════════════════════════════════════════════════');
  console.log(`【UNSAFE】存在跨模块调用方 → 加守卫会 403（${unsafeCandidates.length} 个）`);
  console.log('══════════════════════════════════════════════════════════════');
  unsafeCandidates.forEach(render);

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`【SAFE?】调用方全在本模块内 → 可随本资源管理页门控（${safeCandidates.length} 个）`);
  console.log('══════════════════════════════════════════════════════════════');
  safeCandidates.forEach(render);

  console.log('');
  console.log('说明：SAFE? = 该资源 GET 的调用方全部位于其自身模块目录（页面已被 res 菜单门控），');
  console.log('      补 res:view 守卫不会 403 现有角色；其余为 UNSAFE，需先做「授权+守卫」配对。');
}

main()
  .catch((e) => {
    console.error('ANALYZE FAILED:', e);
    process.exit(1);
  })
  .finally(() => {
    sql.end();
    process.exit(0);
  });
