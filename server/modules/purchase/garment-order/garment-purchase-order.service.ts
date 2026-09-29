import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count, gte, lt, sql, inArray } from 'drizzle-orm';
import {
  garmentPurchaseOrder,
  garmentPurchaseOrderSku,
  supplier,
  sku,
  style,
  garmentPurchaseInbound,
} from '@server/database/schema';
import type {
  GarmentPurchaseOrder,
  GarmentPurchaseOrderSku,
  GarmentPurchaseOrderCreateDto,
  GarmentPurchaseOrderUpdateDto,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




type TxLike =
  PostgresJsDatabase |
  Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

interface ListQuery {
  page: number;
  pageSize: number;
  supplierId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  styleNo?: string;
  keyword?: string;
}

@Injectable()
export class GarmentPurchaseOrderService {
  private readonly logger = new Logger(GarmentPurchaseOrderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateOrderNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart: string = dateStr.replace(/-/g, '');
    const prefix: string = `GPO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      garmentPurchaseOrder,
      garmentPurchaseOrder.orderNo,
      prefix,
      4,
    );
  }

  private mapOrder(row: typeof garmentPurchaseOrder.$inferSelect): GarmentPurchaseOrder {
    return {
      id: row.id,
      orderNo: row.orderNo,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      orderDate: row.orderDate,
      expectDate: row.expectDate ?? undefined,
      brand: row.brand ?? undefined,
      buyer: row.buyer ?? undefined,
      totalAmount: Number(row.totalAmount),
      totalQty: Number(row.totalQty),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapOrderSku(row: typeof garmentPurchaseOrderSku.$inferSelect): GarmentPurchaseOrderSku {
    return {
      id: row.id,
      orderId: row.orderId,
      styleId: row.styleId,
      styleNo: row.styleNo,
      skuId: row.skuId,
      color: row.color,
      size: row.size,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      receivedQty: Number(row.receivedQty),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<GarmentPurchaseOrder>> {
    const { page, pageSize, supplierId, status, startDate, endDate, styleNo, keyword } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(garmentPurchaseOrder.supplierId, supplierId));
    if (status) conditions.push(eq(garmentPurchaseOrder.status, status));
    if (startDate) conditions.push(gte(garmentPurchaseOrder.orderDate, startDate));
    if (endDate) conditions.push(lt(garmentPurchaseOrder.orderDate, endDate));
    if (keyword) conditions.push(sql`${garmentPurchaseOrder.orderNo} like ${'%' + keyword + '%'}`);
    if (styleNo) {
      conditions.push(
        sql`exists (
          select 1 from ${garmentPurchaseOrderSku}
          where ${garmentPurchaseOrderSku.orderId} = ${garmentPurchaseOrder.id}
            and ${garmentPurchaseOrderSku.styleNo} = ${styleNo}
        )`,
      );
    }

    // 行级数据权限：仅可见当前用户所属经销商的供应商关联成衣采购订单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: garmentPurchaseOrder.supplierId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset: number = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(garmentPurchaseOrder).where(where),
      this.db
        .select()
        .from(garmentPurchaseOrder)
        .where(where)
        .orderBy(desc(garmentPurchaseOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total: number = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapOrder(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<GarmentPurchaseOrder> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: garmentPurchaseOrder.supplierId },
    );
    const where = scopeCond
      ? and(eq(garmentPurchaseOrder.id, id), scopeCond)
      : eq(garmentPurchaseOrder.id, id);
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }

    const skuRows = await this.db
      .select()
      .from(garmentPurchaseOrderSku)
      .where(eq(garmentPurchaseOrderSku.orderId, id));

    const order: GarmentPurchaseOrder = this.mapOrder(rows[0]);
    order.skus = skuRows.map((row) => this.mapOrderSku(row));
    return order;
  }

  async create(
    dto: GarmentPurchaseOrderCreateDto,
    tx?: TxLike,
  ): Promise<GarmentPurchaseOrder> {
    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    // 校验供应商
    const supRows = await this.db
      .select()
      .from(supplier)
      .where(eq(supplier.id, dto.supplierId));
    if (supRows.length === 0) {
      throw new BadRequestException('供应商不存在');
    }
    const sup = supRows[0];

    await assertWriteWithinScope(this.db, { supplierId: dto.supplierId });

    // 校验 SKU 存在并取信息
    const skuIds: string[] = dto.skus.map((s) => s.skuId);
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    // 校验款号
    const styleIds: string[] = [...new Set(dto.skus.map((s) => s.styleId))];
    const styleRows = await this.db.select().from(style).where(inArray(style.id, styleIds));
    const styleMap = new Map<string, typeof style.$inferSelect>();
    for (const st of styleRows) {
      styleMap.set(st.id, st);
    }

    let totalAmount: number = 0;
    let totalQty: number = 0;
    const orderSkus: {
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      amount: string;
      receivedQty: string;
    }[] = [];

    for (const s of dto.skus) {
      const skuItem = skuMap.get(s.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${s.skuId}`);
      }
      const st = styleMap.get(s.styleId);
      if (!st) {
        throw new BadRequestException(`款号不存在: ${s.styleId}`);
      }
      const qty: number = Number(s.quantity);
      const prc: number = Number(s.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt: number = qty * prc;
      totalAmount += amt;
      totalQty += qty;
      orderSkus.push({
        styleId: st.id,
        styleNo: st.styleNo,
        skuId: skuItem.id,
        color: skuItem.color,
        size: skuItem.size,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        receivedQty: '0',
      });
    }

    const exec = async (runner: TxLike): Promise<GarmentPurchaseOrder> => {
      const orderNo: string = await this.generateOrderNo(runner, dto.orderDate);
      const inserted = await runner
        .insert(garmentPurchaseOrder)
        .values({
          orderNo,
          supplierId: dto.supplierId,
          supplierName: sup.name,
          orderDate: dto.orderDate,
          expectDate: dto.expectDate ?? null,
          brand: dto.brand ?? null,
          buyer: dto.buyer ?? null,
          totalAmount: round2(totalAmount),
          totalQty: round3(totalQty),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const orderId: string = inserted[0].id;
      await runner.insert(garmentPurchaseOrderSku).values(
        orderSkus.map((item) => ({
          ...item,
          orderId,
        })),
      );

      const skuRows = await runner
        .select()
        .from(garmentPurchaseOrderSku)
        .where(eq(garmentPurchaseOrderSku.orderId, orderId));
      const order = this.mapOrder(inserted[0]);
      order.skus = skuRows.map((r) => this.mapOrderSku(r));
      return order;
    };

    if (tx) {
      return exec(tx);
    }
    return this.db.transaction(async (t) => exec(t));
  }

  async update(id: string, dto: GarmentPurchaseOrderUpdateDto): Promise<GarmentPurchaseOrder> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }
    const order = rows[0];
    if (order.status !== 'draft') {
      throw new BadRequestException('只能修改草稿状态的订单');
    }

    if (!dto.skus || dto.skus.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    // 校验供应商
    const supplierIdVal: string = dto.supplierId ?? order.supplierId;
    const supRows = await this.db
      .select()
      .from(supplier)
      .where(eq(supplier.id, supplierIdVal));
    if (supRows.length === 0) {
      throw new BadRequestException('供应商不存在');
    }
    const sup = supRows[0];

    // 校验 SKU
    const skuIds: string[] = dto.skus.map((s) => s.skuId);
    const skuRows = await this.db.select().from(sku).where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    // 校验款号
    const styleIds: string[] = [...new Set(dto.skus.map((s) => s.styleId))];
    const styleRows = await this.db.select().from(style).where(inArray(style.id, styleIds));
    const styleMap = new Map<string, typeof style.$inferSelect>();
    for (const st of styleRows) {
      styleMap.set(st.id, st);
    }

    let totalAmount: number = 0;
    let totalQty: number = 0;
    const orderSkus: {
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      amount: string;
      receivedQty: string;
    }[] = [];

    for (const s of dto.skus) {
      const skuItem = skuMap.get(s.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${s.skuId}`);
      }
      const st = styleMap.get(s.styleId);
      if (!st) {
        throw new BadRequestException(`款号不存在: ${s.styleId}`);
      }
      const qty: number = Number(s.quantity);
      const prc: number = Number(s.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt: number = qty * prc;
      totalAmount += amt;
      totalQty += qty;
      orderSkus.push({
        styleId: st.id,
        styleNo: st.styleNo,
        skuId: skuItem.id,
        color: skuItem.color,
        size: skuItem.size,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        receivedQty: '0',
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(garmentPurchaseOrder)
        .set({
          supplierId: supplierIdVal,
          supplierName: sup.name,
          orderDate: dto.orderDate ?? order.orderDate,
          expectDate: dto.expectDate !== undefined ? dto.expectDate ?? null : order.expectDate,
          brand: dto.brand !== undefined ? dto.brand ?? null : order.brand,
          buyer: dto.buyer !== undefined ? dto.buyer ?? null : order.buyer,
          totalAmount: round2(totalAmount),
          totalQty: round3(totalQty),
          remark: dto.remark !== undefined ? dto.remark ?? null : order.remark,
          updatedAt: new Date(),
        })
        .where(eq(garmentPurchaseOrder.id, id));

      await tx.delete(garmentPurchaseOrderSku).where(eq(garmentPurchaseOrderSku.orderId, id));
      await tx.insert(garmentPurchaseOrderSku).values(
        orderSkus.map((item) => ({
          ...item,
          orderId: id,
        })),
      );
    });

    return this.getDetail(id);
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, garmentPurchaseOrder, id, {
      draftValue: 'draft',
      notFoundMsg: "成衣采购订单不存在",
      guardMsg: "只能删除草稿状态的订单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的订单');
    }
    await this.db.delete(garmentPurchaseOrder).where(eq(garmentPurchaseOrder.id, id));
  }

  async submit(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的订单才能提交审核');
    }
    await this.db
      .update(garmentPurchaseOrder)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(garmentPurchaseOrder.id, id));
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }
    if (rows[0].status !== 'pending') {
      throw new BadRequestException('只有待审核状态的订单才能审核通过');
    }
    await this.db
      .update(garmentPurchaseOrder)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(garmentPurchaseOrder.id, id));
  }

  async unapprove(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }
    if (rows[0].status !== 'approved') {
      throw new BadRequestException('只有已审核状态的订单才能弃审');
    }

    // 检查是否已发生入库
    const inboundRows = await this.db
      .select({ count: count() })
      .from(garmentPurchaseInbound)
      .where(eq(garmentPurchaseInbound.orderId, id));
    const inboundCount: number = Number(inboundRows[0]?.count ?? 0);
    if (inboundCount > 0) {
      throw new ConflictException('订单已发生入库，不能弃审');
    }

    await this.db
      .update(garmentPurchaseOrder)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(garmentPurchaseOrder.id, id));
  }

  /**
   * 下游确认接收分销镜像生成的采购单（wait_confirm -> approved）。
   * 分销镜像生成的下游采购单初始为"待接收(wait_confirm)"，下游分销商在门户中
   * 确认接收后转为 approved，之后方可执行采购入库（入库门禁要求 status='approved'）。
   */
  async confirmPurchaseOrder(id: string): Promise<GarmentPurchaseOrder> {
    const rows = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('成衣采购订单不存在');
    }
    if (rows[0].status !== 'wait_confirm') {
      throw new BadRequestException('只有"待接收"状态的订单才能确认接收');
    }
    await this.db
      .update(garmentPurchaseOrder)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(garmentPurchaseOrder.id, id));
    return this.getDetail(id);
  }
}
