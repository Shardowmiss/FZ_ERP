import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { memberLevel } from '@server/database/schema';
import type { MemberLevel, PaginationResult } from '@shared/api.interface';

interface CreateMemberLevelDto {
  code: string;
  name: string;
  conditionType?: string;
  thresholdAmount?: number;
  discount?: number;
  discountOnPromo?: boolean;
  sortOrder?: number;
  status?: string;
  remark?: string;
}

interface UpdateMemberLevelDto {
  name?: string;
  conditionType?: string;
  thresholdAmount?: number;
  discount?: number;
  discountOnPromo?: boolean;
  sortOrder?: number;
  status?: string;
  remark?: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  conditionType?: string;
  status?: string;
}

@Injectable()
export class MemberLevelService {
  private readonly logger = new Logger(MemberLevelService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  private mapRow(row: typeof memberLevel.$inferSelect): MemberLevel {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      conditionType: row.conditionType,
      thresholdAmount: Number(row.thresholdAmount ?? 0),
      discount: Number(row.discount ?? 1),
      discountOnPromo: row.discountOnPromo,
      sortOrder: row.sortOrder ?? 0,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<MemberLevel>> {
    const { page, pageSize, keyword, conditionType, status } = query;
    const conditions = [];
    if (keyword) conditions.push(ilike(memberLevel.name, `%${escapeLike(keyword)}%`));
    if (conditionType) conditions.push(eq(memberLevel.conditionType, conditionType));
    if (status) conditions.push(eq(memberLevel.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(memberLevel).where(where),
      this.db
        .select()
        .from(memberLevel)
        .where(where)
        .orderBy(desc(memberLevel.sortOrder), desc(memberLevel.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    return { items: rows.map((r) => this.mapRow(r)), total, page, pageSize };
  }

  /** 下拉选项：所有启用中的等级（供会员管理页选择会员等级） */
  async getOptions(): Promise<{ code: string; name: string }[]> {
    const rows = await this.db
      .select({ code: memberLevel.code, name: memberLevel.name })
      .from(memberLevel)
      .where(eq(memberLevel.status, 'active'))
      .orderBy(desc(memberLevel.sortOrder));
    return rows;
  }

  async getDetail(id: string): Promise<MemberLevel> {
    const rows = await this.db.select().from(memberLevel).where(eq(memberLevel.id, id));
    if (rows.length === 0) throw new NotFoundException('会员等级不存在');
    return this.mapRow(rows[0]);
  }

  async create(dto: CreateMemberLevelDto, userId: string): Promise<MemberLevel> {
    if (!dto.code) throw new BadRequestException('等级编码必填');
    if (!dto.name) throw new BadRequestException('等级名称必填');

    const [row] = await this.db
      .insert(memberLevel)
      .values({
        code: dto.code,
        name: dto.name,
        conditionType: dto.conditionType ?? 'cumulative',
        thresholdAmount: dto.thresholdAmount != null ? String(dto.thresholdAmount) : '0',
        discount: dto.discount != null ? String(dto.discount) : '1',
        discountOnPromo: dto.discountOnPromo ?? false,
        sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? 'active',
        remark: dto.remark ?? null,
      })
      .returning();

    this.logger.log(
      `创建会员等级成功: id=${row.id}, code=${row.code}, operator=${userId}`,
    );
    return this.mapRow(row);
  }

  async update(id: string, dto: UpdateMemberLevelDto, userId: string): Promise<MemberLevel> {
    const existing = await this.db.select().from(memberLevel).where(eq(memberLevel.id, id));
    if (existing.length === 0) throw new NotFoundException('会员等级不存在');

    const patch: Partial<typeof memberLevel.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.conditionType !== undefined) patch.conditionType = dto.conditionType;
    if (dto.thresholdAmount !== undefined)
      patch.thresholdAmount = String(dto.thresholdAmount);
    if (dto.discount !== undefined) patch.discount = String(dto.discount);
    if (dto.discountOnPromo !== undefined) patch.discountOnPromo = dto.discountOnPromo;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');
    patch.updatedAt = new Date();

    const updated = await this.db
      .update(memberLevel)
      .set(patch)
      .where(eq(memberLevel.id, id))
      .returning();

    this.logger.log(`更新会员等级成功: id=${id}, operator=${userId}`);
    return this.mapRow(updated[0]);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.db.select().from(memberLevel).where(eq(memberLevel.id, id));
    if (existing.length === 0) throw new NotFoundException('会员等级不存在');

    await this.db.delete(memberLevel).where(eq(memberLevel.id, id));
    this.logger.log(`删除会员等级成功: id=${id}, operator=${userId}`);
  }
}
