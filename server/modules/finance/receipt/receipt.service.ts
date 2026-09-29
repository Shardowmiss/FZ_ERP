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
  financeReceipt,
  financeReceiptWriteoff,
  receivable,
} from '@server/database/schema';
import type {
  FinanceReceipt,
  FinanceReceiptWriteoff,
  PaginationResult,
} from '@shared/api.interface';
import { NumberGeneratorService } from '../../system/code-rule/number-generator.service';
import { OperationLogService } from '../../system/operation-log/operation-log.service';

interface WriteoffDto {
  receivableId: string;
  receivableNo: string;
  writeoffAmount: number;
}

interface ListQuery {
  page: number;
  pageSize: number;
  customerId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

interface CreateReceiptDto {
  receiptDate: string;
  customerId: string;
  customerName: string;
  amount: number;
  paymentMethod: string;
  handler?: string;
  remark?: string;
  writeoffs: WriteoffDto[];
}

interface UpdateReceiptDto {
  receiptDate?: string;
  customerId?: string;
  customerName?: string;
  amount?: number;
  paymentMethod?: string;
  handler?: string;
  remark?: string;
  writeoffs?: WriteoffDto[];
}

interface ReceiptDetail extends FinanceReceipt {
  writeoffs: FinanceReceiptWriteoff[];
}

@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGeneratorService: NumberGeneratorService,
    private readonly operationLogService: OperationLogService,
  ) {}

  private mapReceipt(row: typeof financeReceipt.$inferSelect): FinanceReceipt {
    return {
      id: row.id,
      receiptNo: row.receiptNo,
      receiptDate: row.receiptDate,
      customerId: row.customerId,
      customerName: row.customerName ?? '',
      amount: Number(row.amount),
      paymentMethod: row.paymentMethod,
      handler: row.handler ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapWriteoff(row: typeof financeReceiptWriteoff.$inferSelect): FinanceReceiptWriteoff {
    return {
      id: row.id,
      receiptId: row.receiptId,
      receivableId: row.receivableId,
      receivableNo: row.receivableNo ?? '',
      writeoffAmount: Number(row.writeoffAmount),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<FinanceReceipt>> {
    const { page, pageSize, customerId, status, startDate, endDate, keyword } = query;
    const conditions = [];
    if (customerId) conditions.push(eq(financeReceipt.customerId, customerId));
    if (status) conditions.push(eq(financeReceipt.status, status));
    if (startDate) conditions.push(gte(financeReceipt.receiptDate, startDate));
    if (endDate) conditions.push(lt(financeReceipt.receiptDate, endDate));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        sql`(${financeReceipt.customerName} ilike ${'%' + escaped + '%'} 
            OR ${financeReceipt.receiptNo} ilike ${'%' + escaped + '%'})`,
      );
    }

    const receiptScope = buildAggregationScope('finReceipt');
    if (receiptScope) conditions.push(receiptScope);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(financeReceipt).where(where),
      this.db
        .select()
        .from(financeReceipt)
        .where(where)
        .orderBy(desc(financeReceipt.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapReceipt(row)),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string): Promise<ReceiptDetail> {
    const receiptScope = buildAggregationScope('finReceipt');
    const rows = await this.db
      .select()
      .from(financeReceipt)
      .where(receiptScope ? and(eq(financeReceipt.id, id), receiptScope) : eq(financeReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('收款单不存在');
    }

    const writeoffRows = await this.db
      .select()
      .from(financeReceiptWriteoff)
      .where(eq(financeReceiptWriteoff.receiptId, id))
      .orderBy(desc(financeReceiptWriteoff.createdAt));

    const detail = this.mapReceipt(rows[0]) as ReceiptDetail;
    detail.writeoffs = writeoffRows.map((row) => this.mapWriteoff(row));
    return detail;
  }

  async create(dto: CreateReceiptDto, userId: string): Promise<ReceiptDetail> {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('收款金额必须大于0');
    }

    const totalWriteoff = dto.writeoffs.reduce(
      (sum: number, w: WriteoffDto) => sum + Number(w.writeoffAmount),
      0,
    );
    if (totalWriteoff > amount + 0.001) {
      throw new BadRequestException('核销金额不能大于收款金额');
    }

    const amountStr = amount.toFixed(2);
    const dateStr = dto.receiptDate.replace(/-/g, '').slice(0, 8);
    const prefix = `SK${dateStr}`;

    const result = await this.db.transaction(async (tx) => {
      const receiptNo = await this.numberGeneratorService.generateNextNo(
        tx,
        financeReceipt,
        financeReceipt.receiptNo,
        prefix,
        4,
      );

      const [inserted] = await tx
        .insert(financeReceipt)
        .values({
          receiptNo,
          receiptDate: dto.receiptDate,
          customerId: dto.customerId,
          customerName: dto.customerName,
          amount: amountStr,
          paymentMethod: dto.paymentMethod,
          handler: dto.handler ?? null,
          status: 'draft',
          remark: dto.remark ?? null,
        })
        .returning({ id: financeReceipt.id });

      if (dto.writeoffs.length > 0) {
        await tx.insert(financeReceiptWriteoff).values(
          dto.writeoffs.map((w: WriteoffDto) => ({
            receiptId: inserted.id,
            receivableId: w.receivableId,
            receivableNo: w.receivableNo,
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
      objectName: `收款单-${dto.customerName}`,
      summary: '创建收款单',
    });

    return this.get(result.id);
  }

  async update(id: string, dto: UpdateReceiptDto, userId: string): Promise<ReceiptDetail> {
    const rows = await this.db.select().from(financeReceipt).where(eq(financeReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('收款单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可修改');
    }

    const patch: Partial<typeof financeReceipt.$inferInsert> = {};
    if (dto.receiptDate !== undefined) patch.receiptDate = dto.receiptDate;
    if (dto.customerId !== undefined) patch.customerId = dto.customerId;
    if (dto.customerName !== undefined) patch.customerName = dto.customerName;
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
        throw new BadRequestException('核销金额不能大于收款金额');
      }
    }

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length > 0) {
        await tx.update(financeReceipt).set(patch).where(eq(financeReceipt.id, id));
      }

      if (dto.writeoffs !== undefined) {
        await tx.delete(financeReceiptWriteoff).where(eq(financeReceiptWriteoff.receiptId, id));
        if (dto.writeoffs.length > 0) {
          await tx.insert(financeReceiptWriteoff).values(
            dto.writeoffs.map((w: WriteoffDto) => ({
              receiptId: id,
              receivableId: w.receivableId,
              receivableNo: w.receivableNo,
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
      objectName: `收款单-${rows[0].receiptNo}`,
      summary: '更新收款单',
    });

    return this.get(id);
  }

  async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, financeReceipt, id);
  }

  async remove(id: string, userId: string): Promise<{ success: boolean }> {
    const rows = await this.db.select().from(financeReceipt).where(eq(financeReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('收款单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可删除');
    }

    await this.db.transaction(async (tx) => {
      await tx.delete(financeReceiptWriteoff).where(eq(financeReceiptWriteoff.receiptId, id));
      await tx.delete(financeReceipt).where(eq(financeReceipt.id, id));
    });

    await this.operationLogService.create({
      userId,
      module: 'finance',
      operationType: 'delete',
      objectId: id,
      objectName: `收款单-${rows[0].receiptNo}`,
      summary: '删除收款单',
    });

    return { success: true };
  }

  async approve(id: string, userId: string): Promise<ReceiptDetail> {
    const rows = await this.db.select().from(financeReceipt).where(eq(financeReceipt.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('收款单不存在');
    }
    if (rows[0].status !== 'draft') {
      throw new BadRequestException('仅草稿态可审核');
    }

    const writeoffRows = await this.db
      .select()
      .from(financeReceiptWriteoff)
      .where(eq(financeReceiptWriteoff.receiptId, id));

    if (writeoffRows.length === 0) {
      throw new BadRequestException('收款单无核销明细，无法审核');
    }

    await this.db.transaction(async (tx) => {
      // 更新收款单状态
      const updated = await tx
        .update(financeReceipt)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(and(eq(financeReceipt.id, id), eq(financeReceipt.status, 'draft')))
        .returning({ id: financeReceipt.id });

      if (updated.length === 0) {
        throw new BadRequestException('收款单状态已变更，审核失败');
      }

      // 逐条核销应收单
      for (const wo of writeoffRows) {
        const woAmount = Number(wo.writeoffAmount).toFixed(2);

        const receivableUpdated = await tx
          .update(receivable)
          .set({
            receivedAmount: sql`${receivable.receivedAmount} + ${woAmount}::numeric`,
            balance: sql`${receivable.balance} - ${woAmount}::numeric`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(receivable.id, wo.receivableId),
              sql`${receivable.balance} >= ${woAmount}::numeric`,
              sql`${receivable.status} != ${'paid'}`,
            ),
          )
          .returning({ id: receivable.id });

        if (receivableUpdated.length === 0) {
          throw new BadRequestException(
            `应收单 ${wo.receivableNo} 核销失败：余额不足或已结清`,
          );
        }

        // 根据余额更新状态
        const [afterRow] = await tx
          .select({
            receivedAmount: receivable.receivedAmount,
            balance: receivable.balance,
            status: receivable.status,
          })
          .from(receivable)
          .where(eq(receivable.id, wo.receivableId));

        const newBalance = Number(afterRow.balance);
        const newReceivedAmount = Number(afterRow.receivedAmount);

        let newStatus: string;
        if (newBalance <= 0.001) {
          newStatus = 'paid';
        } else if (newReceivedAmount > 0) {
          newStatus = 'partial';
        } else {
          newStatus = 'unpaid';
        }

        if (newStatus !== afterRow.status) {
          await tx
            .update(receivable)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(receivable.id, wo.receivableId));
        }
      }
    });

    await this.operationLogService.create({
      userId,
      module: 'finance',
      operationType: 'approve',
      objectId: id,
      objectName: `收款单-${rows[0].receiptNo}`,
      summary: '审核收款单',
    });

    return this.get(id);
  }
}
