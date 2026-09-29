import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, inArray, lte, sql } from 'drizzle-orm';
import { docUniqueCode, docUniqueCodeArchive, systemConfig } from '@server/database/schema';
import { UniqueCodeTraceService } from './unique-code-trace.service';
import { K_ARCHIVE_DAYS } from './unique-code.tokens';

/**
 * 唯一码引擎【附属域：流水归档与公开溯源】。
 *
 * 职责边界：doc_unique_code 的冷热分离与对外公开视图。
 *  - archiveOldEvents / archiveByDays / getArchiveDays / getArchiveStats：
 *    按时间阈值把热表流水分批搬移到 doc_unique_code_archive，降低热表体积；
 *  - getPublicTrace：消费者/吊牌二维码视角的溯源摘要（不暴露操作人、内部单号）。
 *
 * 依赖：配置①、追溯域⑤（复用 getTrace 的完整时间线后做脱敏投影），无反向依赖，DI 无环。
 * 归档后溯源仍完整，是因为追溯域的 selectEventsBoth 会同时读热表与归档表。
 */
@Injectable()
export class UniqueCodeArchiveService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
    private readonly trace: UniqueCodeTraceService,
  ) {}

  /**
   * 流水归档（P2 留存策略）：将 scan_at 早于 before 的热表流水分批搬移到归档表。
   *  - 分批搬移（默认 2000/批），每批在同一事务内"插入归档 + 删除热表"，保证不丢数据。
   *  - 归档后溯源读取仍覆盖这些事件（selectEventsBoth 跨两表），溯源完整。
   *  - 返回搬移条数；可挂定时任务（如每月归档 N 年前数据，降低热表体积与查询成本）。
   */
  async archiveOldEvents(before: Date, batchSize = 2000): Promise<{ moved: number; before: string }> {
    let moved = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await this.db
        .select()
        .from(docUniqueCode)
        .where(lte(docUniqueCode.scanAt, before))
        .orderBy(docUniqueCode.scanAt)
        .limit(batchSize);
      if (!batch.length) break;
      const rows = batch.map((r: any) => ({ ...r, archivedAt: new Date() }));
      await this.db.transaction(async (t) => {
        await t.insert(docUniqueCodeArchive).values(rows);
        await t.delete(docUniqueCode).where(inArray(docUniqueCode.id, batch.map((b: any) => b.id)));
      });
      moved += batch.length;
      if (batch.length < batchSize) break;
    }
    return { moved, before: before.toISOString() };
  }

  /** 归档统计：热表 / 归档表 各自条数与时间范围，用于留存治理与容量评估 */
  async getArchiveStats(): Promise<{
    hot: { count: number; minAt: Date | null; maxAt: Date | null };
    archive: { count: number; minAt: Date | null; maxAt: Date | null };
  }> {
    const toRow = (r: any) => ({
      count: Number(r?.[0]?.cnt ?? 0),
      minAt: r?.[0]?.min_at ?? null,
      maxAt: r?.[0]?.max_at ?? null,
    });
    const [hot, arc] = await Promise.all([
      (await this.db.execute(
        sql`SELECT COUNT(*)::int AS cnt, MIN(scan_at) AS min_at, MAX(scan_at) AS max_at FROM doc_unique_code`,
      )) as any,
      (await this.db.execute(
        sql`SELECT COUNT(*)::int AS cnt, MIN(scan_at) AS min_at, MAX(scan_at) AS max_at FROM doc_unique_code_archive`,
      )) as any,
    ]);
    return { hot: toRow(hot), archive: toRow(arc) };
  }

  /** 读取流水归档天数配置（UNIQUE_CODE_ARCHIVE_DAYS）：0 表示不归档，>0 表示归档早于该天数的流水 */
  async getArchiveDays(): Promise<number> {
    const rows = await this.db
      .select({ v: systemConfig.configValue })
      .from(systemConfig)
      .where(eq(systemConfig.configKey, K_ARCHIVE_DAYS));
    const raw = rows[0]?.v;
    const n = raw == null ? 0 : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  }

  /**
   * 按配置天数归档：days<=0 视为未启用，直接返回 enabled=false 且不搬移。
   * 否则将早于 (now - days) 的热表流水分批搬移到归档表，溯源仍跨两表完整。
   */
  async archiveByDays(
    days: number,
    batchSize = 2000,
  ): Promise<{ moved: number; before: string; days: number; enabled: boolean }> {
    if (!days || days <= 0) {
      return { moved: 0, before: new Date().toISOString(), days: 0, enabled: false };
    }
    const before = new Date(Date.now() - days * 24 * 3600 * 1000);
    const r = await this.archiveOldEvents(before, batchSize);
    return { ...r, days, enabled: true };
  }

  /**
   * 公开溯源摘要（P2 吊牌溯源二维码 / 消费者自查）：返回"消费者安全"的溯源信息，
   * 不含操作人(operatorId)、内部单号等内部字段，仅暴露 款色码 / 当前状态 /
   * 原始采购入库仓 / 当前仓 / 是否串货嫌疑 / 简化时间线。供吊牌二维码指向的公开页面使用，
   * 区别于内部 /api/unique-code/trace（含操作人、内部单号、完整事件）。
   */
  async getPublicTrace(uniqueCode: string): Promise<{
    found: boolean;
    authentic: boolean;
    uniqueCode: string;
    styleNo: string | null;
    color: string | null;
    size: string | null;
    currentStatusLabel: string | null;
    currentWarehouseName: string | null;
    purchaseOriginWarehouseName: string | null;
    channelCrossingSuspect: boolean;
    eventCount: number;
    events: {
      eventType: string;
      direction: '入' | '出' | '核' | '退';
      warehouseName: string | null;
      scanAt: Date;
    }[];
  }> {
    const full = await this.trace.getTrace(uniqueCode);
    if (!full.enabled) {
      return {
        found: false, authentic: false, uniqueCode, styleNo: null, color: null, size: null,
        currentStatusLabel: null, currentWarehouseName: null, purchaseOriginWarehouseName: null,
        channelCrossingSuspect: false, eventCount: 0, events: [],
      };
    }
    const found = !!full.current || full.eventCount > 0;
    if (!found) {
      return {
        found: false, authentic: false, uniqueCode, styleNo: null, color: null, size: null,
        currentStatusLabel: null, currentWarehouseName: null, purchaseOriginWarehouseName: null,
        channelCrossingSuspect: false, eventCount: 0, events: [],
      };
    }
    const originEv = full.events.find((e) => e.scanType === 'inbound');
    return {
      found: true,
      authentic: true,
      uniqueCode,
      styleNo: full.current?.styleNo ?? originEv?.styleNo ?? null,
      color: full.current?.color ?? originEv?.color ?? null,
      size: full.current?.size ?? originEv?.size ?? null,
      currentStatusLabel: full.current?.statusLabel ?? null,
      currentWarehouseName: full.current?.warehouseName ?? null,
      purchaseOriginWarehouseName: originEv?.warehouseName ?? null,
      channelCrossingSuspect: full.channelCrossingSuspect,
      eventCount: full.eventCount,
      events: full.events.map((e) => ({
        eventType: e.eventType,
        direction: e.direction,
        warehouseName: e.warehouseName,
        scanAt: e.scanAt,
      })),
    };
  }
}
