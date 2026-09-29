import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 当前请求的数据权限作用域（行级多租户 / 经销商隔离）。
 *
 * - type: 'all'  → 可见全部（超级管理员，或单租户未启用边界）
 * - type: 'dealer' → 仅可见指定 dealerIds 的数据；dealerIds 为空表示“已配置但无可见范围”，查询应返回空集
 */
export interface DealerScope {
  type: 'all' | 'dealer';
  dealerIds: string[];
}

/**
 * 单次请求的贯穿上下文。
 *
 * - `requestId`：本端权威请求 ID。由 RequestLogMiddleware 在最外层生成（缺失时自造 UUID），
 *   响应头 `X-Request-Id` 回写，前端 / 客户端可据此在日志平台反查整条链路。
 * - `traceId`：跨系统链路 ID。优先取上游 `X-Trace-Id`；POS 侧推单时会带上自己的 requestId，
 *   ERP 侧据此把「POS 那次推送」与「ERP 这次接收」的日志串成同一条链路。
 * - `method` / `path` / `startTime`：由中间件写入，供结构化日志输出，避免各处重复传递。
 *
 * 注意：整个进程**只能有这一个** AsyncLocalStorage 实例。中间件、拦截器、日志模块
 * 必须共用它，否则会出现“中间件生成的 requestId 在拦截器里读不到”的静默断链。
 */
export interface RequestCtx {
  requestId: string;
  traceId?: string;
  method?: string;
  path?: string;
  startTime?: number;
  dealerScope?: DealerScope;
  userId?: string;
}

/**
 * 基于 AsyncLocalStorage 的请求上下文。
 *
 * - 数据隔离：由 DataScopeInterceptor 写入当前用户的经销商作用域，业务 Service 执行查询时
 *   读取并自动拼接过滤条件，实现“零侵入”的行级数据隔离。
 * - 可观测：由 RequestLogMiddleware 写入 requestId / traceId / 路径 / 起始时间，
 *   `common/logging/logger.ts` 输出结构化日志时自动带出，实现「一次请求一行可检索记录」。
 *
 * 对于非请求上下文（定时任务 / 脚本 / 单测）读取时返回 undefined，调用方应以
 * “全部可见”兜底，避免破坏内部逻辑；写入（patch）则静默忽略。
 */
const storage = new AsyncLocalStorage<RequestCtx>();

export class RequestContext {
  /** 在 ctx 上下文中执行 cb，cb 内部（含其所有 await）可读到该 ctx。 */
  static run<T>(ctx: RequestCtx, cb: () => T): T {
    return storage.run(ctx, cb);
  }

  static get(): RequestCtx | undefined {
    return storage.getStore();
  }

  /** 当前请求 ID（非请求上下文返回 undefined）。结构化日志的主索引字段。 */
  static getRequestId(): string | undefined {
    return storage.getStore()?.requestId;
  }

  /** 跨系统链路 ID（POS→ERP 同一次推送共用）。 */
  static getTraceId(): string | undefined {
    return storage.getStore()?.traceId;
  }

  /**
   * 就地合并写入上下文（同步生效，仅在当前 ALS 作用域内可见）。
   *
   * 用于「上游已经开了 ALS 作用域、下游拦截器想往里补字段」的场景——例如
   * DataScopeInterceptor 解析出 userId 后补写，且必须保留中间件放进去的 requestId，
   * 否则该请求后半段的日志会丢掉关联 ID。
   */
  static patch(p: Partial<RequestCtx>): void {
    const cur = storage.getStore();
    if (!cur) return; // 非请求上下文：静默忽略，不抛错（脚本 / 定时任务里调用是合法的）
    storage.enterWith({ ...cur, ...p });
  }

  /** 读取当前请求解析出的经销商作用域；非请求上下文返回 undefined。 */
  static getDealerScope(): DealerScope | undefined {
    return storage.getStore()?.dealerScope;
  }

  /** 读取当前请求用户 ID；非请求上下文返回 undefined。 */
  static getUserId(): string | undefined {
    return storage.getStore()?.userId;
  }
}

/** 全量可见的作用域常量（超级管理员 / 单租户兜底）。 */
export const ALL_SCOPE: DealerScope = { type: 'all', dealerIds: [] };
