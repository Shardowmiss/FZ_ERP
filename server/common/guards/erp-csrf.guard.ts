import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  ERP_CSRF_COOKIE_NAME,
  ERP_CSRF_HEADER_NAME,
  verifyErpCsrfToken,
} from '../security/erp-csrf.util';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 应用层自签 CSRF 守卫（D.1 增强）。
 *
 * 在平台 double-submit 之上，对「状态变更 + 非公开 + 非机器端点」的接口强制校验
 * 自签 `erp-csrf` 令牌（cookie === header 且 HMAC 有效且未过期）。
 *
 * 跳过策略（纵深 + 兼容）：
 *  - 只读方法（GET/HEAD/OPTIONS）：无状态变更，不校验；
 *  - 机器对机器接收端 /api/pos-receiver/*：由 UpstreamTokenGuard 负责，跳过；
 *  - @Public() 接口（登录/登出等）：跳过。
 */
@Injectable()
export class ErpCsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = (req.method || 'GET').toUpperCase();

    // 1) 只读方法不做 CSRF 校验
    if (SAFE_METHODS.has(method)) return true;

    const path = ((req.originalUrl || req.path || '') as string).split('?')[0];
    // 2) 机器对机器接收端由 UpstreamTokenGuard 负责，跳过自签 CSRF
    if (path.startsWith('/api/pos-receiver')) return true;
    // 3) 公开接口跳过
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 4) 状态变更接口必须携带有效自签 CSRF 令牌（double-submit + 签名）
    const cookieTok =
      (req.cookies?.[ERP_CSRF_COOKIE_NAME] as string | undefined) ?? '';
    const headerTok =
      (req.headers[ERP_CSRF_HEADER_NAME] as string | undefined) ?? '';
    if (!cookieTok || !headerTok) {
      throw new ForbiddenException('缺少 ERP CSRF 令牌');
    }
    if (cookieTok !== headerTok) {
      throw new ForbiddenException('ERP CSRF 令牌不一致');
    }
    const v = verifyErpCsrfToken(cookieTok);
    if (!v.ok) {
      throw new ForbiddenException(
        v.reason === 'expired' ? 'ERP CSRF 令牌已过期' : 'ERP CSRF 令牌无效',
      );
    }
    return true;
  }
}
