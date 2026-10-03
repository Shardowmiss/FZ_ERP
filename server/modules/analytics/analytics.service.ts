import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, eq, desc, and, inArray, type SQL } from 'drizzle-orm';
import {
  salesOutbound,
  salesOutboundItem,
  style,
  sku,
  inventoryStock,
} from '@server/database/schema';
import { round2 } from '../../common/utils/money';
import { resolveReportWindow } from '@server/common/report-window';
import {
  buildAggregationScope,
} from '@server/common/data-scope/aggregation-scope';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition, type DealerPath } from '@server/common/data-scope/dealer-scope';
import type {
  ForecastResult,
  ForecastPoint,
  BatchForecast,
  LifecycleItem,
  BiResult,
  BiDimensionValue,
  DashboardStats,
  TopStyleItem,
  InventoryWarningItem,
  PendingApproval,
  MobileDashboard,
} from '@shared/api.interface';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// 允许钻取的维度 -> 安全的列表达式（杜绝 SQL 注入，维度名来自固定白名单）
const BI_DIM_COLUMN: Record<string, string> = {
  style: 'soi.style_no',
  category: 'st.category',
  warehouse: 'so.warehouse_name',
  dealer: 'dl.name',
  month: "to_char(so.outbound_date, 'YYYY-MM')",
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  // ============ P1-1 AI 销量预测（季节+趋势 Holt 线性） ============
  async forecast(
    skuId: string,
    horizon = 3,
  ): Promise<ForecastResult> {
    const skuRow = await this.db
      .select({
        id: sku.id,
        skuCode: sku.skuCode,
        styleNo: sku.styleNo,
        color: sku.color,
        size: sku.size,
      })
      .from(sku)
      .where(eq(sku.id, skuId))
      .limit(1);

    if (skuRow.length === 0) {
      throw new NotFoundException('SKU 不存在');
    }

    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const salesScope = buildDealerScopeCondition(scope, { kind: 'dealerColumn', column: sql`so.dealer_id` });
    const forecastWhere = [
      sql`so.status IN ('booked', 'accepted') AND soi.sku_id = ${skuId}`,
    ];
    if (salesScope) forecastWhere.push(salesScope);
    const rows = (await this.db.execute(sql`
      SELECT to_char(so.outbound_date, 'YYYY-MM') AS m, SUM(soi.quantity) AS qty
      FROM sales_outbound_item soi
      JOIN sales_outbound so ON soi.outbound_id = so.id
      WHERE ${sql.join(forecastWhere, sql` AND `)}
      GROUP BY 1 ORDER BY 1
    `)) as unknown as Array<{ m: string; qty: string }>;

    const historyMap = new Map<string, number>();
    for (const r of rows) historyMap.set(r.m, Number(r.qty ?? 0));

    const months: string[] = [];
    const now = new Date();
    for (let i = 17; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthKey(d));
    }
    const history: ForecastPoint[] = months.map((m) => ({
      month: m,
      qty: Math.round((historyMap.get(m) ?? 0) * 100) / 100,
    }));

    const series = history.map((h) => h.qty);
    const n = series.length;
    const avgMonthly =
      Math.round((series.reduce((a, b) => a + b, 0) / Math.max(n, 1)) * 100) / 100;

    // 线性趋势（最近 12 期）
    const win = series.slice(-12);
    const wn = win.length;
    let trend = 0;
    if (wn >= 2) {
      const xMean = (wn - 1) / 2;
      const yMean = win.reduce((a, b) => a + b, 0) / wn;
      let num = 0;
      let den = 0;
      for (let i = 0; i < wn; i += 1) {
        num += (i - xMean) * (win[i] - yMean);
        den += (i - xMean) * (i - xMean);
      }
      trend = den === 0 ? 0 : Math.round((num / den) * 100) / 100;
    }

    // 季节指数（按日历月，需要 >=12 期历史）
    const seasonal = new Map<number, number>();
    if (historyMap.size >= 12) {
      const monthSum = new Map<number, number>();
      const monthCnt = new Map<number, number>();
      for (const [m, q] of historyMap) {
        const mm = Number(m.split('-')[1]);
        monthSum.set(mm, (monthSum.get(mm) ?? 0) + q);
        monthCnt.set(mm, (monthCnt.get(mm) ?? 0) + 1);
      }
      const overallAvg =
        [...monthSum.values()].reduce((a, b) => a + b, 0) /
        Math.max(monthCnt.size, 1);
      for (const [mm, s] of monthSum) {
        const cnt = monthCnt.get(mm) ?? 1;
        seasonal.set(mm, (s / cnt) / (overallAvg || 1));
      }
    }

    const lastLevel = series[n - 1] ?? avgMonthly;
    const forecast: ForecastPoint[] = [];
    const std = this.stdDev(series.slice(-6));
    for (let h = 1; h <= horizon; h += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() + h, 1);
      const mk = monthKey(d);
      const seas = seasonal.get(d.getMonth() + 1) ?? 1;
      const point =
        Math.round((lastLevel + trend * h) * seas * 100) / 100;
      forecast.push({
        month: mk,
        qty: Math.max(0, point),
        lower: Math.max(0, Math.round((point - std) * 100) / 100),
        upper: Math.round((point + std) * 100) / 100,
      });
    }

    const invScope = buildAggregationScope('inventory');
    const stockWhere = [sql`sku_id = ${skuId}`];
    if (invScope) stockWhere.push(invScope);
    const [stockRow] = (await this.db.execute(sql`
      SELECT COALESCE(SUM(quantity), 0) AS q FROM inventory_stock WHERE ${sql.join(stockWhere, sql` AND `)}
    `)) as unknown as Array<{ q: string }>;
    const onHand = Number(stockRow?.q ?? 0);
    const nextMonthNeed = forecast[0]?.qty ?? avgMonthly;
    const recommendedStock = Math.max(0, Math.ceil(nextMonthNeed * 1.3 - onHand));

    return {
      skuId,
      skuCode: skuRow[0].skuCode,
      styleNo: skuRow[0].styleNo,
      color: skuRow[0].color,
      size: skuRow[0].size,
      history,
      forecast,
      avgMonthly,
      trend,
      recommendedStock,
    };
  }

  /**
   * P2-2 批量预测：对一组 SKU 计算 Holt 线性趋势 + 季节指数，返回综合调整系数。
   * 单次 GROUP BY 查询，避免逐 SKU 调用 forecast() 的 N+1。
   * 当预测源（sales_outbound）无历史时 avgMonthly=0，adjustment 返回 1（不调整）。
   */
  async forecastBatch(skuIds: string[]): Promise<BatchForecast[]> {
    if (!skuIds.length) return [];
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const salesScope = buildDealerScopeCondition(scope, { kind: 'dealerColumn', column: sql`so.dealer_id` });
    const where = [
      sql`so.status IN ('booked', 'accepted') AND ${inArray(sql`soi.sku_id`, skuIds)}`,
    ];
    if (salesScope) where.push(salesScope);
    const rows = (await this.db.execute(sql`
      SELECT soi.sku_id AS sku_id, to_char(so.outbound_date, 'YYYY-MM') AS m, SUM(soi.quantity) AS qty
      FROM sales_outbound_item soi
      JOIN sales_outbound so ON soi.outbound_id = so.id
      WHERE ${sql.join(where, sql` AND `)}
      GROUP BY 1, 2 ORDER BY 1, 2
    `)) as unknown as Array<{ sku_id: string; m: string; qty: string }>;

    const bySku = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (!bySku.has(r.sku_id)) bySku.set(r.sku_id, new Map());
      bySku.get(r.sku_id)!.set(r.m, Number(r.qty ?? 0));
    }

    const now = new Date();
    const months: string[] = [];
    for (let i = 17; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(monthKey(d));
    }

    const results: BatchForecast[] = [];
    for (const skuId of skuIds) {
      const histMap = bySku.get(skuId) ?? new Map();
      const series = months.map((m) => histMap.get(m) ?? 0);
      const n = series.length;
      const avgMonthly =
        Math.round((series.reduce((a, b) => a + b, 0) / Math.max(n, 1)) * 100) / 100;

      // 线性趋势（最近 12 期）
      const win = series.slice(-12);
      const wn = win.length;
      let trend = 0;
      if (wn >= 2) {
        const xMean = (wn - 1) / 2;
        const yMean = win.reduce((a, b) => a + b, 0) / wn;
        let num = 0;
        let den = 0;
        for (let i = 0; i < wn; i += 1) {
          num += (i - xMean) * (win[i] - yMean);
          den += (i - xMean) * (i - xMean);
        }
        trend = den === 0 ? 0 : Math.round((num / den) * 100) / 100;
      }

      // 季节指数（按日历月，需 >=12 期历史）
      const seasonal = new Map<number, number>();
      if (histMap.size >= 12) {
        const monthSum = new Map<number, number>();
        const monthCnt = new Map<number, number>();
        for (const [m, q] of histMap) {
          const mm = Number(m.split('-')[1]);
          monthSum.set(mm, (monthSum.get(mm) ?? 0) + q);
          monthCnt.set(mm, (monthCnt.get(mm) ?? 0) + 1);
        }
        const overallAvg =
          [...monthSum.values()].reduce((a, b) => a + b, 0) /
          Math.max(monthCnt.size, 1);
        for (const [mm, s] of monthSum)
          seasonal.set(mm, (s / (monthCnt.get(mm) ?? 1)) / (overallAvg || 1));
      }

      const lastLevel = series[n - 1] ?? avgMonthly;
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const seas = seasonal.get(d.getMonth() + 1) ?? 1;
      const nextMonthNeed = Math.max(
        0,
        Math.round((lastLevel + trend) * seas * 100) / 100,
      );
      const adjustment =
        avgMonthly > 0 ? Math.round((nextMonthNeed / avgMonthly) * 100) / 100 : 1;
      results.push({ skuId, nextMonthNeed, avgMonthly, trend, adjustment });
    }
    return results;
  }

  private stdDev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v =
      arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
    return Math.sqrt(v);
  }

  // ============ P1-2 商品企划生命周期 ============
  async lifecycleList(days = 90): Promise<LifecycleItem[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = `${since.getFullYear()}-${pad(since.getMonth() + 1)}-${pad(
      since.getDate(),
    )}`;

    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const lifeScope = buildDealerScopeCondition(scope, { kind: 'dealerColumn', column: sql`so.dealer_id` });
    const lifeWhere = [
      sql`so.status IN ('booked', 'accepted') AND so.outbound_date >= ${sinceStr}`,
    ];
    if (lifeScope) lifeWhere.push(lifeScope);
    const rows = (await this.db.execute(sql`
      SELECT soi.style_no AS style_no, SUM(soi.quantity) AS qty
      FROM sales_outbound_item soi
      JOIN sales_outbound so ON soi.outbound_id = so.id
      WHERE ${sql.join(lifeWhere, sql` AND `)}
      GROUP BY soi.style_no
    `)) as unknown as Array<{ style_no: string; qty: string }>;

    const qtyMap = new Map<string, number>();
    for (const r of rows) qtyMap.set(r.style_no, Number(r.qty ?? 0));

    const styles = await this.db
      .select({
        styleNo: style.styleNo,
        name: style.name,
        category: style.category,
        season: style.season,
        lifecycleStatus: style.lifecycleStatus,
      })
      .from(style);

    const positive = [...qtyMap.values()].sort((a, b) => a - b);
    const p25 = this.percentile(positive, 0.25);
    const p75 = this.percentile(positive, 0.75);

    const items: LifecycleItem[] = styles.map((s) => {
      const recentQty = qtyMap.get(s.styleNo) ?? 0;
      let velocity: LifecycleItem['velocity'] = 'normal';
      if (recentQty <= 0) velocity = 'dead';
      else if (recentQty >= p75) velocity = 'hot';
      else if (recentQty <= p25) velocity = 'slow';

      const status = s.lifecycleStatus || 'introduction';
      let suggestedAction = '维持常规补货与陈列';
      if (status === 'decline' && velocity === 'hot')
        suggestedAction = '衰退期仍热销，建议紧急翻单小批量';
      else if (status === 'growth' && velocity === 'hot')
        suggestedAction = '成长期爆款，建议加大首单与补货';
      else if (velocity === 'dead')
        suggestedAction = '滞销，建议促销清仓 / 停止翻单';
      else if (status === 'introduction' && velocity === 'normal')
        suggestedAction = '导入期观察，控制首单量';
      else if (velocity === 'slow')
        suggestedAction = '动销偏慢，建议关注并适度促销';

      return {
        styleNo: s.styleNo,
        name: s.name,
        category: s.category ?? undefined,
        season: s.season ?? undefined,
        recentQty,
        lifecycleStatus: status,
        velocity,
        suggestedAction,
      };
    });

    items.sort((a, b) => b.recentQty - a.recentQty);
    return items;
  }

  async setLifecycle(styleNo: string, status: string): Promise<{ updated: number }> {
    const allowed = ['introduction', 'growth', 'maturity', 'decline'];
    if (!allowed.includes(status)) throw new BadRequestException('非法生命周期状态');
    const r = await this.db
      .update(style)
      .set({ lifecycleStatus: status })
      .where(eq(style.styleNo, styleNo));
    return { updated: (r as { rowCount?: number }).rowCount ?? 0 };
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(p * sorted.length)),
    );
    return sorted[idx];
  }

  // ============ P1-5 自助 BI 钻取 ============
  async bi(
    dim: string,
    metric = 'amount',
    from?: string,
    to?: string,
    allowFullRange = false,
  ): Promise<BiResult> {
    const col = BI_DIM_COLUMN[dim];
    if (!col) throw new BadRequestException('不支持的维度');
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (from && !dateRe.test(from)) throw new BadRequestException('from 日期格式应为 YYYY-MM-DD');
    if (to && !dateRe.test(to)) throw new BadRequestException('to 日期格式应为 YYYY-MM-DD');
    const metricExpr =
      metric === 'quantity'
        ? sql`SUM(soi.quantity)`
        : sql`SUM(soi.amount)`;

    // P1-c④ 强制时间窗：BI 钻取此前只把 from/to 当可选，都不传就是全出库明细
    // 聚合后再 LIMIT 50，兜底完全无效。现在缺失的一侧由默认窗口补齐。
    const win = resolveReportWindow(
      { startDate: from, endDate: to, allowFullRange },
      this.logger,
    );
    const whereParts = [sql`so.status IN ('booked', 'accepted')`];
    if (win) {
      whereParts.push(sql`so.outbound_date >= ${win.start}`);
      whereParts.push(sql`so.outbound_date < ${win.endExclusive}`);
    } else if (from) {
      whereParts.push(sql`so.outbound_date >= ${from}`);
    }
    if (to) whereParts.push(sql`so.outbound_date <= ${to}`);
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const biScope = buildDealerScopeCondition(scope, { kind: 'dealerColumn', column: sql`so.dealer_id` });
    if (biScope) whereParts.push(biScope);
    const whereSql = sql.join(whereParts, sql` AND `);

    const joinStyle =
      dim === 'category' ? sql`JOIN style st ON soi.style_no = st.style_no` :
      dim === 'dealer' ? sql`JOIN dealer dl ON so.dealer_id = dl.id` : sql``;

    const rows = (await this.db.execute(sql`
      SELECT ${sql.raw(col)} AS dim_value,
             ${metricExpr} AS amount,
             SUM(soi.quantity) AS quantity
      FROM sales_outbound_item soi
      JOIN sales_outbound so ON soi.outbound_id = so.id
      ${joinStyle}
      WHERE ${whereSql}
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 50
    `)) as unknown as Array<{ dim_value: string | null; amount: string; quantity: string }>;

    const resultRows: BiDimensionValue[] = rows.map((r) => ({
      dimValue: r.dim_value ?? '(空)',
      amount: Number(round2(Number(r.amount ?? 0))),
      quantity: Number(round2(Number(r.quantity ?? 0))),
    }));

    return { dim, metric, from, to, rows: resultRows };
  }

  // ============ P1-6 移动老板看板 ============
  async mobileDashboard(): Promise<MobileDashboard> {
    const stats = await this.getStats();
    const pendingApprovals = await this.getPendingApprovals();
    const topStylesScope = buildAggregationScope('sales');
    const topStylesRows = (await this.db
      .select({
        styleNo: salesOutboundItem.styleNo,
        quantity: sql`SUM(${salesOutboundItem.quantity})`,
        amount: sql`SUM(${salesOutboundItem.amount})`,
      })
      .from(salesOutboundItem)
      .innerJoin(salesOutbound, eq(salesOutboundItem.outboundId, salesOutbound.id))
      .where(
        topStylesScope
          ? and(sql`${salesOutbound.status} IN ('booked', 'accepted')`, topStylesScope)
          : sql`${salesOutbound.status} IN ('booked', 'accepted')`,
      )
      .groupBy(salesOutboundItem.styleNo)
      .orderBy(desc(sql`SUM(${salesOutboundItem.quantity})`))
      .limit(5)) as unknown as Array<{ styleNo: string; quantity: string; amount: string }>;

    const topStyles: TopStyleItem[] = topStylesRows.map((r) => ({
      styleNo: r.styleNo,
      name: '',
      quantity: Number(r.quantity ?? 0),
      amount: Number(round2(Number(r.amount ?? 0))),
    }));

    const warningsScope = buildAggregationScope('inventory');
    const warningsRows = (await this.db
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
        warningsScope
          ? and(sql`${inventoryStock.quantity} < ${sku.safetyStockMin}`, warningsScope)
          : sql`${inventoryStock.quantity} < ${sku.safetyStockMin}`,
      )
      .orderBy(sql`${inventoryStock.quantity} - ${sku.safetyStockMin}`)
      .limit(5)) as unknown as Array<{
      skuCode: string; styleNo: string; color: string; size: string;
      warehouseName: string; quantity: string; safetyMin: string; safetyMax: string;
    }>;

    const warnings: InventoryWarningItem[] = warningsRows.map((r) => ({
      skuCode: r.skuCode,
      styleNo: r.styleNo,
      color: r.color,
      size: r.size,
      warehouseName: r.warehouseName,
      quantity: Number(r.quantity),
      safetyMin: Number(r.safetyMin),
      safetyMax: Number(r.safetyMax),
      warningType: 'below_min',
    }));

    return { stats, pendingApprovals, topStyles, warnings };
  }

  private async getStats(): Promise<DashboardStats> {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(
      today.getDate(),
    )}`;
    const statsScope = buildAggregationScope('sales');
    const retailScope = buildAggregationScope('retail');
    const [sales, retail, retailReturn] = await Promise.all([
      this.db
        .select({ total: sql`COALESCE(SUM(${salesOutbound.totalAmount}),0)` })
        .from(salesOutbound)
        .where(
          statsScope
            ? and(sql`${salesOutbound.outboundDate} = ${todayStr} AND ${salesOutbound.status} = 'booked'`, statsScope)
            : sql`${salesOutbound.outboundDate} = ${todayStr} AND ${salesOutbound.status} = 'booked'`,
        ) as unknown as Array<{ total: string }>,
      this.db
        .select({ total: sql`COALESCE(SUM(${sql.raw('receivable_amount')}),0)` })
        .from(sql`retail_order`)
        .where(
          retailScope
            ? and(sql`${sql.raw('sale_date')} = ${todayStr} AND ${sql.raw('status')} IN ('settled','returned')`, retailScope)
            : sql`${sql.raw('sale_date')} = ${todayStr} AND ${sql.raw('status')} IN ('settled','returned')`,
        ) as unknown as Array<{ total: string }>,
      this.db
        .select({ total: sql`COALESCE(SUM(${sql.raw('total_amount')}),0)` })
        .from(sql`retail_return`)
        .where(
          retailScope
            ? and(sql`${sql.raw('return_date')} = ${todayStr} AND ${sql.raw('status')} = 'refunded'`, retailScope)
            : sql`${sql.raw('return_date')} = ${todayStr} AND ${sql.raw('status')} = 'refunded'`,
        ) as unknown as Array<{ total: string }>,
    ]);
    const todaySales = Number(round2(Number(sales[0]?.total ?? 0)));
    const todayRetailGross = Number(retail[0]?.total ?? 0);
    const todayRetailRet = Number(retailReturn[0]?.total ?? 0);
    return {
      todaySales,
      todayRetail: Number(round2(todayRetailGross - todayRetailRet)),
      todayOutboundCount: 0,
      totalSkuCount: 0,
      pendingDocCount: 0,
    };
  }

  private async getPendingApprovals(): Promise<PendingApproval[]> {
    const map = [
      { type: 'sales_order', no: 'order_no', date: 'order_date', pending: 'audited' },
      { type: 'purchase_order', no: 'order_no', date: 'order_date', pending: 'audited' },
      { type: 'sales_outbound', no: 'outbound_no', date: 'outbound_date', pending: 'audited' },
      { type: 'purchase_inbound', no: 'inbound_no', date: 'inbound_date', pending: 'draft' },
    ];
    const scopeMeta: Record<string, DealerPath> = {
      sales_order: { kind: 'dealerColumn', column: sql`sales_order.dealer_id` },
      purchase_order: { kind: 'viaSupplier', column: sql`purchase_order.supplier_id` },
      sales_outbound: { kind: 'dealerColumn', column: sql`sales_outbound.dealer_id` },
      purchase_inbound: { kind: 'viaSupplier', column: sql`purchase_inbound.supplier_id` },
    };
    const result: PendingApproval[] = [];
    for (const m of map) {
      const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
      const meta = scopeMeta[m.type];
      const scopeFrag = buildDealerScopeCondition(scope, meta);
      const whereParts = [sql`status = ${m.pending}`];
      if (scopeFrag) whereParts.push(scopeFrag);
      const rows = (await this.db.execute(sql`
        SELECT id, ${sql.raw(m.no)} AS doc_no, ${sql.raw(m.date)} AS d
        FROM ${sql.raw(m.type)}
        WHERE ${sql.join(whereParts, sql` AND `)}
        ORDER BY ${sql.raw(m.date)} DESC
        LIMIT 8
      `)) as unknown as Array<{ id: string; doc_no: string; d: string }>;
      for (const r of rows) {
        result.push({
          docType: m.type,
          docId: r.id,
          docNo: r.doc_no,
          date: r.d,
        });
      }
    }
    return result;
  }

  // 通用审批：仅允许白名单表，将 pending -> approved
  async approveDoc(docType: string, docId: string): Promise<{ updated: number }> {
    const allowed: Record<string, { table: string; from: string; to: string }> = {
      sales_order: { table: 'sales_order', from: 'audited', to: 'booked' },
      purchase_order: { table: 'purchase_order', from: 'audited', to: 'booked' },
      sales_outbound: { table: 'sales_outbound', from: 'audited', to: 'booked' },
      purchase_inbound: { table: 'purchase_inbound', from: 'draft', to: 'approved' },
    };
    const m = allowed[docType];
    if (!m) throw new BadRequestException('不支持的单据类型');
    const r = (await this.db.execute(sql`
      UPDATE ${sql.raw(m.table)} SET status = ${m.to} WHERE id = ${docId} AND status = ${m.from}
    `)) as unknown as { rowCount?: number };
    return { updated: r.rowCount ?? 0 };
  }
}
