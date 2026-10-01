import { Injectable, NestMiddleware } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * POS 上行接收端（/api/pos-receiver/*）的 CSRF 豁免中间件。
 *
 * 背景：平台在 configureApp 中注册了全局 CsrfMiddleware，要求
 *   req.cookies['suda-csrf-token'] 与 req.headers['x-suda-csrf-token'] 同时存在且一致。
 * 该机制仅用于防御「浏览器同源伪造」，而 POS→ERP 是 machine-to-machine 推送，
 * 根本没有浏览器会话 / cookie，因此需要在 CSRF 中间件之前为这类请求注入一对一致的 CSRF 凭据。
 *
 * 安全边界（双重保险，已对齐 UpstreamTokenGuard 的校验口径）：
 *  - 仅当路径以 ${CLIENT_BASE_PATH}/api/pos-receiver 开头、**且请求头 X-Erp-Upstream-Token 与
 *    ERP_UPSTREAM_TOKEN 时序安全一致**时才注入，否则不注入（CSRF 仍会 403，
 *    且即便绕过也由 UpstreamTokenGuard 判 401）——杜绝「无条件豁免 CSRF」的纵深缺口。
 *  - 注意：平台用 process.env.CLIENT_BASE_PATH 作为全局前缀，机器对机器推送的 originalUrl
 *    实际为 /client/api/pos-receiver/...，故匹配时必须带上该前缀，否则带前缀部署下
 *    POS 上行会卡在 CSRF（403）——此前「黑盒验证」在空前缀下通过、生产带前缀必炸。
 *  - 真实鉴权由 UpstreamTokenGuard 完成（校验共享密钥 + 可选来源 IP 白名单），
 *    本中间件只负责让 CSRF 放行，不替代任何授权判断。
 */
@Injectable()
export class PosUpstreamCsrfBypassMiddleware implements NestMiddleware {
  private static readonly CSRF_DUMMY = '__pos_upstream_machine_call__';

  use(req: Request, _res: Response, next: NextFunction): void {
    const path = (req as unknown as { originalUrl?: string; path?: string }).originalUrl
      ?? (req as unknown as { path?: string }).path
      ?? '';
    // 兼容全局前缀 CLIENT_BASE_PATH：平台把该前缀挂在 originalUrl 上，而控制器路由在
    // /api/pos-receiver 之下。bypass 必须匹配「前缀 + /api/pos-receiver」，否则带前缀部署
    // （如 CLIENT_BASE_PATH=/client）下 POS 机器推送会卡在 CSRF(403)，端点完全不可达。
    const prefix = (process.env.CLIENT_BASE_PATH ?? '').replace(/\/+$/, '');
    const target = `${prefix}/api/pos-receiver`;
    if (!path.startsWith(target)) {
      return next();
    }
    // 机器对机器端点无浏览器会话：先用共享密钥（与 UpstreamTokenGuard 同一口径）校验，
    // 通过才注入一对一致的 CSRF 凭据使平台 CsrfMiddleware 放行；缺失/错误则不放行，
    // 由平台 CSRF(403) 与 UpstreamTokenGuard(401) 双重拒绝。
    if (!this.isUpstreamTokenValid(req)) {
      return next();
    }
    const dummy = PosUpstreamCsrfBypassMiddleware.CSRF_DUMMY;
    const prevCookie = req.headers['cookie'];
    req.headers['cookie'] = `suda-csrf-token=${dummy}${prevCookie ? `; ${prevCookie}` : ''}`;
    req.headers['x-suda-csrf-token'] = dummy;
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    cookies['suda-csrf-token'] = dummy;
    (req as unknown as { cookies: Record<string, string> }).cookies = cookies;
    return next();
  }

  /**
   * 与 UpstreamTokenGuard 一致的时序安全校验：
   * 请求头 X-Erp-Upstream-Token === 环境变量 ERP_UPSTREAM_TOKEN。
   * 未配置令牌 / 长度不符 / 比对失败均返回 false（不放行 CSRF 豁免）。
   */
  private isUpstreamTokenValid(req: Request): boolean {
    const expected = process.env.ERP_UPSTREAM_TOKEN;
    if (!expected) {
      // 未配置令牌时接收端本应不可用（UpstreamTokenGuard 会 fail closed 判 401）；
      // 此处同样不放行 CSRF 豁免，保持纵深拒绝。
      return false;
    }
    const provided = (req.headers['x-erp-upstream-token'] as string | undefined) ?? '';
    const ab = Buffer.from(expected, 'utf8');
    const bb = Buffer.from(provided, 'utf8');
    if (ab.length !== bb.length) return false;
    try {
      return timingSafeEqual(ab, bb);
    } catch {
      return false;
    }
  }
}
