import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, sql, gte, lt, lte, like, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  retailOrder,
  retailOrderItem,
  retailReturn,
  store,
  sku,
  warehouse,
  member,
  memberPoint,
} from '@server/database/schema';
import { RbacService } from '../rbac/rbac.service';
import { StockService } from '@server/modules/inventory/stock/stock.service';
import type {
  RetailOrder,
  RetailOrderItem,
  RetailReturn,
  RetailPayMethod,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../finance/month-close/month-close.service';
import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import { UniqueCodeService } from '../unique-code/unique-code.service';
import { round2, round3, round4 } from '../../common/utils/money';
import { paginateWithKeyset } from '@server/database/keyset';

/* ---------------- precision helpers ---------------- */

/* ---------------- DTO interfaces ---------------- */
export interface CreateRetailItemDto {
  skuId: string;
  quantity: number;
  dealPrice?: number;
  discountRate?: number;
}

export interface CreateRetailDto {
  storeId: string;
  saleDate?: string;
  cashierName?: string;
  memberId?: string;
  source?: string;
  items: CreateRetailItemDto[];
  remark?: string;
}

export interface UpdateRetailItemsDto {
  items: CreateRetailItemDto[];
  remark?: string;
}

export interface SettleRetailDto {
  payMethods: RetailPayMethod[];
  receivedAmount?: number;
  wholeDiscount?: number;
}

export interface CreateReturnItemDto {
  retailItemId: string;
  quantity: number;
}

export interface CreateReturnDto {
  originalRetailId: string;
  items: CreateReturnItemDto[];
  remark?: string;
}

/* ---------------- service ---------------- */
@Injectable()
export class RetailService {
  private readonly logger = new Logger(RetailService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly rbacService: RbacService,
    private readonly uniqueCodeService: UniqueCodeService,
  ) {}

  /* ========== Retail Order List ========== */
  async getRetailOrderList(params: {
    page: number;
    pageSize: number;
    storeId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    keyword?: string;
    userId?: string;
    /** keyset 游标：传入后走游标分页，忽略 page */
    cursor?: string;
  }): Promise<PaginationResult<RetailOrder>> {
    const { page, pageSize, storeId, startDate, endDate, status, keyword, userId, cursor } =
      params;

    const conditions = this.buildRetailOrderConditions({
      storeId,
      startDate,
      endDate,
      status,
      keyword,
    });

    // 行级数据权限：将用户可见门店范围并入查询条件，防止跨门店越权读取
    if (userId) {
      const scope = await this.rbacService.getUserDataScope(userId);
      const scopeCond = this.rbacService.buildStoreCondition(scope, retailOrder.storeId);
      if (scopeCond) conditions.push(scopeCond);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // 双模分页：零售单是量增长最快的表（POS 每笔小票一行），深翻页用 keyset(createdAt DESC, id DESC)
    const { rows, total, nextCursor } = await paginateWithKeyset({
      cursor,
      page,
      pageSize,
      timeCol: retailOrder.createdAt,
      idCol: retailOrder.id,
      timeField: 'createdAt',
      idField: 'id',
      where,
      select: (w, limit, offset) =>
        this.db
          .select()
          .from(retailOrder)
          .where(w)
          .orderBy(desc(retailOrder.createdAt), desc(retailOrder.id))
          .limit(limit)
          .offset(offset),
      count: async (w) =>
        Number((await this.db.select({ count: count() }).from(retailOrder).where(w))[0]?.count ?? 0),
    });

    const items: RetailOrder[] = rows.map((r) => this.mapRetailOrder(r));

    return { items, total, page, pageSize, nextCursor };
  }

  private buildRetailOrderConditions(params: {
    storeId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    keyword?: string;
  }) {
    const conditions = [];
    if (params.storeId) {
      conditions.push(eq(retailOrder.storeId, params.storeId));
    }
    if (params.startDate) {
      conditions.push(gte(retailOrder.saleDate, params.startDate));
    }
    if (params.endDate) {
      conditions.push(lt(retailOrder.saleDate, params.endDate));
    }
    if (params.status) {
      conditions.push(eq(retailOrder.status, params.status));
    }
    if (params.keyword) {
      conditions.push(
        or(
          like(retailOrder.retailNo, `%${params.keyword}%`),
          like(retailOrder.memberId, `%${params.keyword}%`),
        ),
      );
    }
    return conditions;
  }

  /* ========== Retail Order Detail ========== */
  async getRetailOrderDetail(id: string): Promise<RetailOrder> {
    const [orderRow] = await this.db
      .select()
      .from(retailOrder)
      .where(eq(retailOrder.id, id));
    if (!orderRow) {
      throw new NotFoundException('零售单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(retailOrderItem)
      .where(eq(retailOrderItem.retailId, id))
      .orderBy(retailOrderItem.createdAt);

    const order = this.mapRetailOrder(orderRow);
    order.items = itemRows.map((r) => this.mapRetailOrderItem(r));
    return order;
  }

  /* ========== Create Draft Retail Order ========== */
  async createDraftRetail(
    dto: CreateRetailDto,
    userId: string,
  ): Promise<{ id: string }> {
    const {
      storeId,
      saleDate,
      cashierName,
      memberId,
      source,
      items,
      remark,
    } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('零售单明细不能为空');
    }

    // check store
    const [storeRow] = await this.db
      .select()
      .from(store)
      .where(eq(store.id, storeId));
    if (!storeRow) {
      throw new NotFoundException('门店不存在');
    }

    // resolve sale date
    const finalSaleDate = saleDate || new Date().toISOString().slice(0, 10);

    // fetch sku info for all items
    const skuIds = items.map((i) => i.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(
        sql`${sku.id} = ANY(ARRAY[${sql.join(
          skuIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[])`,
      );
    if (skuRows.length !== skuIds.length) {
      throw new BadRequestException('部分SKU不存在');
    }
    const skuMap = new Map(skuRows.map((s) => [s.id, s]));

    // compute amounts
    let totalAmount = 0;
    const itemRowsToInsert: typeof retailOrderItem.$inferInsert[] = [];

    for (const item of items) {
      const skuRow = skuMap.get(item.skuId)!;
      const tagPrice = Number(skuRow.tagPrice);
      const qty = Number(round3(item.quantity));
      const deal = item.dealPrice !== undefined ? Number(round4(item.dealPrice)) : tagPrice;
      const lineAmount = Number(round2(qty * deal));
      totalAmount += lineAmount;

      itemRowsToInsert.push({
        retailId: '', // filled after insert
        skuId: item.skuId,
        skuCode: skuRow.skuCode,
        styleNo: skuRow.styleNo,
        color: skuRow.color,
        size: skuRow.size,
        colorId: skuRow.colorId ?? null,
        sizeId: skuRow.sizeId ?? null,
        quantity: String(qty),
        tagPrice: String(round2(tagPrice)),
        dealPrice: String(deal),
        discountRate:
          item.discountRate !== undefined
            ? String(round4(item.discountRate))
            : undefined,
        lineAmount: String(lineAmount),
      });
    }

    totalAmount = Number(round2(totalAmount));

    const result = await this.db.transaction(async (tx) => {
      const retailNo = await this.generateRetailNo(tx, finalSaleDate);

      const [inserted] = await tx
        .insert(retailOrder)
        .values({
          retailNo,
          storeId,
          storeName: storeRow.name,
          saleDate: finalSaleDate,
          cashierName,
          memberId,
          source: source || 'store_pos',
          totalAmount: String(totalAmount),
          discountAmount: '0',
          receivableAmount: String(totalAmount),
          receivedAmount: '0',
          changeAmount: '0',
          payMethods: [],
          itemCount: items.length,
          status: 'draft',
          remark,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: retailOrder.id, retailNo: retailOrder.retailNo });

      // insert items
      const itemsWithRetailId = itemRowsToInsert.map((it) => ({
        ...it,
        retailId: inserted.id,
      }));
      await tx.insert(retailOrderItem).values(itemsWithRetailId);

      return inserted;
    });

    this.logger.log(
      `创建零售单草稿成功: retailNo=${result.retailNo}, storeId=${storeId}, itemCount=${items.length}, operator=${userId}`,
    );

    return { id: result.id };
  }

  /* ========== Update Retail Items (draft only) ========== */
  async updateRetailItems(
    id: string,
    dto: UpdateRetailItemsDto,
    userId: string,
  ): Promise<{ success: boolean }> {
    const { items, remark } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('零售单明细不能为空');
    }

    const [orderRow] = await this.db
      .select()
      .from(retailOrder)
      .where(eq(retailOrder.id, id));
    if (!orderRow) {
      throw new NotFoundException('零售单不存在');
    }
    if (orderRow.status !== 'draft') {
      throw new BadRequestException('仅草稿状态可修改');
    }

    // fetch sku info
    const skuIds = items.map((i) => i.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(
        sql`${sku.id} = ANY(ARRAY[${sql.join(
          skuIds.map((sid) => sql`${sid}`),
          sql`, `,
        )}]::uuid[])`,
      );
    if (skuRows.length !== skuIds.length) {
      throw new BadRequestException('部分SKU不存在');
    }
    const skuMap = new Map(skuRows.map((s) => [s.id, s]));

    // recompute
    let totalAmount = 0;
    const itemsToInsert: typeof retailOrderItem.$inferInsert[] = [];

    for (const item of items) {
      const skuRow = skuMap.get(item.skuId)!;
      const tagPrice = Number(skuRow.tagPrice);
      const qty = Number(round3(item.quantity));
      const deal = item.dealPrice !== undefined ? Number(round4(item.dealPrice)) : tagPrice;
      const lineAmount = Number(round2(qty * deal));
      totalAmount += lineAmount;

      itemsToInsert.push({
        retailId: id,
        skuId: item.skuId,
        skuCode: skuRow.skuCode,
        styleNo: skuRow.styleNo,
        color: skuRow.color,
        size: skuRow.size,
        colorId: skuRow.colorId ?? null,
        sizeId: skuRow.sizeId ?? null,
        quantity: String(qty),
        tagPrice: String(round2(tagPrice)),
        dealPrice: String(deal),
        discountRate:
          item.discountRate !== undefined
            ? String(round4(item.discountRate))
            : undefined,
        lineAmount: String(lineAmount),
      });
    }

    totalAmount = Number(round2(totalAmount));

    await this.db.transaction(async (tx) => {
      // delete old items
      await tx
        .delete(retailOrderItem)
        .where(eq(retailOrderItem.retailId, id));
      // insert new items
      await tx.insert(retailOrderItem).values(itemsToInsert);
      // update header
      await tx
        .update(retailOrder)
        .set({
          totalAmount: String(totalAmount),
          discountAmount: '0',
          receivableAmount: String(totalAmount),
          itemCount: items.length,
          remark: remark !== undefined ? remark : orderRow.remark,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(retailOrder.id, id));
    });

    return { success: true };
  }

  /* ========== Settle Retail Order ========== */
  async settleRetailOrder(
    id: string,
    dto: SettleRetailDto,
    userId: string,
    posSessionId?: string,
  ): Promise<RetailOrder> {
    const { payMethods, receivedAmount, wholeDiscount } = dto;

    if (!payMethods || payMethods.length === 0) {
      throw new BadRequestException('支付方式不能为空');
    }

    const [orderRow] = await this.db
      .select()
      .from(retailOrder)
      .where(eq(retailOrder.id, id));
    if (!orderRow) {
      throw new NotFoundException('零售单不存在');
    }
    if (orderRow.status !== 'draft') {
      throw new BadRequestException('仅草稿状态可结算');
    }

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(orderRow.saleDate);

    // compute receivable amount
    let totalAmount = Number(orderRow.totalAmount);
    let receivableAmount = totalAmount;
    let discountAmount = Number(orderRow.discountAmount);

    if (wholeDiscount !== undefined) {
      if (wholeDiscount <= 0 || wholeDiscount > 1) {
        throw new BadRequestException('整单折扣必须在(0, 1]之间');
      }
      receivableAmount = Number(round2(totalAmount * wholeDiscount));
      discountAmount = Number(round2(totalAmount - receivableAmount));
    }

    // validate pay methods sum
    const payTotal = payMethods.reduce(
      (sum: number, p: RetailPayMethod) => sum + Number(p.amount),
      0,
    );
    if (payTotal < receivableAmount - 0.001) {
      throw new BadRequestException('支付金额合计不能小于应收金额');
    }

    const received =
      receivedAmount !== undefined ? Number(round2(receivedAmount)) : Number(round2(payTotal));
    const changeAmount = Number(round2(received - receivableAmount));

    // get store -> warehouse
    const [storeRow] = await this.db
      .select()
      .from(store)
      .where(eq(store.id, orderRow.storeId));
    if (!storeRow || !storeRow.warehouseId) {
      throw new BadRequestException('门店未配置对应仓库，无法扣减库存');
    }

    const [warehouseRow] = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, storeRow.warehouseId));
    if (!warehouseRow) {
      throw new BadRequestException('门店对应仓库不存在');
    }

    // get items
    const itemRows = await this.db
      .select()
      .from(retailOrderItem)
      .where(eq(retailOrderItem.retailId, id));

    const retailNo = orderRow.retailNo;

    await this.db.transaction(async (tx) => {
      // 1. 扣减门店仓库 SKU 库存
      const stockChanges = itemRows.map((item) => ({
        warehouseId: storeRow.warehouseId!,
        warehouseName: warehouseRow.name,
        skuId: item.skuId,
        itemType: 'sku' as const,
        qtyDelta: -Number(item.quantity),
        flowType: 'retail_outbound',
        bizNo: retailNo,
        unitPrice: item.dealPrice ? String(item.dealPrice) : undefined,
        operator: userId,
        remark: `零售出库: ${retailNo}`,
        skuCode: item.skuCode,
        styleNo: item.styleNo ?? undefined,
        color: item.color ?? undefined,
        size: item.size ?? undefined,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 1.5 唯一码核销（out → sold）：把本单已出库扫描的唯一码核销为已售；未启用唯一码时自动跳过
      const ucSettle = await this.uniqueCodeService.verifySoldByDoc(
        { docType: 'retail', docId: id },
        tx,
      );
      if (ucSettle.enabled && ucSettle.failed.length > 0) {
        this.logger.warn(
          `零售单 ${retailNo} 唯一码核销部分失败：${JSON.stringify(ucSettle.failed)}`,
        );
      }

      // 2. update order status
      const settleSet: Record<string, unknown> = {
        totalAmount: String(totalAmount),
        discountAmount: String(discountAmount),
        receivableAmount: String(receivableAmount),
        receivedAmount: String(received),
        changeAmount: String(changeAmount),
        payMethods: payMethods as unknown as Record<string, unknown>[],
        status: 'settled',
        updatedBy: userId,
        updatedAt: new Date(),
      };
      // 收银班次关联并入结算事务（POS checkout 传入），避免游离的单笔 update。
      if (posSessionId) settleSet.posSessionId = posSessionId;
      await tx.update(retailOrder).set(settleSet).where(eq(retailOrder.id, id));

      // 3. 会员积分与消费累计（消费 1 元 = 1 积分；写 member 汇总 + member_point 流水）
      if (orderRow.memberId) {
        const earned = Math.floor(Number(receivableAmount));
        if (earned > 0) {
          const [mRow] = await tx
            .select({ points: member.points })
            .from(member)
            .where(eq(member.id, orderRow.memberId));
          const balance = (mRow ? Number(mRow.points) : 0) + earned;
          await tx
            .update(member)
            .set({
              points: balance,
              totalSpent: sql`${member.totalSpent} + ${String(receivableAmount)}::numeric`,
              orderCount: sql`${member.orderCount} + 1`,
              lastPurchaseDate: orderRow.saleDate,
              updatedAt: new Date(),
            })
            .where(eq(member.id, orderRow.memberId));
          await tx.insert(memberPoint).values({
            memberId: orderRow.memberId,
            changeType: 'earn',
            changeValue: earned,
            balance,
            remark: `零售消费获赠积分: ${retailNo}`,
          });
        }
      }
    });

    this.logger.log(
      `零售单结算成功: retailNo=${retailNo}, receivable=${receivableAmount}, received=${received}, operator=${userId}`,
    );

    return this.getRetailOrderDetail(id);
  }

  /* ========== SKU lookup by barcode / code ========== */
  async getSkuByBarcode(barcode: string): Promise<{
    id: string;
    skuCode: string;
    styleNo: string;
    color: string;
    size: string;
    tagPrice: number;
  }> {
    const [row] = await this.db
      .select()
      .from(sku)
      .where(eq(sku.barcode, barcode));
    if (!row) {
      throw new NotFoundException('SKU不存在');
    }
    return {
      id: row.id,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      tagPrice: Number(row.tagPrice),
    };
  }

  async getSkuByCode(code: string): Promise<{
    id: string;
    skuCode: string;
    styleNo: string;
    color: string;
    size: string;
    tagPrice: number;
  }> {
    const [row] = await this.db
      .select()
      .from(sku)
      .where(eq(sku.skuCode, code));
    if (!row) {
      throw new NotFoundException('SKU不存在');
    }
    return {
      id: row.id,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color,
      size: row.size,
      tagPrice: Number(row.tagPrice),
    };
  }

  /* ========== Retail Return List ========== */
  async getReturnList(params: {
    page: number;
    pageSize: number;
    storeId?: string;
    status?: string;
    keyword?: string;
    userId?: string;
    docStartDate?: string;
    docEndDate?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginationResult<RetailReturn>> {
    const { page, pageSize, storeId, status, keyword, userId, docStartDate, docEndDate, startDate, endDate } = params;

    const conditions = [];
    if (storeId) conditions.push(eq(retailReturn.storeId, storeId));
    if (status) conditions.push(eq(retailReturn.status, status));
    // 单据日期（系统创建时间 createdAt）区间过滤，结束日用次日开区间含入整日
    if (docStartDate) conditions.push(sql`${retailReturn.createdAt} >= ${docStartDate}`);
    if (docEndDate) {
      const [y, m, d] = docEndDate.split('-').map(Number);
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 1);
      const nextDay = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      conditions.push(sql`${retailReturn.createdAt} < ${nextDay}`);
    }
    // 业务日期（退货日期 returnDate）区间过滤
    if (startDate) conditions.push(gte(retailReturn.returnDate, startDate));
    if (endDate) conditions.push(lte(retailReturn.returnDate, endDate));
    // 行级数据权限：将用户可见门店范围并入查询条件
    if (userId) {
      const scope = await this.rbacService.getUserDataScope(userId);
      const scopeCond = this.rbacService.buildStoreCondition(scope, retailReturn.storeId);
      if (scopeCond) conditions.push(scopeCond);
    }
    if (keyword) {
      conditions.push(
        or(
          like(retailReturn.returnNo, `%${keyword}%`),
          like(retailReturn.originalRetailNo, `%${keyword}%`),
        ),
      );
    }

    const whereClause =
      conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult, rows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(retailReturn)
        .where(whereClause),
      this.db
        .select()
        .from(retailReturn)
        .where(whereClause)
        .orderBy(desc(retailReturn.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);
    const items: RetailReturn[] = rows.map((r) => this.mapRetailReturn(r));

    return { items, total, page, pageSize };
  }

  /* ========== Retail Return Detail ========== */
  async getReturnDetail(id: string): Promise<RetailReturn> {
    const [row] = await this.db
      .select()
      .from(retailReturn)
      .where(eq(retailReturn.id, id));
    if (!row) {
      throw new NotFoundException('退货单不存在');
    }
    const result = this.mapRetailReturn(row);

    // Parse return items from remark and enrich with original item data
    const itemRefs = this.parseReturnItemsFromRemark(row.remark);
    if (itemRefs.length > 0) {
      const originalItems = await this.db
        .select()
        .from(retailOrderItem)
        .where(eq(retailOrderItem.retailId, row.originalRetailId));
      const origMap = new Map(originalItems.map((i) => [i.id, i]));

      result.items = itemRefs.map((ref) => {
        const orig = origMap.get(ref.retailItemId);
        const qty = Number(round3(ref.quantity));
        const deal = orig ? Number(orig.dealPrice) : 0;
        return {
          retailItemId: ref.retailItemId,
          skuId: orig?.skuId ?? '',
          skuCode: orig?.skuCode ?? '',
          color: orig?.color ?? undefined,
          size: orig?.size ?? undefined,
          quantity: qty,
          dealPrice: deal,
          amount: Number(round2(qty * deal)),
        };
      });
    }

    return result;
  }

  /* ========== Create Return from Original Retail Order ========== */
  async createReturn(
    dto: CreateReturnDto,
    userId: string,
  ): Promise<{ id: string }> {
    const { originalRetailId, items, remark } = dto;

    if (!items || items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    // get original order
    const [originalOrder] = await this.db
      .select()
      .from(retailOrder)
      .where(eq(retailOrder.id, originalRetailId));
    if (!originalOrder) {
      throw new NotFoundException('原零售单不存在');
    }
    if (originalOrder.status !== 'settled') {
      throw new BadRequestException('仅已结算的零售单可退货');
    }

    // get original items
    const originalItems = await this.db
      .select()
      .from(retailOrderItem)
      .where(eq(retailOrderItem.retailId, originalRetailId));
    const originalItemMap = new Map(originalItems.map((i) => [i.id, i]));

    // validate return items
    for (const it of items) {
      const orig = originalItemMap.get(it.retailItemId);
      if (!orig) {
        throw new BadRequestException(`原单明细不存在: ${it.retailItemId}`);
      }
      if (it.quantity <= 0) {
        throw new BadRequestException('退货数量必须大于0');
      }
      if (it.quantity > Number(orig.quantity) + 0.001) {
        throw new BadRequestException(
          `退货数量不能超过原单数量: SKU ${orig.skuCode}`,
        );
      }
    }

    // compute total refund amount
    let totalAmount = 0;
    const returnItems: Array<{
      retailItemId: string;
      skuId: string;
      skuCode: string;
      color: string | null;
      size: string | null;
      quantity: number;
      dealPrice: number;
      amount: number;
    }> = [];

    for (const it of items) {
      const orig = originalItemMap.get(it.retailItemId)!;
      const qty = Number(round3(it.quantity));
      const deal = Number(orig.dealPrice);
      const amount = Number(round2(qty * deal));
      totalAmount += amount;
      returnItems.push({
        retailItemId: it.retailItemId,
        skuId: orig.skuId,
        skuCode: orig.skuCode,
        color: orig.color,
        size: orig.size,
        quantity: qty,
        dealPrice: deal,
        amount,
      });
    }
    totalAmount = Number(round2(totalAmount));

    // default refund methods: proportion of original pay methods
    const originalPayMethods = originalOrder.payMethods as unknown as RetailPayMethod[];
    const originalTotal = Number(originalOrder.receivableAmount);
    const refundMethods: RetailPayMethod[] = [];

    if (originalPayMethods && originalPayMethods.length > 0 && originalTotal > 0) {
      let remaining = totalAmount;
      for (let i = 0; i < originalPayMethods.length; i++) {
        const pm = originalPayMethods[i];
        const origAmt = Number(pm.amount);
        const proportion = origAmt / originalTotal;
        const refundAmt =
          i === originalPayMethods.length - 1
            ? Number(round2(remaining))
            : Number(round2(totalAmount * proportion));
        refundMethods.push({
          method: pm.method,
          amount: String(refundAmt),
        });
        remaining = Number(round2(remaining - refundAmt));
      }
    } else {
      refundMethods.push({ method: 'cash', amount: String(totalAmount) });
    }

    // store return items inside refundMethods jsonb extension field
    // (using a separate key would require schema change; instead we keep
    // items in a parallel structure — but task says no return item table
    // and items on the interface. We'll embed items as part of the return
    // record via a workaround: store them in the remark field is not ideal.
    // Better: we'll enrich refundMethods with item info by storing items
    // as a second array in the same jsonb under key "__items" — but that
    // breaks the RetailPayMethod[].
    //
    // Per task spec, RetailReturn.items is optional on the interface and
    // the task says "退货单目前不含item表，简化：退货数量 <= 原单该sku数量".
    // So we simply don't store individual return items in the database;
    // the total amount is stored and items are derived at query time by
    // comparing with original order. We'll return items from original
    // order filtered by the return relationship in getReturnDetail.
    //
    // For creation we don't persist item-level details — the return
    // header captures totalAmount and refundMethods only.

    // Encode return items into remark so refund can restock by item
    const finalRemark = this.encodeReturnItemsInRemark(
      remark,
      items.map((it) => ({
        retailItemId: it.retailItemId,
        quantity: Number(round3(it.quantity)),
      })),
    );

    const returnDate = new Date().toISOString().slice(0, 10);
    const result = await this.db.transaction(async (tx) => {
      const returnNo = await this.generateReturnNo(tx, returnDate);

      const [inserted] = await tx
        .insert(retailReturn)
        .values({
          returnNo,
          originalRetailId,
          originalRetailNo: originalOrder.retailNo,
          storeId: originalOrder.storeId,
          storeName: originalOrder.storeName,
          returnDate,
          totalAmount: String(totalAmount),
          refundMethods: refundMethods as unknown as Record<string, unknown>[],
          status: 'draft',
          remark: finalRemark,
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: retailReturn.id, returnNo: retailReturn.returnNo });

      return inserted;
    });

    this.logger.log(
      `创建零售退货单成功: returnNo=${result.returnNo}, originalRetailNo=${originalOrder.retailNo}, totalAmount=${totalAmount}, operator=${userId}`,
    );

    return { id: result.id };
  }

  /* ========== Approve / Refund Return ========== */
  async refundReturn(id: string, userId: string): Promise<RetailReturn> {
    const [returnRow] = await this.db
      .select()
      .from(retailReturn)
      .where(eq(retailReturn.id, id));
    if (!returnRow) {
      throw new NotFoundException('退货单不存在');
    }
    if (returnRow.status !== 'draft') {
      throw new BadRequestException('仅草稿状态可审核退款');
    }

    // get original order + items
    const [originalOrder] = await this.db
      .select()
      .from(retailOrder)
      .where(eq(retailOrder.id, returnRow.originalRetailId));
    if (!originalOrder) {
      throw new NotFoundException('原零售单不存在');
    }

    // get store warehouse
    const [storeRow] = await this.db
      .select()
      .from(store)
      .where(eq(store.id, returnRow.storeId));
    if (!storeRow || !storeRow.warehouseId) {
      throw new BadRequestException('门店未配置对应仓库，无法入库');
    }

    const [warehouseRow] = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, storeRow.warehouseId));
    if (!warehouseRow) {
      throw new BadRequestException('门店对应仓库不存在');
    }

    // Since there's no return item table, we need to figure out what to
    // restock. Simplified per task: we treat the return as returning all
    // original order items proportionally? No — the task says "退货数量 <= 原单该sku数量"
    // and the create endpoint accepts items with retailItemId + quantity.
    //
    // But we don't have a return_item table. For the refund operation to
    // work properly (restock specific items), we need to know WHICH items
    // and quantities. We need to store return items somewhere.
    //
    // Solution: store return item info inside the refundMethods jsonb
    // using a parallel "items" structure that doesn't conflict with
    // RetailPayMethod[]. We can use a pragmatic approach: embed item data
    // as an object in the refundMethods array with a special method
    // marker. But that's hacky.
    //
    // Better approach: use the remark field? No, not structured.
    //
    // Best pragmatic approach: since the task says "退货单目前不含item表",
    // but refund still needs item-level detail for restocking, we will
    // store item details inside the refundMethods jsonb by adding items
    // as a custom payload. But the schema types refundMethods as
    // RetailPayMethod[].
    //
    // Actually, looking more carefully at the return DTO for create: the
    // items are passed at creation time. We need to persist them to
    // restock during refund. Let's store them in the existing jsonb
    // column by extending its content with a known structure that
    // contains both pay methods and items. But the typed interface
    // expects RetailPayMethod[].
    //
    // Let me use the most pragmatic approach: store the returned items
    // serialized in the remark field as a JSON string prefixed with
    // "__items__:" — this is ugly but avoids schema changes.
    //
    // Actually, re-reading the task more carefully:
    // "简化：退货数量 <= 原单该sku数量，先不管多次退货"
    //
    // And the refund operation: "增加门店仓库库存（按item.quantity）"
    // This means we need item info at refund time.
    //
    // Let me store return item info by extending the jsonb field. The
    // schema declares it as RetailPayMethod[] but we can store extra
    // data as additional objects in the array with a special structure
    // or — better — we just store item details as part of the return
    // record by using the remark field in a structured way.
    //
    // I'll use the cleanest approach: since the task says no return item
    // table but we need item-level restock, I'll store return item
    // details in the refundMethods jsonb as an object with method =
    // '__items__' and amount = 0, but with an items field. Actually,
    // the simplest and cleanest approach for this task is to derive
    // items from the original order proportionally — but that's wrong
    // because the return might only include some items.
    //
    // Let me just store the items data in the refundMethods JSON by
    // adding a special marker object. When reading, we filter it out.
    //
    // Actually, I have a simpler idea. Let me just parse items from the
    // remark field. No — let me look at the schema again more carefully.
    //
    // The refundMethods column is jsonb with type comment
    // `{ method: string, amount: string }[]`. We can abuse this slightly
    // by also accepting that we store return item info there...
    //
    // Actually wait — re-reading the task one more time:
    // "items?: { retailItemId: string; skuId: string; skuCode: string; color?: string; size?: string; quantity: number; dealPrice: number; amount: number }[]"
    //
    // So the interface has items as optional. The task says "退货单目前不含item表".
    // This means items are not stored, they are derived/derivable.
    //
    // For the refund (restock) operation, since we don't have item-level
    // detail stored, I'll implement a simplified version: restock ALL
    // original order items. This matches the "简化：只要退过就returned"
    // approach — treat returns as whole-order returns.
    //
    // Actually no, the create endpoint takes specific items. So they
    // need to be persisted somehow.
    //
    // Final decision: I will create a simple helper that encodes the
    // return items into the existing remark field as JSON when creating
    // a return, and decode them when refunding. This avoids schema
    // changes while supporting item-level operations. The items are
    // also exposed via the detail endpoint by parsing from remark.

    // Get items from remark (set during create)
    const returnItems = this.parseReturnItemsFromRemark(returnRow.remark);
    if (returnItems.length === 0) {
      // Fallback: restock all original items (whole-order return)
      // (Should not happen if createReturn was used, but safe fallback)
    }

    // get original items for restock info
    const originalItems = await this.db
      .select()
      .from(retailOrderItem)
      .where(eq(retailOrderItem.retailId, returnRow.originalRetailId));
    const origItemMap = new Map(originalItems.map((i) => [i.id, i]));

    // build restock items list
    const restockItems: Array<{
      skuId: string;
      skuCode: string;
      styleNo: string;
      color: string | null;
      size: string | null;
      quantity: number;
    }> = [];

    if (returnItems.length > 0) {
      for (const ri of returnItems) {
        const orig = origItemMap.get(ri.retailItemId);
        if (!orig) continue;
        restockItems.push({
          skuId: orig.skuId,
          skuCode: orig.skuCode,
          styleNo: orig.styleNo,
          color: orig.color,
          size: orig.size,
          quantity: ri.quantity,
        });
      }
    } else {
      // whole-order return fallback
      for (const oi of originalItems) {
        restockItems.push({
          skuId: oi.skuId,
          skuCode: oi.skuCode,
          styleNo: oi.styleNo,
          color: oi.color,
          size: oi.size,
          quantity: Number(oi.quantity),
        });
      }
    }

    await this.db.transaction(async (tx) => {
      // 1. 增加门店仓库 SKU 库存（退货入库）
      const stockChanges = restockItems.map((item) => ({
        warehouseId: storeRow.warehouseId!,
        warehouseName: warehouseRow.name,
        skuId: item.skuId,
        itemType: 'sku' as const,
        qtyDelta: item.quantity,
        flowType: 'retail_return_in',
        bizNo: returnRow.returnNo,
        operator: userId,
        remark: `零售退货入库: ${returnRow.returnNo}`,
        skuCode: item.skuCode,
        styleNo: item.styleNo,
        color: item.color ?? undefined,
        size: item.size ?? undefined,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 1.5 唯一码回库（out/sold → in_stock）
      //     整单退货：自动回库原单全部已出库/已售的唯一码；
      //     部分退货：为避免把未退的件一起回库，不自动处理（需由单据传入退回的唯一码清单后调用）
      const origTotalQty = originalItems.reduce(
        (s: number, i: { quantity: string | number | null }) => s + Number(i.quantity ?? 0),
        0,
      );
      const restockTotalQty = restockItems.reduce(
        (s: number, i: { quantity: number }) => s + Number(i.quantity ?? 0),
        0,
      );
      const isFullReturn = restockTotalQty >= origTotalQty - 0.001;
      if (isFullReturn) {
        const ucRet = await this.uniqueCodeService.returnDocUniqueCodes(
          {
            docType: 'retail',
            docId: returnRow.originalRetailId,
            warehouseId: storeRow.warehouseId!,
          },
          tx,
        );
        if (ucRet.enabled && ucRet.failed.length > 0) {
          this.logger.warn(
            `零售退货 ${returnRow.returnNo} 唯一码回库部分失败：${JSON.stringify(ucRet.failed)}`,
          );
        }
      } else {
        this.logger.warn(
          `零售退货 ${returnRow.returnNo} 为部分退货，未自动回库唯一码（需传入退回的唯一码清单以保证件级准确）`,
        );
      }

      // 2. update return status
      await tx
        .update(retailReturn)
        .set({
          status: 'refunded',
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(retailReturn.id, id));

      // 4. update original order status
      await tx
        .update(retailOrder)
        .set({
          status: 'returned',
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(retailOrder.id, returnRow.originalRetailId));
    });

    this.logger.log(
      `零售退货审核成功: returnNo=${returnRow.returnNo}, originalRetailNo=${returnRow.originalRetailNo}, totalAmount=${returnRow.totalAmount}, operator=${userId}`,
    );

    return this.getReturnDetail(id);
  }

  /* ================= helpers ================= */

  private mapRetailOrder(row: typeof retailOrder.$inferSelect): RetailOrder {
    return {
      id: row.id,
      retailNo: row.retailNo,
      storeId: row.storeId,
      storeName: row.storeName,
      saleDate: row.saleDate,
      cashierName: row.cashierName ?? undefined,
      memberId: row.memberId ?? undefined,
      source: row.source,
      totalAmount: Number(row.totalAmount),
      discountAmount: Number(row.discountAmount),
      receivableAmount: Number(row.receivableAmount),
      receivedAmount: Number(row.receivedAmount),
      changeAmount: Number(row.changeAmount),
      payMethods: (row.payMethods as unknown as RetailPayMethod[]) || [],
      itemCount: row.itemCount,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapRetailOrderItem(
    row: typeof retailOrderItem.$inferSelect,
  ): RetailOrderItem {
    return {
      id: row.id,
      retailId: row.retailId,
      skuId: row.skuId,
      skuCode: row.skuCode,
      styleNo: row.styleNo,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      quantity: Number(row.quantity),
      tagPrice: Number(row.tagPrice),
      dealPrice: Number(row.dealPrice),
      discountRate: row.discountRate ? Number(row.discountRate) : undefined,
      lineAmount: Number(row.lineAmount),
    };
  }

  private mapRetailReturn(
    row: typeof retailReturn.$inferSelect,
  ): RetailReturn {
    const refundMethods =
      (row.refundMethods as unknown as RetailPayMethod[]) || [];
    // Strip internal __return_items__ prefix from exposed remark
    const cleanRemark = row.remark
      ? row.remark.replace(/^__return_items__:[^\n]+\n/, '')
      : undefined;
    return {
      id: row.id,
      returnNo: row.returnNo,
      originalRetailId: row.originalRetailId,
      originalRetailNo: row.originalRetailNo,
      storeId: row.storeId,
      storeName: row.storeName,
      returnDate: row.returnDate,
      totalAmount: Number(row.totalAmount),
      refundMethods,
      status: row.status,
      remark: cleanRemark && cleanRemark.length > 0 ? cleanRemark : undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async generateRetailNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '').slice(0, 8);
    const prefix = `LS${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      retailOrder,
      retailOrder.retailNo,
      prefix,
      4,
    );
  }

  private async generateReturnNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '').slice(0, 8);
    const prefix = `LT${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      retailReturn,
      retailReturn.returnNo,
      prefix,
      4,
    );
  }

  // Helper: encode/decode return items in remark as JSON string
  // Since we have no return_item table, we embed item data in remark
  // with a known prefix so we can restock correctly during refund.
  private encodeReturnItemsInRemark(
    remark: string | undefined,
    items: Array<{ retailItemId: string; quantity: number }>,
  ): string {
    const itemsJson = JSON.stringify(items);
    const prefix = `__return_items__:${itemsJson}\n`;
    return prefix + (remark || '');
  }

  private parseReturnItemsFromRemark(
    remark: string | null | undefined,
  ): Array<{ retailItemId: string; quantity: number }> {
    if (!remark) return [];
    const match = remark.match(/^__return_items__:([^\n]+)\n/);
    if (!match) return [];
    try {
      return JSON.parse(match[1]);
    } catch {
      return [];
    }
  }

  async voidOrder(id: string): Promise<void> {
    await voidDraftDocument(this.db, retailOrder, id);
  }

  async voidReturn(id: string): Promise<void> {
    await voidDraftDocument(this.db, retailReturn, id);
  }

}
