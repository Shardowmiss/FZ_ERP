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
  GarmentPurchaseInboundUpdateDto,
  GarmentPurchaseInboundAcceptDto,
  GarmentPurchaseInboundResolveResult,
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
      acceptedQty: Number(row.acceptedQty ?? 0),
      skuCode: row.skuCode ?? undefined,
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
      skuCode: string | null;
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
        skuCode: skuItem.skuCode ?? null,
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

  // 审核：仅将状态由 draft 置为 approved。
  // 真正增减库存、生成应付、回写订单已收数量，放到「完成验收」环节（按验收数量执行），
  // 以满足「验收才真正入库」的业务要求。
  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有待审核状态的入库单才能审核');
    }
    await this.db
      .update(garmentPurchaseInbound)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(garmentPurchaseInbound.id, id));
  }

  // 审核前编辑：仅 draft 状态可调用，重写表头与明细（验收数量重置为 0）
  async update(id: string, dto: GarmentPurchaseInboundUpdateDto): Promise<GarmentPurchaseInbound> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购入库单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有待审核状态的入库单才能编辑');
    }
    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }
    const inbound = rows[0];

    // 校验仓库
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }
    await assertWriteWithinScope(this.db, { supplierId: inbound.supplierId, warehouseId: dto.warehouseId });

    // 取订单 SKU 明细用于超量校验（receivedQty 反映其他已完成入库单，本单仍为 draft 未计入）
    const orderSkuRows = await this.db
      .select()
      .from(garmentPurchaseOrderSku)
      .where(eq(garmentPurchaseOrderSku.orderId, inbound.orderId));
    const orderSkuMap = new Map<string, typeof garmentPurchaseOrderSku.$inferSelect>();
    for (const os of orderSkuRows) orderSkuMap.set(os.id, os);

    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, dto.skus.map((s) => s.skuId)));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) skuMap.set(s.id, s);

    let totalAmount = 0;
    let totalQty = 0;
    const newSkus: {
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
      skuCode: string | null;
      acceptedQty: string;
    }[] = [];

    for (const s of dto.skus) {
      const skuItem = skuMap.get(s.skuId);
      if (!skuItem) throw new BadRequestException(`SKU不存在: ${s.skuId}`);
      const qty = Number(s.quantity);
      if (qty <= 0) throw new BadRequestException('入库数量必须大于0');
      let price = Number(s.price);
      let orderSkuId: string | null = s.orderSkuId ?? null;
      if (s.orderSkuId) {
        const orderSku = orderSkuMap.get(s.orderSkuId);
        if (!orderSku) throw new BadRequestException(`订单SKU明细不存在: ${s.orderSkuId}`);
        const maxQty = Number(orderSku.quantity) - Number(orderSku.receivedQty);
        if (qty > maxQty) {
          throw new BadRequestException(
            `入库数量超过未入库数量：SKU ${skuItem.skuCode}，最大可入库 ${maxQty.toFixed(3)}`,
          );
        }
        price = Number(orderSku.price);
      }
      if (price < 0) throw new BadRequestException('单价不合法');
      const amt = qty * price;
      totalAmount += amt;
      totalQty += qty;
      newSkus.push({
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
        skuCode: skuItem.skuCode ?? null,
        acceptedQty: '0',
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(garmentPurchaseInbound)
        .set({
          warehouseId: whRows[0].id,
          warehouseName: whRows[0].name,
          inboundDate: dto.inboundDate,
          remark: dto.remark ?? null,
          totalAmount: round2(totalAmount),
          totalQty: round3(totalQty),
          updatedAt: new Date(),
        })
        .where(eq(garmentPurchaseInbound.id, id));
      await tx.delete(garmentPurchaseInboundSku).where(eq(garmentPurchaseInboundSku.inboundId, id));
      await tx.insert(garmentPurchaseInboundSku).values(newSkus.map((item) => ({ ...item, inboundId: id })));
    });

    return this.getDetail(id);
  }

  // 保存验收进度：仅 approved 状态可调用，不真正入库，仅记录各明细累计验收数量
  async saveAcceptance(id: string, dto: GarmentPurchaseInboundAcceptDto): Promise<GarmentPurchaseInbound> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (rows.length === 0) throw new NotFoundException('成衣采购入库单不存在');
    const status = rows[0].status;
    if (status === 'completed') {
      throw new BadRequestException('已完成验收，不可修改验收数量');
    }
    if (status !== 'approved') {
      throw new BadRequestException('只有已审核的入库单才能录入验收数量');
    }
    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('验收明细不能为空');
    }
    const skuRows = await this.db
      .select()
      .from(garmentPurchaseInboundSku)
      .where(eq(garmentPurchaseInboundSku.inboundId, id));
    const ownedIds = new Set(skuRows.map((s) => s.id));
    for (const item of dto.skus) {
      if (!ownedIds.has(item.id)) {
        throw new BadRequestException(`验收明细不存在于本单: ${item.id}`);
      }
      if (Number(item.acceptedQty) < 0) {
        throw new BadRequestException('验收数量不能为负');
      }
    }

    await this.db.transaction(async (tx) => {
      for (const item of dto.skus) {
        await tx
          .update(garmentPurchaseInboundSku)
          .set({ acceptedQty: round3(Number(item.acceptedQty)), updatedAt: new Date() })
          .where(eq(garmentPurchaseInboundSku.id, item.id));
      }
      await tx
        .update(garmentPurchaseInbound)
        .set({ updatedAt: new Date() })
        .where(eq(garmentPurchaseInbound.id, id));
    });

    return this.getDetail(id);
  }

  // 完成验收：按累计验收数量真正增减库存、生成应付、回写订单已收数量，状态置 completed
  async completeAcceptance(id: string): Promise<GarmentPurchaseInbound> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (rows.length === 0) throw new NotFoundException('成衣采购入库单不存在');
    const inbound = rows[0];
    if (inbound.status !== 'approved') {
      throw new BadRequestException('只有已审核的入库单才能完成验收');
    }
    // 月结拦截（真正发生库存/资金变动的环节）
    await this.monthCloseService.checkMonthClosed(inbound.inboundDate);

    const skuRows = await this.db
      .select()
      .from(garmentPurchaseInboundSku)
      .where(eq(garmentPurchaseInboundSku.inboundId, id));

    const acceptedList = skuRows.map((s) => ({ sku: s, qty: Number(s.acceptedQty ?? 0) }));
    const totalAccepted = acceptedList.reduce((sum, x) => sum + x.qty, 0);
    if (totalAccepted <= 0) {
      throw new BadRequestException('请先录入验收数量');
    }

    const stockChanges: StockChangeItem[] = [];
    let totalAcceptedAmount = 0;
    for (const { sku: s, qty } of acceptedList) {
      if (qty <= 0) continue;
      stockChanges.push({
        warehouseId: inbound.warehouseId,
        warehouseName: inbound.warehouseName,
        skuId: s.skuId,
        itemType: 'sku',
        qtyDelta: qty,
        flowType: 'garment_purchase_inbound',
        bizNo: inbound.inboundNo,
        batchNo: s.batchNo ?? null,
        unitPrice: s.price ?? null,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
      });
      totalAcceptedAmount += qty * Number(s.price);
    }

    await this.db.transaction(async (tx) => {
      // 1. 回写采购订单 SKU 已收数量（按验收数量）
      for (const { sku: s, qty } of acceptedList) {
        if (!s.orderSkuId || qty <= 0) continue;
        await tx
          .update(garmentPurchaseOrderSku)
          .set({
            receivedQty: sql`${garmentPurchaseOrderSku.receivedQty} + ${round3(qty)}::numeric`,
            updatedAt: new Date(),
          })
          .where(eq(garmentPurchaseOrderSku.id, s.orderSkuId));
      }

      // 2. 订单是否全部收完
      const orderSkuRows = await tx
        .select()
        .from(garmentPurchaseOrderSku)
        .where(eq(garmentPurchaseOrderSku.orderId, inbound.orderId));
      const allCompleted = orderSkuRows.every((os) => Number(os.receivedQty) >= Number(os.quantity));
      if (allCompleted) {
        await tx
          .update(garmentPurchaseOrder)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(garmentPurchaseOrder.id, inbound.orderId));
      }

      // 3. 增减库存 + 流水
      if (stockChanges.length > 0) {
        await this.stockService.batchChangeStock(tx, stockChanges);
      }

      // 4. 生成应付单（按实际验收金额）
      const payableNo = `AP-${inbound.inboundNo}`;
      await tx.insert(payable).values({
        payableNo,
        supplierId: inbound.supplierId,
        supplierName: inbound.supplierName,
        bizType: 'garment_purchase_inbound',
        bizNo: inbound.inboundNo,
        amount: round2(totalAcceptedAmount),
        paidAmount: '0',
        balance: round2(totalAcceptedAmount),
        status: 'unpaid',
        remark: `成衣采购入库 ${inbound.inboundNo}`,
      });

      // 5. 置已完成
      await tx
        .update(garmentPurchaseInbound)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(garmentPurchaseInbound.id, id));
    });

    return this.getDetail(id);
  }

  // 扫码解析：根据条码识别款式/颜色/尺码，并定位本单明细单元格
  async resolveBarcode(id: string, code: string): Promise<GarmentPurchaseInboundResolveResult> {
    if (!code || !code.trim()) {
      return { found: false, message: '请录入条码' };
    }
    const inboundRows = await this.db
      .select()
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.id, id));
    if (inboundRows.length === 0) {
      throw new NotFoundException('入库单不存在');
    }
    if (inboundRows[0].status !== 'approved') {
      return { found: false, message: '当前单据状态不可验收' };
    }
    const skuRows = await this.db
      .select()
      .from(garmentPurchaseInboundSku)
      .where(eq(garmentPurchaseInboundSku.inboundId, id));
    if (skuRows.length === 0) {
      return { found: false, message: '该商品不存在' };
    }

    const cleanCode = code.trim();
    // 1) 直查 sku 表（sku_code / barcode 命中）
    const skuHits = (await this.db.execute(sql`
      SELECT id, style_id, style_no, color, size, sku_code, barcode
      FROM sku
      WHERE sku_code = ${cleanCode} OR barcode = ${cleanCode}
      LIMIT 1
    `)) as unknown as Array<{
      id: string; style_id: string; style_no: string; color: string; size: string; sku_code: string; barcode: string | null;
    }>;
    // 2) 查 style_barcode 映射（barcode 唯一）
    const sbHits = (await this.db.execute(sql`
      SELECT style_id, color_name, size
      FROM style_barcode
      WHERE barcode = ${cleanCode} AND enabled = true
      LIMIT 1
    `)) as unknown as Array<{ style_id: string; color_name: string; size: string }>;

    const candidates: { styleId: string; color: string; size: string; skuId?: string }[] = [];
    if (skuHits.length > 0) {
      const h = skuHits[0];
      candidates.push({ styleId: h.style_id, color: h.color, size: h.size, skuId: h.id });
    }
    if (sbHits.length > 0) {
      const h = sbHits[0];
      candidates.push({ styleId: h.style_id, color: h.color_name, size: h.size });
    }

    if (candidates.length === 0) {
      return { found: false, message: '该商品不存在' };
    }

    // 在本单明细中定位（优先按 skuId，其次按 款式/颜色/尺码）
    for (const c of candidates) {
      const hit = skuRows.find((s) =>
        c.skuId
          ? s.skuId === c.skuId
          : (s.styleId === c.styleId && s.color === c.color && s.size === c.size),
      );
      if (hit) {
        return {
          found: true,
          styleId: hit.styleId,
          styleNo: hit.styleNo,
          skuId: hit.skuId,
          color: hit.color,
          size: hit.size,
          skuCode: hit.skuCode ?? undefined,
          inboundSkuId: hit.id,
          plannedQty: Number(hit.quantity),
          acceptedQty: Number(hit.acceptedQty ?? 0),
        };
      }
    }
    return { found: false, message: '该商品不存在' };
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
