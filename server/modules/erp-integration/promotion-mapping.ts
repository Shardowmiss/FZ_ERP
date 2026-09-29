import { toCents } from '@server/database/money';

/**
 * Wave 4-C：ERP 促销 → POS 促销 的字段映射
 * ---------------------------------------------------------------------------
 * 两侧模型并不对称，直接把 ERP 列写进 pos_promotion 会出错，因此把映射集中在
 * 这一个文件里，便于单测覆盖 + 后续调整。
 *
 * ERP promotion                     POS pos_promotion                      说明
 * -------------------------------   -------------------------------------   --------------------------
 * id            (uuid)            → erpPromotionId  ← 幂等键（新增列）      稳定唯一，重复同步不产生重复行
 * code          (varchar 32)      → （仅参与日志/对账）                     POS 无等价列，不下发
 * type=full_reduction             → type='full_reduce'                     POS 计价分支名
 *   reduce_amount (元)            → discount_value = toCents(...)          POS 金额列是「分」
 * type=discount（或 percentage）    → type='full_discount'                  POS 折扣分支
 *   （注：ERP 库约束 ck_promotion_type 只放行 full_reduction / discount）
 *   discount_rate (0~1)           → discount_value = rate                 ⚠ 该分支下 discount_value
 *                                                                          存的是「折扣率」不是金额
 * threshold (元)                  → threshold = toCents(...)              单位换算
 * begin_date (date)               → valid_from = D 日 00:00:00.000<tz>    日期含当天，开日 0 点
 * end_date   (date)               → valid_to   = D 日 23:59:59.999<tz>    日期含当天，末日收尾
 * store_ids   (jsonb)             → apply_scope / scope_ids               'all' 表示全部门店
 * priority    (int)               → priority                              越大越优先
 * status                          → status                                 仅 active 才会下发
 *
 * 明确**不下发**的：
 *  - ERP 的 fixed_price（特价）：POS calculate() 没有该分支，硬塞会静默失效，
 *    宁可跳过并记日志，也不要让门店以为有特价。
 *  - ERP promotion 无「会员专属」标记，POS 的 is_member_only 恒为 false；
 *    若未来 ERP 需要会员维度促销，应新增列而不是复用 status。
 *
 * 时区：valid_from / valid_to 是 timestamptz，但 ERP 给的是「日期」语义
 * （begin_date/end_date 为 YYYY-MM-DD，含当天）。若按 UTC 午夜落库，东八区门店
 * 在 00:00~08:00 会查不到当天开始的促销；按当地日历日展开到 [00:00, 23:59:59.999]
 * 才与「活动当天生效」一致。时区从 constants/business-clock 取，集中管理。
 */

/** ERP 促销类型（ERP 侧取值） */
export type ErpPromotionType = 'full_reduction' | 'percentage' | 'fixed_price' | string;

/** 一条 ERP 促销（RealErpAdapter 读取后的形态；金额统一为「元」） */
export interface ErpPromotionRow {
  erpPromotionId: string;
  erpCode?: string;
  name: string;
  type: ErpPromotionType;
  thresholdYuan?: number | string;
  reduceAmountYuan?: number | string;
  discountRate?: number | string;
  beginDate?: string | null;
  endDate?: string | null;
  storeIds?: string[];
  priority?: number;
  updatedAt?: string | Date | null;
}

/** 落 pos_promotion 的形状（只包含该表有且需要写入的列） */
export interface PosPromotionUpsert {
  id: string; // POS 主键保持随机 uuid，不复用 ERP id（避免暴露内部主键）
  erpPromotionId: string;
  name: string;
  type: string;
  threshold: number; // 分
  discountValue: number; // 分（full_reduce）| 0~1 折扣率（full_discount）
  discountType: string; // 'amount' | 'percent'
  applyScope: string;
  scopeIds: string[];
  validFrom: Date | null;
  validTo: Date | null;
  status: string;
  priority: number;
  source: string;
  isMemberOnly: boolean;
  erpSyncAt: Date;
  erpUpdatedAt: Date | null;
}

export interface MapResult {
  row: PosPromotionUpsert | null;
  /** 被跳过的Reason，用于同步日志 */
  skipReason?: string;
}

function num(v: unknown, d = 0): number {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function dateStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  return String(v).slice(0, 10);
}

/**
 * 归一化适用门店。驱动对 jsonb 的读回形态不一致（数组 / JSON 字符串 / null），
 * 这里全部收敛为 string[]；任何解析不出来的形态一律当作「空 = 全部门店」，
 * 绝不静默变成「限定门店为空集合」导致促销在门店完全失效。
 */
export function normalizeStoreIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((s) => String(s)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s)).filter(Boolean);
    } catch {
      /* 非 JSON：退化为逗号分隔 */
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/** ERP 日期 → POS 时间戳。endDate 取当日 23:59:59.999，保证「活动当天仍生效」。 */
export function erpDateToTimestamp(d: string | null, endOfDay = false): Date | null {
  const s = dateStr(d);
  if (!s) return null;
  const offset = process.env.POS_BUSINESS_TZ_OFFSET || '+08:00';
  const iso = endOfDay ? `${s}T23:59:59.999${offset}` : `${s}T00:00:00.000${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * 单条映射。返回 `{ row: null, skipReason }` 表示「ERP 有但这个 POS 表达不了」，
 * 由调用方记日志（不要静默丢弃 —— 静默的外部类型丢失是最难排查的一类缺陷）。
 */
export function mapErpPromotion(
  r: ErpPromotionRow,
  now: Date = new Date(),
): MapResult {
  const erpPromotionId = String(r.erpPromotionId ?? '').trim();
  if (!erpPromotionId) {
    return { row: null, skipReason: 'erp_promotion_id 缺失' };
  }
  if (!String(r.name ?? '').trim()) {
    return { row: null, skipReason: '促销名称缺失' };
  }

  const storeIds = normalizeStoreIds(r.storeIds);
  const thresholdYuan = num(r.thresholdYuan);
  const base = {
    id: randomUuid(),
    erpPromotionId,
    name: String(r.name).trim(),
    threshold: toCents(thresholdYuan),
    applyScope: storeIds.length === 0 ? 'all' : 'scoped',
    scopeIds: storeIds,
    validFrom: erpDateToTimestamp(r.beginDate ?? null, false),
    validTo: erpDateToTimestamp(r.endDate ?? null, true),
    status: 'active',
    priority: num(r.priority),
    source: 'erp',
    isMemberOnly: false, // ERP 促销模型尚无「会员专属」，恒 false
    erpSyncAt: now,
    erpUpdatedAt: r.updatedAt ? new Date(r.updatedAt) : null,
  };

  // 满减。注意 ERP 库约束里没有 'percentage'，但 POS 侧兜底接受，
  // 将来 ERP 放开约束后无需改这里。
  if (r.type === 'full_reduction') {
    return {
      row: {
        ...base,
        type: 'full_reduce',
        discountType: 'amount',
        // 满减：减免金额的「分」值；门槛不参与减免计算，仅用于展示与二次校验
        discountValue: toCents(num(r.reduceAmountYuan)),
      },
    };
  }

  // 折扣。ERP 库约束里的 'discount'，同时也是代码枚举 'percentage' 的等价形态。
  if (r.type === 'discount' || r.type === 'percentage') {
    const rate = num(r.discountRate, 1);
    if (rate <= 0 || rate >= 1) {
      // 折扣率必须落在 (0,1)；0 或 1 意味着「不打折 / 免费」，属于配置错误
      return { row: null, skipReason: `折扣率非法: ${r.discountRate}` };
    }
    return {
      row: {
        ...base,
        type: 'full_discount',
        discountType: 'percent',
        // ⚠ 不能直写 rate：pos_promotion.discount_value 是 **bigint**，
        // 写 0.8 会被 PostgreSQL 拒绝（invalid input syntax for type bigint），
        // 意味着折扣类促销在 POS 从来就存不进去（calculate 的 full_discount 是死代码）。
        // 统一约定：该列一律存「放大的整数」，对外读回时由 fromCents() 还原：
        //   full_reduce  → 分（3000 = 30 元）
        //   full_discount → 百分率整数（80 = 8 折，读回 fromCents(80) = 0.8）
        discountValue: Math.round(rate * 100),
      },
    };
  }

  return { row: null, skipReason: `不支持的促销类型: ${r.type}` };
}

/** 极简 uuid v4 桩：项目未提供 uuid 依赖时使用。 */
function randomUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const v = (Math.random() * 16) | 0;
    return (c === 'x' ? v : (v & 0x3) | 0x8).toString(16);
  });
}

/** 门店维度是否命中促销。applyScope='all' 视为全部门店。 */
export function promotionHitsStore(
  row: { applyScope: string; scopeIds: string[] | null },
  storeId: string,
): boolean {
  if (row.applyScope === 'all') return true;
  return (row.scopeIds ?? []).includes(storeId);
}
