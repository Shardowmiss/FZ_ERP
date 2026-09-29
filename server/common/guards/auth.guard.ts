import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../../modules/rbac/rbac.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * 全局认证守卫。
 *
 * - 仅保护以 /api/ 开头的接口；静态/视图路由（HBS 页面）保持开放。
 * - 被 @Public() 标记的接口（登录/登出）免校验。
 * - 其余接口必须携带有效 x-auth-token（或 Authorization: Bearer <token>），
 *   否则返回 401。校验通过后把 userId 挂到 request.user 便于后续使用。
 *
 * 说明：本系统原实现仅有登录/登出/me 三处使用 token，没有任何 Guard 或
 * 路由级鉴权，导致所有业务接口在“已登录态”下对任何人开放（越权访问）。
 * 此守卫补齐服务端鉴权。如需更细粒度的“按权限码”控制，可在此基础上结合
 * RbacService.checkPermission 扩展。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly rbacService: RbacService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest() as {
      url?: string;
      headers: Record<string, string | undefined>;
      user?: { id: string };
      // P1-d：身份源统一。平台 SSO 会话会注入 req.userContext（含 userId/userName），
      // 而本地令牌登录仅得到 req.user。DataScopeInterceptor 读取 req.userContext.userId
      // 解析经销商作用域，二者命名不一致会导致本地令牌会话的 userContext 为 undefined，
      // 进而回退 ALL_SCOPE（全租户可见，越权）。故此处同时写入 userContext 收敛身份源。
      userContext?: { userId: string; userName?: string };
    };

    // 非 /api 路由（如前端页面）不强制鉴权
    if (!req.url?.startsWith('/api/')) return true;

    const headerToken = req.headers['x-auth-token'];
    const bearer = req.headers['authorization'];
    const token =
      headerToken ??
      (bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : undefined);

    if (!token) {
      throw new UnauthorizedException('未登录或登录已过期');
    }

    const userId = await this.rbacService.getUserIdByToken(String(token));
    if (!userId) {
      throw new UnauthorizedException('登录已过期，请重新登录');
    }

    // P1-d：身份源统一 —— 同时写入 req.userContext，使 DataScopeInterceptor 能按
    // 本地令牌用户解析经销商作用域，而非回退到 ALL_SCOPE（全租户可见）。
    // 保留 req.user 供 AuditInterceptor（:47）读取操作人，不破坏既有审计。
    req.user = { id: userId };
    req.userContext = { userId };
    return true;
  }
}
