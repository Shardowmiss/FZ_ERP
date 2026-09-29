import { ForbiddenException, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from '../modules/auth/auth.service';

/**
 * P0-1：多租户（门店）隔离的统一基础工具。
 *
 * 设计目标：所有写接口的门店归属必须取自服务端鉴权主体（principal），
 * 所有列表/查询接口必须强制约束在主体门店作用域内，杜绝「客户端自行指定
 * storeId 实现跨店越权读写」这一系统级根因漏洞。
 *
 * 主体来源双路径兼容：
 *  - POS 本地登录：AuthGuard 注入 `req.posUser: AuthPrincipal`
 *  - 平台 SSO：注入 `req.userContext`（字段命名不同，需做映射）
 */

/** 从请求中统一解析登录主体。优先本地登录主体，其次平台 SSO。 */
export function principalFromReq(
  req: Request | { posUser?: AuthPrincipal | null; userContext?: Record<string, unknown> | null } | null | undefined,
): AuthPrincipal | null {
  const r = req as { posUser?: AuthPrincipal | null; userContext?: Record<string, unknown> | null } | null | undefined;
  if (r?.posUser) return r.posUser;
  const uc = r?.userContext;
  if (uc) {
    return {
      employeeId: String(uc.employeeId ?? uc.userId ?? ''),
      name: String(uc.name ?? uc.employeeName ?? ''),
      role: String(uc.role ?? 'sales'),
      storeId: uc.storeId ? String(uc.storeId) : null,
      code: String(uc.code ?? uc.employeeId ?? uc.userId ?? ''),
    } as AuthPrincipal;
  }
  return null;
}

/**
 * P1-3：角色满足判定。admin 为超管，拥有全部权限；否则需命中声明角色之一。
 * 供 AuthGuard 与单测复用，使 RBAC 在 Bearer 与平台 SSO 两种身份路径下一致生效。
 */
export function roleSatisfied(
  principal: AuthPrincipal | null | undefined,
  roles: string[],
): boolean {
  if (!principal) return false;
  if (principal.role === 'admin') return true;
  return roles.includes(principal.role);
}

/**
 * 写接口门店归属：服务端权威推导。
 * 优先使用登录主体门店；仅当主体未绑定门店（如未绑定门店的督导、历史离线落地）
 * 且调用方显式传入合法回退值时才允许回退。绝不直接信任客户端 DTO 的 storeId。
 *
 * @throws BadRequestException 当主体与回退值均无法得出有效门店时
 */
export function resolveStoreId(
  principal: AuthPrincipal | null | undefined,
  fallbackStoreId?: string | null,
): string {
  if (principal?.storeId) return principal.storeId;
  if (fallbackStoreId) return fallbackStoreId;
  throw new BadRequestException(
    '无法确定操作门店：登录主体未绑定门店，且未提供合法的门店参数',
  );
}

/**
 * 列表/查询接口的门店强制作用域。
 *  - 主体已绑定门店（store-scoped）：强制使用主体门店，忽略客户端传入的 storeId，
 *    防止越权读取其他门店数据。
 *  - 主体为跨店角色（storeId 为空，如督导/平台管理员）：允许按客户端指定门店查询；
 *    未传则抛出明确错误。
 *
 * @returns 实际应用于 SQL 过滤的 storeId
 * @throws BadRequestException 跨店主体未提供 storeId 时
 */
export function enforceStoreScope(
  principal: AuthPrincipal | null | undefined,
  requestedStoreId?: string | null,
): string {
  if (principal?.storeId) {
    return principal.storeId;
  }
  if (requestedStoreId) return requestedStoreId;
  throw new BadRequestException('请提供 storeId 参数以限定查询门店');
}

/** 跨店角色判定：主体未绑定门店即视为可跨店（督导/平台管理员等）。 */
export function isCrossStore(principal: AuthPrincipal | null | undefined): boolean {
  return !principal?.storeId;
}

/** 越权访问统一抛错（用于需要显式拒绝而非静默降权的场景）。 */
export function throwIfStoreMismatch(
  principal: AuthPrincipal | null | undefined,
  targetStoreId: string | null | undefined,
): void {
  if (!principal?.storeId) return; // 跨店主体放行
  if (targetStoreId && targetStoreId !== principal.storeId) {
    throw new ForbiddenException('无权访问其他门店的数据');
  }
}
