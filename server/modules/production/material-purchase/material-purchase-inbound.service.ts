import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count, sql, inArray, gte, lte } from 'drizzle-orm';
import {
  materialPurchaseInbound,
  materialPurchaseInboundItem,
  materialPurchaseOrder,
  materialPurchaseOrderItem,
  warehouse,
  payable,
} from '@server/database/schema';
import type {
  MaterialPurchaseInbound,
  MaterialPurchaseInboundItem,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../../finance/month-close/month-close.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { StockService, StockChangeItem } from '../../inventory/stock/stock.service';
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
  warehouseId?: string;
  docStartDate?: string;
  docEndDate?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class MaterialPurchaseInboundService {
  private readonly logger = new Logger(MaterialPurchaseInboundService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly stockService: StockService,
  ) {}

  private async generateInboundNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart: string = dateStr.replace(/-/g, '');
    const prefix: string = `MPI${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      materialPurchaseInbound,
      materialPurchaseInbound.inboundNo,
      prefix,
      4,
    );
  }

  private mapInbound(
    row: typeof materialPurchaseInbound.$inferSelect,
  ): MaterialPurchaseInbound {
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

  private mapInboundItem(
    row: typeof materialPurchaseInboundItem.$inferSelect,
  ): MaterialPurchaseInboundItem {
    return {
      id: row.id,
      inboundId: row.inboundId,
      orderItemId: row.orderItemId ?? undefined,
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

  async list(query: ListQuery): Promise<PaginationResult<MaterialPurchaseInbound>> {
    const { page, pageSize, supplierId, status, orderNo, warehouseId, docStartDate, docEndDate, startDate, endDate } = query;
    const conditions = [];
    if (supplierId)
      conditions.push(eq(materialPurchaseInbound.supplierId, supplierId));
    if (status) conditions.push(eq(materialPurchaseInbound.status, status));
    if (orderNo) conditions.push(eq(materialPurchaseInbound.orderNo, orderNo));
    // 店仓（仓库）精确过滤
    if (warehouseId) conditions.push(eq(materialPurchaseInbound.warehouseId, warehouseId));
    // 单据日期（系统创建时间 createdAt）区间过滤，结束日用次日开区间含入整日
    if (docStartDate) conditions.push(sql`${materialPurchaseInbound.createdAt} >= ${docStartDate}`);
    if (docEndDate) {
      const [y, m, d] = docEndDate.split('-').map(Number);
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 1);
      const nextDay = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      conditions.push(sql`${materialPurchaseInbound.createdAt} < ${nextDay}`);
    }
    // 业务日期（入库日期 inboundDate）区间过滤
    if (startDate) conditions.push(gte(materialPurchaseInbound.inboundDate, startDate));
    if (endDate) conditions.push(lte(materialPurchaseInbound.inboundDate, endDate));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset: number = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(materialPurchaseInbound)
        .where(where),
      this.db
        .select()
        .from(materialPurchaseInbound)
        .where(where)
        .orderBy(desc(materialPurchaseInbound.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total: number = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapInbound(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<MaterialPurchaseInbound> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: materialPurchaseInbound.supplierId },
    );
    const where = scopeCond
      ? and(eq(materialPurchaseInbound.id, id), scopeCond)
      : eq(materialPurchaseInbound.id, id);
    const rows = await this.db
      .select()
      .from(materialPurchaseInbound)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购入库单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(materialPurchaseInboundItem)
      .where(eq(materialPurchaseInboundItem.inboundId, id));

    const inbound: MaterialPurchaseInbound = this.mapInbound(rows[0]);
    inbound.items = itemRows.map((row) => this.mapInboundItem(row));
    return inbound;
  }

  async create(dto: CreateInboundDto): Promise<MaterialPurchaseInbound> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    const orderRows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, dto.orderId));
    if (orderRows.length === 0) {
      throw new BadRequestException('面辅料采购订单不存在');
    }
    const order = orderRows[0];
    if (order.status !== 'approved') {
      throw new BadRequestException('只能针对已审核的采购订单入库');
    }

    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }
    const wh = whRows[0];

    await assertWriteWithinScope(this.db, { supplierId: order.supplierId, warehouseId: dto.warehouseId });

    const orderItemIds = dto.items.map((item) => item.orderItemId);
    const orderItemRows = await this.db
      .select()
      .from(materialPurchaseOrderItem)
      .where(inArray(materialPurchaseOrderItem.id, orderItemIds));
    const orderItemMap = new Map<
      string,
      typeof materialPurchaseOrderItem.$inferSelect
    >();
    for (const oi of orderItemRows) {
      if (oi.orderId === dto.orderId) {
        orderItemMap.set(oi.id, oi);
      }
    }

    let totalAmount: number = 0;
    const inboundItems: {
      orderItemId: string | null;
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
      const qty: number = Number(item.quantity);
      const orderedQty: number = Number(orderItem.quantity);
      const receivedQty: number = Number(orderItem.receivedQty);
      if (qty <= 0) {
        throw new BadRequestException('入库数量必须大于0');
      }
      if (qty > orderedQty - receivedQty) {
        throw new BadRequestException(
          `入库数量超过未入库数量：物料 ${orderItem.materialName}，最大可入库 ${(
            orderedQty - receivedQty
          ).toFixed(3)}`,
        );
      }
      const price: number = Number(orderItem.price);
      const amt: number = qty * price;
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
      const inboundNo: string = await this.generateInboundNo(tx, dto.inboundDate);
      const inserted = await tx
        .insert(materialPurchaseInbound)
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

      const inboundId: string = inserted[0].id;
      await tx.insert(materialPurchaseInboundItem).values(
        inboundItems.map((item) => ({
          ...item,
          inboundId,
        })),
      );

      return inserted[0];
    });

    this.logger.log(`创建面辅料采购入库单成功: id=${created.id}, inboundNo=${created.inboundNo}`);

    return this.getDetail(created.id);
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(materialPurchaseInbound)
      .where(eq(materialPurchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的入库单才能审核');
    }
    const inbound = rows[0];

    await this.monthCloseService.checkMonthClosed(inbound.inboundDate);

    const itemRows = await this.db
      .select()
      .from(materialPurchaseInboundItem)
      .where(eq(materialPurchaseInboundItem.inboundId, id));

    await this.db.transaction(async (tx) => {
      // 1. 更新入库单状态
      await tx
        .update(materialPurchaseInbound)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(materialPurchaseInbound.id, id));

      // 2. 更新采购订单明细的 receivedQty
      for (const item of itemRows) {
        if (!item.orderItemId) continue;
        const qty: number = Number(item.quantity);
        await tx
          .update(materialPurchaseOrderItem)
          .set({
            receivedQty: sql`${materialPurchaseOrderItem.receivedQty} + ${round3(
              qty,
            )}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(materialPurchaseOrderItem.id, item.orderItemId));
      }

      // 3. 检查订单所有明细是否都已全部入库
      const orderItemRows = await tx
        .select()
        .from(materialPurchaseOrderItem)
        .where(eq(materialPurchaseOrderItem.orderId, inbound.orderId));
      const allCompleted: boolean = orderItemRows.every((oi) => {
        const q: number = Number(oi.quantity);
        const r: number = Number(oi.receivedQty);
        return r >= q;
      });
      if (allCompleted) {
        await tx
          .update(materialPurchaseOrder)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(materialPurchaseOrder.id, inbound.orderId));
      }

      // 4+5. 增加面辅料库存 + 生成库存流水（统一收敛到 StockService：原子 upsert + 批量流水）
      const stockChanges: StockChangeItem[] = itemRows.map((item) => ({
        warehouseId: inbound.warehouseId,
        warehouseName: inbound.warehouseName,
        materialId: item.materialId,
        itemType: 'material',
        qtyDelta: Number(item.quantity),
        flowType: 'purchase_inbound',
        bizNo: inbound.inboundNo,
        batchNo: item.batchNo ?? null,
        unitPrice: item.price ?? null,
        materialCode: item.materialCode,
        materialName: item.materialName,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 6. 生成应付单
      const payableNo: string = `AP-${inbound.inboundNo}`;
      await tx.insert(payable).values({
        payableNo,
        supplierId: inbound.supplierId,
        supplierName: inbound.supplierName,
        bizType: 'material_purchase_inbound',
        bizNo: inbound.inboundNo,
        amount: inbound.totalAmount,
        paidAmount: '0',
        balance: inbound.totalAmount,
        status: 'unpaid',
        remark: `面辅料采购入库 ${inbound.inboundNo}`,
      });
    });

    this.logger.log(`审核面辅料采购入库单成功: id=${id}`);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, materialPurchaseInbound, id);
  }

  async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(materialPurchaseInbound)
      .where(eq(materialPurchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的入库单');
    }
    await this.db
      .delete(materialPurchaseInbound)
      .where(eq(materialPurchaseInbound.id, id));
    this.logger.log(`删除面辅料采购入库单成功: id=${id}`);
  }
}
