import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../common/context/request-context';
import { emitLog, levelForStatus, SLOW_MS } from '../common/logging/logger';
import { desensitize } from '../common/logging/pii';

/**
 * 调试用「请求体记录」开关。**默认关闭**（`LOG_REQUEST_BODY` 未设或为空）。
 * 仅在排查特定问题时显式打开，且记录前必过 `desensitize()` 脱敏，
 * 绝不会把 password / phone / token 等明文写进日志。
 */
const LOG_REQUEST_BODY = !!process.env.LOG_REQUEST_BODY;

/** 请求头约定（POS↔ERP 共用，见 P2-c / Wave 4-A②）：*
 * - `X-Request-Id`：调用方提供的链路 ID；缺失时服务端自造并回写响应头，
 *   前端可在控制台看到、据此在日志平台反查整条请求链路。
 * - `X-Trace-Id`：跨系统链路 ID（POS 推单时带上自己那次的 requestId），
 *   用于把「POS 侧推送」与「ERP 侧接收」两条日志串起来。
 */
const REQUEST_ID_HEADER = 'x-request-id';
const TRACE_ID_HEADER = 'x-trace-id';
const RESPONSE_ID_HEADER = 'X-Request-Id';

/** 噪音路径（静态视图资源）不计入访问日志，避免淹没业务日志。 */
function isNoise(path: string): boolean {
  return /\.(js|css|map|png|jpe?g|gif|svg|ico|woff2?)$/i.test(path) || path.startsWith('/assets/');
}

/** 去掉 query string，避免把 token / 过滤条件等参数原样落日志。 */
function safePath(raw?: string): string {
  if (!raw) return '';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

/**
 * 请求日志 + 上下文贯穿中间件（Wave 4-A② / P2-c）。
 *
 * 职责（全部收在这里，业务代码零改造）：
 * 1. **生成/接受 requestId**：优先沿用调用方 `X-Request-Id`；缺失则自造 UUID。
 *    同时把它放入 AsyncLocalStorage，之后**任何深度**（Service / DB / 第三方调用）
 *    的结构化日志都会自动带上，实现「一次请求一行可检索记录」。
 * 2. **回写响应头**：客户端拿到 `X-Request-Id`，出错时可在日志平台直接反查。
 * 3. **贯穿 traceId**：接受 `X-Trace-Id`，让 POS→ERP 的上行链路两端日志可对上。
 * 4. **访问日志**：在响应结束（finish / 客户端断开）时输出一行访问记录，
 *    按状态码分级（5xx=error、4xx=warn、其余 info），超慢请求额外打点。
 *
 * 注册位置：必须早于任何业务路由与鉴权逻辑，且在平台 CSRF 中间件之前完成
 * requestId 注入，以保证连 401/403 这类被拒请求也有可关联的 ID。
 */
export function requestLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const incomingId = (typeof incoming === 'string' ? incoming : '').trim();
  // 服务端权威：调用方给的可能为空串或非法值，此时一律自造，保证 requestId 恒可用
  const requestId = incomingId || randomUUID();
  const traceHeader = req.headers[TRACE_ID_HEADER];
  const traceId = (typeof traceHeader === 'string' ? traceHeader : '').trim() || requestId;

  const method = (req.method || '').toUpperCase();
  const path = safePath((req as { originalUrl?: string }).originalUrl || req.url || '');
  const startTime = Date.now();

  RequestContext.run({ requestId, traceId, method, path, startTime }, () => {
    try {
      res.setHeader(RESPONSE_ID_HEADER, requestId);
    } catch {
      // 响应已发出时无法写头：忽略，不影响主流程
    }

    if (isNoise(path)) {
      next();
      return;
    }

    let emitted = false;
    const emit = () => {
      if (emitted) return;
      emitted = true;
      const durationMs = Date.now() - startTime;
      const status = res.statusCode || 0;

      // 客户端提前断开（res 未结束就 close）：记为 warn 而不是伪造一个 200
      if (!res.writableEnded) {
        emitLog('warn', 'http.abandoned', {
          status,
          durationMs,
          reason: res.statusCode ? 'response-not-finished' : 'client-aborted',
        });
        return;
      }

      const level = levelForStatus(status);
      const slow = durationMs > SLOW_MS;
      emitLog(level, 'http.access', {
        status,
        durationMs,
        // 慢请求不额外造 event，而是在同一条记录上提级 + 标注，便于统一按 event 聚合、按 durationMs 排序
        slow,
        // 5xx 时才携带错误摘要（避免把内部消息写进访问日志）
        ...(status >= 500 ? { error: res.locals?.lastError ?? undefined } : {}),
        // 调试开关：显式打开 LOG_REQUEST_BODY 时，脱敏后记录请求体（默认关闭）
        ...(LOG_REQUEST_BODY && ['POST', 'PUT', 'PATCH'].includes(method) && req.body
          ? { body: desensitize(req.body) }
          : {}),
      });
    };

    res.on('finish', emit);
    res.on('close', emit);

    next();
  });
}
