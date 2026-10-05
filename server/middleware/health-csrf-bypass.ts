import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * 可观测性基线（W1-1）健康检查端点的平台级 CSRF 豁免中间件。
 *
 * 背景：平台在 configureApp 中注册了全局 CsrfMiddleware，要求
 *   req.cookies['suda-csrf-token'] 与 req.headers['x-suda-csrf-token'] 同时存在且一致。
 * 该机制仅防御「浏览器同源伪造」。而 `/api/health`、`/api/health/metrics` 是
 *   K8s/LB/内部监控使用的**只读公开探针**（GET，无状态变更、无 PII），不存在可伪造的状态，
 *   因此需要在平台 CsrfMiddleware 之前为这类请求注入一对一致的 CSRF 凭据使其放行。
 *
 * 与 pos-receiver 豁免的区别（安全边界）：
 *  - pos-receiver 是「机器对机器写接口」，仍需 X-Erp-Upstream-Token 共享密钥做真实鉴权；
 *  - 本端点为只读公开探针，无需任何令牌：任何能到达该路径的调用方都应被允许读取系统健康/指标，
 *    这与 K8s readiness/liveness 探针、内部监控的常规做法一致。注入 dummy 凭据仅用于绕过
 *    平台对「浏览器会话」的假设（探针无浏览器 cookie），不引入任何新的授权面。
 *
 * 注册位置：必须在 `configureApp` 之前（与 PosUpstreamCsrfBypassMiddleware 同序），
 * 使平台 CsrfMiddleware 之前即注入凭据。ErpCsrfGuard 对 GET 已自动放行，故仅需绕过平台这一层。
 */
@Injectable()
export class HealthCsrfBypassMiddleware implements NestMiddleware {
  private static readonly CSRF_DUMMY = '__health_probe_call__';
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  use(req: Request, _res: Response, next: NextFunction): void {
    const method = (req.method || 'GET').toUpperCase();
    // 仅对只读方法豁免：健康检查/指标本就是 GET，且避免为非只读方法注入凭据。
    if (!HealthCsrfBypassMiddleware.SAFE_METHODS.has(method)) {
      return next();
    }
    const path = (req as unknown as { originalUrl?: string; path?: string }).originalUrl
      ?? (req as unknown as { path?: string }).path
      ?? '';
    // 兼容全局前缀 CLIENT_BASE_PATH：平台把该前缀挂在 originalUrl 上，故实际路径为
    // ${CLIENT_BASE_PATH}/api/health（及 /api/health/metrics）。
    const prefix = (process.env.CLIENT_BASE_PATH ?? '').replace(/\/+$/, '');
    const target = `${prefix}/api/health`;
    if (!path.startsWith(target)) {
      return next();
    }
    const dummy = HealthCsrfBypassMiddleware.CSRF_DUMMY;
    const prevCookie = req.headers['cookie'];
    req.headers['cookie'] = `suda-csrf-token=${dummy}${prevCookie ? `; ${prevCookie}` : ''}`;
    req.headers['x-suda-csrf-token'] = dummy;
    const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies ?? {};
    cookies['suda-csrf-token'] = dummy;
    (req as unknown as { cookies: Record<string, string> }).cookies = cookies;
    return next();
  }
}
