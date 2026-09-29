import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  store,
  sku,
  retailOrder,
  retailOrderItem,
  inventoryStock,
  warehouse,
  customer,
  salesOrder,
  salesOrderItem,
  inventoryTransfer,
  inventoryTransferItem,
  replenishPlan,
  replenishPlanItem,
} from '@server/database/schema';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { AnalyticsService } from '../../analytics/analytics.service';
import { round2, round3 } from '../../../common/utils/money';

export interface ReplenishCalcItem {
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  recentSalesQty: number;
  dailyAvg: number;
  /** P2-2：启用预测时，用于毛需求的需求速率（= dailyAvg × 预测系数，夹紧后）。 */
  effectiveDaily: number;
  /** P2-2：预测综合系数（趋势+季节），未启用或预测源为空时为 1。 */
  forecastAdj: number;
  currentStock: number;
  inTransitQty: number;
  safetyStock: number;
  suggestedRaw: number;
  suggestedQty: number;
}

export interface ReplenishCalcParams {
  storeId: string;
  n: number;
  expectedDays: number;
  leadTimeDays?: number;
  safetyDays?: number;
  caseQty?: number;
  skuFilter?: string[];
  /**
   * P2-2：是否接入 analytics.forecast 趋势+季节指数替代常数预计天数。
   * 启用后，以门店自有零售日销为基准，乘以预测综合系数（nextMonthNeed/avgMonthly），
   * 把"趋势上行/季节高峰"注入毛需求，避免恒定量外推。预测源（sales_outbound）无历史时
   * 自动降级为 1（不调整）。
   */
  useForecast?: boolean;
}

/** 销量数据时效告警阈值（天）：最新销售数据距今天数超过该值即视为时效不足。 */
const FRESHNESS_THRESHOLD_DAYS = 3;

/** P2-2：预测综合系数夹紧区间，防止单月异常把建议量放大/缩小到离谱。 */
const FORECAST_ADJ_MIN = 0.5;
const FORECAST_ADJ_MAX = 2.0;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * calc 的富返回结构。
 * - items：逐 SKU 的建议补货量明细。
 * - dataAsOf：销量数据来源的“最新销售日期”，用于前端展示“数据截至时间”。
 * - daysStale：今天 − dataAsOf（天）。
 * - freshnessAlert：daysStale 超过阈值，提示下游慎用建议量。
 * - salesStoreCount：近 N 天有有效销量的门店数（全公司覆盖度）。
 */
export interface ReplenishCalcResult {
  items: ReplenishCalcItem[];
  dataAsOf: string | null;
  daysStale: number | null;
  freshnessAlert: boolean;
  salesStoreCount: number;
}

export interface ReplenishGenerateResult {
  planNo: string;
  docType: 'sales_order' | 'transfer';
  docNo: string;
  docId: string;
  itemCount: number;
}

/**
 * 补货管理（下游渠道铺货）。
 * - calc：基于门店近 N 天零售销量（retail_order）与当前库存（inventory_stock），
 *   按增强版重订货点公式给出建议补货量。
 * - generate：按门店类型分支生成草稿单据——
 *     franchise（经销商）→ sales_order（销售订单，草稿）；
 *     direct（直营店）→ inventory_transfer（调拨单，草稿，主仓→门店仓）。
 *   生成的单据均 raw 插入（status='draft'），并写 replenish_plan / replenish_plan_item 追溯。
 */
@Injectable()
export class ReplenishPlanService {
  private readonly logger = new Logger(ReplenishPlanService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly analytics: AnalyticsService,
  ) {}

  /**
   * 计算建议补货量。
   * 公式（增强版）：dailyAvg = 近N天销量 / N；
   *   safety = dailyAvg × safetyDays；
   *   target = dailyAvg × (leadTimeDays + expectedDays) + safety；
   *   raw = target − 当前库存 − 在途；
   *   suggestedQty = raw<=0 ? 0 : ceil(raw / caseQty) × caseQty。
   * 当 leadTimeDays=safetyDays=0 时退化为基础版：日均×预计天数 − 库存（含在途）。
   */
  async calc(params: ReplenishCalcParams): Promise<ReplenishCalcResult> {
    const {
      storeId,
      n,
      expectedDays,
      leadTimeDays = 0,
      safetyDays = 0,
      caseQty = 1,
      skuFilter,
      useForecast = false,
    } = params;
    if (n <= 0) throw new BadRequestException('近N天参数必须大于0');
    if (expectedDays <= 0) throw new BadRequestException('预计销售天数必须大于0');
    if (caseQty <= 0) throw new BadRequestException('箱规/起订量必须大于0');

    const storeRow = await this.db
      .select()
      .from(store)
      .where(eq(store.id, storeId))
      .limit(1);
    if (!storeRow.length) throw new NotFoundException('门店不存在');
    const s = storeRow[0];
    const whId = s.warehouseId;
    if (!whId) throw new BadRequestException('该门店未关联仓库，无法取库存');

    // 销量数据时效快照（公司级，单次聚合，避免 N+1）：
    // 取近 N 天有效销量的最新销售日期与覆盖门店数，供前端“数据截至时间”展示与时效告警。
    const windowCond = and(
      inArray(retailOrder.status, ['settled', 'returned']),
      sql`${retailOrder.saleDate} >= (current_date - ${n}::int)`,
    );
    const [maxDateRows, storeCountRows] = await Promise.all([
      this.db.select({ d: sql`MAX(${retailOrder.saleDate})` }).from(retailOrder).where(windowCond),
      this.db.select({ c: sql`COUNT(DISTINCT ${retailOrder.storeId})` }).from(retailOrder).where(windowCond),
    ]);
    const dataAsOfRaw = maxDateRows[0]?.d;
    const dataAsOf = dataAsOfRaw ? String(dataAsOfRaw) : null;
    const daysStale = dataAsOf
      ? Math.floor((Date.now() - new Date(dataAsOf).getTime()) / 86_400_000)
      : null;
    const freshnessAlert = daysStale != null && daysStale > FRESHNESS_THRESHOLD_DAYS;
    const salesStoreCount = Number(storeCountRows[0]?.c ?? 0);

    // 近 N 天销量（按门店，有效状态 settled/returned）
    const salesRows = await this.db
      .select({
        skuId: retailOrderItem.skuId,
        qty: sql`SUM(${retailOrderItem.quantity})`,
      })
      .from(retailOrderItem)
      .innerJoin(retailOrder, eq(retailOrderItem.retailId, retailOrder.id))
      .where(
        and(
          eq(retailOrder.storeId, storeId),
          sql`${retailOrder.saleDate} >= (current_date - ${n}::int)`,
          inArray(retailOrder.status, ['settled', 'returned']),
        ),
      )
      .groupBy(retailOrderItem.skuId);
    const salesMap = new Map<string, number>();
    for (const r of salesRows) salesMap.set(r.skuId, Number(r.qty));

    // 当前库存（按门店仓）
    const stockRows = await this.db
      .select()
      .from(inventoryStock)
      .where(eq(inventoryStock.warehouseId, whId));
    const stockMap = new Map<string, (typeof inventoryStock.$inferSelect)>();
    for (const r of stockRows) stockMap.set(r.skuId, r);

    // 候选 SKU：有销量 或 有库存（或显式筛选）
    const skuIds = new Set<string>([
      ...salesMap.keys(),
      ...stockMap.keys(),
    ]);
    if (skuFilter && skuFilter.length) for (const id of skuFilter) skuIds.add(id);

    // P2-2：预测综合系数（趋势+季节）。单次批量查询，避免逐 SKU N+1。
    const forecastAdjMap = new Map<string, number>();
    if (useForecast && skuIds.size) {
      const batch = await this.analytics.forecastBatch([...skuIds]);
      for (const b of batch) forecastAdjMap.set(b.skuId, b.adjustment);
      const adjusted = batch.filter((b) => b.adjustment !== 1).length;
      this.logger.log(
        `[replenish] useForecast: batch ${skuIds.size} skus, ${adjusted} with trend/seasonal adj != 1`,
      );
    }

    const skuRows = skuIds.size
      ? await this.db.select().from(sku).where(inArray(sku.id, [...skuIds]))
      : [];
    const skuMap = new Map<string, (typeof sku.$inferSelect)>();
    for (const r of skuRows) skuMap.set(r.id, r);

    const items: ReplenishCalcItem[] = [];
    for (const id of skuIds) {
      const srow = skuMap.get(id);
      if (!srow) continue; // 跳过来历不明（无主数据）的 SKU
      const recentSalesQty = salesMap.get(id) ?? 0;
      const stock = stockMap.get(id);
      const currentStock = stock ? Number(stock.quantity) : 0;
      const inTransitQty = stock ? Number(stock.inTransitQty ?? 0) : 0;
      const dailyAvg = recentSalesQty / n;
      // P2-2：预测综合系数（趋势+季节），夹紧防极端；未启用或预测源为空=1。
      const rawAdj = forecastAdjMap.get(id) ?? 1;
      const forecastAdj = useForecast ? clamp(rawAdj, FORECAST_ADJ_MIN, FORECAST_ADJ_MAX) : 1;
      const effectiveDaily = dailyAvg * forecastAdj;
      const safetyStock = effectiveDaily * safetyDays;
      const grossNeed = effectiveDaily * (leadTimeDays + expectedDays);
      const target = grossNeed + safetyStock;
      const raw = target - currentStock - inTransitQty;
      const suggestedQty = raw <= 0 ? 0 : Math.ceil(raw / caseQty) * caseQty;
      items.push({
        skuId: id,
        skuCode: srow.skuCode,
        styleNo: srow.styleNo,
        color: srow.color,
        size: srow.size,
        recentSalesQty: Number(round3(recentSalesQty)),
        dailyAvg: Number(round3(dailyAvg)),
        effectiveDaily: Number(round3(effectiveDaily)),
        forecastAdj: Number(round3(forecastAdj)),
        currentStock,
        inTransitQty,
        safetyStock: Number(round3(safetyStock)),
        suggestedRaw: Number(round3(raw)),
        suggestedQty,
      });
    }
    items.sort((a, b) => b.suggestedQty - a.suggestedQty);
    return {
      items,
      dataAsOf,
      daysStale,
      freshnessAlert,
      salesStoreCount,
    };
  }

  /** 主仓解析：优先取 store_type IS NULL 的中央仓，否则取任意仓库第一条。 */
  private async resolveMainWarehouse(): Promise<{ id: string; name: string }> {
    const central = await this.db
      .select()
      .from(warehouse)
      .where(sql`${warehouse.storeType} IS NULL`)
      .orderBy(warehouse.createdAt)
      .limit(1);
    if (central.length) return { id: central[0].id, name: central[0].name };
    const any = await this.db
      .select()
      .from(warehouse)
      .orderBy(warehouse.createdAt)
      .limit(1);
    if (!any.length) throw new BadRequestException('系统中不存在仓库，无法生成单据');
    return { id: any[0].id, name: any[0].name };
  }

  async generate(dto: {
    storeId: string;
    items: { skuId: string; suggestedQty: number }[];
    sourceWarehouseId?: string;
    remark?: string;
    templateId?: string;
  }): Promise<ReplenishGenerateResult> {
    const validItems = (dto.items ?? []).filter((it) => Number(it.suggestedQty) > 0);
    if (!validItems.length)
      throw new BadRequestException('没有需要补货的明细（建议量均<=0）');

    const storeRow = await this.db
      .select()
      .from(store)
      .where(eq(store.id, dto.storeId))
      .limit(1);
    if (!storeRow.length) throw new NotFoundException('门店不存在');
    const s = storeRow[0];

    const srcWhId = dto.sourceWarehouseId ?? (await this.resolveMainWarehouse()).id;
    const srcWh = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, srcWhId))
      .limit(1);
    if (!srcWh.length) throw new BadRequestException('发货仓不存在');
    const src = srcWh[0];

    const skuIds = [...new Set(validItems.map((it) => it.skuId))];
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, (typeof sku.$inferSelect)>();
    for (const r of skuRows) skuMap.set(r.id, r);
    for (const it of validItems)
      if (!skuMap.has(it.skuId)) throw new BadRequestException(`SKU不存在: ${it.skuId}`);

    const today = new Date().toISOString().slice(0, 10);
    const datePart = today.replace(/-/g, '');

    return this.db.transaction(async (tx) => {
      let docType: 'sales_order' | 'transfer';
      let docNo = '';
      let docId = '';

      if (s.storeType === 'franchise') {
        docType = 'sales_order';
        if (!s.dealerId)
          throw new BadRequestException('该加盟店未关联经销商，无法生成销售单');
        const cust = await tx
          .select()
          .from(customer)
          .where(eq(customer.partnerId, s.dealerId))
          .limit(1);
        if (!cust.length)
          throw new BadRequestException('该经销商未关联客户档案，无法生成销售单');
        const orderNo = await this.numberGenerator.generateNextNo(
          tx,
          salesOrder,
          salesOrder.orderNo,
          `RO${datePart}`,
          4,
        );
        const inserted = await tx
          .insert(salesOrder)
          .values({
            orderNo,
            customerId: cust[0].id,
            customerName: cust[0].name,
            orderDate: today,
            totalAmount: '0',
            status: 'draft',
            remark: dto.remark || '补货管理自动生成（经销商销售单）',
          })
          .returning();
        docId = inserted[0].id;
        docNo = orderNo;
        let total = 0;
        const itemVals = validItems.map((it) => {
          const sk = skuMap.get(it.skuId)!;
          const price = Number(sk.supplyPrice ?? 0);
          const amt = price * Number(it.suggestedQty);
          total += amt;
          return {
            orderId: docId,
            skuId: sk.id,
            skuCode: sk.skuCode,
            styleNo: sk.styleNo,
            color: sk.color,
            size: sk.size,
            quantity: round3(Number(it.suggestedQty)),
            price: round2(price),
            amount: round2(amt),
            deliveredQty: '0',
          };
        });
        await tx.insert(salesOrderItem).values(itemVals);
        await tx
          .update(salesOrder)
          .set({ totalAmount: round2(total) })
          .where(eq(salesOrder.id, docId));
      } else if (s.storeType === 'direct') {
        docType = 'transfer';
        if (!s.warehouseId)
          throw new BadRequestException('该直营店未关联仓库，无法生成调拨单');
        const destWh = await tx
          .select()
          .from(warehouse)
          .where(eq(warehouse.id, s.warehouseId))
          .limit(1);
        if (!destWh.length) throw new BadRequestException('门店仓库不存在');
        const transferNo = await this.numberGenerator.generateNextNo(
          tx,
          inventoryTransfer,
          inventoryTransfer.transferNo,
          `RT${datePart}`,
          4,
        );
        const inserted = await tx
          .insert(inventoryTransfer)
          .values({
            transferNo,
            fromWarehouseId: src.id,
            fromWarehouseName: src.name,
            toWarehouseId: destWh[0].id,
            toWarehouseName: destWh[0].name,
            transferDate: today,
            itemType: 'sku',
            status: 'draft',
            remark: dto.remark || '补货管理自动生成（直营店调拨单）',
          })
          .returning();
        docId = inserted[0].id;
        docNo = transferNo;
        const itemVals = validItems.map((it) => {
          const sk = skuMap.get(it.skuId)!;
          return {
            transferId: docId,
            skuId: sk.id,
            itemCode: sk.skuCode,
            itemName: `${sk.styleNo} ${sk.color} ${sk.size}`,
            color: sk.color,
            size: sk.size,
            quantity: round3(Number(it.suggestedQty)),
          };
        });
        await tx.insert(inventoryTransferItem).values(itemVals);
      } else {
        throw new BadRequestException(`不支持的门店类型: ${s.storeType}`);
      }

      // 写入补货计划头 + 明细（追溯）
      const planNo = await this.numberGenerator.generateNextNo(
        tx,
        replenishPlan,
        replenishPlan.planNo,
        `RP${datePart}`,
        4,
      );
      const planInserted = await tx
        .insert(replenishPlan)
        .values({
          planNo,
          templateId: dto.templateId ?? null,
          storeId: s.id,
          storeType: s.storeType,
          storeName: s.name,
          docType,
          status: 'draft',
          calcSnapshot: { generatedAt: new Date().toISOString(), docNo, docType },
          remark: dto.remark || '',
        })
        .returning();
      const planId = planInserted[0].id;
      await tx.insert(replenishPlanItem).values(
        validItems.map((it) => {
          const sk = skuMap.get(it.skuId)!;
          return {
            planId,
            skuId: sk.id,
            skuCode: sk.skuCode,
            styleNo: sk.styleNo,
            color: sk.color,
            size: sk.size,
            suggestedQty: round3(Number(it.suggestedQty)),
            generatedDocId: docId,
            generatedDocNo: docNo,
          };
        }),
      );

      return {
        planNo,
        docType,
        docNo,
        docId,
        itemCount: validItems.length,
      } as ReplenishGenerateResult;
    });
  }

  /** 补货计划列表（查询/追溯）。 */
  async list(params: { page?: number; pageSize?: number; storeId?: string }) {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const conditions: any[] = [];
    if (params.storeId) conditions.push(eq(replenishPlan.storeId, params.storeId));
    const where = conditions.length ? and(...conditions) : undefined;

    const [totalRows, rows] = await Promise.all([
      this.db.select({ c: count() }).from(replenishPlan).where(where),
      this.db
        .select()
        .from(replenishPlan)
        .where(where)
        .orderBy(desc(replenishPlan.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    return { total: Number(totalRows[0]?.c ?? 0), list: rows };
  }
}
