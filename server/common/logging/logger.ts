/**
 * 结构化日志输出（POS 侧，与 ERP 侧 `common/logging/logger.ts` 同构，Wave 4-A② / P2-c）。
 *
 * 此前全站只有 Nest 内置 Logger 的自由文本输出，无法按 requestId 聚合；
 * 且 5xx 的 `errorId` 是**每次现生成**的 randomUUID，跨请求不可关联、更无法与 ERP 侧对齐。
 * 现在所有事件统一经此处输出，自动带出上下文中的 requestId / traceId。
 *
 * 输出示例（生产 JSON 一行 / 开发可读单行）：
 * `{"ts":"...","level":"error","event":"unhandled","requestId":"...","traceId":"...","path":"/api/sales","err":{...}}`
 */

import { RequestContext, type RequestCtx } from './request-context';
import { desensitize } from './pii';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 慢请求阈值（毫秒），可用 `LOG_SLOW_MS` 覆盖，默认 1000ms。 */
const SLOW_MS = Number(process.env.LOG_SLOW_MS || 1000);

const isProduction = () => process.env.NODE_ENV === 'production';

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'bigint') return value.toString();
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'function' ? undefined : v)));
  } catch {
    return String(value);
  }
}

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
 * `event` 必须是稳定的事件名（如 `http.access` / `unhandled` / `upstream.push`），
 * 变量一律进 `extra`，否则日志平台无法按字段聚合。敏感信息（手机号 / 令牌）不得入日志。
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

export function logInfo(event: string, extra?: Record<string, unknown>): void {
  emitLog('info', event, extra);
}

export function logWarn(event: string, extra?: Record<string, unknown>): void {
  emitLog('warn', event, extra);
}

export function logError(event: string, extra?: Record<string, unknown>): void {
  emitLog('error', event, extra);
}

export function levelForStatus(status: number): LogLevel {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export { SLOW_MS };
