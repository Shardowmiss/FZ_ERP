import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gte, lt, sql, sum } from 'drizzle-orm';
import { resolveReportWindow } from '@server/common/report-window';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { retailOrder, retailOrderItem, sku, style } from '@server/database/schema';
import type { RetailSummaryParams } from './report-interfaces';
import type { ReportRetailSummary } from '@shared/api.interface';

/**
 * 门店零售汇总（域）。逻辑、SQL、返回结构与拆前逐字一致。
 * 该方法是"汇总"语义，无分页无 limit，无界扫描代价最高。
 */
@Injectable()
export class ReportRetailSummaryService {
  private readonly logger = new Logger(ReportRetailSummaryService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getRetailSummary(params: RetailSummaryParams): Promise<ReportRetailSummary> {
    const { startDate, endDate, storeId, brand, allowFullRange } = params;

    const conditions: ReturnType<typeof and>[] = [];
    // P1-c④ 强制时间窗：该方法是"汇总"语义，无分页无 limit，无界扫描代价最高
    const win = resolveReportWindow(
      { startDate, endDate, allowFullRange },
      this.logger,
    );
    if (win) {
      conditions.push(gte(retailOrder.saleDate, win.start));
      conditions.push(lt(retailOrder.saleDate, win.endExclusive));
    }
    if (storeId) conditions.push(eq(retailOrder.storeId, storeId));
    if (brand) conditions.push(eq(style.brand, brand));
    const retailScope = buildAggregationScope('retail');
    if (retailScope) conditions.push(retailScope);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const summaryRow: { totalQty: string; totalAmount: string } | undefined = (
      await this.db
        .select({
          totalQty: sum(retailOrderItem.quantity).as('total_qty'),
          totalAmount: sum(retailOrderItem.lineAmount).as('total_amount'),
        })
        .from(retailOrderItem)
        .innerJoin(retailOrder, eq(retailOrderItem.retailId, retailOrder.id))
        .leftJoin(sku, eq(retailOrderItem.skuId, sku.id))
        .leftJoin(style, eq(sku.styleId, style.id))
        .where(whereClause)
    )[0];

    const orderCountResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(DISTINCT ${retailOrder.id})` })
      .from(retailOrderItem)
      .innerJoin(retailOrder, eq(retailOrderItem.retailId, retailOrder.id))
      .leftJoin(sku, eq(retailOrderItem.skuId, sku.id))
      .leftJoin(style, eq(sku.styleId, style.id))
      .where(whereClause);

    const orderCount: number = orderCountResult[0]?.count ?? 0;
    const totalQtyNum: number = Number(summaryRow?.totalQty ?? 0);
    const totalAmountNum: number = Number(summaryRow?.totalAmount ?? 0);
    const avgPrice: number = orderCount > 0 ? totalAmountNum / orderCount : 0;

    const summary: ReportRetailSummary = {
      orderCount,
      totalQty: totalQtyNum,
      totalAmount: totalAmountNum,
      avgPrice: Math.round(avgPrice * 100) / 100,
    };

    return summary;
  }
}
