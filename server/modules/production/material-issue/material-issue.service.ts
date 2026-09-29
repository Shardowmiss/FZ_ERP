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
  productionMaterialIssue,
  productionMaterialIssueItem,
  productionWorkOrder,
  material,
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


export interface MaterialIssueItem {
  id: string;
  issueId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  spec?: string;
  unit: string;
  planQty: number;
  actualQty: number;
}

export interface MaterialIssue {
  id: string;
  issueNo: string;
  workOrderId: string;
  workOrderNo?: string;
  warehouseId: string;
  warehouseName?: string;
  issueDate: string;
  receiver?: string;
  status: string;
  remark?: string;
  createdAt: string;
  items?: MaterialIssueItem[];
}

interface CreateMaterialIssueDto {
  workOrderId: string;
  warehouseId: string;
  issueDate: string;
  receiver?: string;
  remark?: string;
  items: {
    materialId: string;
    planQty: number;
    actualQty: number;
  }[];
}

interface UpdateMaterialIssueDto {
  workOrderId: string;
  warehouseId: string;
  issueDate: string;
  receiver?: string;
  remark?: string;
  items: {
    materialId: string;
    planQty: number;
    actualQty: number;
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
export class MaterialIssueService {
  private readonly logger = new Logger(MaterialIssueService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
    private readonly stockService: StockService,
  ) {}

  private async generateIssueNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `MI${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      productionMaterialIssue,
      productionMaterialIssue.issueNo,
      prefix,
      4,
    );
  }

  private mapHeader(row: typeof productionMaterialIssue.$inferSelect & { warehouseName?: string }): MaterialIssue {
    return {
      id: row.id,
      issueNo: row.issueNo,
      workOrderId: row.workOrderId,
      workOrderNo: row.workOrderNo ?? undefined,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName ?? undefined,
      issueDate: row.issueDate,
      receiver: row.receiver ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapItem(row: typeof productionMaterialIssueItem.$inferSelect): MaterialIssueItem {
    return {
      id: row.id,
      issueId: row.issueId,
      materialId: row.materialId,
      materialCode: row.materialCode ?? '',
      materialName: row.materialName ?? '',
      spec: row.spec ?? undefined,
      unit: row.unit ?? '',
      planQty: Number(row.planQty),
      actualQty: Number(row.actualQty),
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

  async list(query: ListQuery): Promise<PaginationResult<MaterialIssue>> {
    const { page, pageSize, status, workOrderId, keyword, startDate, endDate } = query;
    const conditions = [];
    if (status) conditions.push(eq(productionMaterialIssue.status, status));
    if (workOrderId) conditions.push(eq(productionMaterialIssue.workOrderId, workOrderId));
    if (keyword) conditions.push(ilike(productionMaterialIssue.issueNo, `%${keyword}%`));
    if (startDate) conditions.push(gte(productionMaterialIssue.issueDate, startDate));
    if (endDate) conditions.push(lt(productionMaterialIssue.issueDate, endDate));

    // 行级数据权限：仅可见当前用户所属经销商仓库关联的物料发料单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: productionMaterialIssue.warehouseId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(productionMaterialIssue).where(where),
      this.db
        .select()
        .from(productionMaterialIssue)
        .where(where)
        .orderBy(desc(productionMaterialIssue.createdAt))
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

  async get(id: string): Promise<MaterialIssue> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaWarehouse', column: productionMaterialIssue.warehouseId },
    );
    const where = scopeCond
      ? and(eq(productionMaterialIssue.id, id), scopeCond)
      : eq(productionMaterialIssue.id, id);
    const rows = await this.db
      .select()
      .from(productionMaterialIssue)
      .where(where);
    if (rows.length === 0) {
      throw new NotFoundException('领料单不存在');
    }

    const itemRows = await this.db
      .select()
      .from(productionMaterialIssueItem)
      .where(eq(productionMaterialIssueItem.issueId, id));

    const whRows = await this.db
      .select({ name: warehouse.name })
      .from(warehouse)
      .where(eq(warehouse.id, rows[0].warehouseId));

    const header = this.mapHeader(rows[0]);
    header.warehouseName = whRows[0]?.name;
    header.items = itemRows.map((r) => this.mapItem(r));
    return header;
  }

  async create(dto: CreateMaterialIssueDto): Promise<MaterialIssue> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('领料明细不能为空');
    }

    // 校验工单号
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

    const issueItems: Omit<typeof productionMaterialIssueItem.$inferInsert, 'issueId'>[] = [];
    for (const item of dto.items) {
      const mat = matMap.get(item.materialId);
      if (!mat) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
      const planQty = Number(item.planQty);
      const actualQty = Number(item.actualQty);
      if (planQty < 0 || actualQty < 0) {
        throw new BadRequestException('数量不能为负');
      }
      issueItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        spec: mat.spec ?? null,
        unit: mat.unit,
        planQty: round3(planQty),
        actualQty: round3(actualQty),
      });
    }

    const created = await this.db.transaction(async (tx) => {
      const issueNo = await this.generateIssueNo(tx, dto.issueDate);

      const inserted = await tx
        .insert(productionMaterialIssue)
        .values({
          issueNo,
          workOrderId: dto.workOrderId,
          workOrderNo: workOrder.orderNo,
          warehouseId: dto.warehouseId,
          issueDate: dto.issueDate,
          receiver: dto.receiver ?? null,
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      const issueId = inserted[0].id;
      await tx.insert(productionMaterialIssueItem).values(
        issueItems.map((item) => ({
          ...item,
          issueId,
        })),
      );

      return inserted[0];
    });

    return this.get(created.id);
  }

  async update(id: string, dto: UpdateMaterialIssueDto): Promise<MaterialIssue> {
    const rows = await this.db
      .select()
      .from(productionMaterialIssue)
      .where(eq(productionMaterialIssue.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('领料单不存在');
    }
    const issue = rows[0];
    if (issue.status !== 'draft') {
      throw new ConflictException('仅草稿状态可修改');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('领料明细不能为空');
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

    const issueItems: Omit<typeof productionMaterialIssueItem.$inferInsert, 'issueId'>[] = [];
    for (const item of dto.items) {
      const mat = matMap.get(item.materialId);
      if (!mat) {
        throw new BadRequestException(`物料不存在: ${item.materialId}`);
      }
      const planQty = Number(item.planQty);
      const actualQty = Number(item.actualQty);
      if (planQty < 0 || actualQty < 0) {
        throw new BadRequestException('数量不能为负');
      }
      issueItems.push({
        materialId: mat.id,
        materialCode: mat.code,
        materialName: mat.name,
        spec: mat.spec ?? null,
        unit: mat.unit,
        planQty: round3(planQty),
        actualQty: round3(actualQty),
      });
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(productionMaterialIssue)
        .set({
          workOrderId: dto.workOrderId,
          workOrderNo: workOrder.orderNo,
          warehouseId: dto.warehouseId,
          issueDate: dto.issueDate,
          receiver: dto.receiver ?? null,
          remark: dto.remark ?? null,
        })
        .where(eq(productionMaterialIssue.id, id));

      await tx
        .delete(productionMaterialIssueItem)
        .where(eq(productionMaterialIssueItem.issueId, id));

      await tx.insert(productionMaterialIssueItem).values(
        issueItems.map((item) => ({
          ...item,
          issueId: id,
        })),
      );
    });

    return this.get(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, productionMaterialIssue, id);
  }

  async remove(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionMaterialIssue)
      .where(eq(productionMaterialIssue.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('领料单不存在');
    }
    const issue = rows[0];
    if (issue.status !== 'draft') {
      throw new ConflictException('仅草稿状态可删除');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .delete(productionMaterialIssueItem)
        .where(eq(productionMaterialIssueItem.issueId, id));
      await tx
        .delete(productionMaterialIssue)
        .where(eq(productionMaterialIssue.id, id));
      await this.insertOpLog(
        tx,
        ctx,
        'delete',
        issue.id,
        issue.issueNo,
        `删除领料单 ${issue.issueNo}`,
      );
    });
  }

  async approve(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionMaterialIssue)
      .where(eq(productionMaterialIssue.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('领料单不存在');
    }
    const issue = rows[0];
    if (issue.status !== 'draft') {
      throw new ConflictException('仅草稿状态可审核');
    }

    const itemRows = await this.db
      .select()
      .from(productionMaterialIssueItem)
      .where(eq(productionMaterialIssueItem.issueId, id));
    if (itemRows.length === 0) {
      throw new BadRequestException('领料明细不能为空');
    }

    // 校验实领数量 > 0
    let totalActual = 0;
    for (const it of itemRows) {
      totalActual += Number(it.actualQty);
    }
    if (totalActual <= 0) {
      throw new BadRequestException('实领数量必须大于0');
    }

    // 查询仓库信息
    const whRows = await this.db
      .select({ name: warehouse.name })
      .from(warehouse)
      .where(eq(warehouse.id, issue.warehouseId));
    const warehouseName = whRows[0]?.name ?? '';

    await this.db.transaction(async (tx) => {
      // 扣减面辅料库存
      const stockChanges: StockChangeItem[] = itemRows
        .filter((it) => Number(it.actualQty) > 0)
        .map((it) => ({
          warehouseId: issue.warehouseId,
          warehouseName,
          materialId: it.materialId,
          itemType: 'material' as const,
          qtyDelta: -Number(it.actualQty),
          flowType: 'production_issue',
          bizNo: issue.issueNo,
          bizItemId: it.id,
          operator: ctx.userName,
          materialCode: it.materialCode ?? undefined,
          materialName: it.materialName ?? undefined,
        }));

      await this.stockService.batchChangeStock(tx, stockChanges);

      // 更新状态
      const updated = await tx
        .update(productionMaterialIssue)
        .set({ status: 'approved' })
        .where(eq(productionMaterialIssue.id, id))
        .returning({ id: productionMaterialIssue.id });

      if (updated.length === 0) {
        throw new ConflictException('状态更新失败');
      }

      await this.insertOpLog(
        tx,
        ctx,
        'approve',
        issue.id,
        issue.issueNo,
        `审核领料单 ${issue.issueNo}，共 ${itemRows.length} 种物料`,
      );
    });
  }
}
