/**
 * 权限判定：单一实现（跨端共享，纯 TS，无 React / Node 依赖）。
 *
 * ── 为什么必须单一实现 ────────────────────────────────────────────────
 * 同一套「父子码继承」语义在历史上被抄了三份，随后各自漂移：
 *   · server  rbac.service.checkPermission   （只认 父→子）
 *   · client  AuthContext.hasPermission      （只认 父→子）
 *   · client  AuthContext.hasMenu            （只认 子→父）
 * 直接后果（真实报障）：仅授「颜色·查看」(base:color:view) 的经销商，
 *   侧栏菜单可见（Layout 走 hasMenu 命中），点进去页面却提示「无权限访问」
 *   —— 因为渲染页签内容的 TabPageCache 走的是 hasPermission，对 base:color 粗码判假。
 * 三份实现不共用 → 必然继续打地鼠。故上收为本模块的两个语义明确的谓词。
 *
 * ── 两条语义边界（务必遵守）────────────────────────────────────────────
 * canDo(code, held)      「能不能执行这个动作」
 *   严格：持有该码本身，或持有其任一祖先（前缀）码。
 *   用于：动作/写操作门控（按钮）、后端动作鉴权。
 *   仅持 base:color:view 的角色 → canDo('base:color:create') = false（写被拒）。
 *
 * canAccess(code, held)  「这个资源对我可不可见 / 可不可进入」
 *   宽松：canDo 命中，或持有其下任一动作子码。
 *   用于：菜单可见性（Layout）、页面可达性（ProtectedRoute / TabPageCache）、
 *         后端 GET/HEAD 读接口门禁。
 *   仅持 base:color:view 的角色 → canAccess('base:color') = true（页面可进）。
 *
 * 一句话：canAccess 只放宽「入口」，绝不放宽「动作」。
 * 入口放宽是可接受的（进去也只是只读），动作放宽才是越权。
 */

/**
 * 是否可执行某权限码（严格：持有码本身，或持有其祖先/前缀码）。
 * @param code 待校验的权限码，如 `base:color:create`、`sales:order`
 * @param held 当前用户**显式**持有的权限码集合（不含隐式补出的父节点）
 */
export function canDo(code: string, held: readonly string[]): boolean {
  if (!code) return true; // 未声明权限码 → 不设限
  return held.some((p) => p === code || code.startsWith(p + ':'));
}

/**
 * 是否可访问/可进入某资源（宽松：canDo 命中，或持有其下任一动作子码）。
 *
 * 子→父继承：持有 `base:color:view` ⇒ `base:color` 可达（菜单/页面放行）。
 * 该继承**不**用于动作判定，故不会把「查看」放大成「新增/编辑/删除」。
 */
export function canAccess(code: string, held: readonly string[]): boolean {
  if (!code) return true;
  return canDo(code, held) || held.some((p) => p.startsWith(code + ':'));
}

/**
 * HTTP 方法 → 是否为「读」语义（用于后端守卫的只读放宽）。
 * 只有 GET/HEAD 视为读；POST/PUT/PATCH/DELETE 一律写路径，零放宽。
 */
export function isReadMethod(method: string | undefined | null): boolean {
  const m = String(method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

/**
 * 为粗码补出对应的「查看」动作子码（`sales:outbound` → `sales:outbound:view`）。
 * 已是 `:view` 结尾则原样返回。控制器混用粗码/动作码时统一口径用。
 */
export function readCodeFor(code: string): string {
  return code.endsWith(':view') ? code : `${code}:view`;
}
