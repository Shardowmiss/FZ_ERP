import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  eq,
  and,
  count,
  desc,
  asc,
  or,
  ilike,
  lte,
  gte,
  isNull,
  inArray,
} from 'drizzle-orm';
import {
  priceList,
  priceListItem,
  promotion,
  coupon,
  sku,
} from '@server/database/schema';
import { RbacService } from '../rbac/rbac.service';
import { MoneyService } from '@server/common/services/money.service';
import { EventBusService } from '@server/modules/events/event-bus.service';
import { TTL as CACHE_TTL, cached as readThrough } from '@server/common/cache';
import {
  CommonStatus,
  CouponType,
  PriceListType,
  PromotionType,
} from '@server/common/enums';
import type {
  PriceListDto,
  PriceListItemDto,
  PromotionDto,
  CouponDto,
} from './dto/pricing.dto';
import type { PaginationResult } from '@shared/api.interface';

/* ---------------- helpers ---------------- */

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDateRange(begin: unknown, end: unknown): boolean {
  const today = todayStr();
  if (begin && String(begin) > today) return false;
  if (end && String(end) < today) return false;
  return true;
}

// date 列在 schema 中映射为 string（YYYY-MM-DD）；空值返回 undefined 以略过（不写 NULL）
function toDateStr(v?: string | null): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/* ---------------- DTO interfaces（已迁移至 ./dto/pricing.dto.ts，采用 class-validator 校验） ---------------- */

export interface ResolvedPrice {
  skuId?: string;
  skuCode?: string;
  styleNo?: string;
  tagPrice: number;
  listPrice: number;
  finalPrice: number;
  appliedPromotion: {
    id: string;
    name: string;
    type: string;
    discountAmount: number;
  } | null;
  availablePromotions: Array<{
    id: string;
    name: string;
    type: string;
    discountAmount: number;
  }>;
}

/* ---------------- service ---------------- */

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly rbacService: RbacService,
    private readonly money: MoneyService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @Inject(EventBusService) private readonly eventBus: EventBusService,
  ) {}

  /* ========== Price List ========== */

  async listPriceLists(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    type?: string;
    status?: string;
  }): Promise<PaginationResult<Record<string, unknown>>> {
    const { page, pageSize, keyword, type, status } = params;
    const conditions = [];
    if (keyword) {
      conditions.push(
        or(ilike(priceList.code, `%${keyword}%`), ilike(priceList.name, `%${keyword}%`)),
      );
    }
    if (type) conditions.push(eq(priceList.type, type));
    if (status) conditions.push(eq(priceList.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(priceList).where(where as any),
      this.db
        .select()
        .from(priceList)
        .where(where as any)
        .orderBy(desc(priceList.priority), desc(priceList.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows as unknown as Record<string, unknown>[],
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getPriceList(id: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(priceList).where(eq(priceList.id, id));
    if (rows.length === 0) throw new NotFoundException('价格表不存在');
    const list = rows[0];
    const items = await this.db
      .select()
      .from(priceListItem)
      .where(eq(priceListItem.priceListId, id))
      .orderBy(asc(priceListItem.createdAt));
    return { ...(list as object), items } as Record<string, unknown>;
  }

  async createPriceList(data: PriceListDto): Promise<{ id: string }> {
    if (!data.code?.trim()) throw new BadRequestException('价格表编码不能为空');
    if (!data.name?.trim()) throw new BadRequestException('价格表名称不能为空');
    const existing = await this.db
      .select({ id: priceList.id })
      .from(priceList)
      .where(eq(priceList.code, data.code));
    if (existing.length > 0) throw new ConflictException('价格表编码已存在');

    const inserted = await this.db
      .insert(priceList)
      .values({
        code: data.code,
        name: data.name,
        type: data.type || PriceListType.STORE,
        scopeId: data.scopeId ?? null,
        priority: data.priority ?? 0,
        status: data.status ?? CommonStatus.ACTIVE,
        effectiveFrom: toDateStr(data.effectiveFrom),
        effectiveTo: toDateStr(data.effectiveTo),
        remark: data.remark ?? null,
      })
      .returning({ id: priceList.id });
    await this.invalidateActiveCache();
    return { id: inserted[0].id };
  }

  async updatePriceList(
    id: string,
    data: Partial<PriceListDto>,
  ): Promise<{ success: boolean }> {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.type !== undefined) patch.type = data.type;
    if (data.scopeId !== undefined) patch.scopeId = data.scopeId ?? null;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.status !== undefined) patch.status = data.status;
    if (data.effectiveFrom !== undefined)
      patch.effectiveFrom = toDateStr(data.effectiveFrom);
    if (data.effectiveTo !== undefined)
      patch.effectiveTo = toDateStr(data.effectiveTo);
    if (data.remark !== undefined) patch.remark = data.remark ?? null;
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('未提供可更新字段');

    const updated = await this.db
      .update(priceList)
      .set(patch)
      .where(eq(priceList.id, id))
      .returning({ id: priceList.id });
    if (updated.length === 0) throw new NotFoundException('价格表不存在');
    await this.invalidateActiveCache();
    return { success: true };
  }

  async deletePriceList(id: string): Promise<{ success: boolean }> {
    await this.db.delete(priceListItem).where(eq(priceListItem.priceListId, id));
    const deleted = await this.db
      .delete(priceList)
      .where(eq(priceList.id, id))
      .returning({ id: priceList.id });
    if (deleted.length === 0) throw new NotFoundException('价格表不存在');
    await this.invalidateActiveCache();
    return { success: true };
  }

  /* ========== Price List Item ========== */

  async addPriceListItems(
    listId: string,
    items: PriceListItemDto[],
  ): Promise<{ count: number }> {
    const listRows = await this.db
      .select({ id: priceList.id })
      .from(priceList)
      .where(eq(priceList.id, listId));
    if (listRows.length === 0) throw new NotFoundException('价格表不存在');
    if (items.length === 0) throw new BadRequestException('明细不能为空');

    const values = items.map((it) => ({
      priceListId: listId,
      styleNo: it.styleNo ?? null,
      skuId: it.skuId ?? null,
      skuCode: it.skuCode ?? null,
      tagPrice: this.money.round2(it.tagPrice ?? 0),
      price: this.money.round2(it.price ?? 0),
      discountRate: this.money.round2(it.discountRate ?? 1),
      status: it.status ?? CommonStatus.ACTIVE,
    }));
    await this.db.insert(priceListItem).values(values);
    return { count: values.length };
  }

  async updatePriceListItem(
    itemId: string,
    data: Partial<PriceListItemDto>,
  ): Promise<{ success: boolean }> {
    const patch: Record<string, unknown> = {};
    if (data.styleNo !== undefined) patch.styleNo = data.styleNo ?? null;
    if (data.skuId !== undefined) patch.skuId = data.skuId ?? null;
    if (data.skuCode !== undefined) patch.skuCode = data.skuCode ?? null;
    if (data.tagPrice !== undefined) patch.tagPrice = this.money.round2(data.tagPrice);
    if (data.price !== undefined) patch.price = this.money.round2(data.price);
    if (data.discountRate !== undefined) patch.discountRate = this.money.round2(data.discountRate);
    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('未提供可更新字段');

    const updated = await this.db
      .update(priceListItem)
      .set(patch)
      .where(eq(priceListItem.id, itemId))
      .returning({ id: priceListItem.id });
    if (updated.length === 0) throw new NotFoundException('价格表明细不存在');
    await this.invalidateActiveCache();
    return { success: true };
  }

  async removePriceListItem(itemId: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(priceListItem)
      .where(eq(priceListItem.id, itemId))
      .returning({ id: priceListItem.id });
    if (deleted.length === 0) throw new NotFoundException('价格表明细不存在');
    await this.invalidateActiveCache();
    return { success: true };
  }

  /* ========== Promotion ========== */

  async listPromotions(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    type?: string;
    status?: string;
  }): Promise<PaginationResult<Record<string, unknown>>> {
    const { page, pageSize, keyword, type, status } = params;
    const conditions = [];
    if (keyword) {
      conditions.push(
        or(ilike(promotion.code, `%${keyword}%`), ilike(promotion.name, `%${keyword}%`)),
      );
    }
    if (type) conditions.push(eq(promotion.type, type));
    if (status) conditions.push(eq(promotion.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(promotion).where(where as any),
      this.db
        .select()
        .from(promotion)
        .where(where as any)
        .orderBy(desc(promotion.priority), desc(promotion.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows as unknown as Record<string, unknown>[],
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getPromotion(id: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(promotion).where(eq(promotion.id, id));
    if (rows.length === 0) throw new NotFoundException('促销活动不存在');
    return rows[0] as unknown as Record<string, unknown>;
  }

  async createPromotion(data: PromotionDto): Promise<{ id: string }> {
    if (!data.code?.trim()) throw new BadRequestException('活动编码不能为空');
    if (!data.name?.trim()) throw new BadRequestException('活动名称不能为空');
    const existing = await this.db
      .select({ id: promotion.id })
      .from(promotion)
      .where(eq(promotion.code, data.code));
    if (existing.length > 0) throw new ConflictException('活动编码已存在');

    const inserted = await this.db
      .insert(promotion)
      .values({
        code: data.code,
        name: data.name,
        type: data.type || PromotionType.FULL_REDUCTION,
        threshold: this.money.round2(data.threshold ?? 0),
        reduceAmount: this.money.round2(data.reduceAmount ?? 0),
        discountRate: this.money.round2(data.discountRate ?? 1),
        beginDate: data.beginDate ? toDateStr(data.beginDate) : null,
        endDate: toDateStr(data.endDate),
        storeIds: (data.storeIds ?? []) as unknown as object,
        priority: data.priority ?? 0,
        status: data.status ?? CommonStatus.ACTIVE,
        remark: data.remark ?? null,
      })
      .returning({ id: promotion.id });
    await this.invalidateActiveCache();
    return { id: inserted[0].id };
  }

  async updatePromotion(
    id: string,
    data: Partial<PromotionDto>,
  ): Promise<{ success: boolean }> {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.type !== undefined) patch.type = data.type;
    if (data.threshold !== undefined) patch.threshold = this.money.round2(data.threshold);
    if (data.reduceAmount !== undefined) patch.reduceAmount = this.money.round2(data.reduceAmount);
    if (data.discountRate !== undefined) patch.discountRate = this.money.round2(data.discountRate);
    if (data.beginDate !== undefined)
      patch.beginDate = data.beginDate ? toDateStr(data.beginDate) : null;
    if (data.endDate !== undefined)
      patch.endDate = toDateStr(data.endDate);
    if (data.storeIds !== undefined) patch.storeIds = data.storeIds as unknown as object;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.status !== undefined) patch.status = data.status;
    if (data.remark !== undefined) patch.remark = data.remark ?? null;
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('未提供可更新字段');

    const updated = await this.db
      .update(promotion)
      .set(patch)
      .where(eq(promotion.id, id))
      .returning({ id: promotion.id });
    if (updated.length === 0) throw new NotFoundException('促销活动不存在');
    await this.invalidateActiveCache();
    return { success: true };
  }

  async deletePromotion(id: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(promotion)
      .where(eq(promotion.id, id))
      .returning({ id: promotion.id });
    if (deleted.length === 0) throw new NotFoundException('促销活动不存在');
    await this.invalidateActiveCache();
    return { success: true };
  }

  /* ========== Coupon ========== */

  async listCoupons(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    type?: string;
    status?: string;
  }): Promise<PaginationResult<Record<string, unknown>>> {
    const { page, pageSize, keyword, type, status } = params;
    const conditions = [];
    if (keyword) {
      conditions.push(
        or(ilike(coupon.code, `%${keyword}%`), ilike(coupon.name, `%${keyword}%`)),
      );
    }
    if (type) conditions.push(eq(coupon.type, type));
    if (status) conditions.push(eq(coupon.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(coupon).where(where as any),
      this.db
        .select()
        .from(coupon)
        .where(where as any)
        .orderBy(desc(coupon.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    return {
      items: rows as unknown as Record<string, unknown>[],
      total: Number(countResult[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getCoupon(id: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(coupon).where(eq(coupon.id, id));
    if (rows.length === 0) throw new NotFoundException('优惠券不存在');
    return rows[0] as unknown as Record<string, unknown>;
  }

  async createCoupon(data: CouponDto): Promise<{ id: string }> {
    if (!data.code?.trim()) throw new BadRequestException('券编码不能为空');
    if (!data.name?.trim()) throw new BadRequestException('券名称不能为空');
    const existing = await this.db
      .select({ id: coupon.id })
      .from(coupon)
      .where(eq(coupon.code, data.code));
    if (existing.length > 0) throw new ConflictException('券编码已存在');

    const inserted = await this.db
      .insert(coupon)
      .values({
        code: data.code,
        name: data.name,
        type: data.type || CouponType.FULL_REDUCTION,
        value: this.money.round2(data.value ?? 0),
        discountRate: this.money.round2(data.discountRate ?? 1),
        minSpend: this.money.round2(data.minSpend ?? 0),
        beginDate: data.beginDate ? toDateStr(data.beginDate) : null,
        endDate: toDateStr(data.endDate),
        totalQty: data.totalQty ?? 0,
        usedQty: 0,
        status: data.status ?? CommonStatus.ACTIVE,
        remark: data.remark ?? null,
      })
      .returning({ id: coupon.id });
    return { id: inserted[0].id };
  }

  async updateCoupon(
    id: string,
    data: Partial<CouponDto>,
  ): Promise<{ success: boolean }> {
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.type !== undefined) patch.type = data.type;
    if (data.value !== undefined) patch.value = this.money.round2(data.value);
    if (data.discountRate !== undefined) patch.discountRate = this.money.round2(data.discountRate);
    if (data.minSpend !== undefined) patch.minSpend = this.money.round2(data.minSpend);
    if (data.beginDate !== undefined)
      patch.beginDate = data.beginDate ? toDateStr(data.beginDate) : null;
    if (data.endDate !== undefined)
      patch.endDate = toDateStr(data.endDate);
    if (data.totalQty !== undefined) patch.totalQty = data.totalQty;
    if (data.status !== undefined) patch.status = data.status;
    if (data.remark !== undefined) patch.remark = data.remark ?? null;
    if (Object.keys(patch).length === 0)
      throw new BadRequestException('未提供可更新字段');

    const updated = await this.db
      .update(coupon)
      .set(patch)
      .where(eq(coupon.id, id))
      .returning({ id: coupon.id });
    if (updated.length === 0) throw new NotFoundException('优惠券不存在');
    return { success: true };
  }

  async deleteCoupon(id: string): Promise<{ success: boolean }> {
    const deleted = await this.db
      .delete(coupon)
      .where(eq(coupon.id, id))
      .returning({ id: coupon.id });
    if (deleted.length === 0) throw new NotFoundException('优惠券不存在');
    return { success: true };
  }

  /* ========== Price Resolution ========== */

  /**
   * 解析某个 SKU 在当前门店/会员下的应售价。
   * 1) 取吊牌价（来自 sku 或 price_list_item）
   * 2) 选优先级最高的适用价格表，得到 listPrice
   * 3) 叠加当前生效且门店命中的促销，计算最优折扣
   */
  async resolvePrice(params: {
    skuId?: string;
    skuCode?: string;
    styleNo?: string;
    storeId?: string;
  }): Promise<ResolvedPrice> {
    const { skuId, skuCode, styleNo, storeId } = params;

    // 基础 SKU 信息
    let targetSku: { id: string; skuCode: string; styleNo: string; tagPrice: number } | null =
      null;
    if (skuId) {
      const rows = await this.db.select().from(sku).where(eq(sku.id, skuId)).limit(1);
      if (rows.length > 0) {
        const r = rows[0];
        targetSku = {
          id: r.id,
          skuCode: r.skuCode,
          styleNo: r.styleNo,
          tagPrice: num(r.tagPrice),
        };
      }
    } else if (skuCode) {
      const rows = await this.db
        .select()
        .from(sku)
        .where(eq(sku.skuCode, skuCode))
        .limit(1);
      if (rows.length > 0) {
        const r = rows[0];
        targetSku = {
          id: r.id,
          skuCode: r.skuCode,
          styleNo: r.styleNo,
          tagPrice: num(r.tagPrice),
        };
      }
    }

    const fallbackStyleNo = styleNo ?? targetSku?.styleNo;
    const tagPrice = targetSku?.tagPrice ?? 0;

    // 选适用价格表：先按 status + 日期范围下推到 SQL（避免全表扫描），
    // 再按门店 scope 规则在内存过滤（仅候选集，数据量极小），取优先级最高的一条。
    const today = todayStr();
    const candidateLists = await this.db
      .select()
      .from(priceList)
      .where(
        and(
          eq(priceList.status, CommonStatus.ACTIVE),
          or(isNull(priceList.effectiveFrom), lte(priceList.effectiveFrom, today)),
          or(isNull(priceList.effectiveTo), gte(priceList.effectiveTo, today)),
        ),
      )
      .orderBy(desc(priceList.priority));

    const applicableLists = candidateLists
      .filter((l) => {
        if (l.type !== PriceListType.STORE) return true; // 非门店价表（渠道/会员/客户）一律适用
        if (!storeId) return true; // 与历史语义一致：未传门店时门店价表也参与
        return l.scopeId === storeId;
      })
      .sort((a, b) => Number(b.priority) - Number(a.priority));

    let listPrice = tagPrice;
    const bestList = applicableLists[0] ?? null;
    if (bestList) {
      // 仅对命中优先级最高的价格表取明细，避免 N+1 逐表查询
      const itemConditions = [eq(priceListItem.priceListId, bestList.id)];
      if (targetSku?.id) itemConditions.push(eq(priceListItem.skuId, targetSku.id));
      else if (fallbackStyleNo)
        itemConditions.push(eq(priceListItem.styleNo, fallbackStyleNo));
      const items = await this.db
        .select()
        .from(priceListItem)
        .where(and(...itemConditions))
        .limit(1);
      if (items.length > 0) listPrice = num(items[0].price);
    }

    // 促销叠加：先按 status + 日期范围下推 SQL，再按门店过滤（内存）
    const promoRows = await this.db
      .select()
      .from(promotion)
      .where(
        and(
          eq(promotion.status, CommonStatus.ACTIVE),
          or(isNull(promotion.beginDate), lte(promotion.beginDate, today)),
          or(isNull(promotion.endDate), gte(promotion.endDate, today)),
        ),
      );
    const available: Array<{
      id: string;
      name: string;
      type: string;
      discountAmount: number;
    }> = [];
    let best: { id: string; name: string; type: string; discountAmount: number } | null = null;
    let bestDiscount = 0;

    for (const p of promoRows) {
      const storeIds = (p.storeIds as unknown as string[]) ?? [];
      if (storeIds.length > 0 && storeId && !storeIds.includes(storeId)) continue;

      // 注意：full_reduction 属“整单级”促销，不能按单品价扣减，故仅放入 available 列表，
      // 由结算层 resolveOrderPromotion 在整单维度计算并只应用一次（修复原每单品重复减免的漏洞）。
      if (p.type === PromotionType.FULL_REDUCTION) {
        available.push({
          id: p.id,
          name: p.name,
          type: p.type,
          discountAmount: num(this.money.round2(num(p.reduceAmount))),
        });
        continue;
      }

      let discount = 0;
      if (p.type === PromotionType.PERCENTAGE) {
        discount = listPrice * (1 - num(p.discountRate));
      } else if (p.type === PromotionType.FIXED_PRICE) {
        discount = listPrice - num(p.reduceAmount);
      }
      discount = Math.max(0, discount);
      if (discount <= 0) continue;

      available.push({
        id: p.id,
        name: p.name,
        type: p.type,
        discountAmount: num(this.money.round2(discount)),
      });
      if (discount > bestDiscount) {
        bestDiscount = discount;
        best = {
          id: p.id,
          name: p.name,
          type: p.type,
          discountAmount: num(this.money.round2(discount)),
        };
      }
    }

    const finalPrice = Math.max(0, num(this.money.round2(listPrice - bestDiscount)));

    return {
      skuId: targetSku?.id,
      skuCode: targetSku?.skuCode ?? skuCode,
      styleNo: fallbackStyleNo,
      tagPrice: num(this.money.round2(tagPrice)),
      listPrice: num(this.money.round2(listPrice)),
      finalPrice,
      appliedPromotion: best,
      availablePromotions: available,
    };
  }

  /**
   * 整单级促销解析（满减）。在结算层对“订单应售总额”计算一次，只应用最优的一条满减，
   * 避免 resolvePrice 单品维度重复减免。返回 null 表示无可用满减。
   */
  async resolveOrderPromotion(params: {
    storeId?: string;
    subtotal: number;
  }): Promise<{ id: string; name: string; reduceAmount: number } | null> {
    const { storeId, subtotal } = params;
    const today = todayStr();
    const promoRows = await this.db
      .select()
      .from(promotion)
      .where(
        and(
          eq(promotion.status, CommonStatus.ACTIVE),
          or(isNull(promotion.beginDate), lte(promotion.beginDate, today)),
          or(isNull(promotion.endDate), gte(promotion.endDate, today)),
        ),
      );
    let best: { id: string; name: string; reduceAmount: number } | null = null;
    let bestReduce = 0;
    for (const p of promoRows) {
      if (p.type !== PromotionType.FULL_REDUCTION) continue;
      const storeIds = (p.storeIds as unknown as string[]) ?? [];
      if (storeIds.length > 0 && storeId && !storeIds.includes(storeId)) continue;
      const threshold = num(p.threshold);
      const reduce = num(p.reduceAmount);
      if (subtotal >= threshold && reduce > bestReduce) {
        bestReduce = reduce;
        best = { id: p.id, name: p.name, reduceAmount: reduce };
      }
    }
    return best;
  }

  /* ========== 批量计价（购物车报价） ========== */

  /** 生效中的价格表（status + 日期范围下推 SQL，避免全表扫描）。 */
  /**
   * 失效「生效中的价格表/促销」缓存（按当天维度）。
   *
   * P1-c ①：此前所有价格表/促销的写路径**只有 deletePromotion 调了它**——
   * create/update 价格表、改明细、改促销全部漏失效，导致改完报价仍用旧值（最长 60 秒）。
   * 现已在全部写路径统一调用（见各 create/update/delete 方法）。
   * 任期键带 scope 指纹是多余的：这两张表是全局主数据，不涉及经销商隔离。
   *
   * W2-1 事件总线化：本地同步失效改为 publish('cache.invalidate') 事件，由
   * CacheInvalidationSubscriber 异步执行真正的缓存删除。语义从「同步」变为「秒级异步」，
   * 与内存缓存 TTL(60s) 预期一致，且把「写路径里的跨模块副作用」解耦到事件总线。
   * publish 失败（如 DB 抖动）只记日志、不阻断业务写路径（缓存失效降级为下次 TTL 自然过期）。
   */
  private async invalidateActiveCache() {
    const today = todayStr();
    await this.eventBus
      .publish({
        aggregateType: 'pricing',
        aggregateId: 'active',
        eventType: 'cache.invalidate',
        payload: {
          keys: [`pricing:activeLists:${today}`, `pricing:activePromos:${today}`],
        },
      })
      .catch((e) => this.logger.error('发布缓存失效事件失败（不影响业务写路径）', e));
  }

  /** 计价参考数据（价格表/促销）的读穿缓存：key + producer，TTL 取 reference。 */
  private readonly withCache = <T>(key: string, producer: () => Promise<T>): Promise<T> =>
    readThrough<T>(this.cacheManager, key, CACHE_TTL.reference, producer);

  private async fetchActivePriceLists(today: string) {
    const key = `pricing:activeLists:${today}`;
    return this.withCache(key, () =>
      this.db
        .select()
        .from(priceList)
        .where(
          and(
            eq(priceList.status, CommonStatus.ACTIVE),
            or(isNull(priceList.effectiveFrom), lte(priceList.effectiveFrom, today)),
            or(isNull(priceList.effectiveTo), gte(priceList.effectiveTo, today)),
          ),
        )
        .orderBy(desc(priceList.priority)),
    );
  }

  /** 生效中的促销活动。 */
  private async fetchActivePromotions(today: string) {
    const key = `pricing:activePromos:${today}`;
    return this.withCache(key, () =>
      this.db
        .select()
        .from(promotion)
        .where(
          and(
            eq(promotion.status, CommonStatus.ACTIVE),
            or(isNull(promotion.beginDate), lte(promotion.beginDate, today)),
            or(isNull(promotion.endDate), gte(promotion.endDate, today)),
          ),
        ),
    );
  }

  /** 取命中门店/日期的优先级最高价格表。 */
  private pickBestList(
    lists: Array<{ id: string; type: string; scopeId?: string | null; priority?: number | null }>,
    storeId?: string,
  ) {
    return (
      lists
        .filter((l) => {
          if (l.type !== PriceListType.STORE) return true;
          if (!storeId) return true;
          return l.scopeId === storeId;
        })
        .sort((a, b) => Number(b.priority) - Number(a.priority))[0] ?? null
    );
  }

  /** 按门店过滤促销（storeIds 为空表示全门店适用）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private filterStorePromos(promos: any[], storeId?: string) {
    return promos.filter((p) => {
      const storeIds = (p.storeIds as unknown as string[]) ?? [];
      if (storeIds.length > 0 && storeId && !storeIds.includes(storeId)) return false;
      return true;
    });
  }

  /** 单品级促销（percentage / fixed_price）计算，返回最终售价与可用促销。full_reduction 仅入列表不扣减。 */
  private computeItemPromo(
    listPrice: number,
    promos: Array<{ id: string; name: string; type: string; discountRate?: unknown; reduceAmount?: unknown }>,
  ) {
    const available: Array<{ id: string; name: string; type: string; discountAmount: number }> = [];
    let best: { id: string; name: string; type: string; discountAmount: number } | null = null;
    let bestDiscount = 0;
    for (const p of promos) {
      if (p.type === PromotionType.FULL_REDUCTION) {
        available.push({
          id: p.id,
          name: p.name,
          type: p.type,
          discountAmount: num(this.money.round2(num(p.reduceAmount))),
        });
        continue;
      }
      let discount = 0;
      if (p.type === PromotionType.PERCENTAGE) discount = listPrice * (1 - num(p.discountRate));
      else if (p.type === PromotionType.FIXED_PRICE) discount = listPrice - num(p.reduceAmount);
      discount = Math.max(0, discount);
      if (discount <= 0) continue;
      available.push({
        id: p.id,
        name: p.name,
        type: p.type,
        discountAmount: num(this.money.round2(discount)),
      });
      if (discount > bestDiscount) {
        bestDiscount = discount;
        best = { id: p.id, name: p.name, type: p.type, discountAmount: num(this.money.round2(discount)) };
      }
    }
    return {
      finalPrice: Math.max(0, num(this.money.round2(listPrice - bestDiscount))),
      appliedPromotion: best,
      availablePromotions: available,
    };
  }

  /**
   * 购物车批量报价：一次性查询价格表/促销/商品/明细，返回每行售价 + 整单级满减 + 应付金额。
   * 供 POS 结算与前端展示共用，保证“展示的优惠”与“实际结算”完全一致，并消除逐行 N+1。
   */
  async quote(params: {
    storeId?: string;
    items: Array<{ skuId?: string; skuCode?: string; quantity: number }>;
  }): Promise<PosQuoteResult> {
    const { storeId, items } = params;
    if (!items || items.length === 0) throw new BadRequestException('购物车不能为空');

    const today = todayStr();
    const lists = await this.fetchActivePriceLists(today);
    const promos = await this.fetchActivePromotions(today);
    const storePromos = this.filterStorePromos(promos, storeId);
    const bestList = this.pickBestList(lists as any, storeId);

    // 批量取商品（按 id 或 code）
    const skuIds = items.filter((i) => i.skuId).map((i) => i.skuId as string);
    const skuCodes = items.filter((i) => !i.skuId && i.skuCode).map((i) => i.skuCode as string);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(
        skuIds.length && skuCodes.length
          ? or(inArray(sku.id, skuIds), inArray(sku.skuCode, skuCodes))
          : skuIds.length
            ? inArray(sku.id, skuIds)
            : inArray(sku.skuCode, skuCodes),
      );
    const skuByKey = new Map<string, (typeof skuRows)[number]>();
    for (const s of skuRows) {
      skuByKey.set('id:' + s.id, s);
      skuByKey.set('code:' + s.skuCode, s);
    }

    // 批量取命中价格表明细（一次查询覆盖所有商品）
    const pliMap = new Map<string, number>();
    if (bestList && skuRows.length > 0) {
      const ids = skuRows.map((s) => s.id);
      const styleVals = skuRows.map((s) => s.styleNo).filter((v): v is string => !!v);
      const conditions = [eq(priceListItem.priceListId, (bestList as any).id)];
      const orConds = [inArray(priceListItem.skuId, ids)];
      if (styleVals.length) orConds.push(inArray(priceListItem.styleNo, styleVals));
      conditions.push(or(...orConds));
      const rows = await this.db.select().from(priceListItem).where(and(...conditions));
      for (const r of rows) {
        if (r.skuId) pliMap.set('sku:' + r.skuId, num(r.price));
        if (r.styleNo) pliMap.set('style:' + r.styleNo, num(r.price));
      }
    }

    const quoteItems: PosQuoteLineItem[] = [];
    let subtotal = 0;
    for (const it of items) {
      const sku = it.skuId ? skuByKey.get('id:' + it.skuId) : skuByKey.get('code:' + it.skuCode);
      if (!sku) throw new BadRequestException(`商品不存在: ${it.skuId || it.skuCode}`);
      const tagPrice = num(sku.tagPrice);
      const listPrice =
        pliMap.get('sku:' + sku.id) ??
        (sku.styleNo ? pliMap.get('style:' + sku.styleNo) : undefined) ??
        tagPrice;
      const { finalPrice, appliedPromotion, availablePromotions } = this.computeItemPromo(
        listPrice,
        storePromos as any,
      );
      const qty = Number(it.quantity) || 1;
      const lineAmount = num(this.money.round2(finalPrice * qty));
      subtotal += lineAmount;
      quoteItems.push({
        skuId: sku.id,
        skuCode: sku.skuCode,
        styleNo: sku.styleNo,
        tagPrice: num(this.money.round2(tagPrice)),
        listPrice: num(this.money.round2(listPrice)),
        finalPrice,
        quantity: qty,
        lineAmount,
        appliedPromotion,
        availablePromotions,
      });
    }

    // 整单级满减（仅取最优一条，整单只应用一次）
    let orderPromotion: { id: string; name: string; reduceAmount: number } | null = null;
    let bestReduce = 0;
    for (const p of storePromos) {
      if (p.type !== PromotionType.FULL_REDUCTION) continue;
      const threshold = num((p as any).threshold);
      const reduce = num((p as any).reduceAmount);
      if (subtotal >= threshold && reduce > bestReduce) {
        bestReduce = reduce;
        orderPromotion = { id: p.id, name: p.name, reduceAmount: reduce };
      }
    }
    const discountAmount = orderPromotion ? Math.min(bestReduce, subtotal) : 0;
    const payable = Math.max(0, num(this.money.round2(subtotal - discountAmount)));

    return {
      items: quoteItems,
      subtotal: num(this.money.round2(subtotal)),
      orderPromotion,
      discountAmount: num(this.money.round2(discountAmount)),
      payable,
    };
  }
}

export interface PosQuoteLineItem {
  skuId: string;
  skuCode: string;
  styleNo?: string;
  tagPrice: number;
  listPrice: number;
  finalPrice: number;
  quantity: number;
  lineAmount: number;
  appliedPromotion: { id: string; name: string; type: string; discountAmount: number } | null;
  availablePromotions: Array<{ id: string; name: string; type: string; discountAmount: number }>;
}

export interface PosQuoteResult {
  items: PosQuoteLineItem[];
  subtotal: number;
  orderPromotion: { id: string; name: string; reduceAmount: number } | null;
  discountAmount: number;
  payable: number;
}
