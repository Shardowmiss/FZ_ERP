/**
 * Wave 4-C：POS 开单计价的服务端促销引擎（纯函数）
 * ---------------------------------------------------------------------------
 * 原状：`SalesService.createOrder` 对 `dto.discounts` **不做任何促销校验** ——
 * 收银员/客户端填多少优惠就是多少优惠，只要不超过商品总额。这是明确的资损入口。
 *
 * 本文件提供无 IO 的纯计算：给定门店当前生效促销 + 本单金额，算出「本单允许的最大
 * 促销优惠」。调用方（SalesService）用它去卡客户端传来的优惠总额。
 *
 * 规则（与 ERP 促销中心语义对齐，避免两端算出来不一样）：
 *  1. 只处理**整单级**促销：full_reduce（满减）/ full_discount（折扣）。
 *     单品级促销需要更复杂的门槛分摊，不在本轮范围。
 *  2. **可叠加**：多个满足门槛的促销可以叠加，但每种都必须真实存在于库中
 *     （由调用方传入的行即为库里的生效促销），杜绝凭空造优惠。
 *  3. 门槛判定用「扣减前的商品总额」，且按顺序扣减（前面的促销会抬高后续促销的门槛命中率）。
 *  4. 不是"挑最优一个"，而是"所有真实生效的都算" —— 收银台的让利必须能在
 *     pos_sale_discount 里逐条找到出处。
 */

export interface EnginePromotion {
  id: string;
  name: string;
  /** 'full_reduce' | 'full_discount' */
  type: string;
  /** 满减门槛（分） */
  threshold: number;
  /**
   * full_reduce：减免额（分）；full_discount：折扣**百分率整数**（80 = 8 折）。
   * 统一「存放大整数、读回用 fromCents」的约定 —— 该列是 bigint，直写 0.8 会被 PG 拒绝。
   */
  discountValue: number;
  /** 'amount' | 'percent' */
  discountType: string;
  priority: number;
  isMemberOnly?: boolean;
  applyScope?: string;
  scopeIds?: string[] | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  status?: string;
}

export interface EngineInput {
  storeId: string;
  /** 商品总额（分） */
  subtotalCents: number;
  memberId?: string;
  now?: Date;
}

export interface EngineRejection {
  promotionId: string;
  reason: string;
}

export interface EngineOutput {
  /** 允许的最大促销优惠合计（分） */
  capCents: number;
  /** 命中的促销明细（分，与 capCents 一致） */
  applied: Array<{ promotionId: string; name: string; type: string; discountCents: number }>;
  /** 被剔除的促销及原因（对账/日志用） */
  rejected: EngineRejection[];
}

/** 门店作用域是否命中。applyScope='all' 视为全部门店。 */
export function hitsStore(p: EnginePromotion, storeId: string): boolean {
  if (p.applyScope === 'scoped') {
    const ids = (p.scopeIds ?? []).filter(Boolean);
    if (ids.length > 0 && !ids.includes(storeId)) return false;
  }
  return true;
}

/** 是否在有效期内（含端点）与状态为 active。 */
export function isLive(p: EnginePromotion, now: Date): boolean {
  if (p.status && p.status !== 'active') return false;
  if (p.validFrom && now < p.validFrom) return false;
  if (p.validTo && now > p.validTo) return false;
  return true;
}

function matchesMember(p: EnginePromotion, memberId?: string): boolean {
  if (p.isMemberOnly && !memberId) return false;
  return true;
}

/**
 * 计算本单允许的最大促销优惠。
 *
 * @param promos 门店当前生效促销（由 PromotionsService.getActiveForStore 查出，
 *              本函数不再查库，便于直接单测）
 */
export function evaluatePromotions(
  promos: EnginePromotion[],
  input: EngineInput,
): EngineOutput {
  const now = input.now ?? new Date();
  const applied: EngineOutput['applied'] = [];
  const rejected: EngineRejection[] = [];
  if (!input.storeId) {
    throw new Error('storeId 必填');
  }

  // 门槛按「扣减后剩余额」依次判定：先满足的先扣，后面的促销用剩余额再判
  let remaining = Math.max(0, Math.round(input.subtotalCents));

  const candidates = [...promos]
    .filter((p) => p.type === 'full_reduce' || p.type === 'full_discount')
    .filter((p) => isLive(p, now))
    .filter((p) => hitsStore(p, input.storeId))
    .filter((p) => matchesMember(p, input.memberId))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const p of candidates) {
    // 金额防御：脏数据（NaN / Infinity）一旦进入算术会让整单上限变成 NaN，
    // 进而「比较永远为假」把校验整个绕过去 —— 宁可跳过并记账。
    const rawThreshold = p.threshold ?? 0;
    const threshold = Number.isFinite(rawThreshold)
      ? Math.max(0, Math.round(rawThreshold))
      : 0;
    if (remaining < threshold) {
      rejected.push({
        promotionId: p.id,
        reason: `未达门槛 ${threshold}（剩余 ${remaining}）`,
      });
      continue;
    }

    let discount = 0;
    if (p.type === 'full_reduce' && p.discountType === 'amount') {
      const v = p.discountValue ?? 0;
      if (!Number.isFinite(v)) {
        rejected.push({ promotionId: p.id, reason: `减免额非法: ${p.discountValue}` });
        continue;
      }
      discount = Math.round(v);
    } else if (p.type === 'full_discount' && p.discountType === 'percent') {
      const v = p.discountValue ?? 0;
      const rate = Number.isFinite(v) ? v / 100 : Number.NaN; // 列内存「百分率整数」，还原为 0~1
      if (!(rate > 0 && rate < 1)) {
        rejected.push({
          promotionId: p.id,
          reason: `折扣率非法: ${p.discountValue}`,
        });
        continue;
      }
      discount = Math.round(remaining * (1 - rate));
    } else {
      rejected.push({ promotionId: p.id, reason: `无法解析的促销结构: ${p.type}` });
      continue;
    }

    if (discount <= 0) {
      rejected.push({ promotionId: p.id, reason: '计算出的优惠为 0' });
      continue;
    }

    discount = Math.min(discount, remaining);
    if (!Number.isFinite(discount) || discount < 0) {
      rejected.push({ promotionId: p.id, reason: '优惠额计算异常' });
      continue;
    }
    applied.push({
      promotionId: p.id,
      name: p.name,
      type: p.type,
      discountCents: discount,
    });
    remaining -= discount;
  }

  const capCents = applied.reduce((s, a) => s + a.discountCents, 0);
  return { capCents, applied, rejected };
}
