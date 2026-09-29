import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 单次请求的贯穿上下文（POS 侧，Wave 4-A② / P2-c）。
 *
 * 与 ERP 侧同构（两端共用 `X-Request-Id` / `X-Trace-Id` 约定），字段：
 * - `requestId`：本端权威请求 ID，由 RequestLogMiddleware 生成/接受，响应头回写。
 * - `traceId`：跨系统链路 ID。POS 推单上行时把它带进 HTTP 头，
 *   ERP 接收端会以同一 traceId 记录，从而实现「POS 这次推送 ↔ ERP 这次接收」两端日志串联。
 * - `method` / `path` / `startTime`：中间件写入，供结构化日志输出。
 *
 * 全进程只有这一个 AsyncLocalStorage 实例——中间件、过滤器、日志模块必须共用，
 * 否则会出现「中间件生成的 ID 在过滤器里读不到」的静默断链。
 */
export interface RequestCtx {
  requestId: string;
  traceId?: string;
  method?: string;
  path?: string;
  startTime?: number;
  /** 收银员登录态（由鉴权环节补写）。 */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestCtx>();

export class RequestContext {
  static run<T>(ctx: RequestCtx, cb: () => T): T {
    return storage.run(ctx, cb);
  }

  static get(): RequestCtx | undefined {
    return storage.getStore();
  }

  /** 当前请求 ID；非请求上下文返回 undefined。 */
  static getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  }

  /** 跨系统链路 ID（POS→ERP 同一次推送共用）。 */
  static getTraceId(): string | undefined {
    return storage.getStore()?.traceId;
  }

  /**
   * 就地合并写入上下文（同步生效，仅在当前 ALS 作用域内可见）。
   * 非请求上下文（定时任务 / 脚本 / 单测）调用时静默忽略，不抛错。
   */
  static patch(p: Partial<RequestCtx>): void {
    const cur = storage.getStore();
    if (!cur) return;
    storage.enterWith({ ...cur, ...p });
  }
}
