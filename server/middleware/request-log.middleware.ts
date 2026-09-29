import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../common/logging/request-context';
import { emitLog, levelForStatus, SLOW_MS } from '../common/logging/logger';
import { desensitize } from '../common/logging/pii';

/**
 * 调试用「请求体记录」开关。**默认关闭**（`LOG_REQUEST_BODY` 未设或为空）。
 * 仅在排查特定问题时显式打开，且记录前必过 `desensitize()` 脱敏，
 * 绝不会把 password / phone / token 等明文写进日志。
 */
const LOG_REQUEST_BODY = !!process.env.LOG_REQUEST_BODY;

/**
 * 请求日志 + 上下文贯穿中间件（POS 侧，与 ERP 侧同构，Wave 4-A② / P2-c）。
 *
 * 1. 生成/接受 `X-Request-Id`（缺失时自造 UUID）并放入 AsyncLocalStorage，
 *    之后任何深度的代码输出结构化日志时都会自动带上该 ID。
 * 2. 回写响应头，客户端可据此在日志平台反查。
 * 3. 接受 `X-Trace-Id`；POS 推单上行时**主动带上自己的 requestId**，
 *    ERP 接收端会以同一 traceId 记录，两端日志即可串成一条链路。
 * 4. 响应结束时输出一行访问日志：按状态码分级，超慢请求标注 slow=true。
 */
const REQUEST_ID_HEADER = 'x-request-id';
const TRACE_ID_HEADER = 'x-trace-id';
const RESPONSE_ID_HEADER = 'X-Request-Id';

function isNoise(path: string): boolean {
  return /\.(js|css|map|png|jpe?g|gif|svg|ico|woff2?)$/i.test(path) || path.startsWith('/assets/');
}

/** 去掉 query string，避免 token / 过滤条件等参数原样落日志。 */
function safePath(raw?: string): string {
  if (!raw) return '';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

export function requestLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const incomingId = (typeof incoming === 'string' ? incoming : '').trim();
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
      // 响应已发出时无法写头：忽略
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

      // 客户端提前断开：记为 warn，而不是伪造一个 200 混入访问日志
      if (!res.writableEnded) {
        emitLog('warn', 'http.abandoned', {
          status,
          durationMs,
          reason: res.statusCode ? 'response-not-finished' : 'client-aborted',
        });
        return;
      }

      emitLog(levelForStatus(status), 'http.access', {
        status,
        durationMs,
        slow: durationMs > SLOW_MS,
        ...(status >= 500 ? { error: (res.locals as any)?.lastError ?? undefined } : {}),
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
