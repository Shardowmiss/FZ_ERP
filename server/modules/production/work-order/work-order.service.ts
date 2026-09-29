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
  productionWorkOrder,
  style,
  systemOperationLog,
} from '@server/database/schema';
import type { PaginationResult } from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { round3 } from '../../../common/utils/money';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';


export interface WorkOrder {
  id: string;
  orderNo: string;
  styleId: string;
  styleNo: string;
  styleName?: string;
  quantity: number;
  supplierId?: string;
  factoryName?: string;
  planStartDate?: string;
  planFinishDate?: string;
  actualStartDate?: string;
  actualFinishDate?: string;
  status: string;
  remark?: string;
  createdAt: string;
}

interface CreateWorkOrderDto {
  styleId: string;
  quantity: number;
  supplierId?: string;
  factoryName?: string;
  planStartDate?: string;
  planFinishDate?: string;
  remark?: string;
}

interface UpdateWorkOrderDto {
  styleId: string;
  quantity: number;
  supplierId?: string;
  factoryName?: string;
  planStartDate?: string;
  planFinishDate?: string;
  remark?: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
  status?: string;
  styleId?: string;
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
export class WorkOrderService {
  private readonly logger = new Logger(WorkOrderService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateOrderNo(
    tx: PostgresJsDatabase,
    dateStr: string,
  ): Promise<string> {
    const datePart = dateStr.replace(/-/g, '');
    const prefix = `WO${datePart}`;
    return this.numberGenerator.generateNextNo(
      tx,
      productionWorkOrder,
      productionWorkOrder.orderNo,
      prefix,
      4,
    );
  }

  private mapRow(row: typeof productionWorkOrder.$inferSelect & { styleName?: string }): WorkOrder {
    return {
      id: row.id,
      orderNo: row.orderNo,
      styleId: row.styleId,
      styleNo: row.styleNo ?? '',
      styleName: row.styleName ?? undefined,
      quantity: Number(row.quantity),
      supplierId: row.supplierId ?? undefined,
      factoryName: row.factoryName ?? undefined,
      planStartDate: row.planStartDate ?? undefined,
      planFinishDate: row.planFinishDate ?? undefined,
      actualStartDate: row.actualStartDate ?? undefined,
      actualFinishDate: row.actualFinishDate ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
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

  async list(query: ListQuery): Promise<PaginationResult<WorkOrder>> {
    const { page, pageSize, status, styleId, keyword, startDate, endDate } = query;
    const conditions = [];
    if (status) conditions.push(eq(productionWorkOrder.status, status));
    if (styleId) conditions.push(eq(productionWorkOrder.styleId, styleId));
    if (keyword) conditions.push(ilike(productionWorkOrder.orderNo, `%${keyword}%`));
    if (startDate) conditions.push(gte(productionWorkOrder.planStartDate, startDate));
    if (endDate) conditions.push(lt(productionWorkOrder.planStartDate, endDate));

    // 行级数据权限：仅可见当前用户所属经销商的供应商关联生产工单
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: productionWorkOrder.supplierId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(productionWorkOrder).where(where),
      this.db
        .select()
        .from(productionWorkOrder)
        .where(where)
        .orderBy(desc(productionWorkOrder.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    // 批量补充款号名称
    const styleIds = [...new Set(rows.map((r) => r.styleId))];
    const styleMap = new Map<string, string>();
    if (styleIds.length > 0) {
      const styleRows = await this.db
        .select({ id: style.id, name: style.name })
        .from(style)
        .where(inArray(style.id, styleIds));
      for (const s of styleRows) {
        styleMap.set(s.id, s.name);
      }
    }

    return {
      items: rows.map((row) => ({
        ...this.mapRow(row),
        styleName: styleMap.get(row.styleId),
      })),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<WorkOrder> {
    // 行级数据权限：即使通过 ID 直查，也须落在当前用户可见经销商范围内
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: productionWorkOrder.supplierId },
    );
    const where = scopeCond
      ? and(eq(productionWorkOrder.id, id), scopeCond)
      : eq(productionWorkOrder.id, id);
    const rows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(where);

    if (rows.length === 0) {
      throw new NotFoundException('生产工单不存在');
    }

    const order = rows[0];
    const styleRows = await this.db
      .select({ name: style.name })
      .from(style)
      .where(eq(style.id, order.styleId));

    return {
      ...this.mapRow(order),
      styleName: styleRows[0]?.name,
    };
  }

  async create(dto: CreateWorkOrderDto): Promise<WorkOrder> {
    const qty = Number(dto.quantity);
    if (qty <= 0) {
      throw new BadRequestException('生产数量必须大于0');
    }

    const styleRows = await this.db
      .select()
      .from(style)
      .where(eq(style.id, dto.styleId));
    if (styleRows.length === 0) {
      throw new BadRequestException('款号不存在');
    }
    const st = styleRows[0];

    const orderDate = dto.planStartDate ?? new Date().toISOString().slice(0, 10);

    await assertWriteWithinScope(this.db, { supplierId: dto.supplierId });

    const created = await this.db.transaction(async (tx) => {
      const orderNo = await this.generateOrderNo(tx, orderDate);

      const inserted = await tx
        .insert(productionWorkOrder)
        .values({
          orderNo,
          styleId: dto.styleId,
          styleNo: st.styleNo,
          quantity: round3(qty),
          supplierId: dto.supplierId ?? null,
          factoryName: dto.factoryName ?? null,
          planStartDate: dto.planStartDate ?? null,
          planFinishDate: dto.planFinishDate ?? null,
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      return inserted[0];
    });

    return this.get(created.id);
  }

  async update(id: string, dto: UpdateWorkOrderDto): Promise<WorkOrder> {
    const rows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('生产工单不存在');
    }
    const order = rows[0];
    if (order.status !== 'draft') {
      throw new ConflictException('仅草稿状态可修改');
    }

    const qty = Number(dto.quantity);
    if (qty <= 0) {
      throw new BadRequestException('生产数量必须大于0');
    }

    const styleRows = await this.db
      .select()
      .from(style)
      .where(eq(style.id, dto.styleId));
    if (styleRows.length === 0) {
      throw new BadRequestException('款号不存在');
    }
    const st = styleRows[0];

    // 写越权硬化：校验新引用的供应商归属当前作用域（超管放行，受限态越权 403）
    await assertWriteWithinScope(this.db, { supplierId: dto.supplierId ?? null });

    await this.db
      .update(productionWorkOrder)
      .set({
        styleId: dto.styleId,
        styleNo: st.styleNo,
        quantity: round3(qty),
        supplierId: dto.supplierId ?? null,
        factoryName: dto.factoryName ?? null,
        planStartDate: dto.planStartDate ?? null,
        planFinishDate: dto.planFinishDate ?? null,
        remark: dto.remark ?? null,
      })
      .where(eq(productionWorkOrder.id, id));

    return this.get(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, productionWorkOrder, id);
  }

  async remove(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('生产工单不存在');
    }
    const order = rows[0];
    if (order.status !== 'draft') {
      throw new ConflictException('仅草稿状态可删除');
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(productionWorkOrder).where(eq(productionWorkOrder.id, id));
      await this.insertOpLog(
        tx,
        ctx,
        'delete',
        order.id,
        order.orderNo,
        `删除生产工单 ${order.orderNo}`,
      );
    });
  }

  async approve(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('生产工单不存在');
    }
    const order = rows[0];
    if (order.status !== 'draft' && order.status !== 'pending') {
      throw new ConflictException('仅草稿或待生产状态可审核下发');
    }

    const today = new Date().toISOString().slice(0, 10);
    const nextStatus = 'producing';

    const updated = await this.db
      .update(productionWorkOrder)
      .set({
        status: nextStatus,
        actualStartDate: today,
      })
      .where(eq(productionWorkOrder.id, id))
      .returning({ id: productionWorkOrder.id });

    if (updated.length === 0) {
      throw new ConflictException('状态更新失败');
    }

    await this.insertOpLog(
      this.db,
      ctx,
      'approve',
      order.id,
      order.orderNo,
      `审核下发生产工单 ${order.orderNo}，状态转为生产中`,
    );
  }

  async finish(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('生产工单不存在');
    }
    const order = rows[0];
    if (order.status !== 'producing') {
      throw new ConflictException('仅生产中状态可标记完工');
    }

    const today = new Date().toISOString().slice(0, 10);

    const updated = await this.db
      .update(productionWorkOrder)
      .set({
        status: 'finished',
        actualFinishDate: today,
      })
      .where(eq(productionWorkOrder.id, id))
      .returning({ id: productionWorkOrder.id });

    if (updated.length === 0) {
      throw new ConflictException('状态更新失败');
    }

    await this.insertOpLog(
      this.db,
      ctx,
      'approve',
      order.id,
      order.orderNo,
      `生产工单 ${order.orderNo} 标记完工`,
    );
  }

  async close(id: string, ctx: OperationLogCtx): Promise<void> {
    const rows = await this.db
      .select()
      .from(productionWorkOrder)
      .where(eq(productionWorkOrder.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('生产工单不存在');
    }
    const order = rows[0];
    if (order.status === 'closed') {
      throw new ConflictException('工单已关闭');
    }

    await this.db
      .update(productionWorkOrder)
      .set({ status: 'closed' })
      .where(eq(productionWorkOrder.id, id));

    await this.insertOpLog(
      this.db,
      ctx,
      'approve',
      order.id,
      order.orderNo,
      `关闭生产工单 ${order.orderNo}`,
    );
  }
}
