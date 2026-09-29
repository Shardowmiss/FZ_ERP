/**
 * Wave 4-A①（上行保真）的回归护栏。
 *
 * 这里守住一条底线：**ERP 绝不替 POS 编造业务日期**。改造前 `saleDate` 缺失会落回
 * `?? TODAY()`，离线隔日同步的单子在 ERP 里全变成"同步当天"，把 Wave 3 刚落地的
 * 报表时间窗静默毒化。Panels 里这批脏数据长得很像正常数据，事后既分不出来也补不回来。
 */
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { normalizeSales } from '@server/modules/pos-receiver/normalize';

const BASE = {
  storeCode: 'ST001',
  orderNo: 'SO-20260921-001',
  totalAmount: 199,
  items: [{ skuCode: 'SKU01', qty: 1, price: 199 }],
};

describe('normalizeSales 的 saleDate 保真', () => {
  it('带成交日时原样透传，绝不改写', () => {
    const out = normalizeSales({ ...BASE, saleDate: '2026-09-21' }) as Record<string, unknown>;
    expect(out.saleDate).toBe('2026-09-21');
  });

  it('缺失成交日直接 400，不再静默顶替成"同步当天"', () => {
    let err: unknown;
    try {
      normalizeSales({ ...BASE, saleDate: '' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(400);
  });

  it('ISO 时间戳按日截断（不把 15:30 这种时刻带进去）', () => {
    const out = normalizeSales({
      ...BASE,
      saleDate: '2026-09-21T15:30:00.000Z',
    }) as Record<string, unknown>;
    expect(out.saleDate).toBe('2026-09-21');
  });

  it('非法格式拒绝，脏值进不了 SQL', () => {
    for (const bad of ['21/09/2026', '2026-09', 'abc', '2026-13-40']) {
      expect(() => normalizeSales({ ...BASE, saleDate: bad })).toThrow(HttpException);
    }
  });
});
