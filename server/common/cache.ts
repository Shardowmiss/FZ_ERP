import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { RequestContext } from './context/request-context';

/**
 * 读路径缓存助手（P1-c ①）。
 *
 * 全局 CacheModule 早已注册（app.module.ts:44-48，内存存储、60s TTL、上限 500 条），
 * 但全仓只有 pricing.service 在消费，看板/配置等高频读路径每次都打穿 PG。
 *
 * 三个必须遵守的约束
 * ------------------
 * 1. **作用域必须进 key**。看板/汇总类接口读的是当前请求的经销商作用域
 *    （`buildAggregationScope` → `RequestContext.getDealerScope()`）。若缓存键不带作用域，
 *    超管首次访问会把「全量」结果写进缓存，随后受限用户命中同一 key 直接读到跨租户数据 ——
 *    这是把多租户隔离用缓存漏洞形式重新打开。故 `scopeKey()` 参与每个键的构造。
 * 2. **缓存故障必须降级为直查**，不能让缓存组件故障演变成 500。
 * 3. **写入路径要主动失效**，否则「改了价格表/促销/配置，报价与 KPI 还用旧值」。
 */

/** 常用 TTL（毫秒）。 */
export const TTL = {
  /** 看板类：允许 30 秒新鲜度，换取页面首屏不再打穿聚合查询 */
  dashboard: 30_000,
  /** 配置/计价参考数据：60 秒，写入路径会主动失效，实际更短 */
  reference: 60_000,
} as const;

/**
 * 当前请求作用域指纹。
 * - 无上下文 / 全量可见 → `all`
 * - 经销商受限 → `d<数量>_<哈希>`（dealerIds 可能几百个，不能整串进 key）
 */
export const scopeKey = (): string => {
  const scope = RequestContext.getDealerScope();
  if (!scope || scope.type === 'all' || scope.dealerIds.length === 0) return 'all';
  return `d${scope.dealerIds.length}_${fnv1a(scope.dealerIds.join(','))}`;
};

/** 构造带作用域的缓存键。示例：`dash:stats:all:2026-09-24`。 */
export const cacheKey = (prefix: string, ...parts: (string | number)[]): string =>
  [prefix, scopeKey(), ...parts.map(String)].join(':');

/** FNV-1a 32 位：把长 id 串压成定长十六进制，避免超长 key 与键基数爆炸。 */
const fnv1a = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

/**
 * 读穿（read-through）缓存：命中返回，未命中执行 producer 并写入。
 * 任何一步失败都降级为「直查」，绝不向上抛。
 */
export const cached = async <T>(
  cache: Cache,
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> => {
  try {
    const hit = await cache.get(key);
    if (hit !== undefined && hit !== null) return hit as T;
  } catch {
    // 缓存不可用：本次直查，不影响正确性
  }
  const fresh = await producer();
  await cache.set(key, fresh, ttlMs).catch(() => undefined);
  return fresh;
};

/** 主动失效若干键；失败静默（缓存挂了不该让业务写路径失败）。 */
export const invalidate = async (cache: Cache, ...keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  await Promise.all(keys.map((k) => cache.del(k).catch(() => undefined))).catch(
    () => undefined,
  );
};
