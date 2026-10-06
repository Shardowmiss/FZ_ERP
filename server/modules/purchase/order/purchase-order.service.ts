import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { notDeleted, notDeletedWhere, restoreRow, softDeleteRow } from '@server/common/soft-delete';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, desc, count, gte, lt, sql, inArray } from 'drizzle-orm';
import {
  purchaseOrder,
  purchaseOrderItem,
  supplier,
  material,
  purchaseInbound,
  purchaseReturn,
} from '@server/database/schema';
import {
  PurchaseOrderStatus,
} from '@shared/api.interface';
import type {
  PurchaseOrder,
  PurchaseOrderItem,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '../../../common/context/request-context';
import { buildDealerScopeCondition } from '../../../common/data-scope/dealer-scope';




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
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateOrderNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `PO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      purchaseOrder,
      purchaseOrder.orderNo,
      prefix,
      4,
    );
  }

  private mapOrder(row: typeof purchaseOrder.$inferSelect): PurchaseOrder {
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

  private mapOrderItem(row: typeof purchaseOrderItem.$inferSelect): PurchaseOrderItem {
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

  async list(query: ListQuery): Promise<PaginationResult<PurchaseOrder>> {
    const { page, pageSize, supplierId, status, startDate, endDate } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(purchaseOrder.supplierId, supplierId));
    if (status) conditions.push(eq(purchaseOrder.status, status));
    if (startDate) conditions.push(gte(purchaseOrder.orderDate, startDate));
    if (endDate) {
      // 半开区间上界：endDate 当天应包含在结果内（与 inventory-flow / report-purchase 的 +1 天约定一致）
      const [y, m, d] = endDate.split('-').map(Number);
      const endExclusive = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      conditions.push(lt(purchaseOrder.orderDate, endExclusive));
    }
    // 行级数据权限：仅可见当前用户所属经销商的供应商所下采购订单，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: purchaseOrder.supplierId },
    );
    if (scopeCond) conditions.push(scopeCond);
    // 排除已软删行：软删仅置位 _deleted_at，行仍在表内
    conditions.push(...notDeleted(purchaseOrder));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseOrder).where(where),
      this.db
        .select()
        .from(purchaseOrder)
        .where(where)
        .orderBy(desc(purchaseOrder.createdAt))
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

  async getDetail(id: string): Promise<PurchaseOrder> {
    // 行级数据权限：通过 ID 直查也须落在当前用户可见经销商范围内，否则视为不存在
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: purchaseOrder.supplierId },
    );
    const where = notDeletedWhere(purchaseOrder, eq(purchaseOrder.id, id), scopeCond);
    const rows = await this.db.select().from(purchaseOrder).where(where);
    if (rows.length === 0) {
      throw new NotFoundException('采购订单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(purchaseOrderItem)
      .where(eq(purchaseOrderItem.orderId, id));

    const order = this.mapOrder(rows[0]);
    order.items = itemRows.map((row) => this.mapOrderItem(row));
    return order;
  }

  async create(dto: CreateOrderDto): Promise<PurchaseOrder> {
    if (!dto.items || dto.items.length === 0) {
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

    // 校验物料并取信息
    const materialIds = dto.items.map((item) => item.materialId);
    const matRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const matMap = new Map<string, typeof material.$inferSelect>();
    for (const m of matRows) {
      matMap.set(m.id, m);
    }

    let totalAmount = 0;
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
      const qty = Number(item.quantity);
      const prc = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt = qty * prc;
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
      const orderNo = await this.generateOrderNo(tx, dto.orderDate);

      const inserted = await tx
        .insert(purchaseOrder)
        .values({
          orderNo,
          supplierId: dto.supplierId,
          supplierName: sup.name,
          orderDate: dto.orderDate,
          expectDate: dto.expectDate ?? null,
          totalAmount: round2(totalAmount),
          status: PurchaseOrderStatus.DRAFT,
          remark: dto.remark ?? null,
        })
        .returning();

      const orderId = inserted[0].id;
      await tx.insert(purchaseOrderItem).values(
        orderItems.map((item) => ({
          ...item,
          orderId,
        })),
      );

      return inserted[0];
    });

    return this.getDetail(created.id);
  }

  async update(id: string, dto: UpdateOrderDto): Promise<PurchaseOrder> {
    const rows = await this.db.select().from(purchaseOrder).where(eq(purchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购订单不存在');
    }
    const order = rows[0];
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException('只有“新增”状态的采购订单可以修改');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    // 查询旧明细
    const oldItems = await this.db
      .select()
      .from(purchaseOrderItem)
      .where(eq(purchaseOrderItem.orderId, id));
    const oldItemMap = new Map<string, typeof purchaseOrderItem.$inferSelect>();
    for (const oi of oldItems) {
      oldItemMap.set(oi.materialId, oi);
    }

    // 检查被删除的明细：已入库的不允许删除
    const newMaterialIds = new Set(dto.items.map((item) => item.materialId));
    for (const [materialId, oldItem] of oldItemMap) {
      if (!newMaterialIds.has(materialId) && Number(oldItem.receivedQty) > 0) {
        throw new ConflictException('存在已入库明细，无法删除');
      }
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

    // 校验物料
    const materialIds = dto.items.map((item) => item.materialId);
    const matRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const matMap = new Map<string, typeof material.$inferSelect>();
    for (const m of matRows) {
      matMap.set(m.id, m);
    }

    let totalAmount = 0;
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
      const qty = Number(item.quantity);
      const prc = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt = qty * prc;
      totalAmount += amt;
      // 保留旧明细的已入库数量，新增物料为0
      const oldItem = oldItemMap.get(item.materialId);
      const receivedQty = oldItem ? String(oldItem.receivedQty) : '0';
      orderItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        unit: mat.unit,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        receivedQty,
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(purchaseOrder)
        .set({
          supplierId: dto.supplierId,
          supplierName: sup.name,
          orderDate: dto.orderDate,
          expectDate: dto.expectDate ?? null,
          totalAmount: round2(totalAmount),
          remark: dto.remark ?? null,
          updatedAt: new Date(),
        })
        .where(eq(purchaseOrder.id, id));

      await tx.delete(purchaseOrderItem).where(eq(purchaseOrderItem.orderId, id));
      await tx.insert(purchaseOrderItem).values(
        orderItems.map((item) => ({
          ...item,
          orderId: id,
        })),
      );
    });

    return this.getDetail(id);
  }

    private orderScopeCond() {
      return buildDealerScopeCondition(
        RequestContext.getDealerScope() ?? ALL_SCOPE,
        { kind: 'viaSupplier', column: purchaseOrder.supplierId },
      );
    }

    async voidDoc(id: string): Promise<void> {
      const scopeCond = this.orderScopeCond();
      if (scopeCond) {
        const rows = await this.db
          .select()
          .from(purchaseOrder)
          .where(and(eq(purchaseOrder.id, id), scopeCond));
        if (rows.length === 0) throw new NotFoundException('采购订单不存在');
      }
      await voidDraftDocument(this.db, purchaseOrder, id, {
        draftValue: PurchaseOrderStatus.DRAFT,
        notFoundMsg: "采购订单不存在",
        guardMsg: "只能删除“新增”状态的采购订单",
      });
    }

  /**
   * 删除：改为软删（置位 _deleted_at），数据可恢复。
   * 明细行不删——主表不再触发 FK ON DELETE CASCADE，purchase_order_item 原样保留。
   */
  async delete(id: string): Promise<void> {
    const scopeCond = this.orderScopeCond();
    const rows = await this.db
      .select()
      .from(purchaseOrder)
      .where(notDeletedWhere(purchaseOrder, eq(purchaseOrder.id, id), scopeCond));
    if (rows.length === 0) {
      throw new NotFoundException('采购订单不存在');
    }
    if (rows[0].status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('只能删除“新增”状态的采购订单');
    }
    await softDeleteRow(this.db, purchaseOrder, id);
  }

  /** 还原：清空 _deleted_at，让被误删的采购订单回到列表。 */
  async restore(id: string): Promise<void> {
    const scopeCond = this.orderScopeCond();
    // 注意：存在性校验只能挂 scope，不能挂 notDeleted——
    // 已软删的行恰恰不在 notDeleted 范围内，挂上就永远匹配不到，还原必然 404。
    const rows = await this.db
      .select()
      .from(purchaseOrder)
      .where(scopeCond ? and(eq(purchaseOrder.id, id), scopeCond) : eq(purchaseOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购订单不存在');
    }
    await restoreRow(this.db, purchaseOrder, id);
  }

  /** 审核：新增(draft) → 审核(audited)。审核后订单锁定，不可修改。 */
  async audit(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(purchaseOrder)
        .where(notDeletedWhere(purchaseOrder, eq(purchaseOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('采购订单不存在');
      }
      if (row.status !== PurchaseOrderStatus.DRAFT) {
        throw new BadRequestException('只有"新增"状态的采购订单才能审核');
      }
      await tx
        .update(purchaseOrder)
        .set({ status: PurchaseOrderStatus.AUDITED, updatedAt: new Date() })
        .where(eq(purchaseOrder.id, id));
    });
  }

  /** 取消审核：审核(audited) → 新增(draft)。退回草稿以便修改。 */
  async cancelAudit(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(purchaseOrder)
        .where(notDeletedWhere(purchaseOrder, eq(purchaseOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('采购订单不存在');
      }
      if (row.status !== PurchaseOrderStatus.AUDITED) {
        throw new BadRequestException('只有"审核"状态的采购订单才能取消审核');
      }
      await tx
        .update(purchaseOrder)
        .set({ status: PurchaseOrderStatus.DRAFT, updatedAt: new Date() })
        .where(eq(purchaseOrder.id, id));
    });
  }

  /** 记账：审核(audited) → 记账(booked)。订单真正生效，可作为后续单据（入库/退货/应付）的导入源。 */
  async book(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(purchaseOrder)
        .where(notDeletedWhere(purchaseOrder, eq(purchaseOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('采购订单不存在');
      }
      if (row.status !== PurchaseOrderStatus.AUDITED) {
        throw new BadRequestException('只有"审核"状态的采购订单才能记账');
      }
      await tx
        .update(purchaseOrder)
        .set({ status: PurchaseOrderStatus.BOOKED, updatedAt: new Date() })
        .where(eq(purchaseOrder.id, id));
    });
  }

  /** 验收：记账(booked) → 验收(accepted)。入库验收环节最终验收完成，订单终态。重复验收幂等。 */
  async accept(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(purchaseOrder)
        .where(notDeletedWhere(purchaseOrder, eq(purchaseOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('采购订单不存在');
      }
      if (row.status === PurchaseOrderStatus.ACCEPTED) {
        return;
      }
      if (row.status !== PurchaseOrderStatus.BOOKED) {
        throw new BadRequestException('只有"记账"状态的采购订单才能验收');
      }
      await tx
        .update(purchaseOrder)
        .set({ status: PurchaseOrderStatus.ACCEPTED, updatedAt: new Date() })
        .where(eq(purchaseOrder.id, id));
    });
  }

  /** 可导入的采购订单：已记账(booked) 或 已验收(accepted)，即"真正生效"的订单。 */
  async listImportable(query: ListQuery): Promise<PaginationResult<PurchaseOrder>> {
    const { page, pageSize, supplierId, startDate, endDate } = query;
    const conditions = [
      inArray(purchaseOrder.status, [
        PurchaseOrderStatus.BOOKED,
        PurchaseOrderStatus.ACCEPTED,
      ]),
    ];
    if (supplierId) conditions.push(eq(purchaseOrder.supplierId, supplierId));
    if (startDate) conditions.push(gte(purchaseOrder.orderDate, startDate));
    if (endDate) {
      // 半开区间上界：endDate 当天应包含在结果内（与 inventory-flow / report-purchase 的 +1 天约定一致）
      const [y, m, d] = endDate.split('-').map(Number);
      const endExclusive = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      conditions.push(lt(purchaseOrder.orderDate, endExclusive));
    }
    // 行级数据权限：可导入列表同样仅可见当前用户所属经销商的数据
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: purchaseOrder.supplierId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = and(...conditions);
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseOrder).where(where),
      this.db
        .select()
        .from(purchaseOrder)
        .where(where)
        .orderBy(desc(purchaseOrder.createdAt))
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
}
