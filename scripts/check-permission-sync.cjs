#!/usr/bin/env node
/**
 * 权限 ↔ 功能模块 一致性护栏（可接 CI / precommit）。
 *
 * 回答一个问题：「权限配置里的每一项，系统里都真有对应功能吗？反过来，
 * 每个真实功能，权限配置里都有对应项吗？」
 *
 * 四方对账（+播种配置）：
 *   1) 权限目录    shared/menu-permission.ts → buildPermissionCatalog()（经 dist 编译产物读取）
 *   2) 菜单        MENU_STRUCTURE.children[].permission
 *   3) 前端路由    client/src/config/menuConfig.tsx 的 routeComponents[].permission
 *   4) 后端守卫    server/**\/*.controller.ts 的 @CheckPermission('...')
 *   5) 播种配置    server/modules/rbac/rbac.service.ts 的 OPERATIONAL_ROLES[].permissions
 *
 * 报错级（退出码 1）：
 *   - 路由/菜单/后端守卫 声明了目录里没有的权限码 → 权限树无法授权 → 门禁永久拒绝
 *   - 后端守卫用了目录里没有的码 → 同上（且写接口直接锁死）
 *   - OPERATIONAL_ROLES 声明了目录里没有的码 → 新部署该角色静默缺权限（#811 种子卫生）
 * 告警级：
 *   - 目录里有码，但三方都没有 → 疑似孤儿（功能已下线），清单供人工确认后删除
 *   - 目录里有码，但后端完全没用 → 可能功能不存在，或后端漏加守卫
 *   - 一码多菜单复用 → 权限树只显示一条，用户会「看不到」其余功能
 *
 * 用法：NODE_OPTIONS= node scripts/check-permission-sync.cjs [--strict]
 *   --strict：把「一码多菜单复用」也升为错误（全面拆分后启用）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STRICT = process.argv.includes('--strict');

// 目录真相源：shared/menu-permission.ts（自包含，无 import）。
// 优先用 TypeScript 编译器即时转译源码（纯 JS，无原生二进制依赖，CI 下可靠）——
// 既免「必须先 build」的依赖，也避免读到陈旧 dist 导致假绿；
// 仅在 typescript 不可用时才回退到已构建的 dist 产物（并显式告警）。
function loadPermissionModule() {
  const srcPath = path.join(ROOT, 'shared/menu-permission.ts');
  const distPath = path.join(ROOT, 'dist/shared/menu-permission.js');
  try {
    const ts = require('typescript');
    const src = fs.readFileSync(srcPath, 'utf8');
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: 'menu-permission.ts',
    }).outputText;
    const tmp = path.join(os.tmpdir(), `menu-permission.${process.pid}.cjs`);
    fs.writeFileSync(tmp, out);
    const mod = require(tmp);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return mod;
  } catch (e) {
    if (fs.existsSync(distPath)) {
      console.warn(
        `[perm:check] typescript 即时转译不可用（${e && e.message}），回退已构建产物 dist（可能陈旧）`,
      );
      return require(distPath);
    }
    throw e;
  }
}

const { buildPermissionCatalog, MENU_STRUCTURE } = loadPermissionModule();

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

// ---- 播种配置（OPERATIONAL_ROLES）抽取 ----
// OPERATIONAL_ROLES 是 rbac.service.ts 的 private static 常量（无法 require），
// 故对 TS 源码做「去注释 → 定位 → 括号配平 → 抠 permissions 串」的最小解析。
// 用途（校验 6）：防止「配置声明了目录中不存在的废弃码 → 新部署该角色静默缺权限」复发。
//   （运行期 ensureOperationalRoles 只打 WARN 日志、不阻断；本静态校验在 CI 阶段硬拦。）
function stripComments(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') {
      const nl = s.indexOf('\n', i);
      i = nl < 0 ? s.length : nl;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i);
      i = e < 0 ? s.length : e + 2;
      continue;
    }
    // 字符串内的 // 与 /* 不是注释
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < s.length) {
        out += s[i];
        if (s[i] === '\\') {
          i++;
          if (i < s.length) out += s[i];
          i++;
          continue;
        }
        if (s[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function extractOperationalRoles(src) {
  const s = stripComments(src);
  const anchor = s.indexOf('OPERATIONAL_ROLES');
  if (anchor < 0) return null;
  // 注意：类型注解为 `{...}[] = [`，首个 '[' 属于 `}[]`，必须定位到数组字面量的 `= [`
  const arrIdx = s.indexOf('] = [', anchor);
  if (arrIdx < 0) return null;
  const openBracket = arrIdx + 4;
  // 括号配平，定位外层数组边界
  let depth = 0;
  let inStr = null;
  let end = -1;
  for (let j = openBracket; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (ch === '\\') {
        j++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  if (end < 0) return null;
  const body = s.slice(openBracket + 1, end);
  const roles = [];
  const roleRe = /code:\s*'([^']+)'[\s\S]*?permissions:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = roleRe.exec(body))) {
    const codes = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    roles.push({ role: m[1], codes });
  }
  return roles;
}

const rbacServicePath = path.join(ROOT, 'server/modules/rbac/rbac.service.ts');
const operationalRoles = fs.existsSync(rbacServicePath)
  ? extractOperationalRoles(fs.readFileSync(rbacServicePath, 'utf8'))
  : null;

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

// ---- 校验 6：OPERATIONAL_ROLES 播种码必须【精确】存在于目录中（防「废弃播种码」缺陷复发）
// 注意：此处不做「父码回退」——配置里若写了一个目录中不存在的码，运行期 ensureOperationalRoles
// 只会静默跳过（授 0）+ 打 WARN，故必须在 CI 阶段硬拦，要求改为目录中的真实码或删除。
if (operationalRoles === null) {
  warnings.push(
    '未能从 server/modules/rbac/rbac.service.ts 抽取 OPERATIONAL_ROLES（结构变更？）→ 播种码一致性未校验',
  );
} else {
  for (const { role, codes } of operationalRoles) {
    for (const code of codes) {
      if (catalogCodes.has(code)) continue;
      errors.push(
        `OPERATIONAL_ROLES[${role}] 声明的权限码 ${code} 不在权限目录 → 新部署该角色静默缺此权限（应删除或改为目录中的真实码）`,
      );
    }
  }
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
