import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, gte, lt, sql } from 'drizzle-orm';
import {
  purchaseReconciliation,
  purchaseInbound,
  purchaseReturn,
} from '@server/database/schema';
import type {
  PurchaseReconciliation,
  PurchaseReconPreview,
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
  supplierId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

interface PreviewParams {
  supplierId: string;
  supplierName: string;
  startDate: string;
  endDate: string;
}

interface CreateReconDto {
  supplierId: string;
  supplierName: string;
  startDate: string;
  endDate: string;
  inboundAmount: number;
  returnAmount: number;
  totalAmount: number;
  remark?: string;
}

@Injectable()
export class PurchaseReconciliationService {
  private readonly logger = new Logger(PurchaseReconciliationService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGeneratorService: NumberGeneratorService,
    private readonly operationLogService: OperationLogService,
  ) {}

  private mapRecon(row: typeof purchaseReconciliation.$inferSelect): PurchaseReconciliation {
    return {
      id: row.id,
      reconNo: row.reconNo,
      supplierId: row.supplierId,
      supplierName: row.supplierName ?? undefined,
      startDate: row.startDate,
      endDate: row.endDate,
      inboundAmount: Number(row.inboundAmount),
      returnAmount: Number(row.returnAmount),
      totalAmount: Number(row.totalAmount),
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<PurchaseReconciliation>> {
    const { page, pageSize, supplierId, status, startDate, endDate } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(purchaseReconciliation.supplierId, supplierId));
    if (status) conditions.push(eq(purchaseReconciliation.status, status));
    if (startDate) conditions.push(gte(purchaseReconciliation.startDate, startDate));
    if (endDate) conditions.push(lt(purchaseReconciliation.startDate, endDate));

    const dealerScope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const scopeCond = buildDealerScopeCondition(dealerScope, {
      kind: 'viaSupplier',
      column: purchaseReconciliation.supplierId,
    });
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseReconciliation).where(where),
      this.db
        .select()
        .from(purchaseReconciliation)
        .where(where)
        .orderBy(desc(purchaseReconciliation.createdAt))
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

  async get(id: string): Promise<PurchaseReconciliation> {
    const dealerScope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    const scopeCond = buildDealerScopeCondition(dealerScope, {
      kind: 'viaSupplier',
      column: purchaseReconciliation.supplierId,
    });
    const rows = await this.db
      .select()
      .from(purchaseReconciliation)
      .where(
        scopeCond
          ? and(eq(purchaseReconciliation.id, id), scopeCond)
          : eq(purchaseReconciliation.id, id),
      );
    if (rows.length === 0) {
      throw new NotFoundException('采购对账单不存在');
    }
    return this.mapRecon(rows[0]);
  }

  async preview(params: PreviewParams): Promise<PurchaseReconPreview> {
    const { supplierId, startDate, endDate } = params;

    const [inboundRows, returnRows] = await Promise.all([
      this.db
        .select({
          id: purchaseInbound.id,
          inboundNo: purchaseInbound.inboundNo,
          inboundDate: purchaseInbound.inboundDate,
          totalAmount: purchaseInbound.totalAmount,
        })
        .from(purchaseInbound)
        .where(
          and(
            eq(purchaseInbound.supplierId, supplierId),
            eq(purchaseInbound.status, 'approved'),
            gte(purchaseInbound.inboundDate, startDate),
            lt(purchaseInbound.inboundDate, endDate),
          ),
        )
        .orderBy(desc(purchaseInbound.inboundDate)),
      this.db
        .select({
          id: purchaseReturn.id,
          returnNo: purchaseReturn.returnNo,
          returnDate: purchaseReturn.returnDate,
          totalAmount: purchaseReturn.totalAmount,
        })
        .from(purchaseReturn)
        .where(
          and(
            eq(purchaseReturn.supplierId, supplierId),
            eq(purchaseReturn.status, 'approved'),
            gte(purchaseReturn.returnDate, startDate),
            lt(purchaseReturn.returnDate, endDate),
          ),
        )
        .orderBy(desc(purchaseReturn.returnDate)),
    ]);

    const inboundAmount = inboundRows.reduce(
      (sum: number, row: { totalAmount: string | number }) => sum + Number(row.totalAmount),
      0,
    );
    const returnAmount = returnRows.reduce(
      (sum: number, row: { totalAmount: string | number }) => sum + Number(row.totalAmount),
      0,
    );

    return {
      inboundAmount: Number(inboundAmount.toFixed(2)),
      returnAmount: Number(returnAmount.toFixed(2)),
      totalAmount: Number((inboundAmount - returnAmount).toFixed(2)),
      inboundList: inboundRows.map((row) => ({
        id: row.id,
        inboundNo: row.inboundNo,
        inboundDate: row.inboundDate,
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

  async create(dto: CreateReconDto, userId: string): Promise<PurchaseReconciliation> {
    const prefix = `PR${dto.startDate.replace(/-/g, '').slice(0, 6)}`;

    await assertWriteWithinScope(this.db, { supplierId: dto.supplierId });

    const result = await this.db.transaction(async (tx) => {
      const reconNo = await this.numberGeneratorService.generateNextNo(
        tx,
        purchaseReconciliation,
        purchaseReconciliation.reconNo,
        prefix,
        4,
      );

      const [inserted] = await tx
        .insert(purchaseReconciliation)
        .values({
          reconNo,
          supplierId: dto.supplierId,
          supplierName: dto.supplierName,
          startDate: dto.startDate,
          endDate: dto.endDate,
          inboundAmount: Number(dto.inboundAmount).toFixed(2),
          returnAmount: Number(dto.returnAmount).toFixed(2),
          totalAmount: Number(dto.totalAmount).toFixed(2),
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning({ id: purchaseReconciliation.id });

      return inserted;
    });

    await this.operationLogService.create({
      userId,
      module: 'purchase',
      operationType: 'create',
      objectId: result.id,
      objectName: `采购对账单-${dto.supplierName}`,
      summary: '创建采购对账单',
    });

    return this.get(result.id);
  }

  async confirm(id: string, userId: string): Promise<PurchaseReconciliation> {
    const rows = await this.db
      .select()
      .from(purchaseReconciliation)
      .where(eq(purchaseReconciliation.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('采购对账单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可确认');
    }

    const updated = await this.db
      .update(purchaseReconciliation)
      .set({ status: 'confirmed', updatedAt: new Date() })
      .where(and(eq(purchaseReconciliation.id, id), eq(purchaseReconciliation.status, 'draft')))
      .returning({ id: purchaseReconciliation.id });

    if (updated.length === 0) {
      throw new BadRequestException('对账单状态已变更，确认失败');
    }

    await this.operationLogService.create({
      userId,
      module: 'purchase',
      operationType: 'confirm',
      objectId: id,
      objectName: `采购对账单-${rows[0].reconNo}`,
      summary: '确认采购对账',
    });

    return this.get(id);
  }
}
