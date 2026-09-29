import { Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, count, and, desc, isNull } from 'drizzle-orm';
import type { PgTableWithColumns } from 'drizzle-orm/pg-core';
import { keysetWhereLt, nextCursorFrom } from '../../database/keyset';

export abstract class BaseCrudService<
  TTable extends PgTableWithColumns<any>,
  TSelect,
  TInsert,
  TUpdate = Partial<TInsert>,
> {
  @Inject(DRIZZLE_DATABASE) protected readonly db: PostgresJsDatabase;

  constructor(protected readonly table: TTable) {}

  /** 该表是否启用软删除（存在 deletedAt 列时自动启用，避免影响无该列的表）。 */
  private get softDeleteEnabled(): boolean {
    return !!(this.table as any)?.deletedAt;
  }

  private notDeleted(): any[] {
    return this.softDeleteEnabled ? [isNull((this.table as any).deletedAt)] : [];
  }

  /**
   * 分页查询原始行 + 总数。子类在 list() 中调用后再做 DTO 映射。
   * 启用软删除时自动过滤已删除行。
   * @param page 页码（1-indexed）
   * @param pageSize 每页条数
   * @param whereConditions where 条件数组（由子类构建）
   */
  protected async paginateRaw(
    page: number,
    pageSize: number,
    whereConditions: any[] = [],
  ): Promise<{ rows: any[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const where = and(...whereConditions, ...this.notDeleted()) as any;
    const t = this.table as any;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(t).where(where),
      this.db
        .select()
        .from(t)
        .where(where)
        .orderBy(desc(t.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    return {
      rows,
      total: Number(countResult[0]?.count ?? 0),
    };
  }

  async findById(id: string): Promise<any | null> {
    const t = this.table as any;
    const rows = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, id), ...this.notDeleted()) as any)
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdOrThrow(id: string, notFoundMessage = '记录不存在'): Promise<any> {
    const row = await this.findById(id);
    if (!row) throw new NotFoundException(notFoundMessage);
    return row;
  }

  async insertRow(data: TInsert): Promise<any> {
    const rows = await this.db.insert(this.table as any).values(data as any).returning();
    return rows[0];
  }

  async updateRow(id: string, data: TUpdate, notFoundMessage = '记录不存在'): Promise<any> {
    const t = this.table as any;
    const rows = await this.db
      .update(t)
      .set(data as any)
      .where(and(eq(t.id, id), ...this.notDeleted()) as any)
      .returning();
    if (rows.length === 0) throw new NotFoundException(notFoundMessage);
    return rows[0];
  }

  /**
   * 删除：启用软删除的表置位 deletedAt（可恢复）；否则硬删除。
   * 注意：含唯一约束（如 code）的表在软删除后若再用相同唯一键重建会冲突，
   *       需将唯一索引改为 PARTIAL（WHERE deleted_at IS NULL），列为后续迁移。
   */
  async remove(id: string, notFoundMessage = '记录不存在'): Promise<void> {
    const t = this.table as any;
    if (this.softDeleteEnabled) {
      const rows = await this.db
        .update(t)
        .set({ deletedAt: new Date() })
        .where(eq(t.id, id))
        .returning({ id: t.id });
      if (rows.length === 0) throw new NotFoundException(notFoundMessage);
      return;
    }
    const rows = await this.db.delete(t).where(eq(t.id, id)).returning({ id: t.id });
    if (rows.length === 0) throw new NotFoundException(notFoundMessage);
  }

  async listAll(): Promise<any[]> {
    const t = this.table as any;
    const where = this.softDeleteEnabled ? (isNull(t.deletedAt) as any) : undefined;
    const rows = await this.db.select().from(t).where(where);
    return rows;
  }
}
