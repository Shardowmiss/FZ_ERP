import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * POS 上行接收端（/api/pos-receiver/*）的 CSRF 豁免中间件。
 *
 * 背景：平台在 configureApp 中注册了全局 CsrfMiddleware，要求
 *   req.cookies['suda-csrf-token'] 与 req.headers['x-suda-csrf-token'] 同时存在且一致。
 * 该机制仅用于防御「浏览器同源伪造」，而 POS→ERP 是 machine-to-machine 推送，
 * 根本没有浏览器会话 / cookie，因此需要在 CSRF 中间件之前为这类请求注入一对一致的 CSRF 凭据。
 *
 * 安全边界（双重保险）：
 *  - 仅当路径以 /api/pos-receiver 开头、且请求头 X-Erp-Upstream-Token 与
 *    ERP_UPSTREAM_TOKEN 完全一致时才注入，否则不注入（CSRF 仍会 403）。
 *  - 真实鉴权由 UpstreamTokenGuard 完成（校验共享密钥），本中间件只负责让 CSRF 放行，
 *    不替代任何授权判断。
 */
@Injectable()
export class PosUpstreamCsrfBypassMiddleware implements NestMiddleware {
  private static readonly CSRF_DUMMY = '__pos_upstream_machine_call__';

  use(req: Request, _res: Response, next: NextFunction): void {
    const path = (req as unknown as { originalUrl?: string; path?: string }).originalUrl
      ?? (req as unknown as { path?: string }).path
      ?? '';
    if (!path.startsWith('/api/pos-receiver')) {
      return next();
    }
    // 机器对机器端点无浏览器会话，统一注入一对一致的 CSRF 凭据使平台 CsrfMiddleware 放行；
    // 真实鉴权由 UpstreamTokenGuard 校验 X-Erp-Upstream-Token 完成（缺失/错误 → 401）。
    const dummy = PosUpstreamCsrfBypassMiddleware.CSRF_DUMMY;
    const prevCookie = req.headers['cookie'];
    req.headers['cookie'] = `suda-csrf-token=${dummy}${prevCookie ? `; ${prevCookie}` : ''}`;
    req.headers['x-suda-csrf-token'] = dummy;
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    cookies['suda-csrf-token'] = dummy;
    (req as unknown as { cookies: Record<string, string> }).cookies = cookies;
    return next();
  }
}
