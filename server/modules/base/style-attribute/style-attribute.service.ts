import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { styleAttribute, style } from '@server/database/schema';
import { eq, and, count, asc, desc, or, ilike, inArray } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { BusinessException } from '@server/common/interfaces/exception.interface';
import { ResponseCode } from '@server/common/constants/api_response_code';
import type { StyleAttribute, PaginationResult } from '@shared/api.interface';
import type { PgColumn } from 'drizzle-orm/pg-core';

type StyleAttributeInsert = typeof styleAttribute.$inferInsert;

function getStyleFieldByAttrType(attrType: string): PgColumn | null {
  switch (attrType) {
    case 'year':
      return style.year as unknown as PgColumn;
    case 'season':
      return style.season as unknown as PgColumn;
    case 'category':
      return style.category as unknown as PgColumn;
    case 'sub_category':
      return style.subCategory as unknown as PgColumn;
    case 'fit':
      return style.fit as unknown as PgColumn;
    case 'brand':
      return style.brand as unknown as PgColumn;
    default:
      return null;
  }
}

@Injectable()
export class StyleAttributeService {
  private readonly logger = new Logger(StyleAttributeService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private toDto(row: typeof styleAttribute.$inferSelect): StyleAttribute {
    return {
      id: row.id,
      attrType: row.attrType,
      attrCode: row.attrCode,
      attrName: row.attrName,
      sortOrder: row.sortOrder,
      status: row.status,
      parentCode: row.parentCode ?? undefined,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(
    attrType: string,
    page: number,
    pageSize: number,
    keyword?: string,
  ): Promise<PaginationResult<StyleAttribute>> {
    const conditions = [eq(styleAttribute.attrType, attrType)];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(
        or(
          ilike(styleAttribute.attrCode, `%${escaped}%`),
          ilike(styleAttribute.attrName, `%${escaped}%`),
        ),
      );
    }
    const where = and(...conditions);

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(styleAttribute).where(where),
      this.db
        .select()
        .from(styleAttribute)
        .where(where)
        .orderBy(asc(styleAttribute.sortOrder), desc(styleAttribute.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: StyleAttribute[] = rows.map((row) => this.toDto(row));

    return { items, total, page, pageSize };
  }

  async getAllByType(attrType: string, onlyActive?: boolean): Promise<StyleAttribute[]> {
    const conditions = [eq(styleAttribute.attrType, attrType)];
    if (onlyActive) {
      conditions.push(eq(styleAttribute.status, 'active'));
    }
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(styleAttribute)
      .where(where)
      .orderBy(asc(styleAttribute.sortOrder), asc(styleAttribute.attrCode));

    return rows.map((row) => this.toDto(row));
  }

  async getByCode(attrType: string, attrCode: string): Promise<StyleAttribute | null> {
    const rows = await this.db
      .select()
      .from(styleAttribute)
      .where(and(eq(styleAttribute.attrType, attrType), eq(styleAttribute.attrCode, attrCode)));
    return rows.length > 0 ? this.toDto(rows[0]) : null;
  }

  async detail(id: string): Promise<StyleAttribute> {
    const rows = await this.db.select().from(styleAttribute).where(eq(styleAttribute.id, id));
    if (rows.length === 0) throw new NotFoundException('属性不存在');
    return this.toDto(rows[0]);
  }

  async create(data: {
    attrType: string;
    attrCode: string;
    attrName: string;
    sortOrder: number;
    status?: string;
    parentCode?: string;
    remark?: string;
  }): Promise<StyleAttribute> {
    if (!data.attrType?.trim()) throw new BadRequestException('属性类型不能为空');
    if (!data.attrCode?.trim()) throw new BadRequestException('属性编码不能为空');
    if (!data.attrName?.trim()) throw new BadRequestException('属性名称不能为空');

    const existing = await this.db
      .select()
      .from(styleAttribute)
      .where(and(eq(styleAttribute.attrType, data.attrType), eq(styleAttribute.attrCode, data.attrCode)));
    if (existing.length > 0) throw new BadRequestException('属性编码已存在');

    const values: StyleAttributeInsert = {
      attrType: data.attrType,
      attrCode: data.attrCode,
      attrName: data.attrName,
      sortOrder: data.sortOrder ?? 0,
      status: data.status ?? 'active',
      parentCode: data.parentCode ?? null,
      remark: data.remark ?? null,
    };

    const inserted = await this.db.insert(styleAttribute).values(values).returning();
    return this.toDto(inserted[0]);
  }

  async update(
    id: string,
    data: {
      attrCode?: string;
      attrName?: string;
      sortOrder?: number;
      status?: string;
      parentCode?: string;
      remark?: string;
    },
  ): Promise<StyleAttribute> {
    const currentRows = await this.db.select().from(styleAttribute).where(eq(styleAttribute.id, id));
    if (currentRows.length === 0) throw new NotFoundException('属性不存在');
    const current = currentRows[0];

    const patch: Partial<StyleAttributeInsert> = {};

    if (data.attrCode !== undefined) {
      if (!data.attrCode.trim()) throw new BadRequestException('属性编码不能为空');
      patch.attrCode = data.attrCode;
    }
    if (data.attrName !== undefined) {
      if (!data.attrName.trim()) throw new BadRequestException('属性名称不能为空');
      // 品牌主数据改名保护：style.brand 为自由文本，若仍有款号引用「旧品牌名」，
      // 改名会导致款号与品牌主数据失联。此处拒绝并给出具体原因，而非笼统的「保存失败」。
      if (current.attrType === 'brand' && data.attrName.trim() !== current.attrName) {
        const refCount = Number(
          (
            await this.db
              .select({ c: count() })
              .from(style)
              .where(eq(style.brand, current.attrName as string))
          )[0]?.c ?? 0,
        );
        if (refCount > 0) {
          throw new BusinessException(
            ResponseCode.CONFLICT,
            `该品牌名称「${current.attrName}」已被 ${refCount} 个款号引用，不允许修改。请先处理相关款号后再改名。`,
          );
        }
      }
      patch.attrName = data.attrName;
    }
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (data.status !== undefined) patch.status = data.status;
    if (data.parentCode !== undefined) patch.parentCode = data.parentCode ?? null;
    if (data.remark !== undefined) patch.remark = data.remark ?? null;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    // 编码唯一性校验（排除自身）
    if (patch.attrCode !== undefined) {
      const duplicate = await this.db
        .select()
        .from(styleAttribute)
        .where(
          and(
            eq(styleAttribute.attrType, current.attrType),
            eq(styleAttribute.attrCode, patch.attrCode),
          ),
        );
      if (duplicate.length > 0 && duplicate[0].id !== id) {
        throw new BadRequestException('属性编码已存在');
      }
    }

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(styleAttribute)
      .set(patch)
      .where(eq(styleAttribute.id, id))
      .returning();
    if (updated.length === 0) throw new NotFoundException('属性不存在');
    return this.toDto(updated[0]);
  }

  async remove(
    id: string,
  ): Promise<{ success: boolean; disabled?: boolean; message?: string }> {
    const rows = await this.db.select().from(styleAttribute).where(eq(styleAttribute.id, id));
    if (rows.length === 0) throw new NotFoundException('属性不存在');
    const attr = rows[0];

    const field = getStyleFieldByAttrType(attr.attrType);
    if (field) {
      const countResult = await this.db
        .select({ count: count() })
        .from(style)
        .where(eq(field, attr.attrName as string));
      const refCount = Number(countResult[0]?.count ?? 0);
      if (refCount > 0) {
        await this.db
          .update(styleAttribute)
          .set({ status: 'inactive', updatedAt: new Date() })
          .where(eq(styleAttribute.id, id));
        return {
          success: true,
          disabled: true,
          message: '该属性已被款号引用，已改为禁用状态',
        };
      }
    }

    await this.db.delete(styleAttribute).where(eq(styleAttribute.id, id));
    return { success: true };
  }

  async batchUpdateStatus(
    ids: string[],
    status: string,
  ): Promise<{ success: boolean; count: number }> {
    if (!ids || ids.length === 0) throw new BadRequestException('ID列表不能为空');
    if (!status?.trim()) throw new BadRequestException('状态不能为空');

    const updated = await this.db
      .update(styleAttribute)
      .set({ status, updatedAt: new Date() })
      .where(inArray(styleAttribute.id, ids))
      .returning({ id: styleAttribute.id });

    return { success: true, count: updated.length };
  }

  async getSubCategoriesByParent(
    parentCode: string,
    onlyActive?: boolean,
  ): Promise<StyleAttribute[]> {
    const conditions = [
      eq(styleAttribute.attrType, 'sub_category'),
      eq(styleAttribute.parentCode, parentCode),
    ];
    if (onlyActive) {
      conditions.push(eq(styleAttribute.status, 'active'));
    }
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(styleAttribute)
      .where(where)
      .orderBy(asc(styleAttribute.sortOrder), asc(styleAttribute.attrCode));

    return rows.map((row) => this.toDto(row));
  }
}
