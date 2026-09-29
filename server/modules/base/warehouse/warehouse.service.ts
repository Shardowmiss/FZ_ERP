import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { warehouse, inventoryStock, materialStock } from '@server/database/schema';
import { eq, or, ilike, count, gt, and, sql } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BaseCrudService } from '@server/common/base/base-crud.service';
import type { Warehouse } from '@shared/api.interface';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';

type WarehouseInsert = typeof warehouse.$inferInsert;
type WarehouseUpdate = Partial<WarehouseInsert>;

@Injectable()
export class WarehouseService extends BaseCrudService<
  typeof warehouse,
  Warehouse,
  WarehouseInsert,
  WarehouseUpdate
> {
  private readonly logger = new Logger(WarehouseService.name);

  constructor() {
    super(warehouse);
  }

  private toDto(row: any): Warehouse {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      address: row.address ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    type?: string,
    status?: string,
  ): Promise<{ items: Warehouse[]; total: number; page: number; pageSize: number }> {
    const conditions: any[] = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(warehouse.code, `%${escaped}%`), ilike(warehouse.name, `%${escaped}%`)));
    }
    if (type) conditions.push(eq(warehouse.type, type));
    if (status) conditions.push(eq(warehouse.status, status));
    // 行级数据权限：仓库按所属经销商隔离，非本经销商仓库不可见（防跨租户读取）
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: warehouse.dealerId },
    );
    if (scopeCond) conditions.push(scopeCond);

    const { rows, total } = await this.paginateRaw(page, pageSize, conditions);
    return { items: rows.map((row: any) => this.toDto(row)), total, page, pageSize };
  }

  async detail(id: string): Promise<Warehouse> {
    const scopeCond = buildDealerScopeCondition(
      RequestContext.getDealerScope() ?? ALL_SCOPE,
      { kind: 'dealerColumn', column: warehouse.dealerId },
    );
    const rows = await this.db
      .select()
      .from(warehouse)
      .where(scopeCond ? and(eq(warehouse.id, id), scopeCond) : eq(warehouse.id, id));
    if (rows.length === 0) throw new NotFoundException('仓库不存在');
    return this.toDto(rows[0]);
  }

  async create(dto: {
    code: string;
    name: string;
    type: string;
    address?: string;
    remark?: string;
    status?: string;
  }): Promise<Warehouse> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!dto.type?.trim()) throw new BadRequestException('类型不能为空');

    const existing = await this.db.select().from(warehouse).where(eq(warehouse.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: WarehouseInsert = {
      code: dto.code,
      name: dto.name,
      type: dto.type,
      address: dto.address ?? null,
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
      type?: string;
      address?: string | null;
      remark?: string | null;
      status?: string;
    },
  ): Promise<Warehouse> {
    const patch: WarehouseUpdate = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.type !== undefined) {
      if (!dto.type.trim()) throw new BadRequestException('类型不能为空');
      patch.type = dto.type;
    }
    if (dto.address !== undefined) patch.address = dto.address ?? null;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const row = await this.updateRow(id, patch, '仓库不存在');
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    // 库存检查：存在数量 > 0 的库存则拒绝删除
    const [skuStockCount, materialStockCount] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(inventoryStock)
        .where(and(eq(inventoryStock.warehouseId, id), gt(inventoryStock.quantity, sql`'0'::numeric`))),
      this.db
        .select({ count: count() })
        .from(materialStock)
        .where(and(eq(materialStock.warehouseId, id), gt(materialStock.quantity, sql`'0'::numeric`))),
    ]);

    const hasStock = [skuStockCount[0]?.count, materialStockCount[0]?.count]
      .some((c) => Number(c ?? 0) > 0);

    if (hasStock) {
      throw new ConflictException('仓库存在库存，无法删除');
    }

    await super.remove(id, '仓库不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string; type: string }[]> {
    const rows = await this.db
      .select({ id: warehouse.id, code: warehouse.code, name: warehouse.name, type: warehouse.type })
      .from(warehouse)
      .where(eq(warehouse.status, 'active'))
      .orderBy(warehouse.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type }));
  }
}
