/**
 * P1-5：批量写性能工具。
 *
 * 将「N+1 逐行 insert」转化为「少量批量 insert」：
 * 单条 `insert().values([...chunk])` 的占位符随列数增长，PostgreSQL 默认
 * `max_prepared_statements` 与驱动参数上限决定了每批不宜过大；经验值 500 行/批
 * 在「列数适中 + 上千万行主数据」场景下兼顾吞吐与内存。
 */

/** 单批写入行数上限（经验值，可按列宽调整） */
export const BATCH_SIZE = 500;

/**
 * 将数组按每批 size 切片。
 * @example chunk([1,2,3,4,5], 2) => [[1,2],[3,4],[5]]
 */
export function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('chunk size must be a positive integer');
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * 有界并发映射（并发令牌桶）。
 *
 * 在「总任务数」远大于「并发上限」时：
 * - 全量 `Promise.all` 会把 DB/ERP 在高峰瞬间打满（连接/锁竞争 → 超时）；
 * - 顺序 `for...of await` 又把本可并行的写入串行化，批量吞吐上不去。
 *
 * 这里用固定数量的 worker 协程消费游标 `cursor`，任意时刻在途任务数 ≤ `limit`，
 * 既拿到并行收益，又给下游留「背压」。结果按入参索引顺序回填，保证与输入一一对应。
 *
 * @example
 * await mapWithConcurrency(items, 8, async (it) => process(it));
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('concurrency limit must be a positive integer');
  }
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
