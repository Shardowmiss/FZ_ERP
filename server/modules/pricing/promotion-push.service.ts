import { Injectable, Inject } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { promotion } from '@server/database/schema';
import { CommonStatus } from '@server/common/enums';
import { MoneyService } from '@server/common/services/money.service';

/* ---------------------------------------------------------------------------
 * Wave 4-C：促销中心「下行载荷」服务
 * ---------------------------------------------------------------------------
 * 背景：POS 侧具备完整的促销落地与开单计价能力（pos_promotion），但 ERP 的促销
 * 中心（promotion 表 + PricingService） historically 从未向下下发过 —— POS 的
 * `syncDownstream('promotions')` 只取 count 不做 upsert，RealErpAdapter
 * .getPromotions() 直接 return []。结果是「ERP 建了促销、门店收银台完全不知道」。
 *
 * 本服务只做一件事：把 ERP 促销中心**按门店 + 生效期**裁剪成一份规范化、
 * 幂等的下行载荷（以 ERP promotion.id 作为 POS 侧幂等键 erp_promotion_id）。
 * 具体落库（upsert / 墓碑）在 POS 侧 PromotionSyncService 完成。
 *
 * 金额单位统一用「元」下发（与 ERP promotion 表 numeric 保持一致），
 * 由 POS 侧 toCents() 转分；避免两侧小数精度在传输途中丢失。
 * ------------------------------------------------------------------------- */

/**
 * ERP 促销类型（与 server/common/enums 的 PromotionType 对齐）。
 *
 * ⚠ 实测\Database 约束 `ck_promotion_type` 只允许 'full_reduction' 与 'discount'，
 * 代码枚举里的 percentage / fixed_price 在库层面根本写不进去。这里按**库约束**
 * 收敛为三值（含容错分支），避免下行时把永远不可能存在的值带下去。
 */
export type PromotionPushType = 'full_reduction' | 'discount' | 'percentage' | 'fixed_price';

export interface PromotionPushItem {
  /** ERP 促销主键 —— POS 侧回落主键（幂等键），保证重复同步不产生重复行 */
  erpPromotionId: string;
  /** 业务编码，便于人工对账 */
  erpCode: string;
  name: string;
  type: PromotionPushType;
  /** 满减门槛（元） */
  thresholdYuan: number;
  /** 减免金额（元，full_reduction / fixed_price 使用） */
  reduceAmountYuan: number;
  /** 折扣率 0~1（percentage 使用） */
  discountRate: number;
  /** YYYY-MM-DD，空表示不限起始 */
  beginDate: string | null;
  /** YYYY-MM-DD，空表示不限结束 */
  endDate: string | null;
  /** 适用门店；空数组表示全部门店 */
  storeIds: string[];
  priority: number;
  status: string;
  /** ERP 侧最后更新时间，POS 用来判断是否真有变更 */
  updatedAt: string;
}

export interface PromotionPushPayload {
  /** 传入的门店；未传表示全部门店 */
  storeId?: string;
  /** 生效期判定基准日（YYYY-MM-DD），默认当天 */
  asOf: string;
  items: PromotionPushItem[];
  generatedAt: string;
}

function num(v: unknown, d = 0): number {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function dateStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** jsonb 列可能以字符串读回，这里统一为 string[] */
function storeIdsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      // 非 JSON，退化为逗号分隔（防御性，正常不应发生）
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

@Injectable()
export class PromotionPushService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly money: MoneyService,
  ) {}

  /**
   * 构建促销下行载荷。
   *
   * 过滤规则（三层）：
   *  1) 仅 status='active'（其它状态由 POS 侧墓碑软删处理，不在本载荷内）；
   *  2) 生效期包含 asOf（beginDate/endDate 为空视为不限）；
   *  3) 若传入 storeId，仅返回「适用该门店」的促销 ——
   *     storeIds 为空 = 全部门店，否则必须命中该门店。
   *
   * 注意：不做分页。促销是低频变更的参考数据，门店一次性全量拉取更合适；
   * 若未来促销规模上万，再改为 since 增量（以 _updated_at 为水位）。
   */
  async getPushPayload(params: {
    storeId?: string;
    asOf?: string;
  } = {}): Promise<PromotionPushPayload> {
    const asOf = dateStr(params.asOf) ?? new Date().toISOString().slice(0, 10);

    const rows = await this.db
      .select()
      .from(promotion)
      .where(
        and(
          eq(promotion.status, CommonStatus.ACTIVE),
          or(isNull(promotion.beginDate), lte(promotion.beginDate, asOf)),
          or(isNull(promotion.endDate), gte(promotion.endDate, asOf)),
        ),
      )
      .orderBy(desc(promotion.priority), desc(promotion.createdAt));

    const items: PromotionPushItem[] = [];
    for (const row of rows) {
      const storeIds = storeIdsOf(row.storeIds);
      // 门店维度过滤放在内存：行数少（促销通常几十到几百），避免 jsonb 索引依赖。
      // storeIds 为空 = 全部门店，必须放行 —— 与 POS 侧「空 scope 命中所有门店」的
      // 计价口径保持一致，否则同一次查询在 ERP 二分之一门店、在 POS 却是另一套结果。
      if (
        params.storeId &&
        storeIds.length > 0 &&
        !storeIds.includes(params.storeId)
      ) {
        continue;
      }
      items.push({
        erpPromotionId: row.id,
        erpCode: row.code,
        name: row.name,
        type: (row.type as PromotionPushType) ?? 'full_reduction',
        thresholdYuan: num(this.money.round2(row.threshold)),
        reduceAmountYuan: num(this.money.round2(row.reduceAmount)),
        discountRate: num(this.money.round2(row.discountRate), 1),
        beginDate: dateStr(row.beginDate),
        endDate: dateStr(row.endDate),
        storeIds,
        priority: num(row.priority),
        status: row.status,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
      });
    }

    return {
      ...(params.storeId ? { storeId: params.storeId } : {}),
      asOf,
      items,
      generatedAt: new Date().toISOString(),
    };
  }

  /** POS 侧做「墓碑」比对时需要知道 ERP 侧某个促销是否已被撤销（软删/改非 active）。 */
  async isStillActive(erpPromotionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: promotion.id })
      .from(promotion)
      .where(and(eq(promotion.id, erpPromotionId), eq(promotion.status, CommonStatus.ACTIVE)))
      .limit(1);
    return rows.length > 0;
  }

  /** 供运维/联调用：统计当前应下发的促销数。 */
  async countPushable(params: { storeId?: string } = {}): Promise<number> {
    return (await this.getPushPayload(params)).items.length;
  }

  /** 供日志/同步明细使用：把一条促销压成一行可读摘要。 */
  static summarize(item: PromotionPushItem): string {
    return `${item.erpCode}|${item.name}|${item.type}|threshold=${item.thresholdYuan}|reduce=${item.reduceAmountYuan}|rate=${item.discountRate}|store=${item.storeIds.length === 0 ? 'ALL' : item.storeIds.join(',')}`;
  }
}
