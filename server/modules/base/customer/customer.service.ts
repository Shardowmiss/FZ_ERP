import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { customer, salesOrder, salesOutbound, salesReturn, receivable } from '@server/database/schema';
import { eq, or, ilike, count, and } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { Customer } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

type CustomerInsert = typeof customer.$inferInsert;
type CustomerUpdate = Partial<CustomerInsert>;

@Injectable()
export class CustomerService extends BaseCrudService<
  typeof customer,
  Customer,
  CustomerInsert,
  CustomerUpdate
> {
  private readonly logger = new Logger(CustomerService.name);

  constructor() {
    super(customer);
  }

  private toDto(row: any): Customer {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      creditPeriod: row.creditPeriod ?? 0,
      level: row.level ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    status?: string,
  ): Promise<{ items: Customer[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(customer.code, `%${escaped}%`), ilike(customer.name, `%${escaped}%`)));
    }
    if (status) conditions.push(eq(customer.status, status));
    // 行级数据权限：客户按所属经销商隔离，非本经销商客户不可见（防跨租户读取）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaCustomer', column: customer.id },
    );
    if (scopeCond) conditions.push(scopeCond);

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<Customer> {
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaCustomer', column: customer.id },
    );
    const rows = await this.db
      .select()
      .from(customer)
      .where(scopeCond ? and(eq(customer.id, id), scopeCond) : eq(customer.id, id));
    if (rows.length === 0) throw new NotFoundException('客户不存在');
    return this.toDto(rows[0]);
  }

  async create(dto: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    creditPeriod?: number;
    level?: string;
    remark?: string;
    status?: string;
  }): Promise<Customer> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');

    const existing = await this.db.select().from(customer).where(eq(customer.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: CustomerInsert = {
      code: dto.code,
      name: dto.name,
      contactPerson: dto.contactPerson ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      creditPeriod: dto.creditPeriod ?? 0,
      level: dto.level ?? null,
      remark: dto.remark ?? null,
      status: dto.status ?? 'active',
    };

    const row = await this.insertRow(values);
    return this.toDto(row);
  }

  async update(
    id: string,
    dto: {
      code?: string;
      name?: string;
      contactPerson?: string | null;
      phone?: string | null;
      address?: string | null;
      creditPeriod?: number;
      level?: string | null;
      remark?: string | null;
      status?: string;
    },
  ): Promise<Customer> {
    const patch: CustomerUpdate = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.contactPerson !== undefined) patch.contactPerson = dto.contactPerson ?? null;
    if (dto.phone !== undefined) patch.phone = dto.phone ?? null;
    if (dto.address !== undefined) patch.address = dto.address ?? null;
    if (dto.creditPeriod !== undefined) patch.creditPeriod = dto.creditPeriod;
    if (dto.level !== undefined) patch.level = dto.level ?? null;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '客户不存在');
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    // 引用检查
    const [soCount, outboundCount, returnCount, receivableCount] = await Promise.all([
      this.db.select({ count: count() }).from(salesOrder).where(eq(salesOrder.customerId, id)),
      this.db.select({ count: count() }).from(salesOutbound).where(eq(salesOutbound.customerId, id)),
      this.db.select({ count: count() }).from(salesReturn).where(eq(salesReturn.customerId, id)),
      this.db.select({ count: count() }).from(receivable).where(eq(receivable.customerId, id)),
    ]);

    const hasReference = [
      soCount[0]?.count,
      outboundCount[0]?.count,
      returnCount[0]?.count,
      receivableCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasReference) {
      throw new ConflictException('客户存在关联单据，无法删除');
    }

    await super.remove(id, '客户不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string }[]> {
    const rows = await this.db
      .select({ id: customer.id, code: customer.code, name: customer.name })
      .from(customer)
      .where(eq(customer.status, 'active'))
      .orderBy(customer.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }
}
