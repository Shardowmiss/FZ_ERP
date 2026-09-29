/**
 * P-2：数组分片工具
 *
 * 用途：IndexedDB 大批量写入不得塞进单个事务（SKU×门店可达 10 万级，
 * 单 readwrite 事务会长时间占用 DB 线程并冻结 UI，低配安卓机上表现为白屏）。
 * 调用方按本函数切分后逐片提交，片间让出事件循环。
 */
/**
 * 默认写入分片大小（条/事务）。
 * 放在本模块而非 db.ts，是为了让策略常量可被不依赖浏览器的环境单独校验。
 */
export const DEFAULT_WRITE_CHUNK_SIZE = 500;

export const splitIntoChunks = <T,>(arr: readonly T[], size: number): T[][] => {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`splitIntoChunks: size 必须为正整数，收到 ${String(size)}`);
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size) as T[]);
  }
  return out;
};
