import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { DRIZZLE_DATABASE, PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  like,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import {
  customer,
  dealer,
  garmentPurchaseOrder,
  garmentPurchaseReturn,
  payable,
  rbacUserPartner,
  receivable,
  salesOrder,
  salesReturn,
  supplier,
} from '@server/database/schema';
import { RbacService } from '../rbac/rbac.service';
import { GarmentPurchaseOrderService } from '../purchase/garment-order/garment-purchase-order.service';

export interface PortalQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
}

export interface PortalPurchaseOrder {
  id: string;
  orderNo: string;
  sourceOrderNo: string | null; // 上游销售单号（总部/上级卖给本节点的单）
  sourceDocType: string | null;
  supplierName: string | null; // 上游（卖方）
  partnerName: string | null; // 本节点（买方）
  orderDate: string | null;
  totalAmount: string | null;
  totalQty: string | null;
  status: string;
  remark: string | null;
}

export interface PortalPurchaseReturn {
  id: string;
  returnNo: string;
  sourceReturnNo: string | null; // 上游销售退货单号
  sourceDocType: string | null;
  supplierName: string | null;
  partnerName: string | null;
  returnDate: string | null;
  totalAmount: string | null;
  totalQty: string | null;
  status: string;
  remark: string | null;
}

export interface PortalPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PortalSummary {
  purchaseOrderCount: number;
  purchaseOrderAmount: number;
  purchaseReturnCount: number;
  purchaseReturnAmount: number;
}

export interface BoundPartner {
  id: string;
  name: string;
  code: string | null;
  level: number | null;
  treePath: string | null;
  role: string;
}

/**
 * 分销门户服务：让分销节点（经销商）用户登录后，
 * 仅能看到“自己节点及其下级子树”的采购单 / 采购退货单。
 *
 * 过滤核心：成衣采购单的 downstream_org_id 指向买方分销节点（dealer.id），
 * 因此用“用户绑定的 partner 子树”过滤该列即可实现行级隔离。
 *
 * 可见范围规则（与 rbac_user_store 最小权限范式一致）：
 *  - 超级管理员         → 可见全部（返回 null 表示不加限制）
 *  - 普通用户已绑定节点 → 可见这些节点及其全部后代
 *  - 普通用户未绑定节点 → 空集（不可见任何分销采购数据）
 */
@Injectable()
export class DistributionPortalService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly rbacService: RbacService,
    private readonly garmentPurchaseOrderService: GarmentPurchaseOrderService,
  ) {}

  /**
   * 解析当前用户可访问的分销节点 id 集合（含绑定的种子节点及其所有后代）。
   * 返回 null 表示“全部可见”（超级管理员）；返回 [] 表示“无任何可见节点”。
   */
  private async resolveVisiblePartnerIds(userId: string): Promise<string[] | null> {
    if (await this.rbacService.isSuperAdmin(userId)) {
      return null;
    }

    const bound = await this.db
      .select({ partnerId: rbacUserPartner.partnerId })
      .from(rbacUserPartner)
      .where(eq(rbacUserPartner.userId, userId));

    if (bound.length === 0) {
      return [];
    }

    const seedIds = bound.map((b) => b.partnerId);
    const nodes = await this.db
      .select({ id: dealer.id, treePath: dealer.treePath })
      .from(dealer)
      .where(inArray(dealer.id, seedIds));

    if (nodes.length === 0) {
      return seedIds;
    }

    // 每个种子节点：有 tree_path 则匹配“自身及后代”(tree_path LIKE path%)；
    // 无 tree_path（未回填）则仅精确匹配自身，避免 LIKE '%' 误匹配全表。
    const conds = nodes.map((n) =>
      n.treePath ? like(dealer.treePath, `${n.treePath}%`) : eq(dealer.id, n.id),
    );

    const rows = await this.db
      .select({ id: dealer.id })
      .from(dealer)
      .where(or(...conds));

    return rows.map((r) => r.id);
  }

  /** 根据可见节点集合构造下游采购单的 downstream_org_id 过滤条件。 */
  private buildDownstreamCondition(visibleIds: string[] | null): SQL | undefined {
    if (visibleIds === null) return undefined; // 全部可见
    if (visibleIds.length === 0) return sql`1=0`; // 无任何可见
    return inArray(garmentPurchaseOrder.downstreamOrgId, visibleIds);
  }

  /** 根据可见节点集合构造下游采购退货单的 downstream_org_id 过滤条件。 */
  private buildDownstreamConditionReturn(visibleIds: string[] | null): SQL | undefined {
    if (visibleIds === null) return undefined;
    if (visibleIds.length === 0) return sql`1=0`;
    return inArray(garmentPurchaseReturn.downstreamOrgId, visibleIds);
  }

  async getPurchaseOrders(
    userId: string,
    query: PortalQuery,
  ): Promise<PortalPage<PortalPurchaseOrder>> {
    const visibleIds = await this.resolveVisiblePartnerIds(userId);
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    if (visibleIds !== null && visibleIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const offset = (page - 1) * pageSize;
    const conditions: SQL[] = [];
    const downstreamCond = this.buildDownstreamCondition(visibleIds);
    if (downstreamCond) conditions.push(downstreamCond);
    if (query.status) conditions.push(eq(garmentPurchaseOrder.status, query.status));
    if (query.keyword)
      conditions.push(like(garmentPurchaseOrder.orderNo, `%${query.keyword}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRes, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(garmentPurchaseOrder)
        .where(where),
      this.db
        .select({
          id: garmentPurchaseOrder.id,
          orderNo: garmentPurchaseOrder.orderNo,
          sourceOrderNo: salesOrder.orderNo,
          sourceDocType: garmentPurchaseOrder.sourceDocType,
          supplierName: garmentPurchaseOrder.supplierName,
          partnerName: dealer.name,
          orderDate: garmentPurchaseOrder.orderDate,
          totalAmount: garmentPurchaseOrder.totalAmount,
          totalQty: garmentPurchaseOrder.totalQty,
          status: garmentPurchaseOrder.status,
          remark: garmentPurchaseOrder.remark,
        })
        .from(garmentPurchaseOrder)
        .leftJoin(dealer, eq(dealer.id, garmentPurchaseOrder.downstreamOrgId))
        .leftJoin(
          salesOrder,
          and(
            eq(salesOrder.id, garmentPurchaseOrder.sourceDocId),
            eq(garmentPurchaseOrder.sourceDocType, 'sales_order'),
          ),
        )
        .where(where)
        .orderBy(desc(garmentPurchaseOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    return {
      items: rows,
      total: Number(countRes[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getPurchaseReturns(
    userId: string,
    query: PortalQuery,
  ): Promise<PortalPage<PortalPurchaseReturn>> {
    const visibleIds = await this.resolveVisiblePartnerIds(userId);
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    if (visibleIds !== null && visibleIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const offset = (page - 1) * pageSize;
    const conditions: SQL[] = [];
    const downstreamCond = this.buildDownstreamConditionReturn(visibleIds);
    if (downstreamCond) conditions.push(downstreamCond);
    if (query.status) conditions.push(eq(garmentPurchaseReturn.status, query.status));
    if (query.keyword)
      conditions.push(like(garmentPurchaseReturn.returnNo, `%${query.keyword}%`));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRes, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(garmentPurchaseReturn)
        .where(where),
      this.db
        .select({
          id: garmentPurchaseReturn.id,
          returnNo: garmentPurchaseReturn.returnNo,
          sourceReturnNo: salesReturn.returnNo,
          sourceDocType: garmentPurchaseReturn.sourceDocType,
          supplierName: garmentPurchaseReturn.supplierName,
          partnerName: dealer.name,
          returnDate: garmentPurchaseReturn.returnDate,
          totalAmount: garmentPurchaseReturn.totalAmount,
          totalQty: garmentPurchaseReturn.totalQty,
          status: garmentPurchaseReturn.status,
          remark: garmentPurchaseReturn.remark,
        })
        .from(garmentPurchaseReturn)
        .leftJoin(dealer, eq(dealer.id, garmentPurchaseReturn.downstreamOrgId))
        .leftJoin(
          salesReturn,
          and(
            eq(salesReturn.id, garmentPurchaseReturn.sourceDocId),
            eq(garmentPurchaseReturn.sourceDocType, 'sales_return'),
          ),
        )
        .where(where)
        .orderBy(desc(garmentPurchaseReturn.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    return {
      items: rows,
      total: Number(countRes[0]?.count ?? 0),
      page,
      pageSize,
    };
  }

  async getSummary(userId: string): Promise<PortalSummary> {
    const visibleIds = await this.resolveVisiblePartnerIds(userId);

    const [po, pr] = await Promise.all([
      this.db
        .select({
          cnt: count(),
          amt: sql`coalesce(sum(${garmentPurchaseOrder.totalAmount}), 0)`,
        })
        .from(garmentPurchaseOrder)
        .where(this.buildDownstreamCondition(visibleIds)),
      this.db
        .select({
          cnt: count(),
          amt: sql`coalesce(sum(${garmentPurchaseReturn.totalAmount}), 0)`,
        })
        .from(garmentPurchaseReturn)
        .where(this.buildDownstreamConditionReturn(visibleIds)),
    ]);

    return {
      purchaseOrderCount: Number(po[0]?.cnt ?? 0),
      purchaseOrderAmount: Number(po[0]?.amt ?? 0),
      purchaseReturnCount: Number(pr[0]?.cnt ?? 0),
      purchaseReturnAmount: Number(pr[0]?.amt ?? 0),
    };
  }

  /** 当前用户绑定的分销节点（含层级与角色）。 */
  async getUserPartners(userId: string): Promise<BoundPartner[]> {
    const rows = await this.db
      .select({
        id: dealer.id,
        name: dealer.name,
        code: dealer.code,
        level: dealer.level,
        treePath: dealer.treePath,
        role: rbacUserPartner.role,
      })
      .from(rbacUserPartner)
      .innerJoin(dealer, eq(dealer.id, rbacUserPartner.partnerId))
      .where(eq(rbacUserPartner.userId, userId));

    return rows;
  }

  /**
   * 将用户绑定到一个或多个分销节点（仅超级管理员可操作）。
   * 绑定后，该用户登录门户即可看到这些节点及其下级的采购单 / 退货单。
   */
  async assignUserPartners(
    operatorUserId: string,
    targetUserId: string,
    partnerIds: string[],
  ): Promise<void> {
    if (!(await this.rbacService.isSuperAdmin(operatorUserId))) {
      throw new ForbiddenException('仅超级管理员可分配分销门户访问权限');
    }
    if (partnerIds.length > 0) {
      const partners = await this.db
        .select({ id: dealer.id })
        .from(dealer)
        .where(inArray(dealer.id, partnerIds));
      if (partners.length !== partnerIds.length) {
        throw new ForbiddenException('存在无效的分销节点ID');
      }
    }
    await this.db.transaction(async (tx) => {
      await tx
        .delete(rbacUserPartner)
        .where(eq(rbacUserPartner.userId, targetUserId));
      if (partnerIds.length > 0) {
        await tx
          .insert(rbacUserPartner)
          .values(
            partnerIds.map((pid) => ({
              userId: targetUserId,
              partnerId: pid,
              role: 'owner',
            })),
          );
      }
    });
  }

  /**
   * 分销节点用户确认接收上游镜像生成的采购单（待接收 -> 已审核）。
   * 确认前校验：目标采购单必须属于当前用户可见子树（downstream_org_id 在可见集合中），
   * 防止越权确认。确认后该下游采购单方可执行采购入库（入库门禁要求 status='approved'）。
   */
  async confirmPurchaseOrder(
    userId: string,
    orderId: string,
  ): Promise<{ id: string; status: string }> {
    const visibleIds = await this.resolveVisiblePartnerIds(userId);
    if (visibleIds !== null && visibleIds.length === 0) {
      throw new ForbiddenException('当前用户无任何可见分销节点');
    }

    const rows = await this.db
      .select({ id: garmentPurchaseOrder.id, downstreamOrgId: garmentPurchaseOrder.downstreamOrgId })
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.id, orderId));
    if (rows.length === 0) {
      throw new ForbiddenException('采购订单不存在或不可见');
    }
    const downstreamOrgId = rows[0].downstreamOrgId;
    if (visibleIds !== null && (!downstreamOrgId || !visibleIds.includes(downstreamOrgId))) {
      throw new ForbiddenException('该采购订单不属于当前用户可见的分销子树');
    }

    const updated = await this.garmentPurchaseOrderService.confirmPurchaseOrder(orderId);
    return { id: updated.id, status: updated.status };
  }

  /**
   * 分销门户“上下游应收应付对账视图”（F3 应付闭环）。
   *
   * 对当前用户可见子树内的每个分销节点：
   *  - 作为“下游买方”（customer 身份，partner_id=本节点）：其应收 receivables 表示本节点欠上游的货款；
   *  - 作为“上游卖方”（supplier 身份，partner_id=本节点）：其应付 payables 表示下级欠本节点的货款。
   * 两者对冲得到该节点的净应收/应付头寸。
   *
   * 返回：按节点明细 + 整棵子树汇总，便于门户核对“上级开了多少应收 / 下级欠了多少应付”。
   */
  async getReconciliation(userId: string): Promise<{
    nodes: Array<{
      dealerId: string;
      dealerName: string | null;
      dealerCode: string | null;
      level: number | null;
      treePath: string | null;
      asBuyerReceivable: number; // 本节点作为买方欠上游（应收，站在上游视角）
      asSellerPayable: number; // 本节点作为卖方被下级欠（应付，站在本节点视角）
      netPosition: number; // asSellerPayable - asBuyerReceivable
    }>;
    summary: {
      nodeCount: number;
      totalAsBuyerReceivable: number;
      totalAsSellerPayable: number;
      totalNetPosition: number;
    };
  }> {
    const visibleIds = await this.resolveVisiblePartnerIds(userId);
    if (visibleIds !== null && visibleIds.length === 0) {
      return {
        nodes: [],
        summary: {
          nodeCount: 0,
          totalAsBuyerReceivable: 0,
          totalAsSellerPayable: 0,
          totalNetPosition: 0,
        },
      };
    }

    // 可见子树全部节点（含自身及后代）
    const dealerRows = await this.db
      .select({
        id: dealer.id,
        name: dealer.name,
        code: dealer.code,
        level: dealer.level,
        treePath: dealer.treePath,
      })
      .from(dealer)
      .where(visibleIds === null ? undefined : inArray(dealer.id, visibleIds));

    // 一次性取出这些节点对应的 customer / supplier 身份
    const customerRows = await this.db
      .select({ partnerId: customer.partnerId, id: customer.id })
      .from(customer)
      .where(
        visibleIds === null ? undefined : inArray(customer.partnerId, visibleIds),
      );
    const supplierRows = await this.db
      .select({ partnerId: supplier.partnerId, id: supplier.id })
      .from(supplier)
      .where(
        visibleIds === null ? undefined : inArray(supplier.partnerId, visibleIds),
      );
    const customerByPartner = new Map(customerRows.map((c) => [c.partnerId, c.id]));
    const supplierByPartner = new Map(supplierRows.map((s) => [s.partnerId, s.id]));

    const customerIds = customerRows.map((c) => c.id);
    const supplierIds = supplierRows.map((s) => s.id);

    // 批量取应收（按 customer_id）与应付（按 supplier_id）
    const receivableRows = customerIds.length
      ? await this.db
          .select({ customerId: receivable.customerId, amount: receivable.amount })
          .from(receivable)
          .where(inArray(receivable.customerId, customerIds))
      : [];
    const payableRows = supplierIds.length
      ? await this.db
          .select({ supplierId: payable.supplierId, amount: payable.amount })
          .from(payable)
          .where(inArray(payable.supplierId, supplierIds))
      : [];

    const receivableByCustomer = new Map<string, number>();
    for (const r of receivableRows) {
      receivableByCustomer.set(
        r.customerId,
        (receivableByCustomer.get(r.customerId) ?? 0) + Number(r.amount),
      );
    }
    const payableBySupplier = new Map<string, number>();
    for (const p of payableRows) {
      payableBySupplier.set(
        p.supplierId,
        (payableBySupplier.get(p.supplierId) ?? 0) + Number(p.amount),
      );
    }

    const nodes = dealerRows.map((d) => {
      const custId = customerByPartner.get(d.id);
      const suppId = supplierByPartner.get(d.id);
      const asBuyerReceivable = custId ? receivableByCustomer.get(custId) ?? 0 : 0;
      const asSellerPayable = suppId ? payableBySupplier.get(suppId) ?? 0 : 0;
      return {
        dealerId: d.id,
        dealerName: d.name,
        dealerCode: d.code,
        level: d.level,
        treePath: d.treePath,
        asBuyerReceivable,
        asSellerPayable,
        netPosition: asSellerPayable - asBuyerReceivable,
      };
    });

    const summary = {
      nodeCount: nodes.length,
      totalAsBuyerReceivable: nodes.reduce((s, n) => s + n.asBuyerReceivable, 0),
      totalAsSellerPayable: nodes.reduce((s, n) => s + n.asSellerPayable, 0),
      totalNetPosition: nodes.reduce((s, n) => s + n.netPosition, 0),
    };

    return { nodes, summary };
  }
}
