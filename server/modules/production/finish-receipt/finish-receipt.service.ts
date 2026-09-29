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
import { eq, and, desc, count, gte, lt, ilike, inArray } from 'drizzle-orm';
import {
  productionFinishReceipt,
  productionFinishReceiptItem,
  productionWorkOrder,
  sku,
  warehouse,
  systemOperationLog,
} from '@server/database/schema';
import type { PaginationResult } from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round3 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';
import {
  StockService,
  type StockChangeItem,
} from '../../inventory/stock/stock.service';


export interface FinishReceiptItem {
  id: string;
  receiptId: string;
  skuId: string;
  skuCode?: string;
  color?: string;
  size?: string;
  qty: number;
}

export interface FinishReceipt {
  id: string;
  receiptNo: string;
  workOrderId: string;
  workOrderNo?: string;
  warehouseId: string;
  warehouseName?: string;
  receiptDate: string;
  finishedQty: number;
  defectiveQty: number;
  status: string;
  remark?: string;
  createdAt: string;
  items?: FinishReceiptItem[];
}

interface CreateFinishReceiptDto {
  workOrderId: string;
  warehouseId: string;
  receiptDate: string;
  finishedQty: number;
  defectiveQty: number;
  remark?: string;
  items: {
    skuId: string;
    qty: number;
  }[];
}

interface UpdateFinishReceiptDto {
  workOrderId: string;
  warehouseId: string;
  receiptDate: string;
  finishedQty: number;
  defectiveQty: number;
  remark?: string;
  items: {
    skuId: string;
    qty: number;
  }[];
}

interface ListQuery {
  page: number;
  pageSize: number;
  status?: string;
  workOrderId?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
}

interface OperationLogCtx {
  userId: string;
  userName: string;
  module: string;
}

@Injectable()
export class FinishReceiptService {
  private readonly logger = new Logger(FinishReceiptService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly stockService: StockService,
  ) {}

  private async generateReceiptNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `FR${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      productionFinishReceipt,
      productionFinishReceipt.receiptNo,
      prefix,
      4,
    );
  }

  private mapHeader(
    row: typeof productionFinishReceipt.$inferSelect & { warehouseName?: string },
  ): FinishReceipt {
    return {
      id: row.id,
      receiptNo: row.receiptNo,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo ?? undefined,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName ?? undefined,
      receiptDate: row.receiptDate,
      finishedQty: Number(row.finishedQty),
      defectiveQty: Number(row.defectiveQty),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapItem(row: typeof productionFinishReceiptItem.$inferSelect): FinishReceiptItem {
    return {
      id: row.id,
      receiptId: row.receiptId,
      skuId: row.skuId,
      skuCode: row.skuCode ?? undefined,
      color: row.color ?? undefined,
      size: row.size ?? undefined,
      qty: Number(row.qty),
    };
  }

  private async insertOpLog(
    tx: PostgresJsDatabase,
    ctx: OperationLogCtx,
    operationType: string,
    objectId: string,
    objectName: string,
    summary: string,
  ): Promise<void> {
    await tx.insert(systemOperationLog).values({
      userId: ctx.userId,
      userName: ctx.userName,
      module: ctx.module,
      operationType,
      objectId,
      objectName,
      summary,
    });
  }

  async list(query: ListQuery): Promise<PaginationResult<FinishReceipt>> {
    const { page, pageSize, status, workOrderId, keyword, startDate, endDate } = query;
    const conditions = [];
    if (status) conditions.push(eq(productionFinishReceipt.status, status));
    if (workOrderId) conditions.push(eq(productionFinishReceipt.workOrderId, workOrderId));
    if (keyword) conditions.push(ilike(productionFinishReceipt.receiptNo, `%${keyword}%`));
    if (startDate) conditions.push(gte(productionFinishReceipt.receiptDate, startDate));
    if (endDate) conditions.push(lt(productionFinishReceipt.receiptDate, endDate));

    // 行级数据权限：仅可见当前用户所属经销商仓库关联的完工入库单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: productionFinishReceipt.warehouseId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(productionFinishReceipt).where(where),
      this.db
        .select()
        .from(productionFinishReceipt)
        .where(where)
        .orderBy(desc(productionFinishReceipt.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    // 补充仓库名称
    const whIds = [...new Set(rows.map((r) => r.warehouseId))];
    const whMap = new Map<string, string>();
    if (whIds.length > 0) {
      const whRows = await this.db
        .select({ id: warehouse.id, name: warehouse.name })
        .from(warehouse)
        .where(inArray(warehouse.id, whIds));
      for (const w of whRows) {
        whMap.set(w.id, w.name);
      }
    }

    return {
      items: rows.map((row) => ({
        ...this.mapHeader(row),
        warehouseName: whMap.get(row.warehouseId),
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<FinishReceipt> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: productionFinishReceipt.warehouseId },
    );
    const where = scopeCond
      ? and(eq(productionFinishReceipt.id, id), scopeCond)
      : eq(productionFinishReceipt.id, id);
    const rows = await this.db
      .select()
      .from(productionFinishReceipt)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('完工入库单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(productionFinishReceiptItem)
      .where(eq(productionFinishReceiptItem.receiptId, id));

    const whRows = await this.db
      .select({ name: warehouse.name })
      .from(warehouse)
      .where(eq(warehouse.id, rows[0].warehouseId));

    const header = this.mapHeader(rows[0]);
    header.warehouseName = whRows[0]?.name;
    header.items = itemRows.map((r) => this.mapItem(r));
    return header;
  }

  async create(dto: CreateFinishReceiptDto): Promise<FinishReceipt> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    // 校验工单
    const woRows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, dto.workOrderId));
    if (woRows.length === 0) {
      throw new BadRequestException('生产工单不存在');
    }
    const workOrder = woRows[0];

    // 校验仓库
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }

    await assertWriteWithinScope(this.db, { warehouseId: dto.warehouseId });

    // 校验 SKU
    const skuIds = dto.items.map((item) => item.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    const receiptItems: Omit<typeof productionFinishReceiptItem.$inferInsert, 'receiptId'>[] = [];
    let totalQty = 0;
    for (const item of dto.items) {
      const skuInfo = skuMap.get(item.skuId);
      if (!skuInfo) {
        throw new BadRequestException(`SKU不存在: ${item.skuId}`);
      }
      const qty = Number(item.qty);
      if (qty < 0) {
        throw new BadRequestException('数量不能为负');
      }
      totalQty += qty;
      receiptItems.push({
        skuId: skuInfo.id,
        skuCode: skuInfo.skuCode,
        color: skuInfo.color,
        size: skuInfo.size,
        qty: round3(qty),
      });
    }

    const finishedQty = Number(dto.finishedQty);
    const defectiveQty = Number(dto.defectiveQty);
    if (finishedQty < 0 || defectiveQty < 0) {
      throw new BadRequestException('数量不能为负');
    }

    const created = await this.db.transaction(async (tx) => {
      const receiptNo = await this.generateReceiptNo(tx, dto.receiptDate);

      const inserted = await tx
        .insert(productionFinishReceipt)
        .values({
          receiptNo,
          workOrderId: dto.workOrderId,
          workOrderNo: workOrder.orderNo,
          warehouseId: dto.warehouseId,
          receiptDate: dto.receiptDate,
          finishedQty: round3(finishedQty),
          defectiveQty: round3(defectiveQty),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const receiptId = inserted[0].id;
      await tx.insert(productionFinishReceiptItem).values(
        receiptItems.map((item) => ({
          ...item,
          receiptId,
        })),
      );

      return inserted[0];
    });

    return this.get(created.id);
  }

  async update(id: string, dto: UpdateFinishReceiptDto): Promise<FinishReceipt> {
    const rows = await this.db
      .select()
      .from(productionFinishReceipt)
      .where(eq(productionFinishReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('完工入库单不存在');
    }
    const receipt = rows[0];
    if (receipt.status !== 'draft') {
      throw new ConflictException('仅草稿状态可修改');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    // 校验工单
    const woRows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, dto.workOrderId));
    if (woRows.length === 0) {
      throw new BadRequestException('生产工单不存在');
    }
    const workOrder = woRows[0];

    // 校验仓库
    const whRows = await this.db
      .select()
      .from(warehouse)
      .where(eq(warehouse.id, dto.warehouseId));
    if (whRows.length === 0) {
      throw new BadRequestException('仓库不存在');
    }

    // 写越权硬化：校验新引用的仓库归属当前作用域
    await assertWriteWithinScope(this.db, { warehouseId: dto.warehouseId });

    // 校验 SKU
    const skuIds = dto.items.map((item) => item.skuId);
    const skuRows = await this.db
      .select()
      .from(sku)
      .where(inArray(sku.id, skuIds));
    const skuMap = new Map<string, typeof sku.$inferSelect>();
    for (const s of skuRows) {
      skuMap.set(s.id, s);
    }

    const receiptItems: Omit<typeof productionFinishReceiptItem.$inferInsert, 'receiptId'>[] = [];
    for (const item of dto.items) {
      const skuInfo = skuMap.get(item.skuId);
      if (!skuInfo) {
        throw new BadRequestException(`SKU不存在: ${item.skuId}`);
      }
      const qty = Number(item.qty);
      if (qty < 0) {
        throw new BadRequestException('数量不能为负');
      }
      receiptItems.push({
        skuId: skuInfo.id,
        skuCode: skuInfo.skuCode,
        color: skuInfo.color,
        size: skuInfo.size,
        qty: round3(qty),
      });
    }

    const finishedQty = Number(dto.finishedQty);
    const defectiveQty = Number(dto.defectiveQty);
    if (finishedQty < 0 || defectiveQty < 0) {
      throw new BadRequestException('数量不能为负');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(productionFinishReceipt)
        .set({
          workOrderId: dto.workOrderId,
          workOrderNo: workOrder.orderNo,
          warehouseId: dto.warehouseId,
          receiptDate: dto.receiptDate,
          finishedQty: round3(finishedQty),
          defectiveQty: round3(defectiveQty),
          remark: dto.remark ?? null,
        })
        .where(eq(productionFinishReceipt.id, id));

      await tx
        .delete(productionFinishReceiptItem)
        .where(eq(productionFinishReceiptItem.receiptId, id));

      await tx.insert(productionFinishReceiptItem).values(
        receiptItems.map((item) => ({
          ...item,
          receiptId: id,
        })),
      );
    });

    return this.get(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, productionFinishReceipt, id);
  }

  async remove(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionFinishReceipt)
      .where(eq(productionFinishReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('完工入库单不存在');
    }
    const receipt = rows[0];
    if (receipt.status !== 'draft') {
      throw new ConflictException('仅草稿状态可删除');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(productionFinishReceiptItem)
        .where(eq(productionFinishReceiptItem.receiptId, id));
      await tx
        .delete(productionFinishReceipt)
        .where(eq(productionFinishReceipt.id, id));
      await this.insertOpLog(
        tx,
        ctx,
        'delete',
        receipt.id,
        receipt.receiptNo,
        `删除完工入库单 ${receipt.receiptNo}`,
      );
    });
  }

  async approve(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionFinishReceipt)
      .where(eq(productionFinishReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('完工入库单不存在');
    }
    const receipt = rows[0];
    if (receipt.status !== 'draft') {
      throw new ConflictException('仅草稿状态可审核');
    }

    const itemRows = await this.db
      .select()
      .from(productionFinishReceiptItem)
      .where(eq(productionFinishReceiptItem.receiptId, id));
    if (itemRows.length === 0) {
      throw new BadRequestException('入库明细不能为空');
    }

    // 校验明细数量 > 0
    let totalQty = 0;
    for (const it of itemRows) {
      totalQty += Number(it.qty);
    }
    if (totalQty <= 0) {
      throw new BadRequestException('入库数量必须大于0');
    }

    // 查询仓库信息
    const whRows = await this.db
      .select({ name: warehouse.name })
      .from(warehouse)
      .where(eq(warehouse.id, receipt.warehouseId));
    const warehouseName = whRows[0]?.name ?? '';

    await this.db.transaction(async (tx) => {
      // 成品入库到 inventory_stock
      const stockChanges: StockChangeItem[] = itemRows
        .filter((it) => Number(it.qty) > 0)
        .map((it) => ({
          warehouseId: receipt.warehouseId,
          warehouseName,
          skuId: it.skuId,
          itemType: 'sku' as const,
          qtyDelta: Number(it.qty),
          flowType: 'finish_in',
          bizNo: receipt.receiptNo,
          bizItemId: it.id,
          operator: ctx.userName,
          skuCode: it.skuCode ?? undefined,
          color: it.color ?? undefined,
          size: it.size ?? undefined,
        }));

      await this.stockService.batchChangeStock(tx, stockChanges);

      // 更新单据状态
      const updated = await tx
        .update(productionFinishReceipt)
        .set({ status: 'approved' })
        .where(eq(productionFinishReceipt.id, id))
        .returning({ id: productionFinishReceipt.id });

      if (updated.length === 0) {
        throw new ConflictException('状态更新失败');
      }

      // 回写生产工单状态为 finished
      const today = new Date().toISOString().slice(0, 10);
      await tx
        .update(productionWorkOrder)
        .set({
          status: 'finished',
          actualFinishDate: today,
        })
        .where(eq(productionWorkOrder.id, receipt.workOrderId));

      await this.insertOpLog(
        tx,
        ctx,
        'approve',
        receipt.id,
        receipt.receiptNo,
        `审核完工入库单 ${receipt.receiptNo}，共 ${itemRows.length} 种 SKU，回写工单完工`,
      );
    });
  }
}
