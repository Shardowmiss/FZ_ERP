import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { voidDraftDocument } from '@server/common/document-void';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, gte, lt, sql } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import {
  financePayment,
  financePaymentWriteoff,
  payable,
} from '@server/database/schema';
import type {
  FinancePayment,
  FinancePaymentWriteoff,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { OperationLogService } from '../../system/operation-log/operation-log.service';

interface WriteoffDto {
  payableId: string;
  payableNo: string;
  writeoffAmount: number;
}

interface ListQuery {
  page: number;
  pageSize: number;
  supplierId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

interface CreatePaymentDto {
  paymentDate: string;
  supplierId: string;
  supplierName: string;
  amount: number;
  paymentMethod: string;
  handler?: string;
  remark?: string;
  writeoffs: WriteoffDto[];
}

interface UpdatePaymentDto {
  paymentDate?: string;
  supplierId?: string;
  supplierName?: string;
  amount?: number;
  paymentMethod?: string;
  handler?: string;
  remark?: string;
  writeoffs?: WriteoffDto[];
}

interface PaymentDetail extends FinancePayment {
  writeoffs: FinancePaymentWriteoff[];
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGeneratorService: NumberGeneratorService,
    private readonly operationLogService: OperationLogService,
  ) {}

  private mapPayment(row: typeof financePayment.$inferSelect): FinancePayment {
    return {
      id: row.id,
      paymentNo: row.paymentNo,
      paymentDate: row.paymentDate,
      supplierId: row.supplierId,
      supplierName: row.supplierName ?? '',
      amount: Number(row.amount),
      paymentMethod: row.paymentMethod,
      handler: row.handler ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapWriteoff(row: typeof financePaymentWriteoff.$inferSelect): FinancePaymentWriteoff {
    return {
      id: row.id,
      paymentId: row.paymentId,
      payableId: row.payableId,
      payableNo: row.payableNo ?? '',
      writeoffAmount: Number(row.writeoffAmount),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<FinancePayment>> {
    const { page, pageSize, supplierId, status, startDate, endDate, keyword } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(financePayment.supplierId, supplierId));
    if (status) conditions.push(eq(financePayment.status, status));
    if (startDate) conditions.push(gte(financePayment.paymentDate, startDate));
    if (endDate) conditions.push(lt(financePayment.paymentDate, endDate));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        sql`(${financePayment.supplierName} ilike ${'%' + escaped + '%'} 
            OR ${financePayment.paymentNo} ilike ${'%' + escaped + '%'})`,
      );
    }

    const payScope = buildAggregationScope('finPayment');
    if (payScope) conditions.push(payScope);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(financePayment).where(where),
      this.db
        .select()
        .from(financePayment)
        .where(where)
        .orderBy(desc(financePayment.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapPayment(row)),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<PaymentDetail> {
    const payScope = buildAggregationScope('finPayment');
    const rows = await this.db
      .select()
      .from(financePayment)
      .where(payScope ? and(eq(financePayment.id, id), payScope) : eq(financePayment.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('付款单不存在');
    }

    const writeoffRows = await this.db
      .select()
      .from(financePaymentWriteoff)
      .where(eq(financePaymentWriteoff.paymentId, id))
      .orderBy(desc(financePaymentWriteoff.createdAt));

    const detail = this.mapPayment(rows[0]) as PaymentDetail;
    detail.writeoffs = writeoffRows.map((row) => this.mapWriteoff(row));
    return detail;
  }

  async create(dto: CreatePaymentDto, userId: string): Promise<PaymentDetail> {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('付款金额必须大于0');
    }

    const totalWriteoff = dto.writeoffs.reduce(
      (sum: number, w: WriteoffDto) => sum + Number(w.writeoffAmount),
      0,
    );
    if (totalWriteoff > amount + 0.001) {
      throw new BadRequestException('核销金额不能大于付款金额');
    }

    const amountStr = amount.toFixed(2);
    const dateStr = dto.paymentDate.replace(/-/g, '').slice(0, 8);
    const prefix = `PY${dateStr}`;

    const result = await this.db.transaction(async (tx) => {
      const paymentNo = await this.numberGeneratorService.generateNextNo(
        tx,
        financePayment,
        financePayment.paymentNo,
        prefix,
        4,
      );

      const [inserted] = await tx
        .insert(financePayment)
        .values({
          paymentNo,
          paymentDate: dto.paymentDate,
          supplierId: dto.supplierId,
          supplierName: dto.supplierName,
          amount: amountStr,
          paymentMethod: dto.paymentMethod,
          handler: dto.handler ?? null,
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning({ id: financePayment.id });

      if (dto.writeoffs.length > 0) {
        await tx.insert(financePaymentWriteoff).values(
          dto.writeoffs.map((w: WriteoffDto) => ({
            paymentId: inserted.id,
            payableId: w.payableId,
            payableNo: w.payableNo,
            writeoffAmount: Number(w.writeoffAmount).toFixed(2),
          })),
        );
      }

      return inserted;
    });

    await this.operationLogService.create({
      userId,
      module: 'finance',
      operationType: 'create',
      objectId: result.id,
      objectName: `付款单-${dto.supplierName}`,
      summary: '创建付款单',
    });

    return this.get(result.id);
  }

  async update(id: string, dto: UpdatePaymentDto, userId: string): Promise<PaymentDetail> {
    const rows = await this.db.select().from(financePayment).where(eq(financePayment.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('付款单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可修改');
    }

    const patch: Partial<typeof financePayment.$inferInsert> = {};
    if (dto.paymentDate !== undefined) patch.paymentDate = dto.paymentDate;
    if (dto.supplierId !== undefined) patch.supplierId = dto.supplierId;
    if (dto.supplierName !== undefined) patch.supplierName = dto.supplierName;
    if (dto.amount !== undefined) patch.amount = Number(dto.amount).toFixed(2);
    if (dto.paymentMethod !== undefined) patch.paymentMethod = dto.paymentMethod;
    if (dto.handler !== undefined) patch.handler = dto.handler;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    if (dto.writeoffs !== undefined) {
      const totalWriteoff = dto.writeoffs.reduce(
        (sum: number, w: WriteoffDto) => sum + Number(w.writeoffAmount),
        0,
      );
      const amt = dto.amount !== undefined ? Number(dto.amount) : Number(rows[0].amount);
      if (totalWriteoff > amt + 0.001) {
        throw new BadRequestException('核销金额不能大于付款金额');
      }
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(financePayment).set(patch).where(eq(financePayment.id, id));
      }

      if (dto.writeoffs !== undefined) {
        await tx.delete(financePaymentWriteoff).where(eq(financePaymentWriteoff.paymentId, id));
        if (dto.writeoffs.length > 0) {
          await tx.insert(financePaymentWriteoff).values(
            dto.writeoffs.map((w: WriteoffDto) => ({
              paymentId: id,
              payableId: w.payableId,
              payableNo: w.payableNo,
              writeoffAmount: Number(w.writeoffAmount).toFixed(2),
            })),
          );
        }
      }
    });

    await this.operationLogService.create({
      userId,
      module: 'finance',
      operationType: 'update',
      objectId: id,
      objectName: `付款单-${rows[0].paymentNo}`,
      summary: '更新付款单',
    });

    return this.get(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, financePayment, id);
  }

  async remove(id: string, userId: string): Promise<{ success: boolean }> {
    const rows = await this.db.select().from(financePayment).where(eq(financePayment.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('付款单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可删除');
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(financePaymentWriteoff).where(eq(financePaymentWriteoff.paymentId, id));
      await tx.delete(financePayment).where(eq(financePayment.id, id));
    });

    await this.operationLogService.create({
      userId,
      module: 'finance',
      operationType: 'delete',
      objectId: id,
      objectName: `付款单-${rows[0].paymentNo}`,
      summary: '删除付款单',
    });

    return { success: true };
  }

  async approve(id: string, userId: string): Promise<PaymentDetail> {
    const rows = await this.db.select().from(financePayment).where(eq(financePayment.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('付款单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可审核');
    }

    const writeoffRows = await this.db
      .select()
      .from(financePaymentWriteoff)
      .where(eq(financePaymentWriteoff.paymentId, id));

    if (writeoffRows.length === 0) {
      throw new BadRequestException('付款单无核销明细，无法审核');
    }

    await this.db.transaction(async (tx) => {
      // 更新付款单状态
      const updated = await tx
        .update(financePayment)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(and(eq(financePayment.id, id), eq(financePayment.status, 'draft')))
        .returning({ id: financePayment.id });

      if (updated.length === 0) {
        throw new BadRequestException('付款单状态已变更，审核失败');
      }

      // 逐条核销应付单
      for (const wo of writeoffRows) {
        const woAmount = Number(wo.writeoffAmount).toFixed(2);

        const payableUpdated = await tx
          .update(payable)
          .set({
            paidAmount: sql`${payable.paidAmount} + ${woAmount}::numeric`,
            balance: sql`${payable.balance} - ${woAmount}::numeric`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(payable.id, wo.payableId),
              sql`${payable.balance} >= ${woAmount}::numeric`,
              sql`${payable.status} != ${'paid'}`,
            ),
          )
          .returning({ id: payable.id });

        if (payableUpdated.length === 0) {
          throw new BadRequestException(
            `应付单 ${wo.payableNo} 核销失败：余额不足或已结清`,
          );
        }

        // 根据余额更新状态
        const [afterRow] = await tx
          .select({
            paidAmount: payable.paidAmount,
            balance: payable.balance,
            status: payable.status,
          })
          .from(payable)
          .where(eq(payable.id, wo.payableId));

        const newBalance = Number(afterRow.balance);
        const newPaidAmount = Number(afterRow.paidAmount);

        let newStatus: string;
        if (newBalance <= 0.001) {
          newStatus = 'paid';
        } else if (newPaidAmount > 0) {
          newStatus = 'partial';
        } else {
          newStatus = 'unpaid';
        }

        if (newStatus !== afterRow.status) {
          await tx
            .update(payable)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(payable.id, wo.payableId));
        }
      }
    });

    await this.operationLogService.create({
      userId,
      module: 'finance',
      operationType: 'approve',
      objectId: id,
      objectName: `付款单-${rows[0].paymentNo}`,
      summary: '审核付款单',
    });

    return this.get(id);
  }
}
