import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, ilike, inArray, lt, or, sql, sum } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { resolveReportWindow } from '@server/common/report-window';
import { auditQueryPlan } from '@server/common/query-audit';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { salesOutbound, salesOutboundItem, sku, style } from '@server/database/schema';
import type { BaseQueryParams, SalesReportResult } from './report-interfaces';

/**
 * 销售出库报表（域）。逻辑、SQL、返回结构与拆前逐字一致。
 */
@Injectable()
export class ReportSalesService {
  private readonly logger = new Logger(ReportSalesService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getSalesReport(params: BaseQueryParams): Promise<SalesReportResult> {
    const { startDate, endDate, partnerIds, keyword, brand, page, pageSize, allowFullRange } = params;

    const conditions: ReturnType<typeof and>[] = [];

    // P1-c④ 强制时间窗：显式传参与改造前等价，不传则注入默认回看窗口
    const win = resolveReportWindow(
      { startDate, endDate, allowFullRange },
      this.logger,
    );
    if (win) {
      conditions.push(gte(salesOutbound.outboundDate, win.start));
      conditions.push(lt(salesOutbound.outboundDate, win.endExclusive));
    }
    if (partnerIds) {
      const customerIds: string[] = partnerIds.split(',').filter(Boolean);
      if (customerIds.length > 0) {
        conditions.push(inArray(salesOutbound.customerId, customerIds));
      }
    }
    if (keyword) {
      const kw: string = `%${escapeLike(keyword)}%`;
      conditions.push(or(
        ilike(salesOutbound.outboundNo, kw),
        ilike(salesOutbound.customerName, kw),
        ilike(salesOutboundItem.styleNo, kw),
      ));
    }
    if (brand) {
      conditions.push(eq(style.brand, brand));
    }

    const salesScope = buildAggregationScope('sales');
    if (salesScope) conditions.push(salesScope);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        outboundNo: salesOutbound.outboundNo,
        outboundDate: salesOutbound.outboundDate,
        customerName: salesOutbound.customerName,
        brand: style.brand,
        styleNo: salesOutboundItem.styleNo,
        color: salesOutboundItem.color,
        size: salesOutboundItem.size,
        quantity: salesOutboundItem.quantity,
        tagPrice: sku.tagPrice,
        dealPrice: salesOutboundItem.price,
        amount: salesOutboundItem.amount,
        warehouseName: salesOutbound.warehouseName,
        status: salesOutbound.status,
      })
      .from(salesOutboundItem)
      .innerJoin(salesOutbound, eq(salesOutboundItem.outboundId, salesOutbound.id))
      .leftJoin(sku, eq(salesOutboundItem.skuId, sku.id))
      .leftJoin(style, eq(sku.styleId, style.id))
      .where(whereClause);

    // P1-c⑤ 查询审计（仅 QUERY_AUDIT=1 时生效，默认 no-op）
    await auditQueryPlan(this.db, baseQuery, 'sales-report', this.logger);

    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(baseQuery.as('base'));
    const total: number = totalResult[0]?.count ?? 0;

    const rows = await baseQuery
      .orderBy(desc(salesOutbound.outboundDate), desc(salesOutbound.outboundNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const summaryResult: { totalQty: string; totalAmount: string; totalTagAmount: string }[] =
      await this.db
        .select({
          totalQty: sum(salesOutboundItem.quantity).as('total_qty'),
          totalAmount: sum(salesOutboundItem.amount).as('total_amount'),
          totalTagAmount: sum(sql`${salesOutboundItem.quantity} * ${sku.tagPrice}`).as(
            'total_tag_amount',
          ),
        })
        .from(salesOutboundItem)
        .innerJoin(salesOutbound, eq(salesOutboundItem.outboundId, salesOutbound.id))
        .leftJoin(sku, eq(salesOutboundItem.skuId, sku.id))
        .leftJoin(style, eq(sku.styleId, style.id))
        .where(whereClause);

    const totalQtyNum: number = Number(summaryResult[0]?.totalQty ?? 0);
    const totalAmountNum: number = Number(summaryResult[0]?.totalAmount ?? 0);
    const totalTagAmountNum: number = Number(summaryResult[0]?.totalTagAmount ?? 0);

    const items: SalesReportResult['items'] = rows.map((row) => {
      const qty: number = Number(row.quantity);
      const tagP: number = Number(row.tagPrice ?? 0);
      const dealP: number = Number(row.dealPrice);
      const amt: number = Number(row.amount);
      const tagTotal: number = qty * tagP;
      const discountRate: number = tagTotal > 0 ? amt / tagTotal : 1;
      return {
        outboundNo: row.outboundNo,
        outboundDate: String(row.outboundDate),
        customerName: row.customerName,
        brand: row.brand ?? '-',
        styleNo: row.styleNo,
        color: row.color ?? '-',
        size: row.size ?? '-',
        quantity: qty,
        tagPrice: tagP,
        dealPrice: dealP,
        discountRate: Math.round(discountRate * 10000) / 10000,
        amount: amt,
        warehouseName: row.warehouseName,
        salesperson: '-',
        status: row.status,
      };
    });

    const summary: SalesReportResult['summary'] = {
      totalQty: totalQtyNum,
      totalAmount: totalAmountNum,
      totalDiscountAmount: totalTagAmountNum - totalAmountNum,
    };

    return { items, total, page, pageSize, summary };
  }
}
