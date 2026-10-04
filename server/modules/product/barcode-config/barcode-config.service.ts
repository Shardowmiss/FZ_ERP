import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { styleBarcodeConfig, styleBarcode, style, sizeGroup } from '@server/database/schema';
import { eq, inArray } from 'drizzle-orm';
import type {
  StyleBarcodeConfigDto,
  StyleBarcodeConfigSaveRequest,
  StyleBarcodeDto,
  StyleBarcodeGenerateRequest,
  StyleBarcodeGenerateResult,
} from '@shared/api.interface';

type ConfigRow = typeof styleBarcodeConfig.$inferSelect;
type BarcodeRow = typeof styleBarcode.$inferSelect;

function configRowToDto(row: ConfigRow): StyleBarcodeConfigDto {
  return {
    id: row.id,
    styleId: row.styleId,
    colors: (row.colors as Array<{ name: string; value?: string }>) ?? [],
    sizeGroupIds: (row.sizeGroupIds as string[]) ?? [],
    barcodePrefix: row.barcodePrefix ?? undefined,
    status: row.status,
    remark: row.remark ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function barcodeRowToDto(row: BarcodeRow): StyleBarcodeDto {
  return {
    id: row.id,
    configId: row.configId,
    styleId: row.styleId,
    colorName: row.colorName,
    colorValue: row.colorValue ?? undefined,
    size: row.size,
    sizeGroupId: row.sizeGroupId ?? undefined,
    barcode: row.barcode,
    enabled: row.enabled,
  };
}

@Injectable()
export class BarcodeConfigService {
  private readonly logger = new Logger(BarcodeConfigService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  /** 按款号获取条形码配置及已生成条码矩阵 */
  async getByStyle(
    styleId: string,
  ): Promise<{ config: StyleBarcodeConfigDto | null; barcodes: StyleBarcodeDto[] }> {
    const configRows = await this.db
      .select()
      .from(styleBarcodeConfig)
      .where(eq(styleBarcodeConfig.styleId, styleId))
      .limit(1);
    if (configRows.length === 0) {
      return { config: null, barcodes: [] };
    }
    const config = configRowToDto(configRows[0]);
    const barcodeRows = await this.db
      .select()
      .from(styleBarcode)
      .where(eq(styleBarcode.configId, config.id))
      .orderBy(styleBarcode.colorName, styleBarcode.size);
    return { config, barcodes: barcodeRows.map(barcodeRowToDto) };
  }

  /** 保存（按款号 upsert）条形码配置 */
  async save(req: StyleBarcodeConfigSaveRequest): Promise<StyleBarcodeConfigDto> {
    if (!req.styleId) throw new BadRequestException('款号不能为空');
    if (!req.colors || req.colors.length === 0) throw new BadRequestException('颜色列表不能为空');
    if (!req.sizeGroupIds || req.sizeGroupIds.length === 0) throw new BadRequestException('尺码组不能为空');

    const styleRows = await this.db
      .select({ id: style.id, styleNo: style.styleNo })
      .from(style)
      .where(eq(style.id, req.styleId))
      .limit(1);
    if (styleRows.length === 0) throw new BadRequestException('款号不存在');

    const existing = await this.db
      .select()
      .from(styleBarcodeConfig)
      .where(eq(styleBarcodeConfig.styleId, req.styleId))
      .limit(1);

    let config: ConfigRow;
    if (existing.length > 0) {
      const updated = await this.db
        .update(styleBarcodeConfig)
        .set({
          colors: req.colors as any,
          sizeGroupIds: req.sizeGroupIds as any,
          barcodePrefix: req.barcodePrefix ?? null,
          remark: req.remark ?? null,
          updatedAt: new Date(),
        })
        .where(eq(styleBarcodeConfig.id, existing[0].id))
        .returning();
      config = updated[0];
    } else {
      const inserted = await this.db
        .insert(styleBarcodeConfig)
        .values({
          styleId: req.styleId,
          colors: req.colors as any,
          sizeGroupIds: req.sizeGroupIds as any,
          barcodePrefix: req.barcodePrefix ?? null,
          remark: req.remark ?? null,
        })
        .returning();
      config = inserted[0];
    }
    return configRowToDto(config);
  }

  /** 根据配置生成「颜色 × 尺码」条码矩阵（幂等：先清后插） */
  async generate(req: StyleBarcodeGenerateRequest): Promise<StyleBarcodeGenerateResult> {
    if (!req.styleId) throw new BadRequestException('款号不能为空');

    const configRows = await this.db
      .select()
      .from(styleBarcodeConfig)
      .where(eq(styleBarcodeConfig.styleId, req.styleId))
      .limit(1);
    if (configRows.length === 0) throw new BadRequestException('请先保存条形码配置');
    const config = configRows[0];

    const styleRows = await this.db
      .select({ styleNo: style.styleNo })
      .from(style)
      .where(eq(style.id, req.styleId))
      .limit(1);
    const styleNo = styleRows[0]?.styleNo ?? '';
    const prefix = config.barcodePrefix || styleNo;

    const colors = (config.colors as Array<{ name: string; value?: string }>) ?? [];
    const sizeGroupIds = (config.sizeGroupIds as string[]) ?? [];

    // 汇总所选尺码组内的尺码（按出现顺序去重，记录首个所属尺码组）
    const sizeMap = new Map<string, string | null>();
    if (sizeGroupIds.length > 0) {
      const sgRows = await this.db
        .select()
        .from(sizeGroup)
        .where(inArray(sizeGroup.id, sizeGroupIds));
      for (const sg of sgRows) {
        const sizes = (sg.sizes as string[]) ?? [];
        for (const s of sizes) {
          if (!sizeMap.has(s)) sizeMap.set(s, sg.id);
        }
      }
    }

    if (colors.length === 0 || sizeMap.size === 0) {
      return { generated: 0, barcodes: [] };
    }

    const toInsert: typeof styleBarcode.$inferInsert[] = [];
    for (const color of colors) {
      const colorCode =
        (color.value || color.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) ||
        color.name.toUpperCase().slice(0, 3);
      for (const [size, sgId] of sizeMap.entries()) {
        toInsert.push({
          configId: config.id,
          styleId: config.styleId,
          colorName: color.name,
          colorValue: color.value ?? null,
          size,
          sizeGroupId: sgId,
          barcode: `${prefix}-${colorCode}-${size}`,
          enabled: true,
        });
      }
    }

    const inserted = await this.db.transaction(async (tx) => {
      await tx.delete(styleBarcode).where(eq(styleBarcode.configId, config.id));
      if (toInsert.length === 0) return [];
      return tx.insert(styleBarcode).values(toInsert).returning();
    });

    return { generated: inserted.length, barcodes: inserted.map(barcodeRowToDto) };
  }
}
