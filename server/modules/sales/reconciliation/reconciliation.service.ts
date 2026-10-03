import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, gte, lt, inArray } from 'drizzle-orm';
import {
  salesReconciliation,
  salesOutbound,
  salesReturn,
} from '@server/database/schema';
import type {
  SalesReconciliation,
  SalesReconPreview,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { OperationLogService } from '../../system/operation-log/operation-log.service';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { assertWriteWithinScope } from '@server/common/data-scope/write-scope';

interface ListQuery {
  page: number;
  pageSize: number;
  dealerId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

interface PreviewParams {
  dealerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
}

interface CreateReconDto {
  dealerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  outboundAmount: number;
  returnAmount: number;
  totalAmount: number;
  remark?: string;
}

@Injectable()
export class SalesReconciliationService {
  private readonly logger = new Logger(SalesReconciliationService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGeneratorService: NumberGeneratorService,
    private readonly operationLogService: OperationLogService,
  ) {}

  private mapRecon(row: typeof salesReconciliation.$inferSelect): SalesReconciliation {
    return {
      id: row.id,
      reconNo: row.reconNo,
      dealerId: row.dealerId,
      customerName: row.customerName ?? undefined,
      startDate: row.startDate,
      endDate: row.endDate,
      outboundAmount: Number(row.outboundAmount),
      returnAmount: Number(row.returnAmount),
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<SalesReconciliation>> {
    const { page, pageSize, dealerId, status, startDate, endDate } = query;
    const conditions = [];
    if (dealerId) conditions.push(eq(salesReconciliation.dealerId, dealerId));
    if (status) conditions.push(eq(salesReconciliation.status, status));
    if (startDate) conditions.push(gte(salesReconciliation.startDate, startDate));
    if (endDate) conditions.push(lt(salesReconciliation.startDate, endDate));

    const dealerScope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const scopeCond = buildDealerScopeCondition(dealerScope, {
      kind: 'dealerColumn', column: salesReconciliation.dealerId,
    });
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(salesReconciliation).where(where),
      this.db
        .select()
        .from(salesReconciliation)
        .where(where)
        .orderBy(desc(salesReconciliation.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapRecon(row)),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<SalesReconciliation> {
    const dealerScope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const scopeCond = buildDealerScopeCondition(dealerScope, {
      kind: 'dealerColumn', column: salesReconciliation.dealerId,
    });
    const rows = await this.db
      .select()
      .from(salesReconciliation)
      .where(
        scopeCond
          ? and(eq(salesReconciliation.id, id), scopeCond)
          : eq(salesReconciliation.id, id),
      );
    if (rows.length === 0) {
      throw new NotFoundException('销售对账单不存在');
    }
    return this.mapRecon(rows[0]);
  }

  async preview(params: PreviewParams): Promise<SalesReconPreview> {
    const { dealerId, startDate, endDate } = params;

    const [outboundRows, returnRows] = await Promise.all([
      this.db
        .select({
          id: salesOutbound.id,
          outboundNo: salesOutbound.outboundNo,
          outboundDate: salesOutbound.outboundDate,
          totalAmount: salesOutbound.totalAmount,
        })
        .from(salesOutbound)
        .where(
          and(
            eq(salesOutbound.dealerId, dealerId),
            inArray(salesOutbound.status, ['booked', 'accepted']),
            gte(salesOutbound.outboundDate, startDate),
            lt(salesOutbound.outboundDate, endDate),
          ),
        )
        .orderBy(desc(salesOutbound.outboundDate)),
      this.db
        .select({
          id: salesReturn.id,
          returnNo: salesReturn.returnNo,
          returnDate: salesReturn.returnDate,
          totalAmount: salesReturn.totalAmount,
        })
        .from(salesReturn)
        .where(
          and(
            eq(salesReturn.dealerId, dealerId),
            inArray(salesReturn.status, ['booked', 'accepted']),
            gte(salesReturn.returnDate, startDate),
            lt(salesReturn.returnDate, endDate),
          ),
        )
        .orderBy(desc(salesReturn.returnDate)),
    ]);

    const outboundAmount = outboundRows.reduce(
      (sum: number, row: { totalAmount: string | number }) => sum + Number(row.totalAmount),
      0,
    );
    const returnAmount = returnRows.reduce(
      (sum: number, row: { totalAmount: string | number }) => sum + Number(row.totalAmount),
      0,
    );

    return {
      outboundAmount: Number(outboundAmount.toFixed(2)),
      returnAmount: Number(returnAmount.toFixed(2)),
      totalAmount: Number((outboundAmount - returnAmount).toFixed(2)),
      outboundList: outboundRows.map((row) => ({
        id: row.id,
        outboundNo: row.outboundNo,
        outboundDate: row.outboundDate,
        totalAmount: Number(row.totalAmount),
      })),
      returnList: returnRows.map((row) => ({
        id: row.id,
        returnNo: row.returnNo,
        returnDate: row.returnDate,
        totalAmount: Number(row.totalAmount),
      })),
    };
  }

  async create(dto: CreateReconDto, userId: string): Promise<SalesReconciliation> {
    // 写入端行级权限：被引用的客户必须属于当前账号可见经销商
    await assertWriteWithinScope(this.db, { dealerId: dto.dealerId });

    const prefix = `SR${dto.startDate.replace(/-/g, '').slice(0, 6)}`;

    const result = await this.db.transaction(async (tx) => {
      const reconNo = await this.numberGeneratorService.generateNextNo(
        tx,
        salesReconciliation,
        salesReconciliation.reconNo,
        prefix,
        4,
      );

      const [inserted] = await tx
        .insert(salesReconciliation)
        .values({
          reconNo,
          dealerId: dto.dealerId,
          customerName: dto.customerName,
          startDate: dto.startDate,
          endDate: dto.endDate,
          outboundAmount: Number(dto.outboundAmount).toFixed(2),
          returnAmount: Number(dto.returnAmount).toFixed(2),
          totalAmount: Number(dto.totalAmount).toFixed(2),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning({ id: salesReconciliation.id });

      return inserted;
    });

    await this.operationLogService.create({
      userId,
      module: 'sales',
      operationType: 'create',
      objectId: result.id,
      objectName: `销售对账单-${dto.customerName}`,
      summary: '创建销售对账单',
    });

    return this.get(result.id);
  }

  async confirm(id: string, userId: string): Promise<SalesReconciliation> {
    const rows = await this.db
      .select()
      .from(salesReconciliation)
      .where(eq(salesReconciliation.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('销售对账单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可确认');
    }

    const updated = await this.db
      .update(salesReconciliation)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(and(eq(salesReconciliation.id, id), eq(salesReconciliation.status, 'draft')))
      .returning({ id: salesReconciliation.id });

    if (updated.length === 0) {
      throw new BadRequestException('对账单状态已变更，确认失败');
    }

    await this.operationLogService.create({
      userId,
      module: 'sales',
      operationType: 'confirm',
      objectId: id,
      objectName: `销售对账单-${rows[0].reconNo}`,
      summary: '确认销售对账',
    });

    return this.get(id);
  }
}
