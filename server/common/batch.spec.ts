import { describe, it, expect } from 'vitest';
import { chunk, BATCH_SIZE, mapWithConcurrency } from './batch';

describe('chunk', () => {
  it('空数组返回空', () => {
    expect(chunk([], 500)).toEqual([]);
  });

  it('不整除时末批少于 size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('恰好整除', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it('size 大于数组长度时整批返回', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('对象数组保持引用', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(chunk([a, b], 1)).toEqual([[a], [b]]);
  });

  it('默认批大小为正', () => {
    expect(BATCH_SIZE).toBeGreaterThan(0);
  });

  it('非法 size 抛错', () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
  });
});

describe('mapWithConcurrency', () => {
  it('保持索引顺序（与入参一一对应）', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const out = await mapWithConcurrency(items, 2, async (x) => x + 1);
    expect(out).toEqual(items.map((x) => x + 1));
  });

  it('不超过并发上限', async () => {
    const limit = 3;
    const release: Array<() => void> = [];
    const deferred = Array.from(
      { length: 6 },
      () => new Promise<void>((res) => release.push(res)),
    );
    let active = 0;
    let maxActive = 0;
    const p = mapWithConcurrency(
      Array.from({ length: 6 }, (_, i) => i),
      limit,
      async (x) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await deferred[x]; // 卡住，直到被放行
        active -= 1;
        return x;
      },
    );
    // 让前 limit 个任务进入 in-flight
    await new Promise((r) => setImmediate(r));
    expect(active).toBe(limit);
    expect(maxActive).toBe(limit);
    release.forEach((r) => r());
    await p;
    expect(maxActive).toBeLessThanOrEqual(limit);
  });

  it('空数组直接返回空结果', async () => {
    const out = await mapWithConcurrency([], 4, async (x: number) => x);
    expect(out).toEqual([]);
  });

  it('fn 抛错时整体 reject（调用方须保证 fn 内部不抛）', async () => {
    // offline-sync 的 processItem 自身 try/catch 不抛，故实际不会走到此分支；
    // 这里仅固化「任一项未捕获抛错 → 整体 reject」的契约。
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
    ).rejects.toThrow('boom');
  });

  it('非法并发上限抛错', async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow();
    await expect(mapWithConcurrency([1], -1, async (x) => x)).rejects.toThrow();
  });
});
