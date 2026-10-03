import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, sql } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { buildAggregationScope } from '@server/common/data-scope/aggregation-scope';
import {
  receivable,
  receivablePayment,
} from '@server/database/schema';
import type {
  Receivable,
  PaginationResult,
} from '@shared/api.interface';
import { MonthCloseService } from '../month-close/month-close.service';

interface PaymentDto {
  paymentDate: string;
  amount: number;
  paymentMethod?: string;
  remark?: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
  dealerId?: string;
  status?: string;
  keyword?: string;
}

interface ReceivablePaymentRecord {
  id: string;
  receivableId: string;
  paymentDate: string;
  amount: number;
  paymentMethod?: string;
  remark?: string;
  createdAt: string;
}

interface ReceivableDetail extends Receivable {
  payments: ReceivablePaymentRecord[];
}

@Injectable()
export class ReceivableService {
  private readonly logger = new Logger(ReceivableService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
  ) {}

  private mapReceivable(row: typeof receivable.$inferSelect): Receivable {
    return {
      id: row.id,
      receivableNo: row.receivableNo,
      dealerId: row.dealerId,
      customerName: row.customerName,
      bizType: row.bizType,
      bizNo: row.bizNo,
      amount: Number(row.amount),
      receivedAmount: Number(row.receivedAmount),
      balance: Number(row.balance),
      dueDate: row.dueDate ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapPayment(row: typeof receivablePayment.$inferSelect): ReceivablePaymentRecord {
    return {
      id: row.id,
      receivableId: row.receivableId,
      paymentDate: row.paymentDate,
      amount: Number(row.amount),
      paymentMethod: row.paymentMethod ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<Receivable>> {
    const { page, pageSize, dealerId, status, keyword } = query;
    const conditions = [];
    if (dealerId) conditions.push(eq(receivable.dealerId, dealerId));
    if (status) conditions.push(eq(receivable.status, status));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        sql`(${receivable.customerName} ilike ${'%' + escaped + '%'} 
            OR ${receivable.receivableNo} ilike ${'%' + escaped + '%'})`,
      );
    }

    const recScope = buildAggregationScope('receivable');
    if (recScope) conditions.push(recScope);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(receivable).where(where),
      this.db
        .select()
        .from(receivable)
        .where(where)
        .orderBy(desc(receivable.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapReceivable(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<ReceivableDetail> {
    const recScope = buildAggregationScope('receivable');
    const rows = await this.db
      .select()
      .from(receivable)
      .where(recScope ? and(eq(receivable.id, id), recScope) : eq(receivable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('应收单不存在');
    }

    const paymentRows = await this.db
      .select()
      .from(receivablePayment)
      .where(eq(receivablePayment.receivableId, id))
      .orderBy(desc(receivablePayment.createdAt));

    const detail = this.mapReceivable(rows[0]) as ReceivableDetail;
    detail.payments = paymentRows.map((row) => this.mapPayment(row));
    return detail;
  }

  async addPayment(id: string, dto: PaymentDto): Promise<ReceivableDetail> {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('收款金额必须大于0');
    }

    // 先校验存在性
    const rows = await this.db.select().from(receivable).where(eq(receivable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('应收单不存在');
    }

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(dto.paymentDate);

    const amountStr = amount.toFixed(2);

    const result = await this.db.transaction(async (tx) => {
      // 插入收款流水
      await tx.insert(receivablePayment).values({
        receivableId: id,
        paymentDate: dto.paymentDate,
        amount: amountStr,
        paymentMethod: dto.paymentMethod ?? null,
        remark: dto.remark ?? null,
      });

      // 原子更新：余额校验放在 WHERE 中，并发下只有一个请求能成功
      const updated = await tx
        .update(receivable)
        .set({
          receivedAmount: sql`${receivable.receivedAmount} + ${amountStr}::numeric`,
          balance: sql`${receivable.balance} - ${amountStr}::numeric`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(receivable.id, id),
            sql`${receivable.balance} >= ${amountStr}::numeric`,
            sql`${receivable.status} != ${'paid'}`,
          ),
        )
        .returning({ id: receivable.id });

      if (updated.length === 0) {
        throw new ConflictException('收款金额超过应收余额，或应收单已结清');
      }

      // 重新读取最新状态，根据新的余额判断状态
      const [afterRow] = await tx
        .select({
          receivedAmount: receivable.receivedAmount,
          balance: receivable.balance,
        })
        .from(receivable)
        .where(eq(receivable.id, id));

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

      // 若状态需要变更，再更新一次（极少发生的二级更新，不影响原子性核心）
      if (newStatus !== rows[0].status) {
        await tx
          .update(receivable)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(receivable.id, id));
      }

      return updated[0];
    });

    return this.getDetail(result.id);
  }
}
