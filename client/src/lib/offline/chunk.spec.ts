import { describe, it, expect } from 'vitest';
import { splitIntoChunks } from './chunk';
import { DEFAULT_WRITE_CHUNK_SIZE as LOCAL_STOCK_CHUNK_SIZE } from './chunk';

describe('P-2 库存写入分片', () => {
  it('切分后拼回原数组，一条不丢', () => {
    const arr = Array.from({ length: 1234 }, (_, i) => i);
    const chunks = splitIntoChunks(arr, 500);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(500);
    expect(chunks[1].length).toBe(500);
    expect(chunks[2].length).toBe(234);
    expect(chunks.flat()).toEqual(arr);
  });
  it('边界：空数组 / 不足一片 / 正好整除', () => {
    expect(splitIntoChunks([], 500)).toEqual([]);
    expect(splitIntoChunks([1, 2], 500)).toEqual([[1, 2]]);
    const exact = Array.from({ length: 1000 }, (_, i) => i);
    const c = splitIntoChunks(exact, 500);
    expect(c.length).toBe(2);
    expect(c.flat()).toEqual(exact);
  });
  it('非法分片大小直接失败，不静默退化', () => {
    expect(() => splitIntoChunks([1], 0)).toThrow(RangeError);
    expect(() => splitIntoChunks([1], -1)).toThrow(RangeError);
    expect(() => splitIntoChunks([1], 1.5)).toThrow(RangeError);
  });
  it('putLocalStockBatch 采用的分片常量符合预期（每片≤500，避免单事务过大）', async () => {
    // 10 万级记录应切成 200 片，而非单片 100000 条长事务
    const total = 100000;
    const chunks = splitIntoChunks(Array.from({ length: total }, (_, i) => i), LOCAL_STOCK_CHUNK_SIZE);
    expect(chunks.length).toBe(200);
    expect(chunks.every((c) => c.length <= 500)).toBe(true);
    expect(chunks.flat().length).toBe(total);
  });
});
