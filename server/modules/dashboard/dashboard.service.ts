import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, desc, count, sum, gt, gte, lt, and, isNull, type SQL } from 'drizzle-orm';
import {
  salesOutbound,
  salesOutboundItem,
  inventoryStock,
  sku,
  purchaseOrder,
  salesOrder,
  purchaseInbound,
  style,
  retailOrder,
  retailReturn,
} from '@server/database/schema';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { TTL, cacheKey, cached } from '@server/common/cache';
import {
  DEFAULT_REPORT_WINDOW_DAYS,
  resolveReportWindow,
  type ReportWindow,
} from '@server/common/report-window';
import type {
  DashboardStats,
  SalesTrendItem,
  TopStyleItem,
  InventoryWarningItem,
} from '@shared/api.interface';

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * 看板聚合缓存。
   *
   * 这 4 个接口每次页面加载都会打 PG 聚合（9 条并发聚合 + 3 张表的 join 分页），
   * 是 ERP 内页跳看板最典型的"卡 2 秒"来源。缓存 30 秒，并**把经销商作用域写进 key**
   * （见 common/cache.ts）：否则超管先访问会把全量结果写进缓存，受限用户命中同一键
   * 即构成跨租户数据泄露。
   *
   * 新鲜度取舍：KPI 允许 30 秒延迟。单据写入不主动失效看板键——失效点太多，
   * 收益不抵复杂度；30 秒自过期已覆盖绝大多数"页面刷新看不到最新数"的抱怨。
   */
  private readonly dashKey = {
    stats: () => cacheKey('dash', 'stats', formatDate(new Date())),
    trend: (days: number, start: string) => cacheKey('dash', 'trend', days, start),
    // P1-c④：畅销款 TOP 引入时间窗后，窗口天数必须进缓存 key，
    // 否则传 days=90 与 days=365 会互相命中，返回错误的口径数据。
    topStyles: (limit: number, days: number) => cacheKey('dash', 'topStyles', limit, days),
    warnings: (limit: number) => cacheKey('dash', 'warnings', limit),
  };

  async getStats(): Promise<DashboardStats> {
    return cached<DashboardStats>(
      this.cacheManager,
      this.dashKey.stats(),
      TTL.dashboard,
      () => this.computeStats(),
    );
  }

  async getSalesTrend(days = 30): Promise<SalesTrendItem[]> {
    const computed = await cached<SalesTrendItem[]>(
      this.cacheManager,
      this.dashKey.trend(days, formatDate(new Date(Date.now() - (days - 1) * 86400000))),
      TTL.dashboard,
      () => this.computeSalesTrend(days),
    );
    return computed;
  }

  /**
   * 畅销款 TOP。
   *
   * P1-c④：此前是全历史聚合（只按 status 过滤，无时间下界）——数据量一大就是
   * 全量 group-by 后再 ORDER BY 截断，看板首屏最容易卡住的查询之一。
   * 现在改为按时间窗聚合，默认最近 90 天；`days` 由前端显式传入，口径透明。
   */
  async getTopStyles(limit = 10, days = DEFAULT_REPORT_WINDOW_DAYS): Promise<TopStyleItem[]> {
    const win = resolveReportWindow({ windowDays: days }, this.logger);
    return cached<TopStyleItem[]>(
      this.cacheManager,
      this.dashKey.topStyles(limit, days),
      TTL.dashboard,
      () => this.computeTopStyles(limit, win),
    );
  }

  async getWarnings(limit = 10): Promise<InventoryWarningItem[]> {
    return cached<InventoryWarningItem[]>(
      this.cacheManager,
      this.dashKey.warnings(limit),
      TTL.dashboard,
      () => this.computeWarnings(limit),
    );
  }

  private async computeStats(): Promise<DashboardStats> {
    const today = formatDate(new Date());
    const todayIso = today;

    // 经销商作用域：受限用户仅可见本经销商的经营/财务数据，避免跨租户 KPI 泄露
    const salesScope = buildAggregationScope('sales');
    const purchaseScope = buildAggregationScope('purchase');
    const inventoryScope = buildAggregationScope('inventory');
    const retailScope = buildAggregationScope('retail');
    const sc = (w: SQL, s?: SQL): SQL => (s ? and(w, s) : w);

    // 今日销售出库金额合计 + 出库单数量（approved 状态）
    const [todaySalesResult, todayCountResult, skuCountResult, poPendingResult, soPendingResult, inboundDraftResult, outboundDraftResult, todayRetailResult, todayRetailReturnResult] = await Promise.all([
      this.db
        .select({ total: sum(salesOutbound.totalAmount) })
        .from(salesOutbound)
        .where(sc(sql`${salesOutbound.outboundDate} = ${todayIso} AND ${salesOutbound.status} IN ('booked', 'accepted')`, salesScope)),
      this.db
        .select({ count: count() })
        .from(salesOutbound)
        .where(sc(sql`${salesOutbound.outboundDate} = ${todayIso} AND ${salesOutbound.status} IN ('booked', 'accepted')`, salesScope)),
      // 库存 SKU 总数：inventory_stock 中 quantity > 0 的记录数
      this.db
        .select({ count: count() })
        .from(inventoryStock)
        .where(sc(gt(inventoryStock.quantity, '0'), inventoryScope)),
      // 采购订单 pending
      // 注意：订单已改为软删（0016），这里必须一并排除 _deleted_at IS NOT NULL，
      // 否则被删除的草稿单仍会被计入"待处理"数字，看板口径虚高。
      this.db
        .select({ count: count() })
        .from(purchaseOrder)
        .where(
          and(
            sql`${purchaseOrder.status} IN ('draft', 'audited')`,
            isNull(purchaseOrder.deletedAt),
            purchaseScope,
          ),
        ),
      // 销售订单 pending
      this.db
        .select({ count: count() })
        .from(salesOrder)
        .where(
          and(
            sql`${salesOrder.status} IN ('draft', 'audited')`,
            isNull(salesOrder.deletedAt),
            salesScope,
          ),
        ),
      // 入库单 draft
      this.db
        .select({ count: count() })
        .from(purchaseInbound)
        .where(sc(eq(purchaseInbound.status, 'draft'), purchaseScope)),
      // 出库单 draft
      this.db
        .select({ count: count() })
        .from(salesOutbound)
        .where(sc(eq(salesOutbound.status, 'draft'), salesScope)),
      // 今日零售（已结算+已退货状态 - 已退货金额 = 净额）
      this.db
        .select({ total: sum(retailOrder.receivableAmount) })
        .from(retailOrder)
        .where(sc(sql`${retailOrder.saleDate} = ${todayIso} AND ${retailOrder.status} IN ('settled','returned')`, retailScope)),
      // 今日零售退货
      this.db
        .select({ total: sum(retailReturn.totalAmount) })
        .from(retailReturn)
        .where(sc(sql`${retailReturn.returnDate} = ${todayIso} AND ${retailReturn.status} = 'refunded'`, retailScope)),
    ]);

    const todaySales = Number(todaySalesResult[0]?.total ?? 0);
    const todayRetailGross = Number(todayRetailResult[0]?.total ?? 0);
    const todayRetailReturn = Number(todayRetailReturnResult[0]?.total ?? 0);
    const todayRetail = Math.round((todayRetailGross - todayRetailReturn) * 100) / 100;
    const todayOutboundCount = Number(todayCountResult[0]?.count ?? 0);
    const totalSkuCount = Number(skuCountResult[0]?.count ?? 0);
    const pendingDocCount =
      Number(poPendingResult[0]?.count ?? 0) +
      Number(soPendingResult[0]?.count ?? 0) +
      Number(inboundDraftResult[0]?.count ?? 0) +
      Number(outboundDraftResult[0]?.count ?? 0);

    return {
      todaySales: Math.round(todaySales * 100) / 100,
      todayRetail,
      todayOutboundCount,
      totalSkuCount,
      pendingDocCount,
    };
  }

  private async computeSalesTrend(days: number): Promise<SalesTrendItem[]> {
    // 计算近N天的日期范围
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days + 1);
    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    const salesScope = buildAggregationScope('sales');

    const result = await this.db
      .select({
        date: salesOutbound.outboundDate,
        amount: sum(salesOutbound.totalAmount),
      })
      .from(salesOutbound)
      .where(
        salesScope
          ? and(sql`${salesOutbound.outboundDate} >= ${startStr} AND ${salesOutbound.outboundDate} <= ${endStr} AND ${salesOutbound.status} IN ('booked', 'accepted')`, salesScope)
          : sql`${salesOutbound.outboundDate} >= ${startStr} AND ${salesOutbound.outboundDate} <= ${endStr} AND ${salesOutbound.status} IN ('booked', 'accepted')`,
      )
      .groupBy(salesOutbound.outboundDate)
      .orderBy(salesOutbound.outboundDate);

    // 构建日期映射
    const dataMap = new Map<string, number>();
    for (const row of result) {
      dataMap.set(row.date, Number(row.amount ?? 0));
    }

    // 生成近N天数据，无数据填充0
    const items: SalesTrendItem[] = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = formatDate(d);
      items.push({
        date: dateStr,
        amount: Math.round((dataMap.get(dateStr) ?? 0) * 100) / 100,
      });
    }

    return items;
  }

  private async computeTopStyles(
    limit: number,
    win?: ReportWindow,
  ): Promise<TopStyleItem[]> {
    // 按款号汇总销售出库数量和金额，从 sales_outbound_item 联查 style 表获取款名
    const salesScope = buildAggregationScope('sales');
    const statusCond = sql`${salesOutbound.status} IN ('booked', 'accepted')`;
    // P1-c④ 时间下界：无界时这条聚合要扫全部出库明细再排序截断
    const rangeCond = win
      ? and(
          gte(salesOutbound.outboundDate, win.start),
          lt(salesOutbound.outboundDate, win.endExclusive),
        )
      : undefined;
    const result = await this.db
      .select({
        styleNo: salesOutboundItem.styleNo,
        name: style.name,
        quantity: sum(salesOutboundItem.quantity),
        amount: sum(salesOutboundItem.amount),
      })
      .from(salesOutboundItem)
      .innerJoin(
        salesOutbound,
        eq(salesOutboundItem.outboundId, salesOutbound.id),
      )
      .leftJoin(style, eq(salesOutboundItem.styleNo, style.styleNo))
      .where(
        and(...[statusCond, rangeCond, salesScope].filter((c): c is SQL => Boolean(c))),
      )
      .groupBy(salesOutboundItem.styleNo, style.name)
      .orderBy(desc(sql`sum(${salesOutboundItem.quantity})`))
      .limit(limit);

    return result.map((row) => ({
      styleNo: row.styleNo,
      name: row.name ?? '',
      quantity: Number(row.quantity ?? 0),
      amount: Math.round(Number(row.amount ?? 0) * 100) / 100,
    }));
  }

  private async computeWarnings(limit: number): Promise<InventoryWarningItem[]> {
    // 低于安全库存下限的 SKU
    const inventoryScope = buildAggregationScope('inventory');
    const result = await this.db
      .select({
        skuCode: inventoryStock.skuCode,
        styleNo: inventoryStock.styleNo,
        color: inventoryStock.color,
        size: inventoryStock.size,
        warehouseName: inventoryStock.warehouseName,
        quantity: inventoryStock.quantity,
        safetyMin: sku.safetyStockMin,
        safetyMax: sku.safetyStockMax,
      })
      .from(inventoryStock)
      .innerJoin(sku, eq(inventoryStock.skuId, sku.id))
      .where(
        inventoryScope
          ? and(sql`${inventoryStock.quantity} < ${sku.safetyStockMin}`, inventoryScope)
          : sql`${inventoryStock.quantity} < ${sku.safetyStockMin}`,
      )
      .orderBy(sql`${inventoryStock.quantity} - ${sku.safetyStockMin}`)
      .limit(limit);

    return result.map((row) => ({
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      warehouseName: row.warehouseName,
      quantity: Number(row.quantity),
      safetyMin: Number(row.safetyMin),
      safetyMax: Number(row.safetyMax),
      warningType: 'below_min' as const,
    }));
  }
}
