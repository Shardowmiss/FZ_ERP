import { describe, it, expect } from 'vitest';
import {
  evaluatePromotions,
  hitsStore,
  isLive,
  type EnginePromotion,
} from './promotion-engine';

/**
 * Wave 4-C：开单计价的服务端促销引擎
 *
 * 这一层的价值：收银台的优惠金额不再「填多少算多少」，而是必须有库里真实生效的
 * 促销做上限。以下用例覆盖最常见的几种算错路径。
 */

const STORE = 'ST-001';
const NOW = new Date('2026-09-24T12:00:00.000Z');

const promo = (over: Partial<EnginePromotion> = {}): EnginePromotion => ({
  id: 'P-1',
  name: '满减',
  type: 'full_reduce',
  threshold: 20000,
  discountValue: 3000,
  discountType: 'amount',
  priority: 10,
  applyScope: 'all',
  scopeIds: [],
  status: 'active',
  ...over,
});

describe('evaluatePromotions', () => {
  it('1) 满减：达到门槛才生效，额度按「分」', () => {
    const r = evaluatePromotions([promo()], {
      storeId: STORE,
      subtotalCents: 15000,
      now: NOW,
    });
    expect(r.capCents).toBe(0);

    const ok = evaluatePromotions([promo()], {
      storeId: STORE,
      subtotalCents: 20000,
      now: NOW,
    });
    expect(ok.capCents).toBe(3000);
  });

  it('2) 折扣：discount_value 是「百分率整数」，80 → 8 折', () => {
    const r = evaluatePromotions(
      [
        promo({
          id: 'P-2',
          type: 'full_discount',
          discountType: 'percent',
          discountValue: 80,
          threshold: 0,
          priority: 5,
        }),
      ],
      { storeId: STORE, subtotalCents: 10000, now: NOW },
    );
    expect(r.capCents).toBe(2000); // 10000 × (1-0.8)
  });

  it('3) 折扣率非法（0 / ≥1）不得参与计算', () => {
    const bad = promo({
      type: 'full_discount',
      discountType: 'percent',
      discountValue: 100,
      threshold: 0,
    });
    const r = evaluatePromotions([bad], {
      storeId: STORE,
      subtotalCents: 10000,
      now: NOW,
    });
    expect(r.capCents).toBe(0);
    expect(r.rejected.some((x) => x.reason.includes('折扣率非法'))).toBe(true);
  });

  it('4) 门店作用域：别的店的促销不得在本店生效', () => {
    const other = promo({ applyScope: 'scoped', scopeIds: ['ST-999'] });
    expect(hitsStore(other, STORE)).toBe(false);
    const r = evaluatePromotions([other], {
      storeId: STORE,
      subtotalCents: 50000,
      now: NOW,
    });
    expect(r.capCents).toBe(0);
  });

  it('5) 有效期：起止当天都要算生效（含端点）', () => {
    expect(isLive(promo({ validFrom: NOW, validTo: NOW }), NOW)).toBe(true);
    expect(isLive(promo({ validFrom: new Date(NOW.getTime() + 1000) }), NOW)).toBe(false);
    expect(isLive(promo({ validTo: new Date(NOW.getTime() - 1000) }), NOW)).toBe(false);
  });

  it('6) 会员专属促销：无会员不得使用', () => {
    const memberOnly = promo({ isMemberOnly: true });
    expect(
      evaluatePromotions([memberOnly], {
        storeId: STORE,
        subtotalCents: 50000,
        now: NOW,
      }).capCents,
    ).toBe(0);
    expect(
      evaluatePromotions([memberOnly], {
        storeId: STORE,
        subtotalCents: 50000,
        memberId: 'M-1',
        now: NOW,
      }).capCents,
    ).toBe(3000);
  });

  it('7) 可叠加：多种促销都能在 pos_sale_discount 里找到出处', () => {
    const r = evaluatePromotions(
      [
        promo({ id: 'A', priority: 10 }),
        promo({
          id: 'B',
          name: '8折',
          type: 'full_discount',
          discountType: 'percent',
          discountValue: 80,
          threshold: 0,
          priority: 1,
        }),
      ],
      { storeId: STORE, subtotalCents: 30000, now: NOW },
    );
    // 先扣 3000，剩余 27000 再打 8 折 → 27000×0.2 = 5400
    expect(r.capCents).toBe(8400);
    expect(r.applied.map((a) => a.promotionId)).toEqual(['A', 'B']);
  });

  it('8) 优惠不得超过商品总额', () => {
    const r = evaluatePromotions([promo({ threshold: 0, discountValue: 999999 })], {
      storeId: STORE,
      subtotalCents: 10000,
      now: NOW,
    });
    expect(r.capCents).toBe(10000);
  });

  it('9) 金额非法（NaN/负数）不得让整个计价崩掉', () => {
    const r = evaluatePromotions(
      [
        promo({ threshold: Number.NaN, discountValue: Number.NaN }),
        promo({ id: 'B', threshold: -100, discountValue: 500 }),
      ],
      { storeId: STORE, subtotalCents: 30000, now: NOW },
    );
    // 脏数据那一条被拒，合法那一条（门槛为负按 0 处理）仍照常生效
    expect(Number.isFinite(r.capCents)).toBe(true);
    expect(r.capCents).toBe(500);
    expect(r.rejected.length).toBeGreaterThan(0);
  });

  it('10) 缺 storeId 直接报错，避免静默放行', () => {
    expect(() =>
      evaluatePromotions([promo()], { storeId: '', subtotalCents: 100 }),
    ).toThrow(/storeId/);
  });
});
