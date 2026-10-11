#!/usr/bin/env node
/**
 * 权限 ↔ 功能模块 一致性护栏（可接 CI / precommit）。
 *
 * 回答一个问题：「权限配置里的每一项，系统里都真有对应功能吗？反过来，
 * 每个真实功能，权限配置里都有对应项吗？」
 *
 * 四方对账：
 *   1) 权限目录    shared/menu-permission.ts → buildPermissionCatalog()（经 dist 编译产物读取）
 *   2) 菜单        MENU_STRUCTURE.children[].permission
 *   3) 前端路由    client/src/config/menuConfig.tsx 的 routeComponents[].permission
 *   4) 后端守卫    server/**\/*.controller.ts 的 @CheckPermission('...')
 *
 * 报错级（退出码 1）：
 *   - 路由/菜单/后端守卫 声明了目录里没有的权限码 → 权限树无法授权 → 门禁永久拒绝
 *   - 后端守卫用了目录里没有的码 → 同上（且写接口直接锁死）
 * 告警级：
 *   - 目录里有码，但三方都没有 → 疑似孤儿（功能已下线），清单供人工确认后删除
 *   - 目录里有码，但后端完全没用 → 可能功能不存在，或后端漏加守卫
 *   - 一码多菜单复用 → 权限树只显示一条，用户会「看不到」其余功能
 *
 * 用法：NODE_OPTIONS= node scripts/check-permission-sync.cjs [--strict]
 *   --strict：把「一码多菜单复用」也升为错误（全面拆分后启用）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const { buildPermissionCatalog, MENU_STRUCTURE } = require(path.join(
  ROOT,
  'dist/shared/menu-permission.js',
));

const catalogCodes = new Set(buildPermissionCatalog().map((e) => e.code));

// 菜单
const menuPerm = new Map();
for (const m of MENU_STRUCTURE) {
  for (const c of m.children) {
    if (!menuPerm.has(c.permission)) menuPerm.set(c.permission, []);
    menuPerm.get(c.permission).push(`${m.label}/${c.label}`);
  }
}

// 前端路由
const mcSrc = fs.readFileSync(path.join(ROOT, 'client/src/config/menuConfig.tsx'), 'utf8');
const routePerm = new Map();
for (const m of mcSrc.matchAll(/'(?<path>\/[^']*)':\s*\{[^}]*?permission:\s*'(?<perm>[^']+)'/g)) {
  routePerm.set(m.groups.path, m.groups.perm);
}

// 后端守卫
function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.controller\.ts$/.test(f)) out.push(p);
  }
  return out;
}
const guardCodes = new Map();
for (const f of walk(path.join(ROOT, 'server/modules'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/@CheckPermission\(\s*['"`]([^'"`]+)['"`]/g)) {
    const rel = path.relative(ROOT, f);
    if (!guardCodes.has(m[1])) guardCodes.set(m[1], new Set());
    guardCodes.get(m[1]).add(rel);
  }
}

const errors = [];
const warnings = [];

// ---- 校验 1：路由声明的码必须在目录中
for (const [p, perm] of routePerm) {
  if (!catalogCodes.has(perm)) {
    errors.push(`路由 ${p} 声明的权限码 ${perm} 不在权限目录 → 权限树无法授权，页面永久打不开`);
  }
}
// ---- 校验 2：菜单声明的码必须在目录中（构造上必然成立，防御性保留）
for (const [perm] of menuPerm) {
  if (!catalogCodes.has(perm)) {
    errors.push(`菜单权限码 ${perm} 不在权限目录（MENU_STRUCTURE 自身漂移）`);
  }
}
// ---- 校验 3：后端守卫的码必须在目录中（或为其动作子码）
for (const [code, files] of guardCodes) {
  if (catalogCodes.has(code)) continue;
  const parent = code.replace(/:[^:]+$/, '');
  if (catalogCodes.has(parent)) continue; // 动作子码（如 base:color:create）合法
  errors.push(`后端守卫码 ${code} 不在权限目录（${[...files].join(', ')}）→ 该接口对所有人 403`);
}

// ---- 告警 4：目录中的资源码三方全缺（疑孤儿）
const resourceCodes = buildPermissionCatalog()
  .filter((e) => e.parent && e.parent.startsWith('mod:'))
  .map((e) => e.code);
// 后端「按动作子码」鉴权（如 purchase:inbound:approve）时，粗码本身不出现在守卫里，
// 需把 code:* 形态一并视为「已守卫」。
const guardedCoarse = new Set([...guardCodes.keys()].map((c) => c.replace(/:[^:]+$/, '')));
// 「有菜单+路由但后端无守卫」的例外：页面走的是**公开端点**（设计上免鉴权）。
// 例：唯一码溯源 → /api/trace-public（消费者扫码查真伪，不能要求登录态）。
const KNOWN_NO_BACKEND = new Map([
  ['inventory:unique_code', '溯源页走公开端点 /api/trace-public（trace-public.controller，设计上免鉴权）'],
]);
for (const code of resourceCodes) {
  const inMenu = menuPerm.has(code);
  const inRoute = [...routePerm.values()].includes(code);
  const inGuard = guardCodes.has(code) || guardedCoarse.has(code);
  if (inMenu && inRoute && !inGuard && KNOWN_NO_BACKEND.has(code)) continue;
  if (!inMenu && !inRoute && !inGuard) {
    warnings.push(`权限码 ${code} 无菜单、无路由、无后端守卫 → 疑孤儿，确认后应从目录删除`);
  } else if (inMenu && inRoute && !inGuard) {
    warnings.push(`权限码 ${code} 有菜单+路由但后端无守卫 → 后端可能漏加 @CheckPermission`);
  }
}

// ---- 告警 5：一码多菜单复用（权限树只显示一条，用户会「看不到」其他功能）
//
// 白名单：确属「同一资源、多个入口页」，且共享的是同一个后端端点 —— 拆码反而会造成
// 「页面能开、接口 403」。这些是有意设计，不告警；新增复用必须在此登记并说明理由。
const ALLOWED_REUSE = new Map([
  ['base:size-group', '尺码组 与 尺码组与尺码关系：同一尺码组业务域，共用一个控制器'],
  ['report:purchase', '成衣采购查询 与 面辅料采购查询：共用同一端点 GET /api/report/purchase'],
  ['tradeshow:preorder', '预订单 与 预订汇总：共用 pre-order.controller'],
  ['member:manage', '会员运营 与 会员管理：同一会员主数据，共用 member.controller'],
]);
for (const [code, labels] of menuPerm) {
  if (ALLOWED_REUSE.has(code)) continue;
  if (labels.length > 1) {
    const msg = `一码多菜单复用 ${code} → ${labels.join(' | ')}：权限树只会显示其中一条（label 被覆盖），其余功能在权限管理中「看不到」且无法独立授权`;
    if (STRICT) errors.push(msg);
    else warnings.push(msg);
  }
}

// ---- 输出
console.log(`权限目录 ${catalogCodes.size} 条 | 菜单码 ${menuPerm.size} | 路由码 ${routePerm.size} | 后端守卫码 ${guardCodes.size}`);
if (errors.length) {
  console.error(`\n✗ 错误 ${errors.length} 项：`);
  errors.forEach((e) => console.error('   ✗ ' + e));
}
if (warnings.length) {
  console.warn(`\n⚠ 告警 ${warnings.length} 项：`);
  warnings.forEach((w) => console.warn('   ⚠ ' + w));
}
if (!errors.length && !warnings.length) {
  console.log('\n✓ 权限 ↔ 功能模块 完全一致');
}
console.log(`\n结论：${errors.length ? 'FAIL' : 'PASS'}（错误 ${errors.length} / 告警 ${warnings.length}）`);
process.exit(errors.length ? 1 : 0);
