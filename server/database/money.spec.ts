import { describe, it, expect } from 'vitest';
import { round2 } from './money';

describe('round2（金额取整，P2-7）', () => {
  it('消除浮点长尾：0.1 + 0.2 应为 0.3', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('四舍五入到「分」：可精确表示的两位小数', () => {
    expect(round2(1.125)).toBe(1.13); // 1.125 二进制可精确表示
    expect(round2(1.004)).toBe(1.0);
    expect(round2(2.5)).toBe(2.5);
  });

  it('多行金额聚合后取整，避免对账不平', () => {
    const items = [0.1, 0.2, 0.3, 0.4];
    const total = round2(items.reduce((s, x) => s + x, 0));
    expect(total).toBe(1.0);
  });

  it('非负数与负数', () => {
    expect(round2(1000)).toBe(1000);
    expect(round2(-3.14159)).toBe(-3.14);
    expect(round2(0)).toBe(0);
  });

  it('非数字输入安全兜底为 0', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(undefined as unknown as number)).toBe(0);
    expect(round2(null as unknown as number)).toBe(0);
  });
});
