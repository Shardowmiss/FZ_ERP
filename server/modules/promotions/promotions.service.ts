import { fromCents } from '@server/database/money';
import { hitsStore, type EnginePromotion } from './promotion-engine';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@server/database/drizzle-tokens';
import { scopeDatabase } from '@server/database/soft-delete';
import { posPromotion } from '@server/database/schema';
import { eq, and, count, desc, sql, gte, lte, or, isNull } from 'drizzle-orm';
import type {
  Promotion,
  PromotionQuery,
  ListResponse,
  CalculatePromotionDto,
  PromotionCalculateResult,
  PromotionDiscountDetail,
} from '@shared/api.interface';

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    ) {
    this.db = scopeDatabase(this.db);
  }

  async getPromotions(query: PromotionQuery): Promise<ListResponse<Promotion>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (query.status) conditions.push(eq(posPromotion.status, query.status));
    if (query.type) conditions.push(eq(posPromotion.type, query.type));
    if (query.keyword) {
      conditions.push(
        sql`${posPromotion.name} ILIKE ${'%' + query.keyword + '%'}`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(posPromotion)
        .where(whereClause),
      this.db
        .select()
        .from(posPromotion)
        .where(whereClause)
        .orderBy(desc(posPromotion.priority), desc(posPromotion.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapPromotion(row)),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Wave 4-C：取某门店当前生效的促销（开单计价热路径）。
   *
   * 过滤四层：status=active / 有效期含当天 / 门店作用域命中 / 会员专属校验。
   * 门店作用域在这里就用 SQL + 内存双重收敛：同步时故意不按门店裁剪（否则
   * 换门店同步会把其它门店的促销墓碑掉），因此这里必须把不属于本店的促销剔掉。
   */
  async getActiveForStore(
    storeId: string,
    memberId?: string,
    now: Date = new Date(),
  ): Promise<EnginePromotion[]> {
    if (!storeId) return [];
    const rows = await this.db
      .select()
      .from(posPromotion)
      .where(
        and(
          eq(posPromotion.status, 'active'),
          or(isNull(posPromotion.validFrom), lte(posPromotion.validFrom, now)),
          or(isNull(posPromotion.validTo), gte(posPromotion.validTo, now)),
        ),
      )
      .orderBy(desc(posPromotion.priority));
    // scopeDatabase 已过滤 deletedAt；这里再按门店/会员收敛一次，并给出拒绝对账
    return rows
      .filter((r) => hitsStore(r, storeId))
      .filter((r) => (r.isMemberOnly ? Boolean(memberId) : true))
      .map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        threshold: Number(r.threshold ?? 0),
        discountValue: Number(r.discountValue ?? 0),
        discountType: r.discountType ?? undefined,
        priority: r.priority,
        isMemberOnly: r.isMemberOnly,
        applyScope: r.applyScope,
        scopeIds: r.scopeIds ?? [],
        validFrom: r.validFrom,
        validTo: r.validTo,
        status: r.status,
      }));
  }

  async getPromotion(id: string): Promise<Promotion> {
    const rows = await this.db
      .select()
      .from(posPromotion)
      .where(eq(posPromotion.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('促销活动不存在');
    }
    return this.mapPromotion(rows[0]);
  }

  async calculate(
    dto: CalculatePromotionDto,
  ): Promise<PromotionCalculateResult> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('商品列表不能为空');
    }

    // 获取所有有效促销
    const promotions = await this.db
      .select()
      .from(posPromotion)
      .where(
        and(
          eq(posPromotion.status, 'active'),
          or(isNull(posPromotion.validFrom), lte(posPromotion.validFrom, new Date())),
          or(isNull(posPromotion.validTo), gte(posPromotion.validTo, new Date())),
        ),
      )
      .orderBy(desc(posPromotion.priority));

    const activePromotions = promotions.filter((p) => {
      if (p.isMemberOnly && !dto.memberId) return false;
      return true;
    });

    const totalAmount = dto.totalAmount;
    const discounts: PromotionDiscountDetail[] = [];
    let totalDiscount = 0;

    // 计算满减
    for (const promo of activePromotions) {
      if (promo.type === 'full_reduce' && promo.threshold && promo.discountValue) {
        const threshold = Number(promo.threshold);
        const discountVal = Number(promo.discountValue);
        if (totalAmount - totalDiscount >= threshold) {
          discounts.push({
            promotionId: promo.id,
            promotionName: promo.name,
            promotionType: promo.type,
            discountAmount: discountVal,
          });
          totalDiscount += discountVal;
        }
      }

      if (promo.type === 'full_discount' && promo.threshold && promo.discountValue) {
        const threshold = Number(promo.threshold);
        // ⚠ discount_value 存的是「放大的整数」（见 promotion-mapping 注释）：
        // full_discount 分支下该列按 fromCents 语义还原为折扣率（80 → 0.8）。
        // 直接拿原始值当 0~1 的折扣率算，会让「8 折」被当成「80 折」，折扣额为负。
        const discountVal = fromCents(Number(promo.discountValue));
        if (totalAmount - totalDiscount >= threshold && discountVal > 0 && discountVal < 1) {
          const discountAmount = Math.round((totalAmount - totalDiscount) * (1 - discountVal) * 100) / 100;
          discounts.push({
            promotionId: promo.id,
            promotionName: promo.name,
            promotionType: promo.type,
            discountAmount,
          });
          totalDiscount += discountAmount;
        }
      }
    }

    // 计算会员折扣（如果有会员）
    if (dto.memberLevel && dto.memberLevel !== 'normal') {
      const memberDiscountRate = dto.memberLevel === 'vip' ? 0.95 : 0.9;
      const memberDiscount = Math.round((totalAmount - totalDiscount) * (1 - memberDiscountRate) * 100) / 100;
      if (memberDiscount > 0) {
        discounts.push({
          promotionName: `${dto.memberLevel === 'vip' ? 'VIP' : '金卡'}会员折扣`,
          promotionType: 'member_discount',
          discountAmount: memberDiscount,
        });
        totalDiscount += memberDiscount;
      }
    }

    const finalAmount = Math.max(0, Math.round((totalAmount - totalDiscount) * 100) / 100);

    return {
      totalAmount,
      totalDiscount: Math.round(totalDiscount * 100) / 100,
      finalAmount,
      discounts,
      bestCombination: discounts.map((d) => d.promotionName),
    };
  }

  private mapPromotion(row: typeof posPromotion.$inferSelect): Promotion {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      threshold: row.threshold ? fromCents(row.threshold) : undefined,
      discountValue: row.discountValue ? fromCents(row.discountValue) : undefined,
      discountType: row.discountType ?? undefined,
      applyScope: row.applyScope,
      scopeIds: row.scopeIds ?? [],
      validFrom: row.validFrom?.toISOString(),
      validTo: row.validTo?.toISOString(),
      status: row.status,
      priority: row.priority,
      isMemberOnly: row.isMemberOnly,
      source: row.source,
      erpSyncAt: row.erpSyncAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
