import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, sql, inArray } from 'drizzle-orm';
import {
  allocationOrder,
  allocationItem,
  preOrder,
  preOrderItem,
  tradeShow,
  style,
  sku,
  inventoryStock,
  inventoryFlow,
  salesOrder,
  salesOrderItem,
  salesOutbound,
  salesOutboundItem,
  receivable,
  inventoryTransfer,
  inventoryTransferItem,
  warehouse,
  store,
  dealer,
} from '@server/database/schema';
import type {
  AllocationOrder,
  AllocationItem as AllocationItemType,
  PreOrderSummary,
  PreOrderSummaryBreakdown,
  PreOrderSkuSummary,
  PreOrderSkuSummaryItem,
  PaginationResult,
} from '@shared/api.interface';
import { bulkUpsert } from '@server/common/batch';
import { StockService, type StockChangeItem } from '@server/modules/inventory/stock/stock.service';

interface CreateAllocationDto {
  tradeShowId: string;
  styleId: string;
  totalArrivedQty: number;
  remark?: string;
}

interface UpdateAllocationDto {
  totalArrivedQty?: number;
  remark?: string;
  items?: {
    id?: string;
    skuId: string;
    allocatedQty: number;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  tradeShowId?: string;
  styleId?: string;
  status?: string;
}

import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../common/utils/money';




function generateReceivableNo(outboundNo: string): string {
  return `AR-${outboundNo}`;
}

@Injectable()
export class AllocationService {
  private readonly logger = new Logger(AllocationService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateAllocationNo(
    tx: PostgresJsDatabase,
    tradeShowRow: typeof tradeShow.$inferSelect,
  ): Promise<string> {
    const yearPart = (tradeShowRow.year ?? '').slice(-2);
    const seasonPart = (tradeShowRow.season ?? '').slice(0, 3).toUpperCase();
    const prefix = `AL${yearPart}${seasonPart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      allocationOrder,
      allocationOrder.allocationNo,
      prefix,
      4,
    );
  }

  private async generateSalesOrderNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `SO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      salesOrder,
      salesOrder.orderNo,
      prefix,
      4,
    );
  }

  private async generateOutboundNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `DO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      salesOutbound,
      salesOutbound.outboundNo,
      prefix,
      4,
    );
  }

  private async generateTransferNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `TR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      inventoryTransfer,
      inventoryTransfer.transferNo,
      prefix,
      4,
    );
  }

  private mapOrder(row: typeof allocationOrder.$inferSelect): AllocationOrder {
    return {
      id: row.id,
      allocationNo: row.allocationNo,
      tradeShowId: row.tradeShowId,
      tradeShowName: row.tradeShowName,
      styleId: row.styleId,
      styleNo: row.styleNo,
      styleName: row.styleName,
      totalArrivedQty: Number(row.totalArrivedQty),
      totalAllocatedQty: Number(row.totalAllocatedQty),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapItem(row: typeof allocationItem.$inferSelect): AllocationItemType {
    return {
      id: row.id,
      allocationId: row.allocationId,
      preOrderId: row.preOrderId ?? undefined,
      submitterType: row.submitterType,
      dealerId: row.dealerId ?? undefined,
      dealerName: row.dealerName ?? undefined,
      storeId: row.storeId ?? undefined,
      storeName: row.storeName ?? undefined,
      skuId: row.skuId,
      skuCode: row.skuCode,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      preQty: Number(row.preQty),
      allocatedQty: Number(row.allocatedQty),
      generatedDocType: row.generatedDocType ?? undefined,
      generatedDocId: row.generatedDocId ?? undefined,
      generatedDocNo: row.generatedDocNo ?? undefined,
    };
  }

  // ========== 配货单 CRUD ==========

  async list(query: ListQuery): Promise<PaginationResult<AllocationOrder>> {
    const { page, pageSize, tradeShowId, styleId, status } = query;
    const conditions = [];
    if (tradeShowId)
      conditions.push(eq(allocationOrder.tradeShowId, tradeShowId));
    if (styleId) conditions.push(eq(allocationOrder.styleId, styleId));
    if (status) conditions.push(eq(allocationOrder.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(allocationOrder).where(where),
      this.db
        .select()
        .from(allocationOrder)
        .where(where)
        .orderBy(desc(allocationOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapOrder(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<AllocationOrder> {
    const rows = await this.db
      .select()
      .from(allocationOrder)
      .where(eq(allocationOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('配货单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(allocationItem)
      .where(eq(allocationItem.allocationId, id))
      .orderBy(allocationItem.id);

    const result = this.mapOrder(rows[0]);
    result.items = itemRows.map((row) => this.mapItem(row));
    return result;
  }

  async create(dto: CreateAllocationDto, userId: string): Promise<AllocationOrder> {
    if (dto.totalArrivedQty <= 0) {
      throw new BadRequestException('到货数量必须大于0');
    }

    // 校验订货会
    const [showRow] = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, dto.tradeShowId));
    if (!showRow) {
      throw new NotFoundException('订货会不存在');
    }

    // 校验款号
    const [styleRow] = await this.db
      .select()
      .from(style)
      .where(eq(style.id, dto.styleId));
    if (!styleRow) {
      throw new NotFoundException('款号不存在');
    }

    // 查询所有 submitted/confirmed 状态的预订单
    const validOrders = await this.db
      .select()
      .from(preOrder)
      .where(
        and(
          eq(preOrder.tradeShowId, dto.tradeShowId),
          eq(preOrder.styleId, dto.styleId),
          inArray(preOrder.status, ['submitted', 'confirmed']),
        ),
      );

    if (validOrders.length === 0) {
      throw new BadRequestException('该款号无已提交或已确认的预订单，无法创建配货单');
    }

    const preOrderIds = validOrders.map((o) => o.id);
    const allItems = await this.db
      .select()
      .from(preOrderItem)
      .where(inArray(preOrderItem.preOrderId, preOrderIds));

    const preOrderMap = new Map<string, typeof preOrder.$inferSelect>();
    for (const po of validOrders) {
      preOrderMap.set(po.id, po);
    }

    const result = await this.db.transaction(async (tx) => {
      const allocationNo = await this.generateAllocationNo(tx, showRow);

      const [inserted] = await tx
        .insert(allocationOrder)
        .values({
          allocationNo,
          tradeShowId: dto.tradeShowId,
          tradeShowName: showRow.name,
          styleId: dto.styleId,
          styleNo: styleRow.styleNo,
          styleName: styleRow.name,
          totalArrivedQty: round3(dto.totalArrivedQty),
          totalAllocatedQty: '0',
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      // 生成明细行
      const allocItems = allItems.map((item) => {
        const po = preOrderMap.get(item.preOrderId)!;
        return {
          allocationId: inserted.id,
          preOrderId: po.id,
          submitterType: po.submitterType,
          dealerId: po.dealerId,
          dealerName: po.dealerName,
          storeId: po.storeId,
          storeName: po.storeName,
          skuId: item.skuId,
          skuCode: item.skuCode,
          color: item.color,
          size: item.size,
          preQty: item.qty,
          allocatedQty: '0',
        };
      });

      await tx.insert(allocationItem).values(allocItems);

      return inserted;
    });

    this.logger.log(
      `创建配货单成功: id=${result.id}, allocationNo=${result.allocationNo}, operator=${userId}`,
    );

    return this.getDetail(result.id);
  }

  async update(
    id: string,
    dto: UpdateAllocationDto,
    userId: string,
  ): Promise<AllocationOrder> {
    const existing = await this.db
      .select()
      .from(allocationOrder)
      .where(eq(allocationOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('配货单不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的配货单可以修改');
    }

    const patch: Partial<typeof allocationOrder.$inferInsert> = {};
    if (dto.totalArrivedQty !== undefined) {
      if (dto.totalArrivedQty <= 0) {
        throw new BadRequestException('到货数量必须大于0');
      }
      patch.totalArrivedQty = round3(dto.totalArrivedQty);
    }
    if (dto.remark !== undefined) {
      patch.remark = dto.remark;
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await tx
          .update(allocationOrder)
          .set(patch)
          .where(eq(allocationOrder.id, id));
      }

      if (dto.items && dto.items.length > 0) {
        let totalAllocated = 0;
        for (const item of dto.items) {
          if (item.allocatedQty < 0) {
            throw new BadRequestException('分配数量不能为负');
          }
          if (item.id) {
            await tx
              .update(allocationItem)
              .set({ allocatedQty: round3(item.allocatedQty) })
              .where(eq(allocationItem.id, item.id));
          }
          totalAllocated += item.allocatedQty;
        }

        await tx
          .update(allocationOrder)
          .set({
            totalAllocatedQty: round3(totalAllocated),
            updatedAt: new Date(),
          })
          .where(eq(allocationOrder.id, id));
      }
    });

    this.logger.log(
      `更新配货单成功: id=${id}, operator=${userId}`,
    );

    return this.getDetail(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, allocationOrder, id);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(allocationOrder)
      .where(eq(allocationOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('配货单不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的配货单可以删除');
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(allocationItem).where(eq(allocationItem.allocationId, id));
      await tx.delete(allocationOrder).where(eq(allocationOrder.id, id));
    });

    this.logger.log(
      `删除配货单成功: id=${id}, operator=${userId}`,
    );
  }

  // ========== 预订汇总 ==========

  async getStyleSummary(tradeShowId: string, brand?: string): Promise<PreOrderSummary[]> {
    const conditions = [
      eq(preOrder.tradeShowId, tradeShowId),
      inArray(preOrder.status, ['submitted', 'confirmed']),
    ];
    if (brand) conditions.push(eq(style.brand, brand));
    const whereClause = and(...conditions);

    const rows = await this.db
      .select({
        styleId: preOrder.styleId,
        styleNo: preOrder.styleNo,
        styleName: preOrder.styleName,
        brand: style.brand,
        submitterType: preOrder.submitterType,
        dealerId: preOrder.dealerId,
        dealerName: preOrder.dealerName,
        storeId: preOrder.storeId,
        storeName: preOrder.storeName,
        totalQty: sql<number>`SUM(${preOrderItem.qty})`,
      })
      .from(preOrder)
      .innerJoin(preOrderItem, eq(preOrderItem.preOrderId, preOrder.id))
      .innerJoin(style, eq(preOrder.styleId, style.id))
      .where(whereClause)
      .groupBy(
        preOrder.styleId,
        preOrder.styleNo,
        preOrder.styleName,
        style.brand,
        preOrder.submitterType,
        preOrder.dealerId,
        preOrder.dealerName,
        preOrder.storeId,
        preOrder.storeName,
      );

    // 按款号聚合
    const styleMap = new Map<string, PreOrderSummary>();
    for (const row of rows) {
      if (!row.styleId) continue;
      const key = row.styleId;
      if (!styleMap.has(key)) {
        styleMap.set(key, {
          styleId: row.styleId,
          styleNo: row.styleNo ?? '',
          styleName: row.styleName ?? '',
          brand: row.brand ?? undefined,
          totalQty: 0,
          breakdown: [],
        });
      }
      const entry = styleMap.get(key)!;
      const qty = Number(row.totalQty);
      entry.totalQty += qty;

      let partyId = '';
      let partyName = '';
      let partyType = '';
      if (row.submitterType === 'dealer') {
        partyId = row.dealerId ?? '';
        partyName = row.dealerName ?? '';
        partyType = 'dealer';
      } else {
        partyId = row.storeId ?? '';
        partyName = row.storeName ?? '';
        partyType = 'store';
      }

      // 合并 breakdown
      const existing = entry.breakdown.find(
        (b: PreOrderSummaryBreakdown) => b.partyId === partyId,
      );
      if (existing) {
        existing.qty += qty;
      } else {
        entry.breakdown.push({ partyId, partyName, partyType, qty });
      }
    }

    return Array.from(styleMap.values());
  }

  async getSkuSummary(
    tradeShowId: string,
    styleId: string,
  ): Promise<PreOrderSkuSummary> {
    const [styleRow] = await this.db
      .select()
      .from(style)
      .where(eq(style.id, styleId));
    if (!styleRow) {
      throw new NotFoundException('款号不存在');
    }

    const rows = await this.db
      .select({
        skuId: preOrderItem.skuId,
        skuCode: preOrderItem.skuCode,
        color: preOrderItem.color,
        size: preOrderItem.size,
        submitterType: preOrder.submitterType,
        dealerId: preOrder.dealerId,
        dealerName: preOrder.dealerName,
        storeId: preOrder.storeId,
        storeName: preOrder.storeName,
        totalQty: sql<number>`SUM(${preOrderItem.qty})`,
      })
      .from(preOrderItem)
      .innerJoin(preOrder, eq(preOrder.id, preOrderItem.preOrderId))
      .where(
        and(
          eq(preOrder.tradeShowId, tradeShowId),
          eq(preOrder.styleId, styleId),
          inArray(preOrder.status, ['submitted', 'confirmed']),
        ),
      )
      .groupBy(
        preOrderItem.skuId,
        preOrderItem.skuCode,
        preOrderItem.color,
        preOrderItem.size,
        preOrder.submitterType,
        preOrder.dealerId,
        preOrder.dealerName,
        preOrder.storeId,
        preOrder.storeName,
      )
      .orderBy(preOrderItem.skuCode);

    const skuMap = new Map<string, PreOrderSkuSummaryItem>();
    for (const row of rows) {
      const key = row.skuId;
      if (!skuMap.has(key)) {
        skuMap.set(key, {
          skuId: row.skuId,
          color: row.color ?? '',
          size: row.size ?? '',
          totalQty: 0,
          breakdown: [],
        });
      }
      const entry = skuMap.get(key)!;
      const qty = Number(row.totalQty);
      entry.totalQty += qty;

      let partyId = '';
      let partyName = '';
      let partyType = '';
      if (row.submitterType === 'dealer') {
        partyId = row.dealerId ?? '';
        partyName = row.dealerName ?? '';
        partyType = 'dealer';
      } else {
        partyId = row.storeId ?? '';
        partyName = row.storeName ?? '';
        partyType = 'store';
      }

      const existing = entry.breakdown.find(
        (b: PreOrderSummaryBreakdown) => b.partyId === partyId,
      );
      if (existing) {
        existing.qty += qty;
      } else {
        entry.breakdown.push({ partyId, partyName, partyType, qty });
      }
    }

    return {
      styleId: styleRow.id,
      styleNo: styleRow.styleNo,
      styleName: styleRow.name,
      items: Array.from(skuMap.values()),
    };
  }

  // ========== 审核配货单：生成下游单据 ==========

  async approve(id: string, userId: string): Promise<AllocationOrder> {
    const existing = await this.db
      .select()
      .from(allocationOrder)
      .where(eq(allocationOrder.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('配货单不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的配货单可以审核');
    }

    const allocOrder = existing[0];
    const totalArrived = Number(allocOrder.totalArrivedQty);
    const totalAllocated = Number(allocOrder.totalAllocatedQty);

    if (totalAllocated > totalArrived) {
      throw new BadRequestException('分配总量不能超过总到货量');
    }
    if (totalAllocated <= 0) {
      throw new BadRequestException('分配总量必须大于0');
    }

    const itemRows = await this.db
      .select()
      .from(allocationItem)
      .where(eq(allocationItem.allocationId, id));

    if (itemRows.length === 0) {
      throw new BadRequestException('配货单无明细');
    }

    // 查找总部成品仓
    const [hqWarehouse] = await this.db
      .select()
      .from(warehouse)
      .where(and(eq(warehouse.type, 'finished'), eq(warehouse.status, 'active')))
      .limit(1);
    if (!hqWarehouse) {
      throw new NotFoundException('未找到总部成品仓库');
    }

    const today = new Date().toISOString().slice(0, 10);
    const datePart = today.replace(/-/g, '');

    await this.db.transaction(async (tx) => {
      // 按 submitterType + party(经销商/门店) 分组
      const dealerGroups = new Map<string, typeof itemRows>();
      const storeGroups = new Map<string, typeof itemRows>();

      for (const item of itemRows) {
        const qty = Number(item.allocatedQty);
        if (qty <= 0) continue;
        if (item.submitterType === 'dealer' && item.dealerId) {
          const list = dealerGroups.get(item.dealerId) ?? [];
          list.push(item);
          dealerGroups.set(item.dealerId, list);
        } else if (item.submitterType === 'direct' && item.storeId) {
          const list = storeGroups.get(item.storeId) ?? [];
          list.push(item);
          storeGroups.set(item.storeId, list);
        }
      }

      // 收集批量操作数据，事务末尾一次性提交，消除循环内逐行 N+1
      const allocItemUpdates: { id: string; docType: string; docId: string; docNo: string }[] = [];
      const transferOutChanges: StockChangeItem[] = [];
      const transferInTransitFlows: (typeof inventoryFlow.$inferInsert)[] = [];
      const inTransitUpsertMap = new Map<string, (typeof inventoryStock.$inferInsert)>();

      // 处理经销商：生成销售订单 + 销售出库 + 应收
      for (const [dealerId, items] of dealerGroups) {
        const dealerName = items[0].dealerName ?? '未知经销商';

        // 客户主数据已移除：经销商即业务归属方，销售单/出库单/应收单直接挂 dealerId。

        const orderNo = await this.numberGenerator.generateNextNo(
          tx,
          salesOrder,
          salesOrder.orderNo,
          `SO${datePart}`,
          4,
        );

        // 计算订单明细和总金额
        const skuIds = items.map((it) => it.skuId);
        const skuRows = await tx.select().from(sku).where(inArray(sku.id, skuIds));
        const skuMap = new Map<string, typeof sku.$inferSelect>();
        for (const s of skuRows) skuMap.set(s.id, s);

        let orderTotalAmount = 0;
        const orderItemValues: (typeof salesOrderItem.$inferInsert)[] = [];

        for (const item of items) {
          const qty = Number(item.allocatedQty);
          const skuItem = skuMap.get(item.skuId);
          const price = skuItem ? Number(skuItem.supplyPrice) : 0;
          const amount = qty * price;
          orderTotalAmount += amount;

          orderItemValues.push({
            orderId: '', // 稍后填充
            skuId: item.skuId,
            skuCode: item.skuCode,
            styleNo: allocOrder.styleNo,
            color: item.color ?? '',
            size: item.size ?? '',
            quantity: round3(qty),
            price: round4(price),
            amount: round2(amount),
            deliveredQty: '0',
          });
        }

        const [orderRow] = await tx
          .insert(salesOrder)
          .values({
            orderNo,
            dealerId,
            customerName: dealerName,
            orderDate: today,
            totalAmount: String(round2(orderTotalAmount)),
            status: 'approved',
            remark: `订货会配货单 ${allocOrder.allocationNo} 自动生成`,
          })
          .returning();

        // 写入订单明细
        const orderItemsWithId = orderItemValues.map((oi) => ({
          ...oi,
          orderId: orderRow.id,
        }));
        const insertedOrderItems = await tx
          .insert(salesOrderItem)
          .values(orderItemsWithId)
          .returning();

        const orderItemIdMap = new Map<string, string>(); // skuId -> orderItemId
        for (const oi of insertedOrderItems) {
          orderItemIdMap.set(oi.skuId, oi.id);
        }

        const outboundNo = await this.numberGenerator.generateNextNo(
          tx,
          salesOutbound,
          salesOutbound.outboundNo,
          `DO${datePart}`,
          4,
        );
        let outboundTotal = 0;
        let outboundCostTotal = 0;
        const outboundItemValues: (typeof salesOutboundItem.$inferInsert)[] = [];

        for (const item of items) {
          const qty = Number(item.allocatedQty);
          const skuItem = skuMap.get(item.skuId);
          const price = skuItem ? Number(skuItem.supplyPrice) : 0;
          const costPrice = skuItem ? Number(skuItem.costPrice) : 0;
          const amount = qty * price;
          const costAmount = qty * costPrice;
          outboundTotal += amount;
          outboundCostTotal += costAmount;

          outboundItemValues.push({
            outboundId: '',
            orderItemId: orderItemIdMap.get(item.skuId) ?? '',
            skuId: item.skuId,
            skuCode: item.skuCode,
            styleNo: allocOrder.styleNo,
            color: item.color ?? '',
            size: item.size ?? '',
            quantity: String(round3(qty)),
            price: String(round4(price)),
            costPrice: String(round4(costPrice)),
            amount: String(round2(amount)),
            costAmount: String(round2(costAmount)),
            batchNo: null,
          });
        }

        const [outboundRow] = await tx
          .insert(salesOutbound)
          .values({
            outboundNo,
            orderId: orderRow.id,
            orderNo,
            dealerId,
            customerName: dealerName,
            warehouseId: hqWarehouse.id,
            warehouseName: hqWarehouse.name,
            outboundDate: today,
            totalAmount: String(round2(outboundTotal)),
            costAmount: String(round2(outboundCostTotal)),
            status: 'approved',
            remark: `订货会配货单 ${allocOrder.allocationNo} 自动生成`,
          })
          .returning();

        // 写入出库明细
        const outboundItemsWithId = outboundItemValues.map((oi) => ({
          ...oi,
          outboundId: outboundRow.id,
        }));
        await tx.insert(salesOutboundItem).values(outboundItemsWithId);

        // 更新销售订单明细 deliveredQty（单条 CASE UPDATE 替代逐条 UPDATE N+1）
        const delivIds: string[] = [];
        const delivCases = items
          .map((item) => {
            const qty = Number(item.allocatedQty);
            const orderItemId = orderItemIdMap.get(item.skuId);
            if (!orderItemId) return null;
            delivIds.push(orderItemId);
            return sql`WHEN ${salesOrderItem.id} = ${orderItemId} THEN ${salesOrderItem.deliveredQty} + ${round3(qty)}::numeric`;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        if (delivCases.length > 0) {
          await tx
            .update(salesOrderItem)
            .set({
              deliveredQty: sql`CASE ${sql.join(delivCases, sql` `)} ELSE ${salesOrderItem.deliveredQty} END`,
            })
            .where(inArray(salesOrderItem.id, delivIds));
        }

        // 扣减总部成品仓 SKU 库存 + 流水
        const stockChanges = items.map((item) => ({
          warehouseId: hqWarehouse.id,
          warehouseName: hqWarehouse.name,
          skuId: item.skuId,
          itemType: 'sku' as const,
          qtyDelta: -Number(item.allocatedQty),
          flowType: 'sales_outbound',
          bizNo: outboundNo,
          unitPrice: (skuMap.get(item.skuId)?.supplyPrice ?? '0').toString(),
          skuCode: item.skuCode,
          styleNo: allocOrder.styleNo,
          color: item.color ?? undefined,
          size: item.size ?? undefined,
        }));
        await this.stockService.batchChangeStock(tx, stockChanges);

        // 生成应收单
        const receivableNo = generateReceivableNo(outboundNo);
        await tx.insert(receivable).values({
          receivableNo,
          dealerId,
          customerName: dealerName,
          bizType: 'sales_outbound',
          bizNo: outboundNo,
          amount: String(round2(outboundTotal)),
          receivedAmount: '0',
          balance: String(round2(outboundTotal)),
          status: 'unpaid',
          remark: `订货会配货销售出库 ${outboundNo}`,
        });

        // 回写 allocation_item（收集，事务末尾统一 CASE UPDATE）
        for (const item of items) {
          allocItemUpdates.push({
            id: item.id,
            docType: 'sales',
            docId: outboundRow.id,
            docNo: outboundNo,
          });
        }
      }

      // 处理直营店：生成调拨单（总部成品仓 → 门店仓库）
      // 批量预取门店与关联仓库，避免逐店 N+1（原每个门店组都查一次 store + 一次 warehouse）
      const allStoreIds = [...storeGroups.keys()];
      const storeBatch = await tx
        .select()
        .from(store)
        .where(inArray(store.id, allStoreIds));
      const storeMap = new Map<string, typeof store.$inferSelect>();
      for (const s of storeBatch) storeMap.set(s.id, s);
      const allWarehouseIds = [
        ...new Set(storeBatch.map((s) => s.warehouseId).filter((w): w is string => !!w)),
      ];
      const warehouseBatch = allWarehouseIds.length
        ? await tx.select().from(warehouse).where(inArray(warehouse.id, allWarehouseIds))
        : [];
      const warehouseMap = new Map<string, typeof warehouse.$inferSelect>();
      for (const w of warehouseBatch) warehouseMap.set(w.id, w);

      for (const [storeId, items] of storeGroups) {
        const storeName = items[0].storeName ?? '未知门店';

        // 从批量预取结果中查门店与关联仓库（已建索引，无需逐店查询）
        const storeRow = storeMap.get(storeId);
        if (!storeRow || !storeRow.warehouseId) {
          throw new BadRequestException(`门店 ${storeName} 未关联仓库`);
        }

        const toWarehouse = warehouseMap.get(storeRow.warehouseId);
        if (!toWarehouse) {
          throw new NotFoundException(`门店 ${storeName} 关联仓库不存在`);
        }

        const transferNo = await this.numberGenerator.generateNextNo(
          tx,
          inventoryTransfer,
          inventoryTransfer.transferNo,
          `TR${datePart}`,
          4,
        );
        const [transferRow] = await tx
          .insert(inventoryTransfer)
          .values({
            transferNo,
            fromWarehouseId: hqWarehouse.id,
            fromWarehouseName: hqWarehouse.name,
            toWarehouseId: toWarehouse.id,
            toWarehouseName: toWarehouse.name,
            transferDate: today,
            itemType: 'sku',
            status: 'in_transit',
            remark: `订货会配货单 ${allocOrder.allocationNo} 自动生成`,
          })
          .returning();

        // 写入调拨明细 + 处理库存
        const skuIds = items.map((it) => it.skuId);
        const skuRows = await tx.select().from(sku).where(inArray(sku.id, skuIds));
        const skuMap = new Map<string, typeof sku.$inferSelect>();
        for (const s of skuRows) skuMap.set(s.id, s);

        const transferItemValues = items.map((item) => ({
          transferId: transferRow.id,
          skuId: item.skuId,
          itemCode: item.skuCode,
          itemName: skuMap.get(item.skuId)?.styleNo ?? item.skuCode,
          color: item.color,
          size: item.size,
          quantity: item.allocatedQty,
        }));
        await tx.insert(inventoryTransferItem).values(transferItemValues);

        // 在途库存的逐条 SELECT + UPDATE/INSERT 已移除，改为事务末尾 bulkUpsert 一次性累加（见下方第 2 步）

        // 收集调出/调入库存变动与流水，事务末尾统一批量提交，消除逐条 N+1
        for (const item of items) {
          const qty = Number(item.allocatedQty);
          const skuInfo = skuMap.get(item.skuId);
          if (!skuInfo) continue;

          // 调出仓库扣减（收集，事务末尾统一 batchChangeStock，保留逐条原子扣减 + 流水）
          transferOutChanges.push({
            warehouseId: hqWarehouse.id,
            warehouseName: hqWarehouse.name,
            skuId: item.skuId,
            itemType: 'sku',
            qtyDelta: -qty,
            flowType: 'transfer_out',
            bizNo: transferNo,
            skuCode: item.skuCode,
            styleNo: skuInfo.styleNo,
            color: skuInfo.color,
            size: skuInfo.size,
            remark: '订货会配货调拨',
          });

          // 调入仓库在途增加（按键合并，事务末尾统一多值 upsert 累加）
          const tKey = `${item.skuId}|${toWarehouse.id}`;
          const tq = round3(qty);
          const exist = inTransitUpsertMap.get(tKey);
          if (exist) {
            exist.inTransitQty = round3(Number(exist.inTransitQty ?? 0) + Number(tq));
          } else {
            inTransitUpsertMap.set(tKey, {
              skuId: item.skuId,
              skuCode: item.skuCode,
              styleNo: skuInfo.styleNo,
              color: skuInfo.color,
              size: skuInfo.size,
              warehouseId: toWarehouse.id,
              warehouseName: toWarehouse.name,
              inTransitQty: tq,
            });
          }

          // 在途调入流水（收集，事务末尾统一批量 INSERT）
          transferInTransitFlows.push({
            flowType: 'transfer_in_transit',
            bizNo: transferNo,
            direction: 'in',
            itemType: 'sku',
            skuId: item.skuId,
            styleNo: skuInfo.styleNo,
            color: skuInfo.color,
            size: skuInfo.size,
            warehouseId: toWarehouse.id,
            warehouseName: toWarehouse.name,
            quantity: String(round3(qty)),
            remark: `订货会配货调拨`,
          });

          // 回写 allocation_item（收集，事务末尾统一 CASE UPDATE）
          allocItemUpdates.push({
            id: item.id,
            docType: 'transfer',
            docId: transferRow.id,
            docNo: transferNo,
          });
        }
      }

      // ===== 事务末尾：批量提交收集的数据，消除循环内逐行 N+1 =====
      // 1) 调出仓库扣减：一次性 batchChangeStock（内部逐条原子扣减 + 流水，保留库存不足防护）
      if (transferOutChanges.length > 0) {
        await this.stockService.batchChangeStock(tx, transferOutChanges);
      }

      // 2) 调入仓库在途库存：一次性多值 upsert（按键合并累加）
      const inTransitRows = [...inTransitUpsertMap.values()];
      if (inTransitRows.length > 0) {
        await bulkUpsert(
          tx,
          inventoryStock,
          inTransitRows,
          [inventoryStock.skuId, inventoryStock.warehouseId],
          { inTransitQty: sql`${inventoryStock.inTransitQty} + EXCLUDED.in_transit_qty` },
        );
      }

      // 3) 在途调入流水：一次性批量 INSERT
      if (transferInTransitFlows.length > 0) {
        await tx.insert(inventoryFlow).values(transferInTransitFlows);
      }

      // 4) allocation_item 回写：一次性 CASE UPDATE（generatedDocType/Id/No）
      if (allocItemUpdates.length > 0) {
        const idCases = allocItemUpdates.map(
          (u) => sql`WHEN ${allocationItem.id} = ${u.id} THEN ${u.docType}`,
        );
        const docIdCases = allocItemUpdates.map(
          (u) => sql`WHEN ${allocationItem.id} = ${u.id} THEN ${u.docId}`,
        );
        const docNoCases = allocItemUpdates.map(
          (u) => sql`WHEN ${allocationItem.id} = ${u.id} THEN ${u.docNo}`,
        );
        await tx
          .update(allocationItem)
          .set({
            generatedDocType: sql`CASE ${sql.join(idCases, sql` `)} ELSE ${allocationItem.generatedDocType} END`,
            generatedDocId: sql`CASE ${sql.join(docIdCases, sql` `)} ELSE ${allocationItem.generatedDocId} END`,
            generatedDocNo: sql`CASE ${sql.join(docNoCases, sql` `)} ELSE ${allocationItem.generatedDocNo} END`,
          })
          .where(inArray(allocationItem.id, allocItemUpdates.map((u) => u.id)));
      }

      // 更新配货单状态
      const [updated] = await tx
        .update(allocationOrder)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(allocationOrder.id, id))
        .returning();

      return updated[0];
    });

    this.logger.log(
      `审核配货单成功: id=${id}, allocationNo=${allocOrder.allocationNo}, operator=${userId}`,
    );

    return this.getDetail(id);
  }
}
