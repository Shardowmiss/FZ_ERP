import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, sql, inArray } from 'drizzle-orm';
import {
  subcontractOrder,
  subcontractOrderItem,
  subcontractIssue,
  subcontractIssueItem,
  subcontractReceipt,
  subcontractReceiptItem,
  subcontractFee,
  payable,
  sku,
  material,
  supplier,
  warehouse,
} from '@server/database/schema';
import type {
  SubcontractOrder,
  SubcontractOrderCreate,
  SubcontractIssueCreate,
  SubcontractReceiptCreate,
  SubcontractFeeCreate,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import { StockService } from '../inventory/stock/stock.service';
import { round2, round3 } from '../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';


@Injectable()
export class SubcontractService {
  private readonly logger = new Logger(SubcontractService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly stockService: StockService,
  ) {}

  // ============ 委外订单 ============

  async createOrder(dto: SubcontractOrderCreate): Promise<SubcontractOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('委外订单明细不能为空');
    }
    const supRows = await this.db
      .select()
      .from(supplier)
      .where(eq(supplier.id, dto.supplierId));
    if (supRows.length === 0) {
      throw new BadRequestException('供应商不存在');
    }
    const sup = supRows[0];
    const skuIds = [...new Set(dto.items.map((it) => it.skuId))];
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) skuMap.set(s.id, s);

    let totalQty = 0;
    let totalAmount = 0;
    const itemRows: {
      orderId: string;
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: string;
      unitPrice: string;
      amount: string;
      receivedQty: string;
      remark?: string;
    }[] = [];

    for (const it of dto.items) {
      const s = skuMap.get(it.skuId);
      if (!s) throw new BadRequestException(`SKU不存在: ${it.skuId}`);
      if (it.quantity <= 0) throw new BadRequestException('数量必须大于0');
      const amount = Number(it.unitPrice) * it.quantity;
      totalQty += it.quantity;
      totalAmount += amount;
      itemRows.push({
        orderId: '',
        skuId: s.id,
        skuCode: s.skuCode,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
        quantity: round3(it.quantity),
        unitPrice: round2(Number(it.unitPrice)),
        amount: round2(amount),
        receivedQty: '0',
        remark: it.remark,
      });
    }

    const result = await this.db.transaction(async (tx) => {
      const orderNo = await this.numberGenerator.generateNextNo(
        tx,
        subcontractOrder,
        subcontractOrder.orderNo,
        `WX${dto.orderDate.replace(/-/g, '')}`,
        4,
      );
      const inserted = await tx
        .insert(subcontractOrder)
        .values({
          orderNo,
          supplierId: sup.id,
          supplierName: sup.name,
          orderDate: dto.orderDate,
          deliveryDate: dto.deliveryDate,
          totalQuantity: round3(totalQty),
          totalAmount: round2(totalAmount),
          status: 'draft',
          remark: dto.remark,
        })
        .returning();
      const orderId = inserted[0].id;
      await tx.insert(subcontractOrderItem).values(
        itemRows.map((ir) => ({ ...ir, orderId })),
      );
      return inserted[0];
    });

    return this.getOrder(result.id);
  }

  async listOrders(params: {
    page: number;
    pageSize: number;
    supplierId?: string;
    status?: string;
    keyword?: string;
  }): Promise<PaginationResult<SubcontractOrder>> {
    const { page, pageSize, supplierId, status, keyword } = params;
    const conditions = [];
    if (supplierId) conditions.push(eq(subcontractOrder.supplierId, supplierId));
    if (status) conditions.push(eq(subcontractOrder.status, status));
    if (keyword)
      conditions.push(
        sql`(${subcontractOrder.orderNo} LIKE ${`%${keyword}%`} OR ${subcontractOrder.supplierName} LIKE ${`%${keyword}%`})`,
      );
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const scopeCond = buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: subcontractOrder.supplierId });
    if (scopeCond) conditions.push(scopeCond);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;
    const [countRes, rows] = await Promise.all([
      this.db.select({ count: count() }).from(subcontractOrder).where(where),
      this.db
        .select()
        .from(subcontractOrder)
        .where(where)
        .orderBy(desc(subcontractOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);
    const items: SubcontractOrder[] = rows.map((r) => ({
      id: r.id,
      orderNo: r.orderNo,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      orderDate: r.orderDate,
      deliveryDate: r.deliveryDate ?? undefined,
      totalQuantity: Number(r.totalQuantity),
      totalAmount: Number(r.totalAmount),
      status: r.status,
      remark: r.remark ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total: Number(countRes[0]?.count ?? 0), page, pageSize };
  }

  async getOrder(id: string): Promise<SubcontractOrder> {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const scopeCond = buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: subcontractOrder.supplierId });
    const rows = await this.db
      .select()
      .from(subcontractOrder)
      .where(scopeCond ? and(eq(subcontractOrder.id, id), scopeCond) : eq(subcontractOrder.id, id));
    if (rows.length === 0) throw new BadRequestException('委外订单不存在');
    const r = rows[0];
    const items = await this.db
      .select()
      .from(subcontractOrderItem)
      .where(eq(subcontractOrderItem.orderId, id));
    return {
      id: r.id,
      orderNo: r.orderNo,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      orderDate: r.orderDate,
      deliveryDate: r.deliveryDate ?? undefined,
      totalQuantity: Number(r.totalQuantity),
      totalAmount: Number(r.totalAmount),
      status: r.status,
      remark: r.remark ?? undefined,
      createdAt: r.createdAt.toISOString(),
      items: items.map((it) => ({
        id: it.id,
        orderId: it.orderId,
        skuId: it.skuId,
        skuCode: it.skuCode,
        styleNo: it.styleNo,
        color: it.color,
        size: it.size,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
        receivedQty: Number(it.receivedQty),
        remark: it.remark ?? undefined,
      })),
    };
  }

  async approveOrder(id: string): Promise<SubcontractOrder> {
    const rows = await this.db
      .select()
      .from(subcontractOrder)
      .where(eq(subcontractOrder.id, id));
    if (rows.length === 0) throw new BadRequestException('委外订单不存在');
    if (rows[0].status !== 'draft')
      throw new BadRequestException('仅草稿状态可审核');
    await this.db
      .update(subcontractOrder)
      .set({ status: 'approved' })
      .where(eq(subcontractOrder.id, id));
    return this.getOrder(id);
  }

  // ============ 委外发料 ============

  async createIssue(dto: SubcontractIssueCreate): Promise<{ id: string }> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('发料明细不能为空');
    }
    const orderRows = await this.db
      .select()
      .from(subcontractOrder)
      .where(eq(subcontractOrder.id, dto.orderId));
    if (orderRows.length === 0) throw new BadRequestException('委外订单不存在');
    const order = orderRows[0];
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) throw new BadRequestException('仓库不存在');
    const wh = whRows[0];
    const matIds = [...new Set(dto.items.map((it) => it.materialId))];
    const matRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, matIds));
    const matMap = new Map<string, typeof material.$inferSelect>();
    for (const m of matRows) matMap.set(m.id, m);

    const itemRows: {
      issueId: string;
      materialId: string;
      materialCode: string;
      materialName: string;
      unit: string;
      quantity: string;
      remark?: string;
    }[] = [];
    for (const it of dto.items) {
      const m = matMap.get(it.materialId);
      if (!m) throw new BadRequestException(`物料不存在: ${it.materialId}`);
      if (it.quantity <= 0) throw new BadRequestException('发料数量必须大于0');
      itemRows.push({
        issueId: '',
        materialId: m.id,
        materialCode: m.code,
        materialName: m.name,
        unit: m.unit ?? '',
        quantity: round3(it.quantity),
        remark: it.remark,
      });
    }

    const inserted = await this.db.transaction(async (tx) => {
      const issueNo = await this.numberGenerator.generateNextNo(
        tx,
        subcontractIssue,
        subcontractIssue.issueNo,
        `WXF${dto.issueDate.replace(/-/g, '')}`,
        4,
      );
      const res = await tx
        .insert(subcontractIssue)
        .values({
          issueNo,
          orderId: order.id,
          orderNo: order.orderNo,
          supplierId: order.supplierId,
          supplierName: order.supplierName,
          warehouseId: wh.id,
          warehouseName: wh.name,
          issueDate: dto.issueDate,
          status: 'draft',
          remark: dto.remark,
        })
        .returning();
      const issueId = res[0].id;
      await tx.insert(subcontractIssueItem).values(
        itemRows.map((ir) => ({ ...ir, issueId })),
      );
      return res[0];
    });
    return { id: inserted.id };
  }

  async listIssues(params: {
    page: number;
    pageSize: number;
    orderId?: string;
    status?: string;
  }): Promise<PaginationResult<any>> {
    const { page, pageSize, orderId, status } = params;
    const conditions = [];
    if (orderId) conditions.push(eq(subcontractIssue.orderId, orderId));
    if (status) conditions.push(eq(subcontractIssue.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;
    const [countRes, rows] = await Promise.all([
      this.db.select({ count: count() }).from(subcontractIssue).where(where),
      this.db
        .select()
        .from(subcontractIssue)
        .where(where)
        .orderBy(desc(subcontractIssue.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      issueNo: r.issueNo,
      orderId: r.orderId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      issueDate: r.issueDate,
      status: r.status,
      remark: r.remark ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total: Number(countRes[0]?.count ?? 0), page, pageSize };
  }

  async approveIssue(id: string): Promise<{ id: string }> {
    const rows = await this.db
      .select()
      .from(subcontractIssue)
      .where(eq(subcontractIssue.id, id));
    if (rows.length === 0) throw new BadRequestException('发料单不存在');
    const issue = rows[0];
    if (issue.status !== 'draft')
      throw new BadRequestException('仅草稿状态可审核');
    const items = await this.db
      .select()
      .from(subcontractIssueItem)
      .where(eq(subcontractIssueItem.issueId, id));

    await this.db.transaction(async (tx) => {
      // 扣减物料库存并写物料出库流水
      await this.stockService.batchChangeStock(
        tx,
        items.map((it) => ({
          warehouseId: issue.warehouseId,
          warehouseName: issue.warehouseName,
          itemType: 'material' as const,
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          qtyDelta: -Number(it.quantity),
          flowType: 'subcontract_issue',
          bizNo: issue.issueNo,
          bizItemId: it.id,
        })),
      );
      await tx
        .update(subcontractIssue)
        .set({ status: 'approved' })
        .where(eq(subcontractIssue.id, id));
    });
    return { id };
  }

  // ============ 委外回收（入库） ============

  async createReceipt(dto: SubcontractReceiptCreate): Promise<{ id: string }> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('回收明细不能为空');
    }
    const orderRows = await this.db
      .select()
      .from(subcontractOrder)
      .where(eq(subcontractOrder.id, dto.orderId));
    if (orderRows.length === 0) throw new BadRequestException('委外订单不存在');
    const order = orderRows[0];
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) throw new BadRequestException('仓库不存在');
    const wh = whRows[0];
    await assertWriteWithinScope(this.db, { supplierId: order.supplierId, warehouseId: dto.warehouseId });
    const skuIds = [...new Set(dto.items.map((it) => it.skuId))];
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) skuMap.set(s.id, s);

    const orderItemRows = await this.db
      .select()
      .from(subcontractOrderItem)
      .where(eq(subcontractOrderItem.orderId, dto.orderId));
    const orderItemMap = new Map<string, typeof subcontractOrderItem.$inferSelect>();
    for (const oi of orderItemRows) orderItemMap.set(oi.skuId, oi);

    const itemRows: {
      receiptId: string;
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: string;
      unitPrice: string;
      amount: string;
      qualifiedQty: string;
      remark?: string;
    }[] = [];
    for (const it of dto.items) {
      const s = skuMap.get(it.skuId);
      if (!s) throw new BadRequestException(`SKU不存在: ${it.skuId}`);
      if (it.quantity <= 0) throw new BadRequestException('回收数量必须大于0');
      if (it.qualifiedQty > it.quantity)
        throw new BadRequestException('合格数不能大于回收数');
      const oi = orderItemMap.get(it.skuId);
      const up = oi ? Number(oi.unitPrice) : 0;
      itemRows.push({
        receiptId: '',
        skuId: s.id,
        skuCode: s.skuCode,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
        quantity: round3(it.quantity),
        unitPrice: round2(up),
        amount: round2(up * it.quantity),
        qualifiedQty: round3(it.qualifiedQty),
        remark: it.remark,
      });
    }

    const inserted = await this.db.transaction(async (tx) => {
      const receiptNo = await this.numberGenerator.generateNextNo(
        tx,
        subcontractReceipt,
        subcontractReceipt.receiptNo,
        `WXR${dto.receiptDate.replace(/-/g, '')}`,
        4,
      );
      let totalQty = 0;
      let totalAmt = 0;
      for (const ir of itemRows) {
        totalQty += Number(ir.quantity);
        totalAmt += Number(ir.amount);
      }
      const res = await tx
        .insert(subcontractReceipt)
        .values({
          receiptNo,
          orderId: order.id,
          orderNo: order.orderNo,
          supplierId: order.supplierId,
          supplierName: order.supplierName,
          warehouseId: wh.id,
          warehouseName: wh.name,
          receiptDate: dto.receiptDate,
          totalQuantity: round3(totalQty),
          totalAmount: round2(totalAmt),
          status: 'draft',
          remark: dto.remark,
        })
        .returning();
      const receiptId = res[0].id;
      await tx.insert(subcontractReceiptItem).values(
        itemRows.map((ir) => ({ ...ir, receiptId })),
      );
      return res[0];
    });
    return { id: inserted.id };
  }

  async listReceipts(params: {
    page: number;
    pageSize: number;
    orderId?: string;
    status?: string;
  }): Promise<PaginationResult<any>> {
    const { page, pageSize, orderId, status } = params;
    const conditions = [];
    if (orderId) conditions.push(eq(subcontractReceipt.orderId, orderId));
    if (status) conditions.push(eq(subcontractReceipt.status, status));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;
    const [countRes, rows] = await Promise.all([
      this.db.select({ count: count() }).from(subcontractReceipt).where(where),
      this.db
        .select()
        .from(subcontractReceipt)
        .where(where)
        .orderBy(desc(subcontractReceipt.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      orderId: r.orderId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      receiptDate: r.receiptDate,
      status: r.status,
      remark: r.remark ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total: Number(countRes[0]?.count ?? 0), page, pageSize };
  }

  async approveReceipt(id: string): Promise<{ id: string }> {
    const rows = await this.db
      .select()
      .from(subcontractReceipt)
      .where(eq(subcontractReceipt.id, id));
    if (rows.length === 0) throw new BadRequestException('回收单不存在');
    const receipt = rows[0];
    if (receipt.status !== 'draft')
      throw new BadRequestException('仅草稿状态可审核');
    const items = await this.db
      .select()
      .from(subcontractReceiptItem)
      .where(eq(subcontractReceiptItem.receiptId, id));
    // 订单明细，用于回写已收数量
    const orderItems = await this.db
      .select()
      .from(subcontractOrderItem)
      .where(eq(subcontractOrderItem.orderId, receipt.orderId));
    const orderItemMap = new Map<string, typeof orderItems[number]>();
    for (const oi of orderItems) orderItemMap.set(oi.skuId, oi);

    await this.db.transaction(async (tx) => {
      // 增加成衣库存并写成衣入库流水（按合格数入库）
      await this.stockService.batchChangeStock(
        tx,
        items.map((it) => ({
          warehouseId: receipt.warehouseId,
          warehouseName: receipt.warehouseName,
          itemType: 'sku' as const,
          skuId: it.skuId,
          skuCode: it.skuCode,
          styleNo: it.styleNo,
          color: it.color,
          size: it.size,
          qtyDelta: Number(it.qualifiedQty),
          flowType: 'subcontract_receipt',
          bizNo: receipt.receiptNo,
          bizItemId: it.id,
        })),
      );
      // 回写订单明细已收数量
      for (const it of items) {
        const oi = orderItemMap.get(it.skuId);
        if (oi) {
          await tx
            .update(subcontractOrderItem)
            .set({
              receivedQty: round3(
                Number(oi.receivedQty) + Number(it.qualifiedQty),
              ),
            })
            .where(eq(subcontractOrderItem.id, oi.id));
        }
      }
      await tx
        .update(subcontractReceipt)
        .set({ status: 'approved' })
        .where(eq(subcontractReceipt.id, id));
    });
    return { id };
  }

  // ============ 加工费 ============

  async createFee(dto: SubcontractFeeCreate): Promise<{ id: string }> {
    const orderRows = await this.db
      .select()
      .from(subcontractOrder)
      .where(eq(subcontractOrder.id, dto.orderId));
    if (orderRows.length === 0) throw new BadRequestException('委外订单不存在');
    const order = orderRows[0];
    if (dto.quantity <= 0) throw new BadRequestException('数量必须大于0');
    const amount = Number(dto.unitPrice) * dto.quantity;
    const feeNo = await this.numberGenerator.generateNextNo(
      this.db,
      subcontractFee,
      subcontractFee.feeNo,
      `WXFY${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
      4,
    );
    const inserted = await this.db
      .insert(subcontractFee)
      .values({
        feeNo,
        orderId: order.id,
        orderNo: order.orderNo,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        feeType: dto.feeType ?? 'processing',
        quantity: round3(dto.quantity),
        unitPrice: round2(Number(dto.unitPrice)),
        amount: round2(amount),
        status: 'pending',
        remark: dto.remark,
      })
      .returning();
    return { id: inserted[0].id };
  }

  async listFees(orderId?: string): Promise<any[]> {
    const conditions = orderId ? [eq(subcontractFee.orderId, orderId)] : [];
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await this.db
      .select()
      .from(subcontractFee)
      .where(where)
      .orderBy(desc(subcontractFee.createdAt));
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      supplierId: r.supplierId,
      supplierName: r.supplierName,
      feeType: r.feeType,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unitPrice),
      amount: Number(r.amount),
      status: r.status,
      remark: r.remark ?? undefined,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async settleFee(id: string): Promise<{ id: string }> {
    const rows = await this.db
      .select()
      .from(subcontractFee)
      .where(eq(subcontractFee.id, id));
    if (rows.length === 0) throw new BadRequestException('加工费记录不存在');
    const fee = rows[0];
    if (fee.status !== 'pending')
      throw new BadRequestException('仅待结算状态可结算');
    const settleDate = new Date().toISOString().slice(0, 10);
    await this.db.transaction(async (tx) => {
      const payableNo = await this.numberGenerator.generateNextNo(
        tx,
        payable,
        payable.payableNo,
        `YF${settleDate.replace(/-/g, '')}`,
        4,
      );
      await tx.insert(payable).values({
        payableNo,
        supplierId: fee.supplierId,
        supplierName: fee.supplierName,
        bizType: 'subcontract_fee',
        bizNo: fee.id,
        amount: fee.amount,
        paidAmount: '0',
        balance: fee.amount,
        dueDate: settleDate,
        status: 'unpaid',
        remark: `委外加工费结算-${fee.feeType}`,
      });
      await tx
        .update(subcontractFee)
        .set({ status: 'settled' })
        .where(eq(subcontractFee.id, id));
    });
    return { id };
  }

  async voidOrder(id: string): Promise<void> {
    await voidDraftDocument(this.db, subcontractOrder, id);
  }

  async voidIssue(id: string): Promise<void> {
    await voidDraftDocument(this.db, subcontractIssue, id);
  }

  async voidReceipt(id: string): Promise<void> {
    await voidDraftDocument(this.db, subcontractReceipt, id);
  }

  async voidFee(id: string): Promise<void> {
    await voidDraftDocument(this.db, subcontractFee, id, { draftValue: 'pending', guardMsg: '仅待结算状态的加工费才能作废' });
  }

}
