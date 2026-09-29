/**
 * 结构化日志输出（Wave 4-A② / P2-c）。
 *
 * 背景：此前全站只有 Nest 内置 `Logger`，输出形如
 * `[Nest] 2026-09-24 14:03:00.000 LOG [PosReceiverService] [POS接收] 落地 ERP单号=xxx`，
 * 属于「给人看的自由文本」——无法按 requestId 聚合、无法被日志采集器按字段检索、
 * 也无法区分「同一请求里第几次调用」。排障时只能靠时间窗肉眼对齐，跨端（POS→ERP）
 * 更是完全断链。
 *
 * 本模块只做一件事：把一条**事件**序列化成一行结构化记录写出。字段约定：
 *
 * ```json
 * {"ts":"...","level":"warn","event":"http.access","requestId":"...","traceId":"...",
 *  "method":"POST","path":"/api/pos-receiver/sales","status":400,"durationMs":12,"userId":"..."}
 * ```
 *
 * 约定：
 * 1. `event` 是稳定的事件名（如 `http.access` / `unhandled` / `db.slow`），**不要**把变量拼进 event；
 *    变量一律进 `extra`，便于按字段聚合。
 * 2. 敏感信息（手机号 / 身份证 / 令牌）**必须**先脱敏再进日志——如需参考 `common/data-scope/pii.ts`。
 * 3. 输出走 `process.stdout/stderr` 直接 write，不依赖 Nest Logger 的 formatter，
 *    避免被 `@lark-apaas/fullstack-nestjs-core` 的日志配置影响。
 * 4. 开发环境（`NODE_ENV !== 'production'`）输出可读单行，生产环境输出 JSON（便于采集）。
 */

import { RequestContext, type RequestCtx } from '../context/request-context';
import { desensitize } from './pii';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 告警阈值：慢请求判定（毫秒）。可用 `LOG_SLOW_MS` 覆盖，默认 1000ms。 */
const SLOW_MS = Number(process.env.LOG_SLOW_MS || 1000);

const isProduction = () => process.env.NODE_ENV === 'production';

/** 序列化：Error 展开为 {name,message,stack}；循环引用兜底为字符串。 */
function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  try {
    // 兜底 depth 防止超深对象撑爆日志
    return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'function' ? undefined : v)));
  } catch {
    return String(value);
  }
}

/** 开发环境的可读单行格式：`2026-09-24 14:03:00.123 WARN [http.access] requestId=xxx method=POST ...`。 */
function formatReadable(rec: Record<string, unknown>): string {
  const { ts, level, event, ...rest } = rec;
  const head = `${ts} ${String(level).toUpperCase().padEnd(5)} [${String(event)}]`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }
  return `${head} ${parts.join(' ')}`;
}

/**
 * 输出一条结构化日志。
 *
 * 上下文字段（requestId / traceId / userId / method / path）自动从 RequestContext 带出，
 * 调用方只需关心 `event` 与业务字段——这也是本模块存在的意义：让「打点」变成一处决策。
 */
export function emitLog(level: LogLevel, event: string, extra: Record<string, unknown> = {}): void {
  // 显式标注：若写成 `?? {}`，TS 会把联合类型 `RequestCtx | {}` 退化为 `{}`，
  // 随后访问 requestId 等字段会报 “Property does not exist on type '{}'”。
  const ctx: Partial<RequestCtx> = RequestContext.get() ?? {};
  const rec: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event,
    requestId: ctx.requestId,
    traceId: ctx.traceId,
    method: ctx.method,
    path: ctx.path,
    userId: ctx.userId,
  };

  // durationMs 允许调用方显式给（如中间件已在 finish 前算好），否则从上下文开始时间推算
  if (typeof extra.durationMs === 'number') {
    rec.durationMs = extra.durationMs;
    delete extra.durationMs;
  } else if (typeof ctx.startTime === 'number') {
    rec.durationMs = Date.now() - ctx.startTime;
  }

  // 纵深防御：所有业务字段先过脱敏边界，避免调用方误把含 password/phone/token 的对象丢进日志。
  const safeExtra = desensitize(extra) as Record<string, unknown>;
  for (const [k, v] of Object.entries(safeExtra)) {
    if (v === undefined) continue;
    rec[k] = serialize(v);
  }

  const line = isProduction() ? JSON.stringify(rec) : formatReadable(rec);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

/** info 级：常规业务事件（单据落地、幂等返回等）。 */
export function logInfo(event: string, extra?: Record<string, unknown>): void {
  emitLog('info', event, extra);
}

/** warn 级：需要关注但没失败的事件（慢请求、降级、客户端异常）。 */
export function logWarn(event: string, extra?: Record<string, unknown>): void {
  emitLog('warn', event, extra);
}

/** error 级：异常 / 失败。 */
export function logError(event: string, extra?: Record<string, unknown>): void {
  emitLog('error', event, extra);
}

/**
 * 判定一次 HTTP 请求的日志级别。
 * - 5xx / 未知 → error（需要告警）
 * - 4xx → warn（客户端问题，值得关注是否是被攻击或前端 bug）
 * - 2xx/3xx → info
 * - 超过慢阈值 → 至少 warn
 */
export function levelForStatus(status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export { SLOW_MS };
