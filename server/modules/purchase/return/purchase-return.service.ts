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
import { and, desc, count, sql, inArray, gte, lte, like, or, eq } from 'drizzle-orm';
import {
  purchaseReturn,
  purchaseReturnItem,
  material,
  materialStock,
  payable,
  dealer,
  store,
  warehouse,
  supplier,
} from '@server/database/schema';
import type {
  PurchaseReturn,
  PurchaseReturnItem,
  PurchaseReturnCreateDto,
  ReturnContext,
  PaginationResult,
} from '@shared/api.interface';
import { StockService } from '../../inventory/stock/stock.service';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round2, round3, round4 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';

interface ListQuery {
  page: number;
  pageSize: number;
  status?: string;
  startDate?: string; // 退货日期（出库日期）起
  endDate?: string; // 退货日期（出库日期）止
  docStartDate?: string; // 单据日期（createdAt/_created_at）起
  docEndDate?: string; // 单据日期（createdAt/_created_at）止
  supplierId?: string;
  warehouseId?: string;
  keyword?: string;
}

@Injectable()
export class PurchaseReturnService {
  private readonly logger = new Logger(PurchaseReturnService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly stockService: StockService,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateReturnNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `PR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      purchaseReturn,
      purchaseReturn.returnNo,
      prefix,
      4,
    );
  }

  private mapReturn(row: typeof purchaseReturn.$inferSelect): PurchaseReturn {
    return {
      id: row.id,
      returnNo: row.returnNo,
      inboundId: row.inboundId ?? null,
      inboundNo: row.inboundNo ?? null,
      supplierId: row.supplierId ?? null,
      supplierName: row.supplierName ?? null,
      dealerId: row.dealerId ?? null,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      receiverType: row.receiverType as 'supplier' | 'store',
      receiverId: row.receiverId ?? null,
      receiverName: row.receiverName ?? null,
      returnDate: row.returnDate,
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapReturnItem(row: typeof purchaseReturnItem.$inferSelect): PurchaseReturnItem {
    return {
      id: row.id,
      returnId: row.returnId,
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

  async list(query: ListQuery): Promise<PaginationResult<PurchaseReturn>> {
    const { page, pageSize, status, startDate, endDate, docStartDate, docEndDate, supplierId, warehouseId, keyword } = query;
    const conditions = [];
    if (status) {
      const vals = status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (vals.length === 1) {
        conditions.push(eq(purchaseReturn.status, vals[0]));
      } else if (vals.length > 1) {
        conditions.push(inArray(purchaseReturn.status, vals));
      }
    }
    if (startDate) conditions.push(gte(purchaseReturn.returnDate, startDate));
    if (endDate) conditions.push(lte(purchaseReturn.returnDate, endDate));
    // 单据日期（系统创建时间 _created_at）：createdAt 为 customTimestamptz(Date 类型)，
    // 用 sql 模板传日期字符串规避 gte/lte 字符串类型报错；结束日用「< 次日」半开区间含入整日。
    if (docStartDate) conditions.push(sql`${purchaseReturn.createdAt} >= ${docStartDate}`);
    if (docEndDate) {
      const [y, m, d] = docEndDate.split('-').map(Number);
      const endDt = new Date(y, m - 1, d);
      endDt.setDate(endDt.getDate() + 1);
      const nextDay = `${endDt.getFullYear()}-${String(endDt.getMonth() + 1).padStart(2, '0')}-${String(endDt.getDate()).padStart(2, '0')}`;
      conditions.push(sql`${purchaseReturn.createdAt} < ${nextDay}`);
    }
    if (supplierId) conditions.push(eq(purchaseReturn.supplierId, supplierId));
    if (warehouseId) conditions.push(eq(purchaseReturn.warehouseId, warehouseId));
    if (keyword) {
      conditions.push(
        or(
          like(purchaseReturn.returnNo, `%${keyword}%`),
          like(purchaseReturn.supplierName, `%${keyword}%`),
        ),
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseReturn).where(where),
      this.db
        .select()
        .from(purchaseReturn)
        .where(where)
        .orderBy(desc(purchaseReturn.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapReturn(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<PurchaseReturn> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内（直连 dealerId 列）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: purchaseReturn.dealerId },
    );
    const where = scopeCond
      ? and(eq(purchaseReturn.id, id), scopeCond)
      : eq(purchaseReturn.id, id);
    const rows = await this.db
      .select()
      .from(purchaseReturn)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('采购退货单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(purchaseReturnItem)
      .where(eq(purchaseReturnItem.returnId, id));

    const ret = this.mapReturn(rows[0]);
    ret.items = itemRows.map((row) => this.mapReturnItem(row));
    return ret;
  }

  /**
   * 退货新增页上下文：依据当前账号类型决定 UI 形态。
   * - 总部(HQ)：退货店仓与收货方(供应商)均可在前端编辑；
   * - 经销商：退货店仓=本店仓、收货方=上级经销商店仓，均由服务端解析且只读。
   */
  async getReturnContext(): Promise<ReturnContext> {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    if (scope.type === 'all') {
      return {
        accountType: 'hq',
        returnWarehouse: { id: '', name: '', readonly: false },
        receiver: { type: 'supplier', readonly: false },
      };
    }

    const dealerId = scope.dealerIds[0];
    const [cur] = await this.db.select().from(dealer).where(eq(dealer.id, dealerId));

    // 本经销商的店仓（退货店仓）
    const [myStore] = await this.db
      .select({ id: store.id, name: store.name, warehouseId: store.warehouseId })
      .from(store)
      .where(eq(store.dealerId, dealerId));
    let returnWarehouse = { id: '', name: '', readonly: true as const };
    if (myStore?.warehouseId) {
      const [wh] = await this.db
        .select({ name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, myStore.warehouseId));
      returnWarehouse = {
        id: myStore.warehouseId,
        name: wh?.name ?? myStore.name,
        readonly: true,
      };
    }

    // 上级经销商的店仓（收货方）
    let parentStore:
      | { id: string; name: string; dealerId: string; dealerName: string }
      | undefined;
    if (cur?.parentId) {
      const [parent] = await this.db.select().from(dealer).where(eq(dealer.id, cur.parentId));
      const [ps] = await this.db
        .select({ id: store.id, name: store.name })
        .from(store)
        .where(eq(store.dealerId, cur.parentId));
      if (ps) {
        parentStore = {
          id: ps.id,
          name: ps.name,
          dealerId: parent?.id ?? '',
          dealerName: parent?.name ?? '',
        };
      }
    }

    return {
      accountType: 'dealer',
      dealerId,
      dealerName: cur?.name,
      returnWarehouse,
      receiver: { type: 'store', readonly: true, store: parentStore },
    };
  }

  async create(dto: PurchaseReturnCreateDto): Promise<PurchaseReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const isHq = scope.type === 'all';
    const curDealerId: string | null = isHq ? null : scope.dealerIds[0];

    let warehouseId: string;
    let warehouseName: string;
    let dealerId: string | null = curDealerId;
    let receiverType: 'supplier' | 'store';
    let receiverId: string;
    let receiverName: string;
    let supplierId: string | null = null;
    let supplierName: string | null = null;

    if (isHq) {
      // 总部：退货店仓与收货方(供应商)由前端提交，服务端校验存在性
      if (!dto.warehouseId) throw new BadRequestException('请选择退货店仓');
      if (!dto.receiver || dto.receiver.type !== 'supplier' || !dto.receiver.id) {
        throw new BadRequestException('请选择收货供应商');
      }
      const [wh] = await this.db
        .select({ id: warehouse.id, name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, dto.warehouseId));
      if (!wh) throw new BadRequestException('退货店仓不存在');
      const [sup] = await this.db
        .select({ id: supplier.id, name: supplier.name })
        .from(supplier)
        .where(eq(supplier.id, dto.receiver.id));
      if (!sup) throw new BadRequestException('收货供应商不存在');
      warehouseId = wh.id;
      warehouseName = wh.name;
      receiverType = 'supplier';
      receiverId = sup.id;
      receiverName = sup.name;
      supplierId = sup.id;
      supplierName = sup.name;
    } else {
      // 经销商：退货店仓与收货方由服务端按经销层级解析，忽略前端提交防篡改
      const ctx = await this.getReturnContext();
      if (!ctx.returnWarehouse.id) {
        throw new BadRequestException('当前经销商无关联店仓，无法退货');
      }
      if (!ctx.receiver.store) {
        throw new BadRequestException('当前经销商无上级经销商店仓，无法退货');
      }
      warehouseId = ctx.returnWarehouse.id;
      warehouseName = ctx.returnWarehouse.name;
      receiverType = 'store';
      receiverId = ctx.receiver.store.id;
      receiverName = ctx.receiver.store.name;
    }

    // 写权限校验（HQ 超管直接放行；经销商校验店仓归属）
    await assertWriteWithinScope(this.db, {
      dealerId,
      warehouseId,
      supplierId: receiverType === 'supplier' ? receiverId : null,
    });

    // 物料存在性 + 退货店仓库存充足（仅控库存，不控原单上限，支持批量退货）
    const materialIds = dto.items.map((i) => i.materialId);
    const matRows = await this.db
      .select()
      .from(material)
      .where(inArray(material.id, materialIds));
    const matMap = new Map(matRows.map((m) => [m.id, m]));

    let totalAmount = 0;
    const returnItems: {
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
      const qty = Number(item.quantity);
      const prc = Number(item.price);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new BadRequestException('退货数量必须大于 0');
      }
      if (!Number.isFinite(prc) || prc < 0) {
        throw new BadRequestException('退货单价不合法');
      }
      const mat = matMap.get(item.materialId);
      if (!mat) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
      // 校验退货店仓库存是否充足
      const [stk] = await this.db
        .select()
        .from(materialStock)
        .where(
          and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, warehouseId),
          ),
        );
      if (!stk || Number(stk.quantity) < qty) {
        throw new BadRequestException(`物料 ${mat.name} 在退货店仓库存不足，无法退货`);
      }
      const amt = qty * prc;
      totalAmount += amt;
      returnItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        unit: mat.unit,
        quantity: round3(qty),
        price: round4(prc),
        amount: round2(amt),
        batchNo: item.batchNo ?? null,
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const returnNo = await this.generateReturnNo(tx, dto.returnDate);
      const [inserted] = await tx
        .insert(purchaseReturn)
        .values({
          returnNo,
          inboundId: dto.inboundId ?? null,
          inboundNo: null,
          supplierId,
          supplierName,
          dealerId,
          warehouseId,
          warehouseName,
          receiverType,
          receiverId,
          receiverName,
          returnDate: dto.returnDate,
          totalAmount: round2(totalAmount),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const returnId = inserted.id;
      await tx.insert(purchaseReturnItem).values(
        returnItems.map((item) => ({
          ...item,
          returnId,
        })),
      );

      return inserted;
    });

    return this.getDetail(created.id);
  }

  async approve(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(purchaseReturn)
      .where(eq(purchaseReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购退货单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只有草稿状态的退货单才能审核');
    }
    const ret = rows[0];

    const itemRows = await this.db
      .select()
      .from(purchaseReturnItem)
      .where(eq(purchaseReturnItem.returnId, id));

    // 审核时再次校验退货店仓库存充足（防止并发或其他单据已消耗）
    for (const item of itemRows) {
      const [stk] = await this.db
        .select()
        .from(materialStock)
        .where(
          and(
            eq(materialStock.materialId, item.materialId),
            eq(materialStock.warehouseId, ret.warehouseId),
          ),
        );
      if (!stk || Number(stk.quantity) < Number(item.quantity)) {
        throw new ConflictException(
          `物料 ${item.materialName} 在退货店仓库存不足，无法审核退货`,
        );
      }
    }

    await this.db.transaction(async (tx) => {
      // 1. 更新退货单状态
      await tx
        .update(purchaseReturn)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(eq(purchaseReturn.id, id));

      // 2. 扣减面辅料库存 + 生成库存流水
      const stockChanges = itemRows.map((item) => ({
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        materialId: item.materialId,
        itemType: 'material' as const,
        qtyDelta: -Number(item.quantity),
        flowType: 'purchase_return',
        bizNo: ret.returnNo,
        batchNo: item.batchNo ?? undefined,
        unitPrice: item.price,
        materialCode: item.materialCode,
        materialName: item.materialName,
      }));
      await this.stockService.batchChangeStock(tx, stockChanges);

      // 3. 总部退货（收货方=供应商）：生成应付红冲（负数应付单，冲减该供应商往来）
      if (ret.receiverType === 'supplier' && ret.supplierId) {
        const payableNo = `APR-${ret.returnNo}`;
        await tx.insert(payable).values({
          payableNo,
          supplierId: ret.supplierId,
          supplierName: ret.supplierName ?? '',
          bizType: 'purchase_return',
          bizNo: ret.returnNo,
          amount: round2(-Number(ret.totalAmount)),
          paidAmount: '0',
          balance: round2(-Number(ret.totalAmount)),
          status: 'unpaid',
          remark: `采购退货冲减应付 ${ret.returnNo}`,
        });
      }
      // 经销商退货（收货方=上级店仓）为内部调拨，不产生应付。
    });
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, purchaseReturn, id, {
      draftValue: 'draft',
      notFoundMsg: "采购退货单不存在",
      guardMsg: "只能删除草稿状态的退货单",
    });
  }

async delete(id: string): Promise<void> {
    const rows = await this.db
      .select()
      .from(purchaseReturn)
      .where(eq(purchaseReturn.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购退货单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('只能删除草稿状态的退货单');
    }
    await this.db.delete(purchaseReturn).where(eq(purchaseReturn.id, id));
  }
}
