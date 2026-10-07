import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sku, style, color, size, colorGroupColor, sizeGroupSize } from '@server/database/schema';
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
    colorId: row.colorId ?? undefined,
    sizeId: row.sizeId ?? undefined,
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

    // 3.5) color/size 名称 → 主数据 id 解析（B.1 / P1-3 M4）
    //   匹配不上则留 NULL，过渡期由 varchar 镜像(color/size)兜底；P1-4 再收紧 NOT NULL + 强制主数据。
    const colorNames = [...new Set(resolveIdx.map((x) => items[x.i].color))];
    const sizeNames = [...new Set(resolveIdx.map((x) => items[x.i].size))];
    const colorRows = await this.db
      .select({ id: color.id, name: color.name })
      .from(color)
      .where(inArray(color.name, colorNames));
    const sizeRows = await this.db
      .select({ id: size.id, name: size.name })
      .from(size)
      .where(inArray(size.name, sizeNames));
    const colorMap = new Map(colorRows.map((c) => [c.name, c.id]));
    const sizeMap = new Map(sizeRows.map((s) => [s.name, s.id]));

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
      colorId?: string | null; sizeId?: string | null;
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
        color: it.color, size: it.size,
        colorId: colorMap.get(it.color) ?? null,
        sizeId: sizeMap.get(it.size) ?? null,
        barcode: it.barcode ?? null,
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
              colorId: c.colorId ?? null,
              sizeId: c.sizeId ?? null,
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

  /**
   * 按款号的「色组 × 尺码组」笛卡尔积批量生成 SKU 矩阵。
   *
   * 服装建档的核心效率痛点：一个 5 色 × 6 码的款需 30 个 SKU，
   * 逐条手录或先在 Excel 拼好再导入，200 款即 5000+ 条人工录入。
   *
   * 幂等保证（两道防线）：
   *   1) 预检：查询已存在的 (styleId, colorId, sizeId)，批内去重 + 库内去重；
   *   2) 插入：ON CONFLICT DO NOTHING 兜住并发场景
   *      （依赖唯一索引 idx_sku_style_color_id_size_id）。
   * 因此重复调用同一款号不会产生重复 SKU，也不会报错。
   *
   * skuCode 规则沿用现有库既有格式：`{styleNo}-{色CODE}-{码CODE}`
   * （如 AW26-001-AP-L），与存量 166 个 SKU 保持一致。
   * 注意用的是颜色/尺码的 **code** 而非 name，与存量数据口径相同。
   */
  async generateMatrix(
    styleId: string,
  ): Promise<{
    styleNo: string;
    total: number;      // 应收矩阵数（色数 × 码数）
    inserted: number;   // 实际新增
    skipped: number;    // 已存在而跳过
    colors: number;
    sizes: number;
  }> {
    // 1) 取款号及其色组/尺码组
    const [st] = await this.db
      .select({
        id: style.id,
        styleNo: style.styleNo,
        colorGroupId: style.colorGroupId,
        sizeGroupId: style.sizeGroupId,
      })
      .from(style)
      .where(eq(style.id, styleId))
      .limit(1);
    if (!st) {
      throw new NotFoundException(`款式不存在: ${styleId}`);
    }

    // 2) 取色组成员（按 sortOrder 稳定排序，保证生成顺序可预期）
    const colorRows = await this.db
      .select({ id: color.id, code: color.code, name: color.name })
      .from(colorGroupColor)
      .innerJoin(color, eq(color.id, colorGroupColor.colorId))
      .where(eq(colorGroupColor.colorGroupId, st.colorGroupId))
      .orderBy(colorGroupColor.sortOrder, color.code);

    // 3) 取尺码组成员
    const sizeRows = await this.db
      .select({ id: size.id, code: size.code, name: size.name })
      .from(sizeGroupSize)
      .innerJoin(size, eq(size.id, sizeGroupSize.sizeId))
      .where(eq(sizeGroupSize.sizeGroupId, st.sizeGroupId))
      .orderBy(sizeGroupSize.sortOrder, size.code);

    if (colorRows.length === 0) {
      throw new BadRequestException(
        `款号 ${st.styleNo} 的色组没有成员，请先在「色组管理」中为该色组添加颜色`,
      );
    }
    if (sizeRows.length === 0) {
      throw new BadRequestException(
        `款号 ${st.styleNo} 的尺码组没有成员，请先在「尺码组管理」中为该尺码组添加尺码`,
      );
    }

    // 4) 预检：查出该款已存在的 (colorId, sizeId) 组合
    const existing = await this.db
      .select({ colorId: sku.colorId, sizeId: sku.sizeId })
      .from(sku)
      .where(eq(sku.styleId, styleId));
    const existSet = new Set(
      existing.map((r) => `${r.colorId ?? ''}|${r.sizeId ?? ''}`),
    );

    // 5) 笛卡尔积 + 批内去重
    const rows: {
      skuCode: string;
      styleId: string;
      styleNo: string;
      color: string;
      size: string;
      colorId: string;
      sizeId: string;
    }[] = [];
    const batchSeen = new Set<string>();
    let skipped = 0;

    for (const c of colorRows) {
      for (const z of sizeRows) {
        const key = `${c.id}|${z.id}`;
        if (existSet.has(key) || batchSeen.has(key)) {
          skipped += 1;
          continue;
        }
        batchSeen.add(key);
        rows.push({
          skuCode: `${st.styleNo}-${c.code}-${z.code}`,
          styleId: st.id,
          styleNo: st.styleNo,
          color: c.name,
          size: z.name,
          colorId: c.id,
          sizeId: z.id,
        });
      }
    }

    const total = colorRows.length * sizeRows.length;

    // 6) 批量插入（单事务）。ON CONFLICT DO NOTHING 兜住并发写入。
    let inserted = 0;
    if (rows.length > 0) {
      try {
        await this.db.transaction(async (tx) => {
          await tx
            .insert(sku)
            .values(
              rows.map((r) => ({
                skuCode: r.skuCode,
                styleId: r.styleId,
                styleNo: r.styleNo,
                color: r.color,
                size: r.size,
                colorId: r.colorId,
                sizeId: r.sizeId,
                costPrice: '0',
                tagPrice: '0',
                supplyPrice: '0',
                safetyStockMin: '0',
                safetyStockMax: '0',
                status: 'active',
              })),
            )
            .onConflictDoNothing();
        });
        inserted = rows.length;
      } catch (e: any) {
        this.logger.error(
          `生成 SKU 矩阵失败 styleId=${styleId} styleNo=${st.styleNo}: ${e?.message ?? e}`,
        );
        throw new BadRequestException(`生成 SKU 矩阵失败: ${e?.message ?? e}`);
      }
    }

    this.logger.log(
      `生成 SKU 矩阵 styleNo=${st.styleNo} 色${colorRows.length}×码${sizeRows.length}=${total} ` +
        `新增 ${inserted} 跳过 ${skipped}`,
    );

    return {
      styleNo: st.styleNo,
      total,
      inserted,
      skipped,
      colors: colorRows.length,
      sizes: sizeRows.length,
    };
  }
}
