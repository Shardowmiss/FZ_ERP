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
  payable,
  payablePayment,
} from '@server/database/schema';
import type {
  Payable,
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
  supplierId?: string;
  status?: string;
  keyword?: string;
}

interface PayablePaymentRecord {
  id: string;
  payableId: string;
  paymentDate: string;
  amount: number;
  paymentMethod?: string;
  remark?: string;
  createdAt: string;
}

interface PayableDetail extends Payable {
  payments: PayablePaymentRecord[];
}

@Injectable()
export class PayableService {
  private readonly logger = new Logger(PayableService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly monthCloseService: MonthCloseService,
  ) {}

  private mapPayable(row: typeof payable.$inferSelect): Payable {
    return {
      id: row.id,
      payableNo: row.payableNo,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      bizType: row.bizType,
      bizNo: row.bizNo,
      amount: Number(row.amount),
      paidAmount: Number(row.paidAmount),
      balance: Number(row.balance),
      dueDate: row.dueDate ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private mapPayment(row: typeof payablePayment.$inferSelect): PayablePaymentRecord {
    return {
      id: row.id,
      payableId: row.payableId,
      paymentDate: row.paymentDate,
      amount: Number(row.amount),
      paymentMethod: row.paymentMethod ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<Payable>> {
    const { page, pageSize, supplierId, status, keyword } = query;
    const conditions = [];
    if (supplierId) conditions.push(eq(payable.supplierId, supplierId));
    if (status) conditions.push(eq(payable.status, status));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        sql`(${payable.supplierName} ilike ${'%' + escaped + '%'} 
            OR ${payable.payableNo} ilike ${'%' + escaped + '%'})`,
      );
    }

    const payScope = buildAggregationScope('payable');
    if (payScope) conditions.push(payScope);

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(payable).where(where),
      this.db
        .select()
        .from(payable)
        .where(where)
        .orderBy(desc(payable.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapPayable(row)),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(id: string): Promise<PayableDetail> {
    const payScope = buildAggregationScope('payable');
    const rows = await this.db
      .select()
      .from(payable)
      .where(payScope ? and(eq(payable.id, id), payScope) : eq(payable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('应付单不存在');
    }

    const paymentRows = await this.db
      .select()
      .from(payablePayment)
      .where(eq(payablePayment.payableId, id))
      .orderBy(desc(payablePayment.createdAt));

    const detail = this.mapPayable(rows[0]) as PayableDetail;
    detail.payments = paymentRows.map((row) => this.mapPayment(row));
    return detail;
  }

  async addPayment(id: string, dto: PaymentDto): Promise<PayableDetail> {
    const amount = Number(dto.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('付款金额必须大于0');
    }

    // 先校验存在性
    const rows = await this.db.select().from(payable).where(eq(payable.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('应付单不存在');
    }

    // 月结拦截
    await this.monthCloseService.checkMonthClosed(dto.paymentDate);

    const amountStr = amount.toFixed(2);

    const result = await this.db.transaction(async (tx) => {
      // 插入付款流水
      await tx.insert(payablePayment).values({
        payableId: id,
        paymentDate: dto.paymentDate,
        amount: amountStr,
        paymentMethod: dto.paymentMethod ?? null,
        remark: dto.remark ?? null,
      });

      // 原子更新：余额校验放在 WHERE 中，并发下只有一个请求能成功
      const updated = await tx
        .update(payable)
        .set({
          paidAmount: sql`${payable.paidAmount} + ${amountStr}::numeric`,
          balance: sql`${payable.balance} - ${amountStr}::numeric`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payable.id, id),
            sql`${payable.balance} >= ${amountStr}::numeric`,
            sql`${payable.status} != ${'paid'}`,
          ),
        )
        .returning({ id: payable.id });

      if (updated.length === 0) {
        throw new ConflictException('付款金额超过应付余额，或应付单已结清');
      }

      // 重新读取最新状态，根据新的余额判断状态
      const [afterRow] = await tx
        .select({
          paidAmount: payable.paidAmount,
          balance: payable.balance,
        })
        .from(payable)
        .where(eq(payable.id, id));

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

      // 若状态需要变更，再更新一次（极少发生的二级更新，不影响原子性核心）
      if (newStatus !== rows[0].status) {
        await tx
          .update(payable)
          .set({ status: newStatus, updatedAt: new Date() })
          .where(eq(payable.id, id));
      }

      return updated[0];
    });

    return this.getDetail(result.id);
  }
}
