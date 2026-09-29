import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  material,
  bomItem,
  purchaseOrderItem,
  purchaseInboundItem,
  purchaseReturnItem,
  materialPurchaseOrderItem,
  materialPurchaseInboundItem,
  materialStock,
} from '@server/database/schema';
import { eq, and, count, desc, or, ilike, gt, sql } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import type { Material } from '@shared/api.interface';

type MaterialInsert = typeof material.$inferInsert;

@Injectable()
export class MaterialService {
  private readonly logger = new Logger(MaterialService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    category?: string,
    status?: string,
  ): Promise<{ items: Material[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(material.code, `%${escaped}%`), ilike(material.name, `%${escaped}%`)));
    }
    if (category) conditions.push(eq(material.category, category));
    if (status) conditions.push(eq(material.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(material).where(where as any),
      this.db.select()
        .from(material)
        .where(where as any)
        .orderBy(desc(material.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: Material[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      spec: row.spec ?? undefined,
      unit: row.unit,
      defaultSupplierId: row.defaultSupplierId ?? undefined,
      stdPrice: Number(row.stdPrice ?? 0),
      category: row.category ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));

    return { items, total, page, pageSize };
  }

  async detail(id: string): Promise<Material> {
    const rows = await this.db.select().from(material).where(eq(material.id, id));
    if (rows.length === 0) throw new NotFoundException('物料不存在');
    const row = rows[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      spec: row.spec ?? undefined,
      unit: row.unit,
      defaultSupplierId: row.defaultSupplierId ?? undefined,
      stdPrice: Number(row.stdPrice ?? 0),
      category: row.category ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(dto: {
    code: string;
    name: string;
    spec?: string;
    unit: string;
    defaultSupplierId?: string;
    stdPrice?: number;
    category?: string;
    remark?: string;
    status?: string;
  }): Promise<Material> {
    if (!dto.code?.trim()) throw new BadRequestException('编码不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!dto.unit?.trim()) throw new BadRequestException('单位不能为空');

    const existing = await this.db.select().from(material).where(eq(material.code, dto.code));
    if (existing.length > 0) throw new ConflictException('编码已存在');

    const values: MaterialInsert = {
      code: dto.code,
      name: dto.name,
      spec: dto.spec ?? null,
      unit: dto.unit,
      defaultSupplierId: dto.defaultSupplierId ?? null,
      stdPrice: dto.stdPrice !== undefined ? String(dto.stdPrice) : '0',
      category: dto.category ?? null,
      remark: dto.remark ?? null,
      status: dto.status ?? 'active',
    };

    const inserted = await this.db.insert(material).values(values).returning();
    const row = inserted[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      spec: row.spec ?? undefined,
      unit: row.unit,
      defaultSupplierId: row.defaultSupplierId ?? undefined,
      stdPrice: Number(row.stdPrice ?? 0),
      category: row.category ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async update(
    id: string,
    dto: {
      code?: string;
      name?: string;
      spec?: string | null;
      unit?: string;
      defaultSupplierId?: string | null;
      stdPrice?: number;
      category?: string | null;
      remark?: string | null;
      status?: string;
    },
  ): Promise<Material> {
    const patch: Partial<MaterialInsert> = {};
    if (dto.code !== undefined) {
      if (!dto.code.trim()) throw new BadRequestException('编码不能为空');
      patch.code = dto.code;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.spec !== undefined) patch.spec = dto.spec ?? null;
    if (dto.unit !== undefined) {
      if (!dto.unit.trim()) throw new BadRequestException('单位不能为空');
      patch.unit = dto.unit;
    }
    if (dto.defaultSupplierId !== undefined) patch.defaultSupplierId = dto.defaultSupplierId ?? null;
    if (dto.stdPrice !== undefined) patch.stdPrice = String(dto.stdPrice);
    if (dto.category !== undefined) patch.category = dto.category ?? null;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db.update(material).set(patch).where(eq(material.id, id)).returning();
    if (updated.length === 0) throw new NotFoundException('物料不存在');
    const row = updated[0];
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      spec: row.spec ?? undefined,
      unit: row.unit,
      defaultSupplierId: row.defaultSupplierId ?? undefined,
      stdPrice: Number(row.stdPrice ?? 0),
      category: row.category ?? undefined,
      remark: row.remark ?? undefined,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

async remove(id: string): Promise<void> {
    // 引用检查
    const [
      bomCount,
      poItemCount,
      piItemCount,
      prItemCount,
      mpoItemCount,
      mpiItemCount,
      stockResult,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(bomItem).where(eq(bomItem.materialId, id)),
      this.db.select({ count: count() }).from(purchaseOrderItem).where(eq(purchaseOrderItem.materialId, id)),
      this.db.select({ count: count() }).from(purchaseInboundItem).where(eq(purchaseInboundItem.materialId, id)),
      this.db.select({ count: count() }).from(purchaseReturnItem).where(eq(purchaseReturnItem.materialId, id)),
      this.db.select({ count: count() }).from(materialPurchaseOrderItem).where(eq(materialPurchaseOrderItem.materialId, id)),
      this.db.select({ count: count() }).from(materialPurchaseInboundItem).where(eq(materialPurchaseInboundItem.materialId, id)),
      this.db
        .select({ count: count() })
        .from(materialStock)
        .where(and(eq(materialStock.materialId, id), gt(materialStock.quantity, sql`'0'::numeric`))),
    ]);

    const hasReference = [
      bomCount[0]?.count,
      poItemCount[0]?.count,
      piItemCount[0]?.count,
      prItemCount[0]?.count,
      mpoItemCount[0]?.count,
      mpiItemCount[0]?.count,
      stockResult[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasReference) {
      throw new ConflictException('物料存在关联数据，无法删除');
    }

    const deleted = await this.db.delete(material).where(eq(material.id, id)).returning({ id: material.id });
    if (deleted.length === 0) throw new NotFoundException('物料不存在');
  }

  async options(): Promise<{ id: string; code: string; name: string; unit: string }[]> {
    const rows = await this.db.select({ id: material.id, code: material.code, name: material.name, unit: material.unit })
      .from(material)
      .where(eq(material.status, 'active'))
      .orderBy(material.code);
    return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, unit: row.unit }));
  }
}
