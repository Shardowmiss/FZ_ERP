import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, ilike, inArray, lt, or, sql, sum } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { resolveReportWindow } from '@server/common/report-window';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { retailOrder, retailOrderItem, sku, style } from '@server/database/schema';
import type { BaseQueryParams, RetailReportResult } from './report-interfaces';

/**
 * 门店零售报表（域）。逻辑、SQL、返回结构与拆前逐字一致。
 */
@Injectable()
export class ReportRetailService {
  private readonly logger = new Logger(ReportRetailService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getRetailReport(params: BaseQueryParams): Promise<RetailReportResult> {
    const { startDate, endDate, partnerIds, keyword, brand, page, pageSize, allowFullRange } = params;

    const conditions: ReturnType<typeof and>[] = [];

    // P1-c④ 强制时间窗：显式传参与改造前等价，不传则注入默认回看窗口
    const win = resolveReportWindow(
      { startDate, endDate, allowFullRange },
      this.logger,
    );
    if (win) {
      conditions.push(gte(retailOrder.saleDate, win.start));
      conditions.push(lt(retailOrder.saleDate, win.endExclusive));
    }
    if (partnerIds) {
      const storeIds: string[] = partnerIds.split(',').filter(Boolean);
      if (storeIds.length > 0) {
        conditions.push(inArray(retailOrder.storeId, storeIds));
      }
    }
    if (keyword) {
      const kw: string = `%${escapeLike(keyword)}%`;
      conditions.push(or(
        ilike(retailOrder.retailNo, kw),
        ilike(retailOrder.storeName, kw),
        ilike(retailOrderItem.styleNo, kw),
      ));
    }
    if (brand) {
      conditions.push(eq(style.brand, brand));
    }

    const retailScope = buildAggregationScope('retail');
    if (retailScope) conditions.push(retailScope);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        retailNo: retailOrder.retailNo,
        saleDate: retailOrder.saleDate,
        storeName: retailOrder.storeName,
        cashierName: retailOrder.cashierName,
        brand: style.brand,
        styleNo: retailOrderItem.styleNo,
        color: retailOrderItem.color,
        size: retailOrderItem.size,
        quantity: retailOrderItem.quantity,
        dealPrice: retailOrderItem.dealPrice,
        lineAmount: retailOrderItem.lineAmount,
        payMethods: retailOrder.payMethods,
        status: retailOrder.status,
      })
      .from(retailOrderItem)
      .innerJoin(retailOrder, eq(retailOrderItem.retailId, retailOrder.id))
      .leftJoin(sku, eq(retailOrderItem.skuId, sku.id))
      .leftJoin(style, eq(sku.styleId, style.id))
      .where(whereClause);

    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(baseQuery.as('base'));
    const total: number = totalResult[0]?.count ?? 0;

    const rows = await baseQuery
      .orderBy(desc(retailOrder.saleDate), desc(retailOrder.retailNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

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

    const items: RetailReportResult['items'] = rows.map((row) => {
      const payList: { method: string; amount: string }[] =
        Array.isArray(row.payMethods) ? (row.payMethods as { method: string; amount: string }[]) : [];
      const payMethod: string = payList.length > 0
        ? payList.map((p: { method: string; amount: string }) => p.method).join(',')
        : '-';
      return {
        retailNo: row.retailNo,
        saleDate: String(row.saleDate),
        storeName: row.storeName,
        cashierName: row.cashierName ?? '-',
        brand: row.brand ?? '-',
        styleNo: row.styleNo,
        color: row.color ?? '-',
        size: row.size ?? '-',
        quantity: Number(row.quantity),
        dealPrice: Number(row.dealPrice),
        amount: Number(row.lineAmount),
        payMethod,
        status: row.status,
      };
    });

    const summary: RetailReportResult['summary'] = {
      orderCount,
      totalQty: totalQtyNum,
      totalAmount: totalAmountNum,
      avgPrice: Math.round(avgPrice * 100) / 100,
    };

    return { items, total, page, pageSize, summary };
  }
}
