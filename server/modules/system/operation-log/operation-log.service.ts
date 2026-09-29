import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { eq, and, count, desc, gte, lt } from 'drizzle-orm';
import { systemOperationLog } from '@server/database/schema';
import { keysetWhereLt, nextCursorFrom } from '@server/database/keyset';
import type { OperationLog, PaginationResult } from '@shared/api.interface';

interface ListQuery {
  page: number;
  pageSize: number;
  startDate?: string;
  endDate?: string;
  userId?: string;
  module?: string;
  operationType?: string;
  /** keyset 游标（上一页最后一行编码）；提供时走游标分页，深翻页不退化。 */
  cursor?: string;
}

interface CreateLogDto {
  userId?: string;
  userName?: string;
  module?: string;
  operationType?: string;
  objectId?: string;
  objectName?: string;
  summary?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  private mapLog(row: typeof systemOperationLog.$inferSelect): OperationLog {
    return {
      id: row.id,
      operationTime: row.operationTime.toISOString(),
      userId: row.userId ?? undefined,
      userName: row.userName ?? undefined,
      module: row.module ?? undefined,
      operationType: row.operationType ?? undefined,
      objectId: row.objectId ?? undefined,
      objectName: row.objectName ?? undefined,
      summary: row.summary ?? undefined,
      ip: row.ip ?? undefined,
      userAgent: row.userAgent ?? undefined,
    };
  }

  async list(query: ListQuery): Promise<PaginationResult<OperationLog>> {
    const { page, pageSize, startDate, endDate, userId: qUserId, module: qModule, operationType: qOp, cursor } = query;
    const conditions = [];
    if (startDate) conditions.push(gte(systemOperationLog.operationTime, new Date(startDate)));
    if (endDate) conditions.push(lt(systemOperationLog.operationTime, new Date(endDate)));
    if (qUserId) conditions.push(eq(systemOperationLog.userId, qUserId));
    if (qModule) conditions.push(eq(systemOperationLog.module, qModule));
    if (qOp) conditions.push(eq(systemOperationLog.operationType, qOp));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const t = systemOperationLog;

    let rows: typeof t.$inferSelect[];
    let total: number;
    if (cursor) {
      // keyset 游标分页：基于 operationTime+id 定位，深翻页 O(M) 不退化
      const keyset = keysetWhereLt(t.operationTime, t.id, cursor);
      const combined = keyset ? (where ? and(where, keyset) : keyset) : where;
      rows = await this.db
        .select()
        .from(t)
        .where(combined)
        .orderBy(desc(t.operationTime), desc(t.id))
        .limit(pageSize);
      total = rows.length;
    } else {
      // 首屏 / 浅翻页：OFFSET 分页，total 精确
      const offset = (page - 1) * pageSize;
      const [countResult, fetched] = await Promise.all([
        this.db.select({ count: count() }).from(t).where(where),
        this.db
          .select()
          .from(t)
          .where(where)
          .orderBy(desc(t.operationTime), desc(t.id))
          .limit(pageSize)
          .offset(offset),
      ]);
      rows = fetched;
      total = Number(countResult[0]?.count ?? 0);
    }

    return {
      items: rows.map((row) => this.mapLog(row)),
      total,
      page,
      pageSize,
      nextCursor: nextCursorFrom(rows, 'operationTime', 'id') ?? undefined,
    };
  }

  async create(dto: CreateLogDto): Promise<void> {
    try {
      await this.db.insert(systemOperationLog).values({
        userId: dto.userId ?? null,
        userName: dto.userName ?? null,
        module: dto.module ?? null,
        operationType: dto.operationType ?? null,
        objectId: dto.objectId ?? null,
        objectName: dto.objectName ?? null,
        summary: dto.summary ?? null,
        ip: dto.ip ?? null,
        userAgent: dto.userAgent ?? null,
      });
    } catch (error: unknown) {
      // 日志写入失败不影响主流程
      this.logger.error(`操作日志写入失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
