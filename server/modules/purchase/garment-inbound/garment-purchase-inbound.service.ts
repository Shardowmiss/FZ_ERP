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
  garmentPurchaseInbound,
  garmentPurchaseInboundSku,
  garmentPurchaseOrder,
  garmentPurchaseOrderSku,
  warehouse,
  payable,
  sku,
} from '@server/database/schema';
import type {
  GarmentPurchaseInbound,
  GarmentPurchaseInboundSku,
  GarmentPurchaseInboundCreateDto,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../../finance/month-close/month-close.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { StockService, StockChangeItem } from '../../inventory/stock/stock.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




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
export class GarmentPurchaseInboundService {
  private readonly logger = new Logger(GarmentPurchaseInboundService.name);

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
    const prefix: string = `GPI${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      garmentPurchaseInbound,
      garmentPurchaseInbound.inboundNo,
      prefix,
      4,
    );
  }

  private mapInbound(row: typeof garmentPurchaseInbound.$inferSelect): GarmentPurchaseInbound {
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
      totalQty: Number(row.totalQty),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapInboundSku(row: typeof garmentPurchaseInboundSku.$inferSelect): GarmentPurchaseInboundSku {
    return {
      id: row.id,
      inboundId: row.inboundId,
      orderSkuId: row.orderSkuId ?? undefined,
      styleId: row.styleId,
      styleNo: row.styleNo,
      skuId: row.skuId,
      color: row.color,
      size: row.size,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      batchNo: row.batchNo ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<GarmentPurchaseInbound>> {
    const { page, pageSize, supplierId, status, orderNo, warehouseId, docStartDate, docEndDate, startDate, endDate } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(garmentPurchaseInbound.supplierId, supplierId));
    if (status) conditions.push(eq(garmentPurchaseInbound.status, status));
    if (orderNo) conditions.push(eq(garmentPurchaseInbound.orderNo, orderNo));
    // 店仓（仓库）精确过滤
    if (warehouseId) conditions.push(eq(garmentPurchaseInbound.warehouseId, warehouseId));
    // 单据日期（系统创建时间 createdAt）区间过滤，结束日用次日开区间含入整日
    if (docStartDate) conditions.push(sql`${garmentPurchaseInbound.createdAt} >= ${docStartDate}`);
    if (docEndDate) {
      const [y, m, d] = docEndDate.split('-').map(Number);
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 1);
      const nextDay = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      conditions.push(sql`${garmentPurchaseInbound.createdAt} < ${nextDay}`);
    }
    // 业务日期（入库日期 inboundDate）区间过滤
    if (startDate) conditions.push(gte(garmentPurchaseInbound.inboundDate, startDate));
    if (endDate) conditions.push(lte(garmentPurchaseInbound.inboundDate, endDate));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset: number = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(garmentPurchaseInbound).where(where),
      this.db
        .select()
        .from(garmentPurchaseInbound)
        .where(where)
        .orderBy(desc(garmentPurchaseInbound.createdAt))
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

  async getDetail(id: string): Promise<GarmentPurchaseInbound> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: garmentPurchaseInbound.supplierId },
    );
    const where = scopeCond
      ? and(eq(garmentPurchaseInbound.id, id), scopeCond)
      : eq(garmentPurchaseInbound.id, id);
    const rows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购入库单不存在');
    }

    const skuRows = await this.db
      .select()
      .from(garmentPurchaseInboundSku)
      .where(eq(garmentPurchaseInboundSku.inboundId, id));

    const inbound: GarmentPurchaseInbound = this.mapInbound(rows[0]);
    inbound.skus = skuRows.map((row) => this.mapInboundSku(row));
    return inbound;
  }

  async create(dto: GarmentPurchaseInboundCreateDto): Promise<GarmentPurchaseInbound> {
    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    // 校验采购订单
    const orderRows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, dto.orderId));
    if (orderRows.length === 0) {
      throw new BadRequestException('成衣采购订单不存在');
    }
    const order = orderRows[0];
    if (order.status !== 'approved') {
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

    await assertWriteWithinScope(this.db, { supplierId: order.supplierId, warehouseId: dto.warehouseId });

    // 取订单 SKU 明细
    const orderSkuIds: string[] = dto.skus
      .filter((s) => s.orderSkuId)
      .map((s) => s.orderSkuId as string);
    const orderSkuRows = await this.db
      .select()
      .from(garmentPurchaseOrderSku)
      .where(inArray(garmentPurchaseOrderSku.id, orderSkuIds));
    const orderSkuMap = new Map<string, typeof garmentPurchaseOrderSku.$inferSelect>();
    for (const os of orderSkuRows) {
      if (os.orderId === dto.orderId) {
        orderSkuMap.set(os.id, os);
      }
    }

    // 校验 SKU
    const skuIds: string[] = dto.skus.map((s) => s.skuId);
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    let totalAmount: number = 0;
    let totalQty: number = 0;
    const inboundSkus: {
      orderSkuId: string | null;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      amount: string;
      batchNo: string | null;
    }[] = [];

    for (const s of dto.skus) {
      const skuItem = skuMap.get(s.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${s.skuId}`);
      }

      const qty: number = Number(s.quantity);
      if (qty <= 0) {
        throw new BadRequestException('入库数量必须大于0');
      }

      let price: number = Number(s.price);
      let orderSkuId: string | null = s.orderSkuId ?? null;

      // 有 orderSkuId 时校验不超过未入库数量
      if (s.orderSkuId) {
        const orderSku = orderSkuMap.get(s.orderSkuId);
        if (!orderSku) {
          throw new BadRequestException(`订单SKU明细不存在: ${s.orderSkuId}`);
        }
        const orderedQty: number = Number(orderSku.quantity);
        const receivedQty: number = Number(orderSku.receivedQty);
        if (qty > orderedQty - receivedQty) {
          throw new BadRequestException(
            `入库数量超过未入库数量：SKU ${skuItem.skuCode}，最大可入库 ${(orderedQty - receivedQty).toFixed(3)}`,
          );
        }
        price = Number(orderSku.price);
      }

      if (price < 0) {
        throw new BadRequestException('单价不合法');
      }

      const amt: number = qty * price;
      totalAmount += amt;
      totalQty += qty;
      inboundSkus.push({
        orderSkuId,
        styleId: s.styleId,
        styleNo: s.styleNo,
        skuId: skuItem.id,
        color: skuItem.color,
        size: skuItem.size,
        quantity: round3(qty),
        price: round4(price),
        amount: round2(amt),
        batchNo: s.batchNo ?? null,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const inboundNo: string = await this.generateInboundNo(tx, dto.inboundDate);
      const inserted = await tx
        .insert(garmentPurchaseInbound)
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
          totalQty: round3(totalQty),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const inboundId: string = inserted[0].id;
      await tx.insert(garmentPurchaseInboundSku).values(
        inboundSkus.map((item) => ({
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
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的入库单才能审核');
    }
    const inbound = rows[0];

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(inbound.inboundDate);

    const skuRows = await this.db
      .select()
      .from(garmentPurchaseInboundSku)
      .where(eq(garmentPurchaseInboundSku.inboundId, id));

    await this.db.transaction(async (tx) => {
      // 1. 更新入库单状态
      await tx
        .update(garmentPurchaseInbound)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(garmentPurchaseInbound.id, id));

      // 2. 更新采购订单 SKU 的 receivedQty
      for (const s of skuRows) {
        if (!s.orderSkuId) continue;
        const qty: number = Number(s.quantity);
        await tx
          .update(garmentPurchaseOrderSku)
          .set({
            receivedQty: sql`${garmentPurchaseOrderSku.receivedQty} + ${round3(qty)}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(garmentPurchaseOrderSku.id, s.orderSkuId));
      }

      // 3. 检查订单所有 SKU 是否都已全部入库
      const orderSkuRows = await tx
        .select()
        .from(garmentPurchaseOrderSku)
        .where(eq(garmentPurchaseOrderSku.orderId, inbound.orderId));
      const allCompleted: boolean = orderSkuRows.every((os) => {
        const q: number = Number(os.quantity);
        const r: number = Number(os.receivedQty);
        return r >= q;
      });
      if (allCompleted) {
        await tx
          .update(garmentPurchaseOrder)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(garmentPurchaseOrder.id, inbound.orderId));
      }

      // 4+5. 增加成品库存 + 生成库存流水（统一收敛到 StockService：原子 upsert + 批量流水）
      const stockChanges: StockChangeItem[] = skuRows.map((s) => ({
        warehouseId: inbound.warehouseId,
        warehouseName: inbound.warehouseName,
        skuId: s.skuId,
        itemType: 'sku',
        qtyDelta: Number(s.quantity),
        flowType: 'garment_purchase_inbound',
        bizNo: inbound.inboundNo,
        batchNo: s.batchNo ?? null,
        unitPrice: s.price ?? null,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 6. 生成应付单
      const payableNo: string = `AP-${inbound.inboundNo}`;
      await tx.insert(payable).values({
        payableNo,
        supplierId: inbound.supplierId,
        supplierName: inbound.supplierName,
        bizType: 'garment_purchase_inbound',
        bizNo: inbound.inboundNo,
        amount: inbound.totalAmount,
        paidAmount: '0',
        balance: inbound.totalAmount,
        status: 'unpaid',
        remark: `成衣采购入库 ${inbound.inboundNo}`,
      });
    });
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, garmentPurchaseInbound, id, {
      draftValue: 'draft',
      notFoundMsg: "成衣采购入库单不存在",
      guardMsg: "只能删除草稿状态的入库单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的入库单');
    }
    await this.db.delete(garmentPurchaseInbound).where(eq(garmentPurchaseInbound.id, id));
  }
}
