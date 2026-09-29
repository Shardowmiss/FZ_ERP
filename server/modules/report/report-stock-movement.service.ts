import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, desc, eq, gte, ilike, inArray, lt, or, sql, sum } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import {
  inventoryStock,
  salesOutbound,
  salesOutboundItem,
  retailOrder,
  retailOrderItem,
  inventoryTransfer,
  inventoryTransferItem,
  sku,
  style,
} from '@server/database/schema';
import type { StockMovementQueryParams, StockMovementReportResult } from './report-interfaces';

/**
 * 库存收发存报表（域）。逻辑、SQL、返回结构与拆前逐字一致。
 *
 * 该报表以 `inventory_stock` 为分页基础，再按当前页的 (skuId, warehouseId) 去
 * 销售/零售/调拨三张流水表聚合区间内的出入，推算期初/期末。无 `startDate` 时退化为
 * "期末即期初"的静态视图。
 */
@Injectable()
export class ReportStockMovementService {
  private readonly logger = new Logger(ReportStockMovementService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async getStockMovementReport(
    params: StockMovementQueryParams,
  ): Promise<StockMovementReportResult> {
    const { startDate, endDate, warehouseId, keyword, brand, page, pageSize } = params;

    // 构建库存基础查询（含 style/sku 关联）
    const stockConditions: ReturnType<typeof and>[] = [];
    if (warehouseId) {
      stockConditions.push(eq(inventoryStock.warehouseId, warehouseId));
    }
    if (keyword) {
      const kw: string = `%${escapeLike(keyword)}%`;
      stockConditions.push(or(
        ilike(inventoryStock.styleNo, kw),
        ilike(inventoryStock.skuCode, kw),
      ));
    }
    if (brand) {
      stockConditions.push(eq(style.brand, brand));
    }
    const stockScope = buildAggregationScope('inventory');
    if (stockScope) stockConditions.push(stockScope);
    const stockWhere = stockConditions.length > 0 ? and(...stockConditions) : undefined;

    const baseQuery = this.db
      .select({
        skuId: inventoryStock.skuId,
        brand: style.brand,
        styleNo: inventoryStock.styleNo,
        color: inventoryStock.color,
        size: inventoryStock.size,
        warehouseName: inventoryStock.warehouseName,
        warehouseId: inventoryStock.warehouseId,
        endQty: inventoryStock.quantity,
        unitCost: sku.costPrice,
      })
      .from(inventoryStock)
      .leftJoin(sku, eq(inventoryStock.skuId, sku.id))
      .leftJoin(style, eq(sku.styleId, style.id))
      .where(stockWhere);

    const totalResult: { count: number }[] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(baseQuery.as('base'));
    const total: number = totalResult[0]?.count ?? 0;

    const pageRows = await baseQuery
      .orderBy(desc(inventoryStock.styleNo))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const keys: { skuId: string; warehouseId: string }[] = pageRows.map(
      (row) => ({ skuId: row.skuId, warehouseId: row.warehouseId }),
    );

    let items: StockMovementReportResult['items'] = [];
    let summary: StockMovementReportResult['summary'] = {
      beginQty: 0,
      purchaseInQty: 0,
      salesOutQty: 0,
      retailOutQty: 0,
      transferNetQty: 0,
      endQty: 0,
      endAmount: 0,
    };

    if (keys.length > 0 && startDate) {
      const skuIds: string[] = keys.map((k: { skuId: string; warehouseId: string }) => k.skuId);
      const warehouseIds: string[] = keys.map(
        (k: { skuId: string; warehouseId: string }) => k.warehouseId,
      );

      const dateStart: string = startDate;
      const dateEnd: string = endDate ?? new Date().toISOString().split('T')[0];

      const salesRows = await this.db
        .select({
          skuId: salesOutboundItem.skuId,
          warehouseId: salesOutbound.warehouseId,
          qty: sum(salesOutboundItem.quantity).as('qty'),
        })
        .from(salesOutboundItem)
        .innerJoin(salesOutbound, eq(salesOutboundItem.outboundId, salesOutbound.id))
        .where(
          and(
            gte(salesOutbound.outboundDate, dateStart),
            lt(salesOutbound.outboundDate, dateEnd),
            inArray(salesOutbound.status, ['booked', 'accepted']),
            skuIds.length ? inArray(salesOutboundItem.skuId, skuIds) : undefined,
            warehouseIds.length ? inArray(salesOutbound.warehouseId, warehouseIds) : undefined,
          ),
        )
        .groupBy(salesOutboundItem.skuId, salesOutbound.warehouseId);

      const salesMap = new Map<string, number>();
      for (const row of salesRows) {
        const key: string = `${row.skuId}-${row.warehouseId}`;
        salesMap.set(key, Number(row.qty));
      }

      const retailRows = await this.db
        .select({
          skuId: retailOrderItem.skuId,
          qty: sum(retailOrderItem.quantity).as('qty'),
        })
        .from(retailOrderItem)
        .innerJoin(retailOrder, eq(retailOrderItem.retailId, retailOrder.id))
        .where(
          and(
            gte(retailOrder.saleDate, dateStart),
            lt(retailOrder.saleDate, dateEnd),
            inArray(retailOrder.status, ['approved', 'completed']),
            skuIds.length ? inArray(retailOrderItem.skuId, skuIds) : undefined,
          ),
        )
        .groupBy(retailOrderItem.skuId);

      const retailMap = new Map<string, number>();
      for (const row of retailRows) {
        retailMap.set(row.skuId, Number(row.qty));
      }

      const transferInRows = await this.db
        .select({
          skuId: inventoryTransferItem.skuId,
          warehouseId: inventoryTransfer.toWarehouseId,
          qty: sum(inventoryTransferItem.quantity).as('qty'),
        })
        .from(inventoryTransferItem)
        .innerJoin(inventoryTransfer, eq(inventoryTransferItem.transferId, inventoryTransfer.id))
        .where(
          and(
            gte(inventoryTransfer.transferDate, dateStart),
            lt(inventoryTransfer.transferDate, dateEnd),
            inArray(inventoryTransfer.status, ['approved', 'completed']),
            eq(inventoryTransfer.itemType, 'sku'),
            skuIds.length ? inArray(inventoryTransferItem.skuId, skuIds) : undefined,
            warehouseIds.length ? inArray(inventoryTransfer.toWarehouseId, warehouseIds) : undefined,
          ),
        )
        .groupBy(inventoryTransferItem.skuId, inventoryTransfer.toWarehouseId);

      const transferOutRows = await this.db
        .select({
          skuId: inventoryTransferItem.skuId,
          warehouseId: inventoryTransfer.fromWarehouseId,
          qty: sum(inventoryTransferItem.quantity).as('qty'),
        })
        .from(inventoryTransferItem)
        .innerJoin(inventoryTransfer, eq(inventoryTransferItem.transferId, inventoryTransfer.id))
        .where(
          and(
            gte(inventoryTransfer.transferDate, dateStart),
            lt(inventoryTransfer.transferDate, dateEnd),
            inArray(inventoryTransfer.status, ['approved', 'completed']),
            eq(inventoryTransfer.itemType, 'sku'),
            skuIds.length ? inArray(inventoryTransferItem.skuId, skuIds) : undefined,
            warehouseIds.length ? inArray(inventoryTransfer.fromWarehouseId, warehouseIds) : undefined,
          ),
        )
        .groupBy(inventoryTransferItem.skuId, inventoryTransfer.fromWarehouseId);

      const transferInMap = new Map<string, number>();
      for (const row of transferInRows) {
        const key: string = `${row.skuId}-${row.warehouseId}`;
        transferInMap.set(key, Number(row.qty));
      }
      const transferOutMap = new Map<string, number>();
      for (const row of transferOutRows) {
        const key: string = `${row.skuId}-${row.warehouseId}`;
        transferOutMap.set(key, Number(row.qty));
      }

      items = pageRows.map((row) => {
        const key: string = `${row.skuId}-${row.warehouseId}`;
        const endQty: number = Number(row.endQty);
        const unitCost: number = Number(row.unitCost ?? 0);

        const purchaseInQty: number = 0;
        const salesOutQty: number = salesMap.get(key) ?? 0;
        const retailOutQty: number = retailMap.get(row.skuId) ?? 0;
        const transferInQty: number = transferInMap.get(key) ?? 0;
        const transferOutQty: number = transferOutMap.get(key) ?? 0;
        const transferNetQty: number = transferInQty - transferOutQty;

        const beginQty: number = endQty - purchaseInQty + salesOutQty + retailOutQty - transferNetQty;

        const endAmount: number = Math.round(endQty * unitCost * 100) / 100;

        return {
          brand: row.brand ?? '-',
          styleNo: row.styleNo,
          color: row.color,
          size: row.size,
          warehouseName: row.warehouseName,
          beginQty,
          purchaseInQty,
          salesOutQty,
          retailOutQty,
          transferNetQty,
          endQty,
          endAmount,
        };
      });

      summary = items.reduce(
        (acc: StockMovementReportResult['summary'], item: StockMovementReportResult['items'][number]) => ({
          beginQty: acc.beginQty + item.beginQty,
          purchaseInQty: acc.purchaseInQty + item.purchaseInQty,
          salesOutQty: acc.salesOutQty + item.salesOutQty,
          retailOutQty: acc.retailOutQty + item.retailOutQty,
          transferNetQty: acc.transferNetQty + item.transferNetQty,
          endQty: acc.endQty + item.endQty,
          endAmount: acc.endAmount + item.endAmount,
        }),
        {
          beginQty: 0,
          purchaseInQty: 0,
          salesOutQty: 0,
          retailOutQty: 0,
          transferNetQty: 0,
          endQty: 0,
          endAmount: 0,
        },
      );
    } else {
      items = pageRows.map((row) => {
        const endQty: number = Number(row.endQty);
        const unitCost: number = Number(row.unitCost ?? 0);
        return {
          brand: row.brand ?? '-',
          styleNo: row.styleNo,
          color: row.color,
          size: row.size,
          warehouseName: row.warehouseName,
          beginQty: endQty,
          purchaseInQty: 0,
          salesOutQty: 0,
          retailOutQty: 0,
          transferNetQty: 0,
          endQty,
          endAmount: Math.round(endQty * unitCost * 100) / 100,
        };
      });
      summary = items.reduce(
        (acc: StockMovementReportResult['summary'], item: StockMovementReportResult['items'][number]) => ({
          beginQty: acc.beginQty + item.beginQty,
          purchaseInQty: acc.purchaseInQty + item.purchaseInQty,
          salesOutQty: acc.salesOutQty + item.salesOutQty,
          retailOutQty: acc.retailOutQty + item.retailOutQty,
          transferNetQty: acc.transferNetQty + item.transferNetQty,
          endQty: acc.endQty + item.endQty,
          endAmount: acc.endAmount + item.endAmount,
        }),
        {
          beginQty: 0,
          purchaseInQty: 0,
          salesOutQty: 0,
          retailOutQty: 0,
          transferNetQty: 0,
          endQty: 0,
          endAmount: 0,
        },
      );
    }

    return { items, total, page, pageSize, summary };
  }
}
