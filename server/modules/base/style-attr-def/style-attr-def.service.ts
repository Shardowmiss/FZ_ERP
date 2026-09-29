import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { styleAttrDef, styleAttrValue, style } from '@server/database/schema';
import { eq, and, count, asc, desc, ilike, or, inArray, sql } from 'drizzle-orm';
import type { StyleAttrDef, StyleAttrValue } from '@shared/api.interface';

type AttrDefInsert = typeof styleAttrDef.$inferInsert;
type AttrValueInsert = typeof styleAttrValue.$inferInsert;

@Injectable()
export class StyleAttrDefService {
  private readonly logger = new Logger(StyleAttrDefService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private defToDto(row: typeof styleAttrDef.$inferSelect): StyleAttrDef {
    return {
      id: row.id,
      attrCode: row.attrCode,
      attrName: row.attrName,
      sortOrder: row.sortOrder,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private valueToDto(row: typeof styleAttrValue.$inferSelect): StyleAttrValue {
    return {
      id: row.id,
      attrDefId: row.attrDefId,
      valueCode: row.valueCode,
      valueName: row.valueName,
      sortOrder: row.sortOrder,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(onlyActive?: boolean): Promise<StyleAttrDef[]> {
    const conditions = [];
    if (onlyActive) conditions.push(eq(styleAttrDef.status, 'active'));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select()
      .from(styleAttrDef)
      .where(where as any)
      .orderBy(asc(styleAttrDef.sortOrder), asc(styleAttrDef.attrCode));

    return rows.map((r) => this.defToDto(r));
  }

  async listWithValues(onlyActive?: boolean): Promise<StyleAttrDef[]> {
    const defs = await this.list(onlyActive);
    if (defs.length === 0) return [];

    const valueConditions = [];
    if (onlyActive) valueConditions.push(eq(styleAttrValue.status, 'active'));
    const where = valueConditions.length > 0 ? and(...valueConditions) : undefined;

    const allValues = await this.db
      .select()
      .from(styleAttrValue)
      .where(where as any)
      .orderBy(asc(styleAttrValue.sortOrder), asc(styleAttrValue.valueCode));

    const byDef = new Map<string, StyleAttrValue[]>();
    for (const v of allValues) {
      const dto = this.valueToDto(v);
      const list = byDef.get(v.attrDefId) ?? [];
      list.push(dto);
      byDef.set(v.attrDefId, list);
    }

    return defs.map((d) => ({
      ...d,
      values: byDef.get(d.id) ?? [],
    }));
  }

  async detail(id: string): Promise<StyleAttrDef> {
    const rows = await this.db.select().from(styleAttrDef).where(eq(styleAttrDef.id, id));
    if (rows.length === 0) throw new NotFoundException('属性定义不存在');
    return this.defToDto(rows[0]);
  }

  async create(data: {
    attrCode: string;
    attrName: string;
    sortOrder: number;
    status?: string;
    remark?: string;
  }): Promise<StyleAttrDef> {
    if (!data.attrCode?.trim()) throw new BadRequestException('属性编码不能为空');
    if (!data.attrName?.trim()) throw new BadRequestException('属性名称不能为空');

    const existing = await this.db
      .select()
      .from(styleAttrDef)
      .where(eq(styleAttrDef.attrCode, data.attrCode.trim().toUpperCase()));
    if (existing.length > 0) throw new BadRequestException('属性编码已存在');

    const values: AttrDefInsert = {
      attrCode: data.attrCode.trim().toUpperCase(),
      attrName: data.attrName.trim(),
      sortOrder: data.sortOrder ?? 0,
      status: data.status ?? 'active',
      remark: data.remark ?? null,
    };

    const inserted = await this.db.insert(styleAttrDef).values(values).returning();
    return this.defToDto(inserted[0]);
  }

  async update(
    id: string,
    data: {
      attrCode?: string;
      attrName?: string;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrDef> {
    const patch: Partial<AttrDefInsert> = {};

    if (data.attrCode !== undefined) {
      if (!data.attrCode.trim()) throw new BadRequestException('属性编码不能为空');
      patch.attrCode = data.attrCode.trim().toUpperCase();
    }
    if (data.attrName !== undefined) {
      if (!data.attrName.trim()) throw new BadRequestException('属性名称不能为空');
      patch.attrName = data.attrName.trim();
    }
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.status !== undefined) patch.status = data.status;
    if (data.remark !== undefined) patch.remark = data.remark ?? null;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    if (patch.attrCode !== undefined) {
      const duplicate = await this.db
        .select()
        .from(styleAttrDef)
        .where(eq(styleAttrDef.attrCode, patch.attrCode));
      if (duplicate.length > 0 && duplicate[0].id !== id) {
        throw new BadRequestException('属性编码已存在');
      }
    }

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(styleAttrDef)
      .set(patch)
      .where(eq(styleAttrDef.id, id))
      .returning();
    if (updated.length === 0) throw new NotFoundException('属性定义不存在');
    return this.defToDto(updated[0]);
  }

  async reorder(items: Array<{ id: string; sortOrder: number }>): Promise<{ success: boolean }> {
    if (!items || items.length === 0) return { success: true };

    // 单条 CASE 批量 UPDATE 替代逐条 update（消除 N+1）
    await this.db.transaction(async (tx) => {
      if (items.length > 0) {
        const cases = items.map(
          (item) => sql`WHEN ${styleAttrDef.id} = ${item.id} THEN ${item.sortOrder}`,
        );
        await tx
          .update(styleAttrDef)
          .set({
            sortOrder: sql`CASE ${sql.join(cases, sql` `)} ELSE ${styleAttrDef.sortOrder} END`,
            updatedAt: new Date(),
          })
          .where(inArray(styleAttrDef.id, items.map((i) => i.id)));
      }
    });

    return { success: true };
  }

  async remove(id: string): Promise<{ success: boolean; disabled?: boolean; message?: string }> {
    const rows = await this.db.select().from(styleAttrDef).where(eq(styleAttrDef.id, id));
    if (rows.length === 0) throw new NotFoundException('属性定义不存在');

    const def = rows[0];

    const refCount = await this.checkDefReferenced(def.attrCode);
    if (refCount > 0) {
      await this.db
        .update(styleAttrDef)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(styleAttrDef.id, id));
      return {
        success: true,
        disabled: true,
        message: `该属性已被 ${refCount} 个款号引用，已改为禁用状态`,
      };
    }

    await this.db.delete(styleAttrDef).where(eq(styleAttrDef.id, id));
    return { success: true };
  }

  private async checkDefReferenced(attrCode: string): Promise<number> {
    const key = attrCode.toLowerCase();
    const result = await this.db
      .select({ count: count() })
      .from(style)
      .where(sql`${style.attributes} ->> ${key} IS NOT NULL`);
    return Number(result[0]?.count ?? 0);
  }

  // ---- 属性值 ----

  async listValues(attrDefId: string, onlyActive?: boolean): Promise<StyleAttrValue[]> {
    const conditions = [eq(styleAttrValue.attrDefId, attrDefId)];
    if (onlyActive) conditions.push(eq(styleAttrValue.status, 'active'));
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(styleAttrValue)
      .where(where)
      .orderBy(asc(styleAttrValue.sortOrder), asc(styleAttrValue.valueCode));

    return rows.map((r) => this.valueToDto(r));
  }

  async createValue(
    attrDefId: string,
    data: {
      valueCode: string;
      valueName: string;
      sortOrder: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrValue> {
    if (!data.valueCode?.trim()) throw new BadRequestException('值编码不能为空');
    if (!data.valueName?.trim()) throw new BadRequestException('值名称不能为空');

    const defRows = await this.db.select().from(styleAttrDef).where(eq(styleAttrDef.id, attrDefId));
    if (defRows.length === 0) throw new NotFoundException('属性定义不存在');

    const existing = await this.db
      .select()
      .from(styleAttrValue)
      .where(
        and(
          eq(styleAttrValue.attrDefId, attrDefId),
          eq(styleAttrValue.valueCode, data.valueCode.trim().toUpperCase()),
        ),
      );
    if (existing.length > 0) throw new BadRequestException('值编码已存在');

    const values: AttrValueInsert = {
      attrDefId,
      valueCode: data.valueCode.trim().toUpperCase(),
      valueName: data.valueName.trim(),
      sortOrder: data.sortOrder ?? 0,
      status: data.status ?? 'active',
      remark: data.remark ?? null,
    };

    const inserted = await this.db.insert(styleAttrValue).values(values).returning();
    return this.valueToDto(inserted[0]);
  }

  async updateValue(
    valueId: string,
    data: {
      valueCode?: string;
      valueName?: string;
      sortOrder?: number;
      status?: string;
      remark?: string;
    },
  ): Promise<StyleAttrValue> {
    const patch: Partial<AttrValueInsert> = {};

    if (data.valueCode !== undefined) {
      if (!data.valueCode.trim()) throw new BadRequestException('值编码不能为空');
      patch.valueCode = data.valueCode.trim().toUpperCase();
    }
    if (data.valueName !== undefined) {
      if (!data.valueName.trim()) throw new BadRequestException('值名称不能为空');
      patch.valueName = data.valueName.trim();
    }
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.status !== undefined) patch.status = data.status;
    if (data.remark !== undefined) patch.remark = data.remark ?? null;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    if (patch.valueCode !== undefined) {
      const current = await this.db.select().from(styleAttrValue).where(eq(styleAttrValue.id, valueId));
      if (current.length === 0) throw new NotFoundException('属性值不存在');

      const duplicate = await this.db
        .select()
        .from(styleAttrValue)
        .where(
          and(
            eq(styleAttrValue.attrDefId, current[0].attrDefId),
            eq(styleAttrValue.valueCode, patch.valueCode),
          ),
        );
      if (duplicate.length > 0 && duplicate[0].id !== valueId) {
        throw new BadRequestException('值编码已存在');
      }
    }

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(styleAttrValue)
      .set(patch)
      .where(eq(styleAttrValue.id, valueId))
      .returning();
    if (updated.length === 0) throw new NotFoundException('属性值不存在');
    return this.valueToDto(updated[0]);
  }

  async reorderValues(items: Array<{ id: string; sortOrder: number }>): Promise<{ success: boolean }> {
    if (!items || items.length === 0) return { success: true };

    // 单条 CASE 批量 UPDATE 替代逐条 update（消除 N+1）
    await this.db.transaction(async (tx) => {
      if (items.length > 0) {
        const cases = items.map(
          (item) => sql`WHEN ${styleAttrValue.id} = ${item.id} THEN ${item.sortOrder}`,
        );
        await tx
          .update(styleAttrValue)
          .set({
            sortOrder: sql`CASE ${sql.join(cases, sql` `)} ELSE ${styleAttrValue.sortOrder} END`,
            updatedAt: new Date(),
          })
          .where(inArray(styleAttrValue.id, items.map((i) => i.id)));
      }
    });

    return { success: true };
  }

  async removeValue(
    valueId: string,
  ): Promise<{ success: boolean; disabled?: boolean; message?: string }> {
    const rows = await this.db.select().from(styleAttrValue).where(eq(styleAttrValue.id, valueId));
    if (rows.length === 0) throw new NotFoundException('属性值不存在');

    const value = rows[0];
    const defRows = await this.db
      .select()
      .from(styleAttrDef)
      .where(eq(styleAttrDef.id, value.attrDefId));
    const attrCode = defRows[0]?.attrCode?.toLowerCase() ?? '';

    const refCount = await this.checkValueReferenced(attrCode, value.valueName);
    if (refCount > 0) {
      await this.db
        .update(styleAttrValue)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(eq(styleAttrValue.id, valueId));
      return {
        success: true,
        disabled: true,
        message: `该属性值已被 ${refCount} 个款号引用，已改为禁用状态`,
      };
    }

    await this.db.delete(styleAttrValue).where(eq(styleAttrValue.id, valueId));
    return { success: true };
  }

  private async checkValueReferenced(attrCode: string, valueName: string): Promise<number> {
    if (!attrCode) return 0;
    const result = await this.db
      .select({ count: count() })
      .from(style)
      .where(sql`${style.attributes} ->> ${attrCode} = ${valueName}`);
    return Number(result[0]?.count ?? 0);
  }
}
