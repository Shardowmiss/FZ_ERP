import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type AuthPrincipal } from './auth.service';
import { principalFromReq, roleSatisfied } from '@server/common/tenant';

export const IS_PUBLIC_KEY = 'pos:isPublic';
/** 标记无需登录即可访问的接口（健康检查、登录本身） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** 声明接口所需角色，未声明表示任意已登录用户 */
export const ROLES_KEY = 'pos:roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

declare module 'express' {
  interface Request {
    /** 由 AuthGuard 注入的登录身份 */
    posUser?: AuthPrincipal;
  }
}

/**
 * A-4：全局登录守卫。
 *
 * 可通过环境变量 POS_AUTH_DISABLED=true 临时旁路，但仅限非生产环境
 * （P1-6：生产环境即便误设该开关也绝不旁路，避免「上线即裸奔」）。
 * 生产环境必须用 POS_AUTH_SECRET 真实启用令牌校验。
 *
 * P1-3：本守卫同时承担 RBAC。角色来源为「统一身份主体」——
 * 优先 Bearer（POS 本地登录），回退平台 SSO（userContext 映射），
 * 因此 @Roles 声明在两种登录路径下都能正确拦截越权调用。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // P1-6：旁路开关仅在非 production 生效
    if (
      process.env.POS_AUTH_DISABLED === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();

    // P1-3：统一身份主体。优先 Bearer（POS 本地登录），回退平台 SSO（userContext 映射），
    // 使 RBAC 在两种登录路径下都生效；不再仅依赖 Bearer，避免 SSO 用户被整体跳过角色校验。
    const principal = this.extractPrincipal(req) ?? principalFromReq(req);
    if (!principal) {
      if (isPublic) return true;
      throw new UnauthorizedException('请先登录');
    }

    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles?.length && !roleSatisfied(principal, requiredRoles)) {
      throw new UnauthorizedException(
        `当前角色（${principal.role}）无权执行该操作`,
      );
    }

    req.posUser = principal;
    return true;
  }

  /** 从 Authorization: Bearer <token> 解析身份；失败返回 null（交由调用方决定是否放行） */
  private extractPrincipal(req: Request): AuthPrincipal | null {
    const raw = req.headers?.authorization;
    if (!raw || !raw.startsWith('Bearer ')) return null;
    const token = raw.slice(7).trim();
    if (!token) return null;
    try {
      return this.authService.verifyToken(token);
    } catch {
      // 令牌无效时：公开接口仍可访问，受保护接口抛 401
      return null;
    }
  }
}
