import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, ilike, inArray, lt, or, sql, sum } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { resolveReportWindow } from '@server/common/report-window';
import { auditQueryPlan } from '@server/common/query-audit';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import { purchaseInbound, purchaseInboundItem } from '@server/database/schema';
import type {
  BaseQueryParams,
  PurchaseReportResult,
} from './report-interfaces';

/**
 * 采购入库报表（域）。
 *
 * 从原 `report.service.ts` 整体迁入，逻辑、SQL、返回结构**逐字未改**；
 * 拆分只改变"谁持有这段代码"，不改变任何对外行为。门面 `ReportService`
 * 直接委托本方法，controller 调用契约保持不变。
 */
@Injectable()
export class ReportPurchaseService {
  private readonly logger = new Logger(ReportPurchaseService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getPurchaseReport(params: BaseQueryParams): Promise<PurchaseReportResult> {
    const { startDate, endDate, partnerIds, keyword, brand, page, pageSize, allowFullRange } = params;

    const conditions: ReturnType<typeof and>[] = [];

    // P1-c④ 强制时间窗：显式传参与改造前等价，不传则注入默认回看窗口
    const win = resolveReportWindow(
      { startDate, endDate, allowFullRange },
      this.logger,
    );
    if (win) {
      conditions.push(gte(purchaseInbound.inboundDate, win.start));
      conditions.push(lt(purchaseInbound.inboundDate, win.endExclusive));
    }
    if (partnerIds) {
      const supplierIds: string[] = partnerIds.split(',').filter(Boolean);
      if (supplierIds.length > 0) {
        conditions.push(inArray(purchaseInbound.supplierId, supplierIds));
      }
    }
    if (keyword) {
      const kw: string = `%${escapeLike(keyword)}%`;
      conditions.push(or(
        ilike(purchaseInbound.inboundNo, kw),
        ilike(purchaseInbound.supplierName, kw),
        ilike(purchaseInboundItem.materialCode, kw),
        ilike(purchaseInboundItem.materialName, kw),
      ));
    }

    const purchaseScope = buildAggregationScope('purchase');
    if (purchaseScope) conditions.push(purchaseScope);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const baseQuery = this.db
      .select({
        inboundNo: purchaseInbound.inboundNo,
        inboundDate: purchaseInbound.inboundDate,
        supplierName: purchaseInbound.supplierName,
        materialCode: purchaseInboundItem.materialCode,
        materialName: purchaseInboundItem.materialName,
        unit: purchaseInboundItem.unit,
        quantity: purchaseInboundItem.quantity,
        price: purchaseInboundItem.price,
        amount: purchaseInboundItem.amount,
        warehouseName: purchaseInbound.warehouseName,
        status: purchaseInbound.status,
      })
      .from(purchaseInboundItem)
      .innerJoin(purchaseInbound, eq(purchaseInboundItem.inboundId, purchaseInbound.id))
      .where(whereClause);

    // P1-c⑤ 查询审计（仅 QUERY_AUDIT=1 时生效，默认 no-op）
    await auditQueryPlan(this.db, baseQuery, 'purchase-report', this.logger);

    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(baseQuery.as('base'));
    const total: number = totalResult[0]?.count ?? 0;

    const rows = await baseQuery
      .orderBy(desc(purchaseInbound.inboundDate), desc(purchaseInbound.inboundNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const summaryResult: { totalQty: string; totalAmount: string }[] = await this.db
      .select({
        totalQty: sum(purchaseInboundItem.quantity).as('total_qty'),
        totalAmount: sum(purchaseInboundItem.amount).as('total_amount'),
      })
      .from(purchaseInboundItem)
      .innerJoin(purchaseInbound, eq(purchaseInboundItem.inboundId, purchaseInbound.id))
      .where(whereClause);

    const items: PurchaseReportResult['items'] = rows.map((row) => ({
      inboundNo: row.inboundNo,
      inboundDate: String(row.inboundDate),
      supplierName: row.supplierName,
      brand: brand ?? '-',
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      warehouseName: row.warehouseName,
      purchaser: '-',
      status: row.status,
    }));

    const summary: PurchaseReportResult['summary'] = {
      totalQty: Number(summaryResult[0]?.totalQty ?? 0),
      totalAmount: Number(summaryResult[0]?.totalAmount ?? 0),
    };

    return { items, total, page, pageSize, summary };
  }
}
