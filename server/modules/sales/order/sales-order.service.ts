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
  salesOrder,
  salesOrderItem,
  customer,
  sku,
  salesOutbound,
  salesReturn,
} from '@server/database/schema';
import {
  SalesOrderStatus,
  SalesOutboundStatus,
  SalesReturnStatus,
} from '@shared/api.interface';
import type {
  SalesOrder,
  SalesOrderItem,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { DistributionMirrorService } from '../../distribution/distribution-mirror.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '../../../common/context/request-context';
import { buildDealerScopeCondition } from '../../../common/data-scope/dealer-scope';
import { paginateWithKeyset } from '@server/database/keyset';

interface CreateOrderDto {
  customerId: string;
  orderDate: string;
  deliveryDate?: string;
  remark?: string;
  items: {
    skuId: string;
    quantity: number;
    price: number;
  }[];
}

interface UpdateOrderDto {
  customerId: string;
  orderDate: string;
  deliveryDate?: string;
  remark?: string;
  items: {
    skuId: string;
    quantity: number;
    price: number;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  customerId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  /** keyset 游标：传入后走游标分页（深翻页/无限滚动），忽略 page */
  cursor?: string;
}

@Injectable()
export class SalesOrderService {
  private readonly logger = new Logger(SalesOrderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly distributionMirror: DistributionMirrorService,
  ) {}

  private async generateOrderNo(
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

  private mapOrder(row: typeof salesOrder.$inferSelect): SalesOrder {
    return {
      id: row.id,
      orderNo: row.orderNo,
      customerId: row.customerId,
      customerName: row.customerName,
      orderDate: row.orderDate,
      deliveryDate: row.deliveryDate ?? undefined,
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapOrderItem(row: typeof salesOrderItem.$inferSelect): SalesOrderItem {
    return {
      id: row.id,
      orderId: row.orderId,
      skuId: row.skuId,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      quantity: Number(row.quantity),
      price: Number(row.price),
      amount: Number(row.amount),
      deliveredQty: Number(row.deliveredQty),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<SalesOrder>> {
    const { page, pageSize, customerId, status, startDate, endDate, cursor } = query;
    const conditions = [];
    if (customerId) conditions.push(eq(salesOrder.customerId, customerId));
    if (status) conditions.push(eq(salesOrder.status, status));
    if (startDate) conditions.push(gte(salesOrder.orderDate, startDate));
    if (endDate) conditions.push(lt(salesOrder.orderDate, endDate));
    // 行级数据权限：仅可见当前用户所属经销商的客户所下销售订单，防止跨租户越权读取
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaCustomer', column: salesOrder.customerId },
    );
    if (scopeCond) conditions.push(scopeCond);
    // 排除已软删行：软删仅置位 _deleted_at，行仍在表内
    conditions.push(...notDeleted(salesOrder));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // 双模分页：无 cursor 走 OFFSET（total 精确）；有 cursor 走 keyset(createdAt DESC, id DESC)，
    // 深翻页时避免 OFFSET 丢弃前 N 行带来的 O(N+M) 退化，且新增行不会造成结果位移。
    const { rows, total, nextCursor } = await paginateWithKeyset({
      cursor,
      page,
      pageSize,
      timeCol: salesOrder.createdAt,
      idCol: salesOrder.id,
      timeField: 'createdAt',
      idField: 'id',
      where,
      select: (w, limit, offset) =>
        this.db
          .select()
          .from(salesOrder)
          .where(w)
          .orderBy(desc(salesOrder.createdAt), desc(salesOrder.id))
          .limit(limit)
          .offset(offset),
      count: async (w) =>
        Number((await this.db.select({ count: count() }).from(salesOrder).where(w))[0]?.count ?? 0),
    });

    return {
      items: rows.map((row) => this.mapOrder(row)),
      total,
      page,
      pageSize,
      nextCursor,
    };
  }

  async getDetail(id: string): Promise<SalesOrder> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内，否则视为不存在
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaCustomer', column: salesOrder.customerId },
    );
    const where = notDeletedWhere(salesOrder, eq(salesOrder.id, id), scopeCond);
    const rows = await this.db.select().from(salesOrder).where(where);
    if (rows.length === 0) {
      throw new NotFoundException('销售订单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.orderId, id));

    const order = this.mapOrder(rows[0]);
    order.items = itemRows.map((row) => this.mapOrderItem(row));
    return order;
  }

  async create(dto: CreateOrderDto): Promise<SalesOrder> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    // 校验客户
    const custRows = await this.db
      .select()
      .from(customer)
      .where(eq(customer.id, dto.customerId));
    if (custRows.length === 0) {
      throw new BadRequestException('客户不存在');
    }
    const cust = custRows[0];

    // 校验SKU并取信息
    const skuIds = dto.items.map((item) => item.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    let totalAmount = 0;
    const orderItems: {
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      amount: string;
      deliveredQty: string;
    }[] = [];

    for (const item of dto.items) {
      const skuItem = skuMap.get(item.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${item.skuId}`);
      }
      const qty = Number(item.quantity);
      const prc = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt = qty * prc;
      totalAmount += amt;
      orderItems.push({
        skuId: skuItem.id,
        skuCode: skuItem.skuCode,
        styleNo: skuItem.styleNo,
        color: skuItem.color,
        size: skuItem.size,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        deliveredQty: '0',
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const orderNo = await this.generateOrderNo(tx, dto.orderDate);

      const inserted = await tx
        .insert(salesOrder)
        .values({
          orderNo,
          customerId: dto.customerId,
          customerName: cust.name,
          orderDate: dto.orderDate,
          deliveryDate: dto.deliveryDate ?? null,
          totalAmount: round2(totalAmount),
          status: SalesOrderStatus.DRAFT,
          remark: dto.remark ?? null,
        })
        .returning();

      const orderId = inserted[0].id;
      await tx.insert(salesOrderItem).values(
        orderItems.map((item) => ({
          ...item,
          orderId,
        })),
      );

      return inserted[0];
    });

    return this.getDetail(created.id);
  }

  async update(id: string, dto: UpdateOrderDto): Promise<SalesOrder> {
    const rows = await this.db
      .select()
      .from(salesOrder)
      .where(notDeletedWhere(salesOrder, eq(salesOrder.id, id)));
    if (rows.length === 0) {
      throw new NotFoundException('销售订单不存在');
    }
    const order = rows[0];
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('只能修改草稿状态的订单');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('订单明细不能为空');
    }

    // 查询旧明细
    const oldItems = await this.db
      .select()
      .from(salesOrderItem)
      .where(eq(salesOrderItem.orderId, id));
    const oldItemMap = new Map<string, typeof salesOrderItem.$inferSelect>();
    for (const oi of oldItems) {
      oldItemMap.set(oi.skuId, oi);
    }

    // 检查被删除的明细：已出库的不允许删除
    const newSkuIds = new Set(dto.items.map((item) => item.skuId));
    for (const [skuId, oldItem] of oldItemMap) {
      if (!newSkuIds.has(skuId) && Number(oldItem.deliveredQty) > 0) {
        throw new ConflictException('存在已出库明细，无法删除');
      }
    }

    // 校验客户
    const custRows = await this.db
      .select()
      .from(customer)
      .where(eq(customer.id, dto.customerId));
    if (custRows.length === 0) {
      throw new BadRequestException('客户不存在');
    }
    const cust = custRows[0];

    // 校验SKU
    const skuIds = dto.items.map((item) => item.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    let totalAmount = 0;
    const orderItems: {
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string;
      size: string;
      quantity: string;
      price: string;
      amount: string;
      deliveredQty: string;
    }[] = [];

    for (const item of dto.items) {
      const skuItem = skuMap.get(item.skuId);
      if (!skuItem) {
        throw new BadRequestException(`SKU不存在: ${item.skuId}`);
      }
      const qty = Number(item.quantity);
      const prc = Number(item.price);
      if (qty <= 0 || prc < 0) {
        throw new BadRequestException('数量或单价不合法');
      }
      const amt = qty * prc;
      totalAmount += amt;
      // 保留旧明细的已出库数量，新增SKU为0
      const oldItem = oldItemMap.get(item.skuId);
      const deliveredQty = oldItem ? String(oldItem.deliveredQty) : '0';
      orderItems.push({
        skuId: skuItem.id,
        skuCode: skuItem.skuCode,
        styleNo: skuItem.styleNo,
        color: skuItem.color,
        size: skuItem.size,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        deliveredQty,
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(salesOrder)
        .set({
          customerId: dto.customerId,
          customerName: cust.name,
          orderDate: dto.orderDate,
          deliveryDate: dto.deliveryDate ?? null,
          totalAmount: round2(totalAmount),
          remark: dto.remark ?? null,
          updatedAt: new Date(),
        })
        .where(eq(salesOrder.id, id));

      await tx.delete(salesOrderItem).where(eq(salesOrderItem.orderId, id));
      await tx.insert(salesOrderItem).values(
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
        { kind: 'viaCustomer', column: salesOrder.customerId },
      );
    }

    async voidDoc(id: string): Promise<void> {
      const scopeCond = this.orderScopeCond();
      // 已软删的单据不可再作废（此前该分支在 scopeCond 为空时被整段跳过，等于没校验）
      const rows = await this.db
        .select()
        .from(salesOrder)
        .where(notDeletedWhere(salesOrder, eq(salesOrder.id, id), scopeCond));
      if (rows.length === 0) throw new NotFoundException('销售订单不存在');
      await voidDraftDocument(this.db, salesOrder, id, {
        draftValue: SalesOrderStatus.DRAFT,
        notFoundMsg: "销售订单不存在",
        guardMsg: "只能删除草稿状态的订单",
      });
    }

  /**
   * 删除：改为软删（置位 _deleted_at），数据可恢复。
   * 明细行不删——主表不再触发 FK ON DELETE CASCADE，sales_order_item 原样保留，
   * 还原时订单头与明细同时回来。
   */
  async delete(id: string): Promise<void> {
    const scopeCond = this.orderScopeCond();
    const rows = await this.db
      .select()
      .from(salesOrder)
      .where(notDeletedWhere(salesOrder, eq(salesOrder.id, id), scopeCond));
    if (rows.length === 0) {
      throw new NotFoundException('销售订单不存在');
    }
    if (rows[0].status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('只能删除草稿状态的订单');
    }
    await softDeleteRow(this.db, salesOrder, id);
  }

  /** 还原：清空 _deleted_at，让被误删的订单回到列表。 */
  async restore(id: string): Promise<void> {
    const scopeCond = this.orderScopeCond();
    // 注意：存在性校验只能挂 scope，不能挂 notDeleted——
    // 已软删的行恰恰不在 notDeleted 范围内，挂上就永远匹配不到，还原必然 404。
    const rows = await this.db
      .select()
      .from(salesOrder)
      .where(scopeCond ? and(eq(salesOrder.id, id), scopeCond) : eq(salesOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售订单不存在');
    }
    await restoreRow(this.db, salesOrder, id);
  }

  async audit(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(salesOrder)
        .where(notDeletedWhere(salesOrder, eq(salesOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('销售订单不存在');
      }
      if (row.status !== SalesOrderStatus.DRAFT) {
        throw new BadRequestException('只有新增状态的订单才能审核');
      }
      await tx
        .update(salesOrder)
        .set({ status: SalesOrderStatus.AUDITED, updatedAt: new Date() })
        .where(eq(salesOrder.id, id));
    });
  }

  async cancelAudit(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(salesOrder)
        .where(notDeletedWhere(salesOrder, eq(salesOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('销售订单不存在');
      }
      if (row.status !== SalesOrderStatus.AUDITED) {
        throw new BadRequestException('只有已审核状态的订单才能取消审核');
      }

      // 已记账/验收的下游单据视为已发生业务，禁止取消审核
      const outboundRows = await tx
        .select({ id: salesOutbound.id, status: salesOutbound.status })
        .from(salesOutbound)
        .where(eq(salesOutbound.orderId, id));
      const effectiveOutbounds = outboundRows.filter(
        (o) => o.status === SalesOutboundStatus.BOOKED || o.status === SalesOutboundStatus.ACCEPTED,
      );
      if (effectiveOutbounds.length > 0) {
        const outboundIds = effectiveOutbounds.map((r) => r.id);
        const returnRows = await tx
          .select({ count: count() })
          .from(salesReturn)
          .where(
            and(
              inArray(salesReturn.outboundId, outboundIds),
              inArray(salesReturn.status, [SalesReturnStatus.BOOKED, SalesReturnStatus.ACCEPTED]),
            ),
          );
        const returnCount = Number(returnRows[0]?.count ?? 0);
        if (returnCount > 0) {
          throw new ConflictException('存在销售退货单，无法取消审核');
        }
        throw new ConflictException('订单已发生出库，不能取消审核');
      }

      await tx
        .update(salesOrder)
        .set({ status: SalesOrderStatus.DRAFT, updatedAt: new Date() })
        .where(eq(salesOrder.id, id));
    });
  }

  async book(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const scopeCond = this.orderScopeCond();
      const [row] = await tx
        .select()
        .from(salesOrder)
        .where(notDeletedWhere(salesOrder, eq(salesOrder.id, id), scopeCond))
        .for('update');
      if (!row) {
        throw new NotFoundException('销售订单不存在');
      }
      if (row.status !== SalesOrderStatus.AUDITED) {
        throw new BadRequestException('只有已审核状态的订单才能记账');
      }
      await tx
        .update(salesOrder)
        .set({ status: SalesOrderStatus.BOOKED, updatedAt: new Date() })
        .where(eq(salesOrder.id, id));
    });

    // 分销镜像：记账后向下级分销商生成采购单（服务内部已吞掉异常，不影响主流程）
    await this.distributionMirror.mirrorFromSalesOrder(id);
  }

}
