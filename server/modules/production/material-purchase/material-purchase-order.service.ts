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
  materialPurchaseOrder,
  materialPurchaseOrderItem,
  supplier,
  material,
  materialPurchaseInbound,
} from '@server/database/schema';
import type {
  MaterialPurchaseOrder,
  MaterialPurchaseOrderItem,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';




interface CreateOrderDto {
  supplierId: string;
  orderDate: string;
  expectDate?: string;
  remark?: string;
  items: {
    materialId: string;
    quantity: number;
    price: number;
  }[];
}

interface UpdateOrderDto {
  supplierId: string;
  orderDate: string;
  expectDate?: string;
  remark?: string;
  items: {
    materialId: string;
    quantity: number;
    price: number;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  supplierId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class MaterialPurchaseOrderService {
  private readonly logger = new Logger(MaterialPurchaseOrderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateOrderNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart: string = dateStr.replace(/-/g, '');
    const prefix: string = `MPO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      materialPurchaseOrder,
      materialPurchaseOrder.orderNo,
      prefix,
      4,
    );
  }

  private mapOrder(row: typeof materialPurchaseOrder.$inferSelect): MaterialPurchaseOrder {
    return {
      id: row.id,
      orderNo: row.orderNo,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      orderDate: row.orderDate,
      expectDate: row.expectDate ?? undefined,
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapOrderItem(row: typeof materialPurchaseOrderItem.$inferSelect): MaterialPurchaseOrderItem {
    return {
      id: row.id,
      orderId: row.orderId,
      materialId: row.materialId,
      materialCode: row.materialCode,
      materialName: row.materialName,
      unit: row.unit,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      receivedQty: Number(row.receivedQty),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<MaterialPurchaseOrder>> {
    const { page, pageSize, supplierId, status, startDate, endDate } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(materialPurchaseOrder.supplierId, supplierId));
    if (status) conditions.push(eq(materialPurchaseOrder.status, status));
    if (startDate) conditions.push(gte(materialPurchaseOrder.orderDate, startDate));
    if (endDate) conditions.push(lt(materialPurchaseOrder.orderDate, endDate));

    // 行级数据权限：仅可见当前用户所属经销商的供应商关联面辅料采购订单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: materialPurchaseOrder.supplierId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset: number = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(materialPurchaseOrder).where(where),
      this.db
        .select()
        .from(materialPurchaseOrder)
        .where(where)
        .orderBy(desc(materialPurchaseOrder.createdAt))
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

  async getDetail(id: string): Promise<MaterialPurchaseOrder> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: materialPurchaseOrder.supplierId },
    );
    const where = scopeCond
      ? and(eq(materialPurchaseOrder.id, id), scopeCond)
      : eq(materialPurchaseOrder.id, id);
    const rows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购订单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(materialPurchaseOrderItem)
      .where(eq(materialPurchaseOrderItem.orderId, id));

    const order: MaterialPurchaseOrder = this.mapOrder(rows[0]);
    order.items = itemRows.map((row) => this.mapOrderItem(row));
    return order;
  }

  async create(dto: CreateOrderDto): Promise<MaterialPurchaseOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    const supRows = await this.db
      .select()
      .from(supplier)
      .where(eq(supplier.id, dto.supplierId));
    if (supRows.length === 0) {
      throw new BadRequestException('供应商不存在');
    }
    const sup = supRows[0];

    await assertWriteWithinScope(this.db, { supplierId: dto.supplierId });

    const materialIds = dto.items.map((item) => item.materialId);
    const matRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const matMap = new Map<string, typeof material.$inferSelect>();
    for (const m of matRows) {
      matMap.set(m.id, m);
    }

    let totalAmount: number = 0;
    const orderItems: {
      materialId: string;
      materialCode: string;
      materialName: string;
      unit: string;
      quantity: string;
      price: string;
      amount: string;
      receivedQty: string;
    }[] = [];

    for (const item of dto.items) {
      const mat = matMap.get(item.materialId);
      if (!mat) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
      const qty: number = Number(item.quantity);
      const prc: number = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt: number = qty * prc;
      totalAmount += amt;
      orderItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        unit: mat.unit,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        receivedQty: '0',
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const orderNo: string = await this.generateOrderNo(tx, dto.orderDate);
      const inserted = await tx
        .insert(materialPurchaseOrder)
        .values({
          orderNo,
          supplierId: dto.supplierId,
          supplierName: sup.name,
          orderDate: dto.orderDate,
          expectDate: dto.expectDate ?? null,
          totalAmount: round2(totalAmount),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const orderId: string = inserted[0].id;
      await tx.insert(materialPurchaseOrderItem).values(
        orderItems.map((item) => ({
          ...item,
          orderId,
        })),
      );

      return inserted[0];
    });

    this.logger.log(`创建面辅料采购订单成功: id=${created.id}, orderNo=${created.orderNo}`);

    return this.getDetail(created.id);
  }

  async update(id: string, dto: UpdateOrderDto): Promise<MaterialPurchaseOrder> {
    const rows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购订单不存在');
    }
    const order = rows[0];
    if (order.status !== 'draft') {
      throw new BadRequestException('只能修改草稿状态的订单');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    const supRows = await this.db
      .select()
      .from(supplier)
      .where(eq(supplier.id, dto.supplierId));
    if (supRows.length === 0) {
      throw new BadRequestException('供应商不存在');
    }
    const sup = supRows[0];

    // 写越权硬化：校验新引用的供应商归属当前作用域
    await assertWriteWithinScope(this.db, { supplierId: dto.supplierId });

    const materialIds = dto.items.map((item) => item.materialId);
    const matRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const matMap = new Map<string, typeof material.$inferSelect>();
    for (const m of matRows) {
      matMap.set(m.id, m);
    }

    let totalAmount: number = 0;
    const orderItems: {
      materialId: string;
      materialCode: string;
      materialName: string;
      unit: string;
      quantity: string;
      price: string;
      amount: string;
      receivedQty: string;
    }[] = [];

    for (const item of dto.items) {
      const mat = matMap.get(item.materialId);
      if (!mat) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
      const qty: number = Number(item.quantity);
      const prc: number = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt: number = qty * prc;
      totalAmount += amt;
      orderItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        unit: mat.unit,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        receivedQty: '0',
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(materialPurchaseOrder)
        .set({
          supplierId: dto.supplierId,
          supplierName: sup.name,
          orderDate: dto.orderDate,
          expectDate: dto.expectDate ?? null,
          totalAmount: round2(totalAmount),
          remark: dto.remark ?? null,
          updatedAt: new Date(),
        })
        .where(eq(materialPurchaseOrder.id, id));

      await tx
        .delete(materialPurchaseOrderItem)
        .where(eq(materialPurchaseOrderItem.orderId, id));
      await tx.insert(materialPurchaseOrderItem).values(
        orderItems.map((item) => ({
          ...item,
          orderId: id,
        })),
      );
    });

    this.logger.log(`更新面辅料采购订单成功: id=${id}`);

    return this.getDetail(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, materialPurchaseOrder, id);
  }

  async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购订单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的订单');
    }
    await this.db
      .delete(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, id));
    this.logger.log(`删除面辅料采购订单成功: id=${id}`);
  }

  async submit(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购订单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的订单才能提交审核');
    }
    await this.db
      .update(materialPurchaseOrder)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(materialPurchaseOrder.id, id));
    this.logger.log(`提交面辅料采购订单审核: id=${id}`);
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购订单不存在');
    }
    if (rows[0].status !== 'pending') {
      throw new BadRequestException('只有待审核状态的订单才能审核通过');
    }
    await this.db
      .update(materialPurchaseOrder)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(materialPurchaseOrder.id, id));
    this.logger.log(`审核通过面辅料采购订单: id=${id}`);
  }

  async unapprove(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(materialPurchaseOrder)
      .where(eq(materialPurchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('面辅料采购订单不存在');
    }
    if (rows[0].status !== 'approved') {
      throw new BadRequestException('只有已审核状态的订单才能弃审');
    }

    const inboundRows = await this.db
      .select({ count: count() })
      .from(materialPurchaseInbound)
      .where(eq(materialPurchaseInbound.orderId, id));
    const inboundCount: number = Number(inboundRows[0]?.count ?? 0);
    if (inboundCount > 0) {
      throw new ConflictException('订单已发生入库，不能弃审');
    }

    await this.db
      .update(materialPurchaseOrder)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(eq(materialPurchaseOrder.id, id));
    this.logger.log(`弃审面辅料采购订单: id=${id}`);
  }
}
