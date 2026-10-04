import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count, sql, inArray, isNull, gte, lte } from 'drizzle-orm';
import {
  purchaseInbound,
  purchaseInboundItem,
  purchaseOrder,
  purchaseOrderItem,
  warehouse,
  payable,
} from '@server/database/schema';
import {
  PurchaseOrderStatus,
} from '@shared/api.interface';
import type {
  PurchaseInbound,
  PurchaseInboundItem,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../../finance/month-close/month-close.service';
import { StockService } from '../../inventory/stock/stock.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




interface CreateInboundDto {
  orderId: string;
  warehouseId: string;
  inboundDate: string;
  remark?: string;
  items: {
    orderItemId: string;
    quantity: number;
    batchNo?: string;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  supplierId?: string;
  status?: string;
  orderNo?: string;
  startDate?: string;
  endDate?: string;
  warehouseId?: string;
}

@Injectable()
export class PurchaseInboundService {
  private readonly logger = new Logger(PurchaseInboundService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateInboundNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `PI${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      purchaseInbound,
      purchaseInbound.inboundNo,
      prefix,
      4,
    );
  }

  private mapInbound(row: typeof purchaseInbound.$inferSelect): PurchaseInbound {
    return {
      id: row.id,
      inboundNo: row.inboundNo,
      orderId: row.orderId,
      orderNo: row.orderNo,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      inboundDate: row.inboundDate,
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapInboundItem(row: typeof purchaseInboundItem.$inferSelect): PurchaseInboundItem {
    return {
      id: row.id,
      inboundId: row.inboundId,
      orderItemId: row.orderItemId,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      batchNo: row.batchNo ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<PurchaseInbound>> {
    const { page, pageSize, supplierId, status, orderNo, startDate, endDate, warehouseId } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(purchaseInbound.supplierId, supplierId));
    if (status) conditions.push(eq(purchaseInbound.status, status));
    if (orderNo) conditions.push(eq(purchaseInbound.orderNo, orderNo));
    if (startDate) conditions.push(gte(purchaseInbound.inboundDate, startDate));
    if (endDate) conditions.push(lte(purchaseInbound.inboundDate, endDate));
    if (warehouseId) conditions.push(eq(purchaseInbound.warehouseId, warehouseId));

    // 软删除过滤：仅返回未删除记录
    conditions.push(isNull(purchaseInbound.deletedAt));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseInbound).where(where),
      this.db
        .select()
        .from(purchaseInbound)
        .where(where)
        .orderBy(desc(purchaseInbound.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapInbound(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<PurchaseInbound> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: purchaseInbound.supplierId },
    );
    const where = scopeCond
      ? and(eq(purchaseInbound.id, id), scopeCond, isNull(purchaseInbound.deletedAt))
      : and(eq(purchaseInbound.id, id), isNull(purchaseInbound.deletedAt));
    const rows = await this.db
      .select()
      .from(purchaseInbound)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('采购入库单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(purchaseInboundItem)
      .where(eq(purchaseInboundItem.inboundId, id));

    const inbound = this.mapInbound(rows[0]);
    inbound.items = itemRows.map((row) => this.mapInboundItem(row));
    return inbound;
  }

  async create(dto: CreateInboundDto): Promise<PurchaseInbound> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    // 校验采购订单
    const orderRows = await this.db
      .select()
      .from(purchaseOrder)
      .where(eq(purchaseOrder.id, dto.orderId));
    if (orderRows.length === 0) {
      throw new BadRequestException('采购订单不存在');
    }
    const order = orderRows[0];
    if (order.status !== PurchaseOrderStatus.BOOKED) {
      throw new BadRequestException('只能针对已审核的采购订单入库');
    }

    // 校验仓库
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }
    const wh = whRows[0];

    // 写入端行级权限：被引用的供应商/仓库必须属于当前账号可见经销商
    await assertWriteWithinScope(this.db, {
      supplierId: order.supplierId,
      warehouseId: dto.warehouseId,
    });

    // 取订单明细
    const orderItemIds = dto.items.map((item) => item.orderItemId);
    const orderItemRows = await this.db
      .select()
      .from(purchaseOrderItem)
      .where(inArray(purchaseOrderItem.id, orderItemIds));
    const orderItemMap = new Map<string, typeof purchaseOrderItem.$inferSelect>();
    for (const oi of orderItemRows) {
      if (oi.orderId === dto.orderId) {
        orderItemMap.set(oi.id, oi);
      }
    }

    let totalAmount = 0;
    const inboundItems: {
      orderItemId: string;
      materialId: string;
      materialCode: string;
      materialName: string;
      unit: string;
      quantity: string;
      price: string;
      amount: string;
      batchNo: string | null;
    }[] = [];

    for (const item of dto.items) {
      const orderItem = orderItemMap.get(item.orderItemId);
      if (!orderItem) {
        throw new BadRequestException(`订单明细不存在: ${item.orderItemId}`);
      }
      const qty = Number(item.quantity);
      const orderedQty = Number(orderItem.quantity);
      const receivedQty = Number(orderItem.receivedQty);
      if (qty <= 0) {
        throw new BadRequestException('入库数量必须大于0');
      }
      // 校验：入库数量不能超过订单未入库数量
      if (qty > orderedQty - receivedQty) {
        throw new BadRequestException(
          `入库数量超过未入库数量：物料 ${orderItem.materialName}，最大可入库 ${(orderedQty - receivedQty).toFixed(3)}`,
        );
      }
      const price = Number(orderItem.price);
      const amt = qty * price;
      totalAmount += amt;
      inboundItems.push({
        orderItemId: orderItem.id,
        materialId: orderItem.materialId,
        materialCode: orderItem.materialCode,
        materialName: orderItem.materialName,
        unit: orderItem.unit,
        quantity: round3(qty),
        price: round4(price),
        amount: round2(amt),
        batchNo: item.batchNo ?? null,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const inboundNo = await this.generateInboundNo(tx, dto.inboundDate);

      const inserted = await tx
        .insert(purchaseInbound)
        .values({
          inboundNo,
          orderId: order.id,
          orderNo: order.orderNo,
          supplierId: order.supplierId,
          supplierName: order.supplierName,
          warehouseId: wh.id,
          warehouseName: wh.name,
          inboundDate: dto.inboundDate,
          totalAmount: round2(totalAmount),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const inboundId = inserted[0].id;
      await tx.insert(purchaseInboundItem).values(
        inboundItems.map((item) => ({
          ...item,
          inboundId,
        })),
      );

      return inserted[0];
    });

    return this.getDetail(created.id);
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(purchaseInbound)
      .where(eq(purchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的入库单才能审核');
    }
    const inbound = rows[0];

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(inbound.inboundDate);

    const itemRows = await this.db
      .select()
      .from(purchaseInboundItem)
      .where(eq(purchaseInboundItem.inboundId, id));

    await this.db.transaction(async (tx) => {
      // 1. 更新入库单状态
      await tx
        .update(purchaseInbound)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(purchaseInbound.id, id));

      // 2. 批量更新采购订单明细的 receivedQty
      const orderItemUpdates = itemRows.map((item) => {
        const qty = Number(item.quantity);
        return sql`WHEN ${purchaseOrderItem.id} = ${item.orderItemId} THEN ${purchaseOrderItem.receivedQty} + ${round3(qty)}::numeric`;
      });
      const orderItemIds = itemRows.map((item) => item.orderItemId);
      await tx
        .update(purchaseOrderItem)
        .set({
          receivedQty: sql`CASE ${sql.join(orderItemUpdates, sql` `)} ELSE ${purchaseOrderItem.receivedQty} END`,
          updatedAt: new Date(),
        })
        .where(inArray(purchaseOrderItem.id, orderItemIds));

      // 3. 检查订单所有明细是否都已全部入库
      const orderItemRows = await tx
        .select()
        .from(purchaseOrderItem)
        .where(eq(purchaseOrderItem.orderId, inbound.orderId));
      const allCompleted = orderItemRows.every((oi) => {
        const q = Number(oi.quantity);
        const r = Number(oi.receivedQty);
        return r >= q;
      });
      if (allCompleted) {
        await tx
          .update(purchaseOrder)
          .set({ status: PurchaseOrderStatus.ACCEPTED, updatedAt: new Date() })
          .where(eq(purchaseOrder.id, inbound.orderId));
      }

      // 4. 增加面辅料库存 + 生成库存流水
      const stockChanges = itemRows.map((item) => ({
        warehouseId: inbound.warehouseId,
        warehouseName: inbound.warehouseName,
        materialId: item.materialId,
        itemType: 'material' as const,
        qtyDelta: Number(item.quantity),
        flowType: 'purchase_inbound',
        bizNo: inbound.inboundNo,
        batchNo: item.batchNo ?? undefined,
        unitPrice: item.price,
        materialCode: item.materialCode,
        materialName: item.materialName,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 5. 生成应付单
      const payableNo = `AP-${inbound.inboundNo}`;
      await tx.insert(payable).values({
        payableNo,
        supplierId: inbound.supplierId,
        supplierName: inbound.supplierName,
        bizType: 'purchase_inbound',
        bizNo: inbound.inboundNo,
        amount: inbound.totalAmount,
        paidAmount: '0',
        balance: inbound.totalAmount,
        status: 'unpaid',
        remark: `采购入库 ${inbound.inboundNo}`,
      });
    });
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, purchaseInbound, id, {
      draftValue: 'draft',
      notFoundMsg: "采购入库单不存在",
      guardMsg: "只能删除草稿状态的入库单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(purchaseInbound)
      .where(and(eq(purchaseInbound.id, id), isNull(purchaseInbound.deletedAt)));
    if (rows.length === 0) {
      throw new NotFoundException('采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的入库单');
    }
    // 软删除：仅置位 _deleted_at，不物理删除
    await this.db
      .update(purchaseInbound)
      .set({ deletedAt: new Date() })
      .where(eq(purchaseInbound.id, id));
  }
}
