import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, or, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { dealer, store, preOrder, allocationItem, warehouse } from '@server/database/schema';
import type { Dealer } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

type DealerInsert = typeof dealer.$inferInsert;

@Injectable()
export class DealerService {
  private readonly logger = new Logger(DealerService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    status?: string,
  ): Promise<{ items: Dealer[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(dealer.code, `%${escaped}%`), ilike(dealer.name, `%${escaped}%`)));
    }
    if (status) conditions.push(eq(dealer.status, status));
    // 行级数据权限：经销商主数据按可见范围隔离，非本用户可见经销商不可见（防跨租户读取）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: dealer.id },
    );
    if (scopeCond) conditions.push(scopeCond);

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(dealer).where(where as any),
      this.db
        .select()
        .from(dealer)
        .where(where as any)
        .orderBy(desc(dealer.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: Dealer[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async detail(id: string): Promise<Dealer> {
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: dealer.id },
    );
    const rows = await this.db
      .select()
      .from(dealer)
      .where(scopeCond ? and(eq(dealer.id, id), scopeCond) : eq(dealer.id, id));
    if (rows.length === 0) throw new NotFoundException('经销商不存在');
    const row = rows[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    remark?: string;
    status?: string;
  }): Promise<Dealer> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');

    const existing = await this.db.select().from(dealer).where(eq(dealer.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: DealerInsert = {
      code: dto.code,
      name: dto.name,
      contactPerson: dto.contactPerson ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      remark: dto.remark ?? null,
      status: dto.status ?? 'active',
    };

    const inserted = await this.db.insert(dealer).values(values).returning();
    const row = inserted[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async update(
    id: string,
    dto: {
      code?: string;
      name?: string;
      contactPerson?: string | null;
      phone?: string | null;
      address?: string | null;
      remark?: string | null;
      status?: string;
    },
  ): Promise<Dealer> {
    const patch: Partial<DealerInsert> = {};
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
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db.update(dealer).set(patch).where(eq(dealer.id, id)).returning();
    if (updated.length === 0) throw new NotFoundException('经销商不存在');
    const row = updated[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

async remove(id: string): Promise<void> {
    // 引用检查：门店、订货会预售单、配货单、仓库
    const [storeCount, preOrderCount, allocCount, warehouseCount] = await Promise.all([
      this.db.select({ count: count() }).from(store).where(eq(store.dealerId, id)),
      this.db.select({ count: count() }).from(preOrder).where(eq(preOrder.dealerId, id)),
      this.db.select({ count: count() }).from(allocationItem).where(eq(allocationItem.dealerId, id)),
      this.db.select({ count: count() }).from(warehouse).where(eq(warehouse.dealerId, id)),
    ]);

    const hasReference = [
      storeCount[0]?.count,
      preOrderCount[0]?.count,
      allocCount[0]?.count,
      warehouseCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasReference) {
      throw new ConflictException('经销商存在关联单据，无法删除');
    }

    const deleted = await this.db.delete(dealer).where(eq(dealer.id, id)).returning({ id: dealer.id });
    if (deleted.length === 0) throw new NotFoundException('经销商不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string }[]> {
    const rows = await this.db
      .select({ id: dealer.id, code: dealer.code, name: dealer.name })
      .from(dealer)
      .where(eq(dealer.status, 'active'))
      .orderBy(dealer.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }
}
