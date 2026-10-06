import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ConflictException, forwardRef } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  sku,
  style,
  colorGroup,
  sizeGroup,
  bom,
  garmentPurchaseOrderSku,
  garmentPurchaseInboundSku,
  garmentPurchaseReturnSku,
  salesOrderItem,
  salesOutboundItem,
  salesReturnItem,
  inventoryStock,
  inventoryFlow,
  allocationOrder,
  preOrder,
} from '@server/database/schema';
import { eq, and, count, desc, or, ilike, gt, sql, inArray } from 'drizzle-orm';
import type { Style, Sku, StyleCreateAutoRequest } from '@shared/api.interface';
import { CodeRuleService } from '../../system/code-rule/code-rule.service';
import { escapeLike } from '@server/common/utils/escape-like';

type StyleInsert = typeof style.$inferInsert;
type SkuInsert = typeof sku.$inferInsert;

/** 款号批量导入单行（来自 Excel 解析），用于「商品资料-批量导入」审核入库 */
export interface StyleImportItem {
  styleNo: string;
  name: string;
  colorGroupCode: string;
  sizeGroupCode: string;
  category?: string | null;
  season?: string | null;
  brand?: string | null;
  wave?: string | null;
  year?: string | null;
  fit?: string | null;
  subCategory?: string | null;
  tagPrice?: number | null;
  costPrice?: number | null;
  supplyPrice?: number | null;
  status?: string | null;
  remark?: string | null;
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

function styleRowToDto(row: typeof style.$inferSelect): Style {
    return {
    id: row.id,
    styleNo: row.styleNo,
    name: row.name,
    category: row.category ?? undefined,
    subCategory: row.subCategory ?? undefined,
    season: row.season ?? undefined,
    year: row.year ?? undefined,
    fit: row.fit ?? undefined,
    brand: row.brand ?? undefined,
    wave: row.wave ?? undefined,
    tagPrice: Number(row.tagPrice ?? 0),
    costPrice: Number(row.costPrice ?? 0),
    supplyPrice: Number(row.supplyPrice ?? 0),
    colorGroupId: row.colorGroupId,
    sizeGroupId: row.sizeGroupId,
    codeRuleId: row.codeRuleId ?? undefined,
    status: row.status,
      remark: row.remark ?? undefined,
      createdAt: row.createdAt.toISOString(),
      attributes: (row.attributes as Record<string, string>) ?? {},
    };
}

@Injectable()
export class StyleService {
  private readonly logger = new Logger(StyleService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(forwardRef(() => CodeRuleService)) private readonly codeRuleService: CodeRuleService,
  ) {}

  async list(
    page: number,
    pageSize: number,
    keyword?: string,
    category?: string,
    brand?: string,
    status?: string,
  ): Promise<{ items: Style[]; total: number; page: number; pageSize: number }> {
    const conditions = [];
    if (keyword) {
      const escaped: string = escapeLike(keyword);
      conditions.push(or(ilike(style.styleNo, `%${escaped}%`), ilike(style.name, `%${escaped}%`)));
    }
    if (category) conditions.push(eq(style.category, category));
    if (brand) conditions.push(eq(style.brand, brand));
    if (status) conditions.push(eq(style.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult, rows] = await Promise.all([
      this.db.select({ count: count() }).from(style).where(where as any),
      this.db.select()
        .from(style)
        .where(where as any)
        .orderBy(desc(style.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);

    const total = Number(countResult[0]?.count ?? 0);
    const items: Style[] = rows.map((row) => styleRowToDto(row));
    return { items, total, page, pageSize };
  }

  async detail(id: string): Promise<Style & { skus: Sku[] }> {
    const styleRows = await this.db.select().from(style).where(eq(style.id, id));
    if (styleRows.length === 0) throw new NotFoundException('款号不存在');
    const styleDto = styleRowToDto(styleRows[0]);

    const skuRows = await this.db.select().from(sku).where(eq(sku.styleId, id)).orderBy(sku.color, sku.size);
    const skus: Sku[] = skuRows.map((row) => skuRowToDto(row));

    return { ...styleDto, skus };
  }

  async createAuto(dto: StyleCreateAutoRequest): Promise<Style & { skus: Sku[] }> {
    if (!dto.name?.trim()) throw new BadRequestException('款号名称不能为空');
    if (!dto.year) throw new BadRequestException('年份不能为空');
    if (!dto.season) throw new BadRequestException('季节不能为空');
    if (!dto.category) throw new BadRequestException('商品大类不能为空');
    if (!dto.subCategory) throw new BadRequestException('商品小类不能为空');
    if (!dto.fit) throw new BadRequestException('版型不能为空');
    if (!dto.colorGroupId) throw new BadRequestException('颜色组不能为空');
    if (!dto.sizeGroupId) throw new BadRequestException('尺码组不能为空');

    // 生成款号
    const preview = await this.codeRuleService.generateStyleCode({
      year: dto.year,
      season: dto.season,
      brand: dto.brand,
      category: dto.category,
      subCategory: dto.subCategory,
      fit: dto.fit,
      ruleId: dto.codeRuleId,
    });
    const styleNo = preview.styleNo;

    // Check unique styleNo
    const existingStyle = await this.db.select().from(style).where(eq(style.styleNo, styleNo));
    if (existingStyle.length > 0) throw new ConflictException('款号已存在');

    // Fetch color group and size group
    const cgRows = await this.db.select().from(colorGroup).where(eq(colorGroup.id, dto.colorGroupId));
    if (cgRows.length === 0) throw new BadRequestException('颜色组不存在');
    const colors = cgRows[0].colors as { name: string; value: string }[];
    if (colors.length === 0) throw new BadRequestException('颜色组为空，无法生成SKU');

    const sgRows = await this.db.select().from(sizeGroup).where(eq(sizeGroup.id, dto.sizeGroupId));
    if (sgRows.length === 0) throw new BadRequestException('尺码组不存在');
    const sizes = sgRows[0].sizes as string[];
    if (sizes.length === 0) throw new BadRequestException('尺码组为空，无法生成SKU');

    // 获取颜色和尺码编码映射
    const mapping = await this.codeRuleService.getMappingConfig();
    const colorCodeMap = new Map(mapping.colors.map((c) => [c.name, c.code]));
    const sizeCodeMap = new Map(mapping.sizes.map((s) => [s.name, s.code]));

    const skuPrices = dto.skus || [];

    const createdStyle = await this.db.transaction(async (tx) => {
       const styleValues: StyleInsert = {
         styleNo,
         name: dto.name,
         year: dto.year,
         season: dto.season,
         brand: dto.brand ?? null,
         category: dto.category,
         subCategory: dto.subCategory,
         fit: dto.fit,
         wave: dto.wave ?? null,
         tagPrice: dto.tagPrice !== undefined ? String(dto.tagPrice) : '0',
         costPrice: dto.costPrice !== undefined ? String(dto.costPrice) : '0',
         supplyPrice: dto.supplyPrice !== undefined ? String(dto.supplyPrice) : '0',
         colorGroupId: dto.colorGroupId,
         sizeGroupId: dto.sizeGroupId,
         codeRuleId: dto.codeRuleId ?? null,
          status: 'active',
          remark: dto.remark ?? null,
          attributes: dto.attributes ?? {} as any,
        };

      const inserted = await tx.insert(style).values(styleValues).returning();
      const newStyle = inserted[0];

      // 自动生成 SKU: 款号 + 颜色码 + 尺码码
      const skuCodes: string[] = [];
      const skuInserts: SkuInsert[] = [];
      let priceIndex = 0;

      for (const color of colors) {
        const colorCode = colorCodeMap.get(color.name) || color.name.toUpperCase().slice(0, 3);
        for (const size of sizes) {
          const sizeCode = sizeCodeMap.get(size) || size;
          const skuCode = `${styleNo}-${colorCode}-${sizeCode}`;
          if (skuCodes.includes(skuCode)) {
            throw new ConflictException(`SKU编码重复: ${skuCode}`);
          }
          skuCodes.push(skuCode);

          const price = skuPrices[priceIndex];
          priceIndex += 1;

          skuInserts.push({
            skuCode,
            styleId: newStyle.id,
            styleNo: newStyle.styleNo,
            color: color.name,
            size,
            barcode: skuCode,
            costPrice: price?.costPrice !== undefined ? String(price.costPrice) : newStyle.costPrice,
            tagPrice: price?.tagPrice !== undefined ? String(price.tagPrice) : newStyle.tagPrice,
            supplyPrice: price?.supplyPrice !== undefined ? String(price.supplyPrice) : newStyle.supplyPrice,
            safetyStockMin: '0',
            safetyStockMax: '0',
            status: 'active',
          });
        }
      }

      if (skuInserts.length > 0) {
        await tx.insert(sku).values(skuInserts);
      }

      return newStyle;
    });

    const styleDto = styleRowToDto(createdStyle);
    const skuRows = await this.db.select().from(sku).where(eq(sku.styleId, createdStyle.id)).orderBy(sku.color, sku.size);
    const skus: Sku[] = skuRows.map((row) => skuRowToDto(row));

    return { ...styleDto, skus };
  }

  async create(dto: {
    styleNo: string;
    name: string;
    category?: string;
    season?: string;
    brand?: string;
    wave?: string;
    tagPrice?: number;
    costPrice?: number;
    supplyPrice?: number;
    colorGroupId: string;
    sizeGroupId: string;
    status?: string;
    remark?: string;
    attributes?: Record<string, string>;
    codeRuleId?: string;
  }): Promise<Style & { skus: Sku[] }> {
    if (!dto.styleNo?.trim()) throw new BadRequestException('款号不能为空');
    if (!dto.name?.trim()) throw new BadRequestException('名称不能为空');
    if (!dto.colorGroupId) throw new BadRequestException('颜色组不能为空');
    if (!dto.sizeGroupId) throw new BadRequestException('尺码组不能为空');

    // Check unique styleNo
    const existingStyle = await this.db.select().from(style).where(eq(style.styleNo, dto.styleNo));
    if (existingStyle.length > 0) throw new ConflictException('款号已存在');

    // Fetch color group and size group
    const cgRows = await this.db.select().from(colorGroup).where(eq(colorGroup.id, dto.colorGroupId));
    if (cgRows.length === 0) throw new BadRequestException('颜色组不存在');
    const colors = cgRows[0].colors as { name: string; value: string }[];
    if (colors.length === 0) throw new BadRequestException('颜色组为空，无法生成SKU');

    const sgRows = await this.db.select().from(sizeGroup).where(eq(sizeGroup.id, dto.sizeGroupId));
    if (sgRows.length === 0) throw new BadRequestException('尺码组不存在');
    const sizes = sgRows[0].sizes as string[];
    if (sizes.length === 0) throw new BadRequestException('尺码组为空，无法生成SKU');

    const createdStyle = await this.db.transaction(async (tx) => {
       const styleValues: StyleInsert = {
         styleNo: dto.styleNo,
         name: dto.name,
         category: dto.category ?? null,
         season: dto.season ?? null,
         brand: dto.brand ?? null,
         wave: dto.wave ?? null,
         tagPrice: dto.tagPrice !== undefined ? String(dto.tagPrice) : '0',
         costPrice: dto.costPrice !== undefined ? String(dto.costPrice) : '0',
         supplyPrice: dto.supplyPrice !== undefined ? String(dto.supplyPrice) : '0',
         colorGroupId: dto.colorGroupId,
         sizeGroupId: dto.sizeGroupId,
         codeRuleId: dto.codeRuleId ?? null,
          status: dto.status ?? 'active',
          remark: dto.remark ?? null,
          attributes: dto.attributes ?? {} as any,
        };

      const inserted = await tx.insert(style).values(styleValues).returning();
      const newStyle = inserted[0];

      // Generate SKU matrix
      const skuCodes: string[] = [];
      const skuInserts: SkuInsert[] = [];
      for (const color of colors) {
        for (const size of sizes) {
          const skuCode = `${dto.styleNo}-${color.value}-${size}`;
          if (skuCodes.includes(skuCode)) {
            throw new ConflictException(`SKU编码重复: ${skuCode}`);
          }
          skuCodes.push(skuCode);
          skuInserts.push({
            skuCode,
            styleId: newStyle.id,
            styleNo: newStyle.styleNo,
            color: color.name,
            size,
            costPrice: newStyle.costPrice,
            tagPrice: newStyle.tagPrice,
            supplyPrice: newStyle.supplyPrice,
            safetyStockMin: '0',
            safetyStockMax: '0',
            status: dto.status ?? 'active',
          });
        }
      }

      // Pre-check global SKU uniqueness
      if (skuInserts.length > 0) {
        const existingSku = await tx.select({ skuCode: sku.skuCode })
          .from(sku)
          .where(eq(sku.styleId, newStyle.id));
        if (existingSku.length > 0) {
          throw new ConflictException('款号下已存在SKU');
        }
        await tx.insert(sku).values(skuInserts);
      }

      return newStyle;
    });

    const styleDto = styleRowToDto(createdStyle);
    const skuRows = await this.db.select().from(sku).where(eq(sku.styleId, createdStyle.id)).orderBy(sku.color, sku.size);
    const skus: Sku[] = skuRows.map((row) => skuRowToDto(row));

    return { ...styleDto, skus };
  }

  /** 批量导入款号（仅建 style 头，不自动生成 SKU 矩阵；按 styleNo 跳过已存在）。
   *  用于「商品资料-批量导入」审核入库阶段；前端须先经 ProductImportService 校验。 */
  async bulkImportStyle(items: StyleImportItem[]): Promise<{
    total: number;
    inserted: number;
    skipped: number;
    errors: { index: number; styleNo?: string; reason: string }[];
  }> {
    const errors: { index: number; styleNo?: string; reason: string }[] = [];
    if (items.length === 0) {
      return { total: 0, inserted: 0, skipped: 0, errors: [] };
    }

    // 批量解析色组 / 尺码组编码 → id
    const cgCodes = [...new Set(items.map((i) => i.colorGroupCode).filter(Boolean))] as string[];
    const sgCodes = [...new Set(items.map((i) => i.sizeGroupCode).filter(Boolean))] as string[];
    const [cgRows, sgRows] = await Promise.all([
      cgCodes.length
        ? this.db.select({ id: colorGroup.id, code: colorGroup.code }).from(colorGroup).where(inArray(colorGroup.code, cgCodes))
        : Promise.resolve([]),
      sgCodes.length
        ? this.db.select({ id: sizeGroup.id, code: sizeGroup.code }).from(sizeGroup).where(inArray(sizeGroup.code, sgCodes))
        : Promise.resolve([]),
    ]);
    const cgMap = new Map(cgRows.map((r) => [r.code, r.id]));
    const sgMap = new Map(sgRows.map((r) => [r.code, r.id]));

    // 已存在的款号（按 styleNo）
    const styleNos = items.map((i) => i.styleNo);
    const existingRows = await this.db.select({ styleNo: style.styleNo }).from(style).where(inArray(style.styleNo, styleNos));
    const existingSet = new Set(existingRows.map((r) => r.styleNo));

    const seen = new Set<string>();
    const toInsert: StyleInsert[] = [];
    let skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (existingSet.has(it.styleNo)) {
        skipped += 1;
        continue;
      }
      if (seen.has(it.styleNo)) {
        errors.push({ index: i, styleNo: it.styleNo, reason: '批内款号重复' });
        continue;
      }
      const colorGroupId = cgMap.get(it.colorGroupCode);
      if (!colorGroupId) {
        errors.push({ index: i, styleNo: it.styleNo, reason: `色组编码不存在: ${it.colorGroupCode}` });
        continue;
      }
      const sizeGroupId = sgMap.get(it.sizeGroupCode);
      if (!sizeGroupId) {
        errors.push({ index: i, styleNo: it.styleNo, reason: `尺码组编码不存在: ${it.sizeGroupCode}` });
        continue;
      }
      seen.add(it.styleNo);
      toInsert.push({
        styleNo: it.styleNo,
        name: it.name,
        colorGroupId,
        sizeGroupId,
        category: it.category ?? null,
        season: it.season ?? null,
        brand: it.brand ?? null,
        wave: it.wave ?? null,
        year: it.year ?? null,
        fit: it.fit ?? null,
        subCategory: it.subCategory ?? null,
        tagPrice: it.tagPrice !== undefined && it.tagPrice !== null ? String(it.tagPrice) : '0',
        costPrice: it.costPrice !== undefined && it.costPrice !== null ? String(it.costPrice) : '0',
        supplyPrice: it.supplyPrice !== undefined && it.supplyPrice !== null ? String(it.supplyPrice) : '0',
        codeRuleId: null,
        status: it.status ?? 'active',
        remark: it.remark ?? null,
        attributes: {} as any,
      });
    }

    if (toInsert.length > 0) {
      // 分批插入（每批 500）避免超长 SQL
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        await this.db.insert(style).values(toInsert.slice(i, i + BATCH));
      }
    }

    return { total: items.length, inserted: toInsert.length, skipped, errors };
  }

  async update(
    id: string,
    dto: {
      styleNo?: string;
      name?: string;
      category?: string | null;
      season?: string | null;
      brand?: string | null;
      wave?: string | null;
      tagPrice?: number;
      costPrice?: number;
      supplyPrice?: number;
      colorGroupId?: string;
      sizeGroupId?: string;
      status?: string;
      remark?: string | null;
      attributes?: Record<string, string> | null;
      codeRuleId?: string | null;
    },
  ): Promise<Style> {
    const patch: Partial<StyleInsert> = {};
    if (dto.styleNo !== undefined) {
      if (!dto.styleNo.trim()) throw new BadRequestException('款号不能为空');
      patch.styleNo = dto.styleNo;
    }
    if (dto.name !== undefined) {
      if (!dto.name.trim()) throw new BadRequestException('名称不能为空');
      patch.name = dto.name;
    }
    if (dto.category !== undefined) patch.category = dto.category ?? null;
    if (dto.season !== undefined) patch.season = dto.season ?? null;
    if (dto.brand !== undefined) patch.brand = dto.brand ?? null;
    if (dto.wave !== undefined) patch.wave = dto.wave ?? null;
    if (dto.tagPrice !== undefined) patch.tagPrice = String(dto.tagPrice);
    if (dto.costPrice !== undefined) patch.costPrice = String(dto.costPrice);
    if (dto.supplyPrice !== undefined) patch.supplyPrice = String(dto.supplyPrice);
    if (dto.colorGroupId !== undefined) patch.colorGroupId = dto.colorGroupId;
    if (dto.sizeGroupId !== undefined) patch.sizeGroupId = dto.sizeGroupId;
    if (dto.codeRuleId !== undefined) patch.codeRuleId = dto.codeRuleId ?? null;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.remark !== undefined) patch.remark = dto.remark ?? null;
    if (dto.attributes !== undefined) patch.attributes = dto.attributes as any;

    if (Object.keys(patch).length === 0) throw new BadRequestException('未提供可更新字段');

    patch.updatedAt = new Date();

    const updated = await this.db.update(style).set(patch).where(eq(style.id, id)).returning();
    if (updated.length === 0) throw new NotFoundException('款号不存在');
    return styleRowToDto(updated[0]);
  }

  async remove(id: string): Promise<void> {
    // 先查款号是否存在并获取 styleNo
    const styleRows = await this.db
      .select({ id: style.id, styleNo: style.styleNo })
      .from(style)
      .where(eq(style.id, id));
    if (styleRows.length === 0) throw new NotFoundException('款号不存在');
    const styleNo = styleRows[0].styleNo;

    // 引用检查
    const [
      skuCount,
      bomCount,
      gpoSkuCount,
      gpiSkuCount,
      gprSkuCount,
      soItemCount,
      soOutboundCount,
      srItemCount,
      stockCount,
      flowCount,
      allocCount,
      preOrderCount,
    ] = await Promise.all([
      this.db.select({ count: count() }).from(sku).where(eq(sku.styleId, id)),
      this.db.select({ count: count() }).from(bom).where(eq(bom.styleId, id)),
      this.db.select({ count: count() }).from(garmentPurchaseOrderSku).where(eq(garmentPurchaseOrderSku.styleId, id)),
      this.db.select({ count: count() }).from(garmentPurchaseInboundSku).where(eq(garmentPurchaseInboundSku.styleId, id)),
      this.db.select({ count: count() }).from(garmentPurchaseReturnSku).where(eq(garmentPurchaseReturnSku.styleId, id)),
      this.db.select({ count: count() }).from(salesOrderItem).where(eq(salesOrderItem.styleNo, styleNo)),
      this.db.select({ count: count() }).from(salesOutboundItem).where(eq(salesOutboundItem.styleNo, styleNo)),
      this.db.select({ count: count() }).from(salesReturnItem).where(eq(salesReturnItem.styleNo, styleNo)),
      this.db.select({ count: count() }).from(inventoryStock).where(eq(inventoryStock.styleNo, styleNo)),
      this.db.select({ count: count() }).from(inventoryFlow).where(eq(inventoryFlow.styleNo, styleNo)),
      this.db.select({ count: count() }).from(allocationOrder).where(eq(allocationOrder.styleId, id)),
      this.db.select({ count: count() }).from(preOrder).where(eq(preOrder.styleId, id)),
    ]);

    const hasReference = [
      skuCount[0]?.count,
      bomCount[0]?.count,
      gpoSkuCount[0]?.count,
      gpiSkuCount[0]?.count,
      gprSkuCount[0]?.count,
      soItemCount[0]?.count,
      soOutboundCount[0]?.count,
      srItemCount[0]?.count,
      stockCount[0]?.count,
      flowCount[0]?.count,
      allocCount[0]?.count,
      preOrderCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    // SKU 不算业务引用，只是款号的子表。业务引用排除 SKU 后判断
    const hasBizReference = [
      bomCount[0]?.count,
      gpoSkuCount[0]?.count,
      gpiSkuCount[0]?.count,
      gprSkuCount[0]?.count,
      soItemCount[0]?.count,
      soOutboundCount[0]?.count,
      srItemCount[0]?.count,
      stockCount[0]?.count,
      flowCount[0]?.count,
      allocCount[0]?.count,
      preOrderCount[0]?.count,
    ].some((c) => Number(c ?? 0) > 0);

    if (hasBizReference) {
      // 有业务引用，软删除：status 改为 disabled（含 SKU 也停用）
      await this.db.transaction(async (tx) => {
        await tx.update(sku).set({ status: 'disabled', updatedAt: new Date() })
          .where(eq(sku.styleId, id));
        const result = await tx.update(style)
          .set({ status: 'disabled', updatedAt: new Date() })
          .where(eq(style.id, id))
          .returning({ id: style.id });
        if (result.length === 0) throw new NotFoundException('款号不存在');
      });
      return;
    }

    // 无业务引用，硬删除（级联删 SKU）
    await this.db.transaction(async (tx) => {
      await tx.delete(sku).where(eq(sku.styleId, id));
      const result = await tx.delete(style).where(eq(style.id, id)).returning({ id: style.id });
      if (result.length === 0) throw new NotFoundException('款号不存在');
    });
  }

  async options(): Promise<{ id: string; styleNo: string; name: string }[]> {
    const rows = await this.db.select({ id: style.id, styleNo: style.styleNo, name: style.name })
      .from(style)
      .where(eq(style.status, 'active'))
      .orderBy(style.styleNo);
    return rows.map((row) => ({ id: row.id, styleNo: row.styleNo, name: row.name }));
  }
}
