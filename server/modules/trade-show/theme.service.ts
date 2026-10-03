import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { tradeShowTheme } from '@server/database/schema';
import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import type { TradeShowTheme, PaginationResult } from '@shared/api.interface';

interface CreateThemeDto {
  themeCode?: string;
  themeName: string;
  year?: string;
  season?: string;
  sortOrder?: number;
  status?: string;
  remark?: string;
}

interface UpdateThemeDto {
  themeName?: string;
  year?: string;
  season?: string;
  sortOrder?: number;
  status?: string;
  remark?: string;
}

interface ListQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  year?: string;
  season?: string;
  status?: string;
}

@Injectable()
export class ThemeService {
  private readonly logger = new Logger(ThemeService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateThemeCode(tx: PostgresJsDatabase, year: string): Promise<string> {
    const prefix = `TH${year}`;
    return this.numberGenerator.generateNextNo(
      tx,
      tradeShowTheme,
      tradeShowTheme.themeCode,
      prefix,
      3,
    );
  }

  private mapRow(row: typeof tradeShowTheme.$inferSelect): TradeShowTheme {
    return {
      id: row.id,
      themeCode: row.themeCode,
      themeName: row.themeName,
      year: row.year ?? undefined,
      season: row.season ?? undefined,
      sortOrder: row.sortOrder ?? 0,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<TradeShowTheme>> {
    const { page, pageSize, keyword, year, season, status } = query;
    const conditions = [];
    if (keyword) {
      conditions.push(ilike(tradeShowTheme.themeName, `%${escapeLike(keyword)}%`));
    }
    if (year) conditions.push(eq(tradeShowTheme.year, year));
    if (season) conditions.push(eq(tradeShowTheme.season, season));
    if (status) conditions.push(eq(tradeShowTheme.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(tradeShowTheme).where(where),
      this.db
        .select()
        .from(tradeShowTheme)
        .where(where)
        .orderBy(desc(tradeShowTheme.sortOrder), desc(tradeShowTheme.createdAt))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      pageSize,
    };
  }

  /** 下拉选项：所有启用中的主题（供订货会主单等引用，满足「其它引用均来自此主数据」） */
  async getOptions(): Promise<{ id: string; themeCode: string; themeName: string }[]> {
    const rows = await this.db
      .select({
        id: tradeShowTheme.id,
        themeCode: tradeShowTheme.themeCode,
        themeName: tradeShowTheme.themeName,
      })
      .from(tradeShowTheme)
      .where(eq(tradeShowTheme.status, 'active'))
      .orderBy(desc(tradeShowTheme.sortOrder));
    return rows;
  }

  async getDetail(id: string): Promise<TradeShowTheme> {
    const rows = await this.db
      .select()
      .from(tradeShowTheme)
      .where(eq(tradeShowTheme.id, id));
    if (rows.length === 0) throw new NotFoundException('订货会主题不存在');
    return this.mapRow(rows[0]);
  }

  async create(dto: CreateThemeDto, userId: string): Promise<TradeShowTheme> {
    if (!dto.themeName) throw new BadRequestException('主题名称不能为空');
    const year = dto.year ?? new Date().getFullYear().toString();

    const inserted = await this.db.transaction(async (tx) => {
      const themeCode = dto.themeCode ?? (await this.generateThemeCode(tx, year));
      const [row] = await tx
        .insert(tradeShowTheme)
        .values({
          themeCode,
          themeName: dto.themeName,
          year: dto.year ?? null,
          season: dto.season ?? null,
          sortOrder: dto.sortOrder ?? 0,
          status: dto.status ?? 'active',
          remark: dto.remark ?? null,
        })
        .returning();
      return row;
    });

    this.logger.log(
      `创建订货会主题成功: id=${inserted.id}, themeCode=${inserted.themeCode}, operator=${userId}`,
    );
    return this.mapRow(inserted);
  }

  async update(id: string, dto: UpdateThemeDto, userId: string): Promise<TradeShowTheme> {
    const existing = await this.db
      .select()
      .from(tradeShowTheme)
      .where(eq(tradeShowTheme.id, id));
    if (existing.length === 0) throw new NotFoundException('订货会主题不存在');

    const patch: Partial<typeof tradeShowTheme.$inferInsert> = {};
    if (dto.themeName !== undefined) patch.themeName = dto.themeName;
    if (dto.year !== undefined) patch.year = dto.year;
    if (dto.season !== undefined) patch.season = dto.season;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');
    patch.updatedAt = new Date();

    const updated = await this.db
      .update(tradeShowTheme)
      .set(patch)
      .where(eq(tradeShowTheme.id, id))
      .returning();

    this.logger.log(`更新订货会主题成功: id=${id}, operator=${userId}`);
    return this.mapRow(updated[0]);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(tradeShowTheme)
      .where(eq(tradeShowTheme.id, id));
    if (existing.length === 0) throw new NotFoundException('订货会主题不存在');

    await this.db.delete(tradeShowTheme).where(eq(tradeShowTheme.id, id));
    this.logger.log(`删除订货会主题成功: id=${id}, operator=${userId}`);
  }
}
