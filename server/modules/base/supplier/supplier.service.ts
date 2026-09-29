import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import {
  supplier,
  purchaseOrder,
  purchaseInbound,
  purchaseReturn,
  garmentPurchaseOrder,
  garmentPurchaseInbound,
  garmentPurchaseReturn,
  payable,
} from '@server/database/schema';
import { eq, or, ilike, count, and } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { Supplier } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

type SupplierInsert = typeof supplier.$inferInsert;
type SupplierUpdate = Partial<SupplierInsert>;

@Injectable()
export class SupplierService extends BaseCrudService<
  typeof supplier,
  Supplier,
  SupplierInsert,
  SupplierUpdate
> {
  private readonly logger = new Logger(SupplierService.name);

  constructor() {
    super(supplier);
  }

  private toDto(row: any): Supplier {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      contactPerson: row.contactPerson ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address ?? undefined,
      supplyCategory: row.supplyCategory ?? undefined,
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
  ): Promise<{ items: Supplier[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(supplier.code, `%${escaped}%`), ilike(supplier.name, `%${escaped}%`)));
    }
    if (status) conditions.push(eq(supplier.status, status));
    // 行级数据权限：供应商按所属经销商隔离，非本经销商供应商不可见（防跨租户读取）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: supplier.id },
    );
    if (scopeCond) conditions.push(scopeCond);

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<Supplier> {
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'viaSupplier', column: supplier.id },
    );
    const rows = await this.db
      .select()
      .from(supplier)
      .where(scopeCond ? and(eq(supplier.id, id), scopeCond) : eq(supplier.id, id));
    if (rows.length === 0) throw new NotFoundException('供应商不存在');
    return this.toDto(rows[0]);
  }

  async create(dto: {
    code: string;
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    supplyCategory?: string;
    remark?: string;
    status?: string;
  }): Promise<Supplier> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');

    const existing = await this.db.select().from(supplier).where(eq(supplier.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: SupplierInsert = {
      code: dto.code,
      name: dto.name,
      contactPerson: dto.contactPerson ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      supplyCategory: dto.supplyCategory ?? null,
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
      supplyCategory?: string | null;
      remark?: string | null;
      status?: string;
    },
  ): Promise<Supplier> {
    const patch: SupplierUpdate = {};
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
    if (dto.supplyCategory !== undefined) patch.supplyCategory = dto.supplyCategory ?? null;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '供应商不存在');
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    // 引用检查：面辅料 + 服装 两类采购单据 + 应付单
    const [
      poCount,
      piCount,
      prCount,
      gpoCount,
      gpiCount,
      gprCount,
      payableCount,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(purchaseOrder).where(eq(purchaseOrder.supplierId, id)),
      this.db.select({ count: count() }).from(purchaseInbound).where(eq(purchaseInbound.supplierId, id)),
      this.db.select({ count: count() }).from(purchaseReturn).where(eq(purchaseReturn.supplierId, id)),
      this.db.select({ count: count() }).from(garmentPurchaseOrder).where(eq(garmentPurchaseOrder.supplierId, id)),
      this.db.select({ count: count() }).from(garmentPurchaseInbound).where(eq(garmentPurchaseInbound.supplierId, id)),
      this.db.select({ count: count() }).from(garmentPurchaseReturn).where(eq(garmentPurchaseReturn.supplierId, id)),
      this.db.select({ count: count() }).from(payable).where(eq(payable.supplierId, id)),
    ]);

    const hasReference = [
      poCount[0]?.count,
      piCount[0]?.count,
      prCount[0]?.count,
      gpoCount[0]?.count,
      gpiCount[0]?.count,
      gprCount[0]?.count,
      payableCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasReference) {
      throw new ConflictException('供应商存在关联单据，无法删除');
    }

    await super.remove(id, '供应商不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string }[]> {
    const rows = await this.db
      .select({ id: supplier.id, code: supplier.code, name: supplier.name })
      .from(supplier)
      .where(eq(supplier.status, 'active'))
      .orderBy(supplier.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name }));
  }
}
