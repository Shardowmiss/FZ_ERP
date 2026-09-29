import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { voidDraftDocument } from '@server/common/document-void';
import { eq, and, count, desc, like, ilike } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { tradeShow } from '@server/database/schema';
import { NumberGeneratorService } from '../system/code-rule/number-generator.service';
import type {
  TradeShow,
  PaginationResult,
} from '@shared/api.interface';

interface CreateTradeShowDto {
  showNo?: string;
  name: string;
  year?: string;
  season?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  remark?: string;
}

interface UpdateTradeShowDto {
  name?: string;
  year?: string;
  season?: string;
  startDate?: string;
  endDate?: string;
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

const STATUS_FLOW: Record<string, string[]> = {
  draft: ['ongoing'],
  ongoing: ['ended'],
  ended: ['closed'],
  closed: [],
};

@Injectable()
export class TradeShowService {
  private readonly logger = new Logger(TradeShowService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly numberGenerator: NumberGeneratorService,
  ) {}

  private async generateShowNo(
    tx: PostgresJsDatabase,
    year: string,
  ): Promise<string> {
    const prefix = `TS${year}`;
    return this.numberGenerator.generateNextNo(
      tx,
      tradeShow,
      tradeShow.showNo,
      prefix,
      4,
    );
  }

  private mapRow(row: typeof tradeShow.$inferSelect): TradeShow {
    return {
      id: row.id,
      showNo: row.showNo,
      name: row.name,
      year: row.year ?? undefined,
      season: row.season ?? undefined,
      startDate: row.startDate ?? undefined,
      endDate: row.endDate ?? undefined,
      status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<TradeShow>> {
    const { page, pageSize, keyword, year, season, status } = query;
    const conditions = [];
    if (keyword) {
      conditions.push(ilike(tradeShow.name, `%${escapeLike(keyword)}%`));
    }
    if (year) conditions.push(eq(tradeShow.year, year));
    if (season) conditions.push(eq(tradeShow.season, season));
    if (status) conditions.push(eq(tradeShow.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (page - 1) * pageSize;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(tradeShow).where(where),
      this.db
        .select()
        .from(tradeShow)
        .where(where)
        .orderBy(desc(tradeShow.createdAt))
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

  async getOptions(): Promise<
    { id: string; showNo: string; name: string; status: string }[]
  > {
    const rows = await this.db
      .select({
        id: tradeShow.id,
        showNo: tradeShow.showNo,
        name: tradeShow.name,
        status: tradeShow.status,
      })
      .from(tradeShow)
      .orderBy(desc(tradeShow.createdAt));

    return rows;
  }

  async getDetail(id: string): Promise<TradeShow> {
    const rows = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, id));
    if (rows.length === 0) {
      throw new NotFoundException('订货会不存在');
    }
    return this.mapRow(rows[0]);
  }

  async create(dto: CreateTradeShowDto, userId: string): Promise<TradeShow> {
    if (!dto.name) {
      throw new BadRequestException('订货会名称不能为空');
    }

    const year = dto.year ?? new Date().getFullYear().toString();

    const inserted = await this.db.transaction(async (tx) => {
      const showNo = dto.showNo ?? (await this.generateShowNo(tx, year));

      const [row] = await tx
        .insert(tradeShow)
        .values({
          showNo,
          name: dto.name,
          year: year ?? null,
          season: dto.season ?? null,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
          status: dto.status ?? 'draft',
          remark: dto.remark ?? null,
        })
        .returning();

      return row;
    });

    this.logger.log(
      `创建订货会成功: id=${inserted.id}, showNo=${inserted.showNo}, operator=${userId}`,
    );

    return this.mapRow(inserted);
  }

  async update(
    id: string,
    dto: UpdateTradeShowDto,
    userId: string,
  ): Promise<TradeShow> {
    const existing = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('订货会不存在');
    }

    const patch: Partial<typeof tradeShow.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.year !== undefined) patch.year = dto.year;
    if (dto.season !== undefined) patch.season = dto.season;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.endDate !== undefined) patch.endDate = dto.endDate;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('未提供可更新字段');
    }

    patch.updatedAt = new Date();

    const updated = await this.db
      .update(tradeShow)
      .set(patch)
      .where(eq(tradeShow.id, id))
      .returning();

    this.logger.log(
      `更新订货会成功: id=${id}, operator=${userId}`,
    );

    return this.mapRow(updated[0]);
  }

    async voidDoc(id: string): Promise<void> {
    await voidDraftDocument(this.db, tradeShow, id, {
      draftValue: 'draft',
      notFoundMsg: "订货会不存在",
      guardMsg: "仅草稿状态的订货会可以删除",
    });
  }

async delete(id: string, userId: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('订货会不存在');
    }
    if (existing[0].status !== 'draft') {
      throw new BadRequestException('仅草稿状态的订货会可以删除');
    }

    await this.db.delete(tradeShow).where(eq(tradeShow.id, id));

    this.logger.log(
      `删除订货会成功: id=${id}, operator=${userId}`,
    );
  }

  private async transitionStatus(
    id: string,
    targetStatus: string,
    userId: string,
  ): Promise<TradeShow> {
    const existing = await this.db
      .select()
      .from(tradeShow)
      .where(eq(tradeShow.id, id));
    if (existing.length === 0) {
      throw new NotFoundException('订货会不存在');
    }

    const currentStatus = existing[0].status;
    const allowedNext = STATUS_FLOW[currentStatus] ?? [];
    if (!allowedNext.includes(targetStatus)) {
      throw new BadRequestException(
        `状态流转不允许: ${currentStatus} → ${targetStatus}`,
      );
    }

    const updated = await this.db
      .update(tradeShow)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(eq(tradeShow.id, id))
      .returning();

    this.logger.log(
      `订货会状态变更: id=${id}, ${currentStatus} → ${targetStatus}, operator=${userId}`,
    );

    return this.mapRow(updated[0]);
  }

  async start(id: string, userId: string): Promise<TradeShow> {
    return this.transitionStatus(id, 'ongoing', userId);
  }

  async end(id: string, userId: string): Promise<TradeShow> {
    return this.transitionStatus(id, 'ended', userId);
  }

  async close(id: string, userId: string): Promise<TradeShow> {
    return this.transitionStatus(id, 'closed', userId);
  }
}
