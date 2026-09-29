import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, sql, and } from 'drizzle-orm';
import {
  salesOrder,
  salesOrderItem,
  salesOutbound,
  salesOutboundItem,
} from '@server/database/schema';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import type {
  ProfitAnalysis,
  ProfitAnalysisItem,
} from '@shared/api.interface';

@Injectable()
export class ProfitService {
  private readonly logger = new Logger(ProfitService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getOrderProfit(orderId: string): Promise<ProfitAnalysis> {
    const profitScope = buildAggregationScope('profit');
    const orderRows = await this.db
      .select()
      .from(salesOrder)
      .where(profitScope ? and(eq(salesOrder.id, orderId), profitScope) : eq(salesOrder.id, orderId));
    if (orderRows.length === 0) {
      throw new NotFoundException('销售订单不存在');
    }
    const order = orderRows[0];

    // 订单明细（销售金额来源）
    const orderItemRows = await this.db
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.orderId, orderId));

    // 已出库的出库单
    const outboundRows = await this.db
      .select()
      .from(salesOutbound)
      .where(eq(salesOutbound.orderId, orderId));
    const outboundIds = outboundRows.map((o) => o.id);

    // 出库单明细
    let outboundItemRows: typeof salesOutboundItem.$inferSelect[] = [];
    if (outboundIds.length > 0) {
      const result = await this.db
        .select()
        .from(salesOutboundItem)
        .where(sql`${salesOutboundItem.outboundId} = ANY(ARRAY[${sql.join(
          outboundIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[])`);
      outboundItemRows = result;
    }

    // 按 SKU 汇总结算：销售金额用订单明细的金额作为目标销售金额
    // 出库成本用实际出库的成本金额累计
    const skuMap = new Map<string, {
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      orderQty: number;
      orderAmount: number;
      unitPrice: number;
      outboundQty: number;
      costAmount: number;
    }>();

    for (const item of orderItemRows) {
      skuMap.set(item.skuId, {
        skuCode: item.skuCode,
        styleNo: item.styleNo,
        color: item.color,
        size: item.size,
        orderQty: Number(item.quantity),
        orderAmount: Number(item.amount),
        unitPrice: Number(item.price),
        outboundQty: 0,
        costAmount: 0,
      });
    }

    for (const obItem of outboundItemRows) {
      const existing = skuMap.get(obItem.skuId);
      if (existing) {
        existing.outboundQty += Number(obItem.quantity);
        existing.costAmount += Number(obItem.costAmount);
      } else {
        // 理论上不会发生，但防御性处理
        skuMap.set(obItem.skuId, {
          skuCode: obItem.skuCode,
          styleNo: obItem.styleNo,
          color: obItem.color,
          size: obItem.size,
          orderQty: 0,
          orderAmount: 0,
          unitPrice: Number(obItem.price),
          outboundQty: Number(obItem.quantity),
          costAmount: Number(obItem.costAmount),
        });
      }
    }

    const items: ProfitAnalysisItem[] = [];
    let totalSalesAmount = 0;
    let totalOutboundCost = 0;

    for (const entry of skuMap.values()) {
      // quantity 为累计出库数量；若无出库，则使用订单数量（待出库场景）
      const qty = entry.outboundQty > 0 ? entry.outboundQty : entry.orderQty;
      // 销售金额：按订单单价 * 出库数量（如果已出库），否则为订单金额
      const salesAmt = entry.outboundQty > 0
        ? entry.unitPrice * entry.outboundQty
        : entry.orderAmount;
      // 单位成本：累计平均成本
      const unitCost = entry.outboundQty > 0
        ? entry.costAmount / entry.outboundQty
        : 0;
      const costAmt = entry.costAmount;
      const unitProfit = entry.unitPrice - unitCost;
      const profit = salesAmt - costAmt;

      items.push({
        skuCode: entry.skuCode,
        styleNo: entry.styleNo,
        color: entry.color,
        size: entry.size,
        quantity: Math.round(qty * 1000) / 1000,
        unitPrice: Math.round(entry.unitPrice * 10000) / 10000,
        salesAmount: Math.round(salesAmt * 100) / 100,
        unitCost: Math.round(unitCost * 10000) / 10000,
        costAmount: Math.round(costAmt * 100) / 100,
        unitProfit: Math.round(unitProfit * 10000) / 10000,
        profit: Math.round(profit * 100) / 100,
      });

      totalSalesAmount += salesAmt;
      totalOutboundCost += costAmt;
    }

    const roundedSales = Math.round(totalSalesAmount * 100) / 100;
    const roundedCost = Math.round(totalOutboundCost * 100) / 100;
    const profit = roundedSales - roundedCost;
    const profitRate = roundedSales > 0
      ? Math.round((profit / roundedSales) * 10000) / 100
      : 0;

    return {
      orderNo: order.orderNo,
      customerName: order.customerName,
      salesAmount: roundedSales,
      materialCost: 0,
      outboundCost: roundedCost,
      profit: Math.round(profit * 100) / 100,
      profitRate,
      items,
    };
  }
}
