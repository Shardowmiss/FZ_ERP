import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sku, style } from '@server/database/schema';
import { eq, and, count, desc, or, ilike, inArray } from 'drizzle-orm';
import type { Sku } from '@shared/api.interface';
import { escapeLike } from '@server/common/utils/escape-like';

type SkuUpdate = typeof sku.$inferInsert;

/** SKU 批量导入单行 */
export interface SkuImportItem {
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  barcode?: string | null;
  costPrice?: number;
  tagPrice?: number;
  supplyPrice?: number;
  safetyStockMin?: number;
  safetyStockMax?: number;
  status?: string;
}

function skuRowToDto(row: typeof sku.$inferSelect): Sku {
  return {
    id: row.id,
    skuCode: row.skuCode,
    styleId: row.styleId,
    styleNo: row.styleNo,
    color: row.color,
    size: row.size,
    barcode: row.barcode ?? undefined,
    costPrice: Number(row.costPrice ?? 0),
    tagPrice: Number(row.tagPrice ?? 0),
    supplyPrice: Number(row.supplyPrice ?? 0),
    safetyStockMin: Number(row.safetyStockMin ?? 0),
    safetyStockMax: Number(row.safetyStockMax ?? 0),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class SkuService {
  private readonly logger = new Logger(SkuService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async list(
    page: number,
    pageSize: number,
    styleId?: string,
    keyword?: string,
    color?: string,
    size?: string,
  ): Promise<{ items: Sku[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (styleId) conditions.push(eq(sku.styleId, styleId));
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(sku.skuCode, `%${escaped}%`), ilike(sku.styleNo, `%${escaped}%`)));
    }
    if (color) conditions.push(eq(sku.color, color));
    if (size) conditions.push(eq(sku.size, size));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(sku).where(where as any),
      this.db.select()
        .from(sku)
        .where(where as any)
        .orderBy(desc(sku.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: Sku[] = rows.map((row) => skuRowToDto(row));
    return { items, total, page, pageSize };
  }

  async detail(id: string): Promise<Sku> {
    const rows = await this.db.select().from(sku).where(eq(sku.id, id));
    if (rows.length === 0) throw new NotFoundException('SKU不存在');
    return skuRowToDto(rows[0]);
  }

  async update(
    id: string,
    dto: {
      barcode?: string | null;
      costPrice?: number;
      tagPrice?: number;
      supplyPrice?: number;
      safetyStockMin?: number;
      safetyStockMax?: number;
      status?: string;
    },
  ): Promise<Sku> {
    const patch: Partial<SkuUpdate> = {};
    if (dto.barcode !== undefined) patch.barcode = dto.barcode ?? null;
    if (dto.costPrice !== undefined) patch.costPrice = String(dto.costPrice);
    if (dto.tagPrice !== undefined) patch.tagPrice = String(dto.tagPrice);
    if (dto.supplyPrice !== undefined) patch.supplyPrice = String(dto.supplyPrice);
    if (dto.safetyStockMin !== undefined) patch.safetyStockMin = String(dto.safetyStockMin);
    if (dto.safetyStockMax !== undefined) patch.safetyStockMax = String(dto.safetyStockMax);
    if (dto.status !== undefined) patch.status = dto.status;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db.update(sku).set(patch).where(eq(sku.id, id)).returning();
    if (updated.length === 0) throw new NotFoundException('SKU不存在');
    return skuRowToDto(updated[0]);
  }

  async listByStyle(styleId: string): Promise<Sku[]> {
    const rows = await this.db.select().from(sku).where(eq(sku.styleId, styleId)).orderBy(sku.color, sku.size);
    return rows.map((row) => skuRowToDto(row));
  }

  /**
   * SKU 批量导入（性能优化 P2-新③）。
   *
   * 设计：
   * - 必填校验 + 批内 skuCode 去重 + styleNo→styleId 批量解析（一次 inArray）。
   * - 已存在 skuCode 跳过（不覆盖，避免误改线上数据）。
   * - 先预检所有唯一冲突（skuCode 唯一 + 组合唯一 + 批内重复），再单事务多值批量 insert
   *   （性能最优、事务安全；避免 PG 事务内单条失败毒化整事务）。
   * - 返回 { total, inserted, skipped, errors }，便于前端逐行展示失败原因。
   */
  async bulkImport(
    items: SkuImportItem[],
  ): Promise<{
    total: number;
    inserted: number;
    skipped: number;
    errors: { index: number; skuCode?: string; reason: string }[];
  }> {
    const errors: { index: number; skuCode?: string; reason: string }[] = [];
    if (!items || items.length === 0) {
      return { total: 0, inserted: 0, skipped: 0, errors };
    }

    // 1) 必填校验
    items.forEach((it, i) => {
      if (!it.skuCode) errors.push({ index: i, reason: 'skuCode 必填' });
      if (!it.styleNo) errors.push({ index: i, reason: 'styleNo 必填' });
      if (!it.color) errors.push({ index: i, reason: 'color 必填' });
      if (!it.size) errors.push({ index: i, reason: 'size 必填' });
    });

    // 2) 批内 skuCode 去重
    const seen = new Set<string>();
    const dedupIdx: number[] = [];
    items.forEach((it, i) => {
      if (errors.some((e) => e.index === i)) return;
      if (seen.has(it.skuCode)) {
        errors.push({ index: i, skuCode: it.skuCode, reason: '批内重复 skuCode' });
        return;
      }
      seen.add(it.skuCode);
      dedupIdx.push(i);
    });

    // 3) styleNo → styleId 批量解析
    const styleNos = [...new Set(dedupIdx.map((i) => items[i].styleNo))];
    const styleRows = await this.db
      .select({ id: style.id, styleNo: style.styleNo })
      .from(style)
      .where(inArray(style.styleNo, styleNos));
    const styleMap = new Map(styleRows.map((s) => [s.styleNo, s.id]));

    const resolveIdx: { i: number; styleId: string }[] = [];
    for (const i of dedupIdx) {
      const sid = styleMap.get(items[i].styleNo);
      if (!sid) {
        errors.push({ index: i, skuCode: items[i].skuCode, reason: `styleNo ${items[i].styleNo} 不存在` });
        continue;
      }
      resolveIdx.push({ i, styleId: sid });
    }

    // 4) 已存在 skuCode 跳过
    let skipped = 0;
    let toInsert = resolveIdx;
    if (resolveIdx.length > 0) {
      const codes = resolveIdx.map((x) => items[x.i].skuCode);
      const existRows = await this.db
        .select({ skuCode: sku.skuCode })
        .from(sku)
        .where(inArray(sku.skuCode, codes));
      const existSet = new Set(existRows.map((e) => e.skuCode));
      const finalIdx: { i: number; styleId: string }[] = [];
      for (const x of resolveIdx) {
        if (existSet.has(items[x.i].skuCode)) {
          errors.push({ index: x.i, skuCode: items[x.i].skuCode, reason: 'skuCode 已存在（已跳过）' });
          skipped += 1;
          continue;
        }
        finalIdx.push(x);
      }
      toInsert = finalIdx;
    }

    // 5) 复合唯一 (styleId, color, size) 预检：批内重复 + 已存在（避免事务内冲突毒化事务）
    type Cand = {
      i: number; styleId: string; skuCode: string; styleNo: string; color: string; size: string;
      barcode?: string | null; costPrice?: number; tagPrice?: number; supplyPrice?: number;
      safetyStockMin?: number; safetyStockMax?: number; status?: string;
    };
    const cand: Cand[] = [];
    const compSeen = new Map<string, number>();
    for (const x of toInsert) {
      const it = items[x.i];
      const compKey = `${x.styleId}|${it.color}|${it.size}`;
      if (compSeen.has(compKey)) {
        errors.push({ index: x.i, skuCode: it.skuCode, reason: '批内重复 (款式,颜色,尺码) 组合' });
        continue;
      }
      compSeen.set(compKey, x.i);
      cand.push({
        i: x.i, styleId: x.styleId, skuCode: it.skuCode, styleNo: it.styleNo,
        color: it.color, size: it.size, barcode: it.barcode ?? null,
        costPrice: it.costPrice, tagPrice: it.tagPrice, supplyPrice: it.supplyPrice,
        safetyStockMin: it.safetyStockMin, safetyStockMax: it.safetyStockMax, status: it.status,
      });
    }

    // 分批查询已存在的 (styleId,color,size)，避免 OR 条件过大
    const BATCH = 500;
    const compExist = new Set<string>();
    for (let s = 0; s < cand.length; s += BATCH) {
      const slice = cand.slice(s, s + BATCH);
      if (slice.length === 0) continue;
      const rows = await this.db
        .select({ styleId: sku.styleId, color: sku.color, size: sku.size })
        .from(sku)
        .where(or(...slice.map((c) => and(eq(sku.styleId, c.styleId), eq(sku.color, c.color), eq(sku.size, c.size)))));
      for (const r of rows) compExist.add(`${r.styleId}|${r.color}|${r.size}`);
    }

    const insertRows = cand.filter((c) => {
      const k = `${c.styleId}|${c.color}|${c.size}`;
      if (compExist.has(k)) {
        errors.push({ index: c.i, skuCode: c.skuCode, reason: '(款式,颜色,尺码) 组合已存在' });
        return false;
      }
      return true;
    });

    // 6) 多值批量插入（单事务）：预检已排除所有已知冲突，正常情况下不会触发唯一约束
    let inserted = 0;
    if (insertRows.length > 0) {
      try {
        await this.db.transaction(async (tx) => {
          await tx.insert(sku).values(
            insertRows.map((c) => ({
              skuCode: c.skuCode,
              styleId: c.styleId,
              styleNo: c.styleNo,
              color: c.color,
              size: c.size,
              barcode: c.barcode,
              costPrice: String(c.costPrice ?? 0),
              tagPrice: String(c.tagPrice ?? 0),
              supplyPrice: String(c.supplyPrice ?? 0),
              safetyStockMin: String(c.safetyStockMin ?? 0),
              safetyStockMax: String(c.safetyStockMax ?? 0),
              status: c.status ?? 'active',
            })),
          );
        });
        inserted = insertRows.length;
      } catch (e: any) {
        // 极端并发冲突（预检与插入之间被他方插入）：整体回滚并标记
        insertRows.forEach((c) =>
          errors.push({ index: c.i, skuCode: c.skuCode, reason: `插入失败: ${e?.message ?? e}` }),
        );
        inserted = 0;
      }
    }

    return { total: items.length, inserted, skipped, errors };
  }
}
