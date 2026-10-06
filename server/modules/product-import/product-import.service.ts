import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import {
  productImportTask,
  style,
  sku,
  colorGroup,
  sizeGroup,
  color,
  size,
} from '@server/database/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { RequestContext } from '@server/common/context/request-context';
import { StyleService, type StyleImportItem } from '../base/style/style.service';
import { SkuService, type SkuImportItem } from '../base/sku/sku.service';

export type RowStatusValue = 'ok' | 'existed' | 'unsupported' | 'missing_master';

export interface ImportRowResult {
  rowIndex: number;
  raw: Record<string, any>;
  status: RowStatusValue;
  reason?: string;
}

export interface ValidateResult {
  importType: 'style' | 'sku';
  total: number;
  ok: number;
  existed: number;
  unsupported: number;
  missingMasterData: number;
  rows: ImportRowResult[];
}

export interface ProductImportSummary {
  total: number;
  ok: number;
  existed: number;
  unsupported: number;
  missingMasterData: number;
  inserted: number;
  skipped: number;
}

export interface ProductImportTaskView {
  id: string;
  importType: string;
  status: string;
  fileName?: string | null;
  fileUrl?: string | null;
  totalRows: number;
  summary: ProductImportSummary;
  rows: ImportRowResult[];
  createdAt: string;
  createdBy?: string | null;
}

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: any): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toStrTrim(v: any): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

@Injectable()
export class ProductImportService {
  private readonly logger = new Logger(ProductImportService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    private readonly styleService: StyleService,
    private readonly skuService: SkuService,
  ) {}

  /** 校验一批导入数据，返回逐行状态清单（不写库）。
   *  款号：必填+色组/尺码组编码解析+款号已存在检测；
   *  SKU：必填+款号/颜色/尺码主数据存在性+SKU 已存在检测。 */
  async validate(importType: 'style' | 'sku', rows: Record<string, any>[]): Promise<ValidateResult> {
    const safeRows = Array.isArray(rows) ? rows : [];
    const result: ValidateResult = {
      importType,
      total: safeRows.length,
      ok: 0,
      existed: 0,
      unsupported: 0,
      missingMasterData: 0,
      rows: [],
    };

    if (importType === 'style') {
      await this.validateStyle(safeRows, result);
    } else {
      await this.validateSku(safeRows, result);
    }
    return result;
  }

  private async validateStyle(rows: Record<string, any>[], result: ValidateResult): Promise<void> {
    const cgCodes = [...new Set(rows.map((r) => toStrTrim(r.colorGroupCode)).filter(Boolean))];
    const sgCodes = [...new Set(rows.map((r) => toStrTrim(r.sizeGroupCode)).filter(Boolean))];
    const [cgRows, sgRows] = await Promise.all([
      cgCodes.length
        ? this.db.select({ code: colorGroup.code }).from(colorGroup).where(inArray(colorGroup.code, cgCodes))
        : Promise.resolve([]),
      sgCodes.length
        ? this.db.select({ code: sizeGroup.code }).from(sizeGroup).where(inArray(sizeGroup.code, sgCodes))
        : Promise.resolve([]),
    ]);
    const cgSet = new Set(cgRows.map((r) => r.code));
    const sgSet = new Set(sgRows.map((r) => r.code));

    const styleNos = [...new Set(rows.map((r) => toStrTrim(r.styleNo)).filter(Boolean))];
    const existingRows = styleNos.length
      ? await this.db.select({ styleNo: style.styleNo }).from(style).where(inArray(style.styleNo, styleNos))
      : [];
    const existingSet = new Set(existingRows.map((r) => r.styleNo));

    rows.forEach((raw, i) => {
      const styleNo = toStrTrim(raw.styleNo);
      const name = toStrTrim(raw.name);
      const cgCode = toStrTrim(raw.colorGroupCode);
      const sgCode = toStrTrim(raw.sizeGroupCode);
      if (!styleNo || !name || !cgCode || !sgCode) {
        result.unsupported += 1;
        result.rows.push({ rowIndex: i, raw, status: 'unsupported', reason: '必填项缺失(款号/名称/色组编码/尺码组编码)' });
        return;
      }
      if (!cgSet.has(cgCode)) {
        result.unsupported += 1;
        result.rows.push({ rowIndex: i, raw, status: 'unsupported', reason: `色组编码不存在: ${cgCode}` });
        return;
      }
      if (!sgSet.has(sgCode)) {
        result.unsupported += 1;
        result.rows.push({ rowIndex: i, raw, status: 'unsupported', reason: `尺码组编码不存在: ${sgCode}` });
        return;
      }
      if (existingSet.has(styleNo)) {
        result.existed += 1;
        result.rows.push({ rowIndex: i, raw, status: 'existed', reason: `款号已存在: ${styleNo}` });
        return;
      }
      result.ok += 1;
      result.rows.push({ rowIndex: i, raw, status: 'ok' });
    });
  }

  private async validateSku(rows: Record<string, any>[], result: ValidateResult): Promise<void> {
    const styleNos = [...new Set(rows.map((r) => toStrTrim(r.styleNo)).filter(Boolean))];
    const colorNames = [...new Set(rows.map((r) => toStrTrim(r.color)).filter(Boolean))];
    const sizeNames = [...new Set(rows.map((r) => toStrTrim(r.size)).filter(Boolean))];
    const skuCodes = [...new Set(rows.map((r) => toStrTrim(r.skuCode)).filter(Boolean))];

    const [styleRows, colorRows, sizeRows, skuRows] = await Promise.all([
      styleNos.length
        ? this.db.select({ styleNo: style.styleNo }).from(style).where(inArray(style.styleNo, styleNos))
        : Promise.resolve([]),
      colorNames.length
        ? this.db.select({ name: color.name }).from(color).where(inArray(color.name, colorNames))
        : Promise.resolve([]),
      sizeNames.length
        ? this.db.select({ name: size.name }).from(size).where(inArray(size.name, sizeNames))
        : Promise.resolve([]),
      skuCodes.length
        ? this.db.select({ skuCode: sku.skuCode }).from(sku).where(inArray(sku.skuCode, skuCodes))
        : Promise.resolve([]),
    ]);
    const styleSet = new Set(styleRows.map((r) => r.styleNo));
    const colorSet = new Set(colorRows.map((r) => r.name));
    const sizeSet = new Set(sizeRows.map((r) => r.name));
    const skuSet = new Set(skuRows.map((r) => r.skuCode));

    rows.forEach((raw, i) => {
      const skuCode = toStrTrim(raw.skuCode);
      const styleNo = toStrTrim(raw.styleNo);
      const c = toStrTrim(raw.color);
      const s = toStrTrim(raw.size);
      if (!skuCode || !styleNo || !c || !s) {
        result.unsupported += 1;
        result.rows.push({ rowIndex: i, raw, status: 'unsupported', reason: '必填项缺失(skuCode/款号/颜色/尺码)' });
        return;
      }
      if (skuSet.has(skuCode)) {
        result.existed += 1;
        result.rows.push({ rowIndex: i, raw, status: 'existed', reason: `SKU编码已存在: ${skuCode}` });
        return;
      }
      if (!styleSet.has(styleNo)) {
        result.missingMasterData += 1;
        result.rows.push({ rowIndex: i, raw, status: 'missing_master', reason: `款号不存在: ${styleNo}` });
        return;
      }
      if (!colorSet.has(c)) {
        result.missingMasterData += 1;
        result.rows.push({ rowIndex: i, raw, status: 'missing_master', reason: `颜色不存在: ${c}` });
        return;
      }
      if (!sizeSet.has(s)) {
        result.missingMasterData += 1;
        result.rows.push({ rowIndex: i, raw, status: 'missing_master', reason: `尺码不存在: ${s}` });
        return;
      }
      result.ok += 1;
      result.rows.push({ rowIndex: i, raw, status: 'ok' });
    });
  }

  /** 建立草稿：复用校验结果记录逐行状态；同类型已存在的 draft 置为 superseded（覆盖语义）。 */
  async createDraft(dto: {
    importType: 'style' | 'sku';
    fileName?: string;
    fileUrl?: string;
    filePath?: string;
    bucketId?: string;
    rows: Record<string, any>[];
  }): Promise<ProductImportTaskView> {
    const result = await this.validate(dto.importType, dto.rows);
    const taskRows = result.rows.map((r) => ({
      rowIndex: r.rowIndex,
      raw: r.raw,
      status: r.status,
      reason: r.reason ?? null,
    }));
    const summary: ProductImportSummary = {
      total: result.total,
      ok: result.ok,
      existed: result.existed,
      unsupported: result.unsupported,
      missingMasterData: result.missingMasterData,
      inserted: 0,
      skipped: 0,
    };
    const userId = RequestContext.getUserId() ?? null;

    // 覆盖语义：同类型旧草稿置为 superseded
    await this.db
      .update(productImportTask)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(and(eq(productImportTask.importType, dto.importType), eq(productImportTask.status, 'draft')));

    const [inserted] = await this.db
      .insert(productImportTask)
      .values({
        importType: dto.importType,
        status: 'draft',
        fileName: toStr(dto.fileName),
        fileUrl: toStr(dto.fileUrl),
        filePath: toStr(dto.filePath),
        bucketId: toStr(dto.bucketId),
        totalRows: result.total,
        summary,
        rows: taskRows,
        createdBy: userId,
      })
      .returning({ id: productImportTask.id });

    return this.getTask(inserted.id);
  }

  async listTasks(importType?: string): Promise<ProductImportTaskView[]> {
    const where = importType ? eq(productImportTask.importType, importType) : undefined;
    const rows = await this.db
      .select()
      .from(productImportTask)
      .where(where as any)
      .orderBy(desc(productImportTask.createdAt));
    return rows.map((r) => this.toView(r));
  }

  async getTask(id: string): Promise<ProductImportTaskView> {
    const rows = await this.db.select().from(productImportTask).where(eq(productImportTask.id, id));
    if (rows.length === 0) throw new NotFoundException('导入任务不存在');
    return this.toView(rows[0]);
  }

  /** 审核：复校后仅将 ok 行批量写入商品库（仅新增、跳过已存在），任务置 approved。 */
  async approve(id: string): Promise<ProductImportTaskView> {
    const task = await this.getTask(id);
    if (task.status !== 'draft') {
      throw new BadRequestException(`任务状态为 ${task.status}，无法审核（仅 draft 可审核）`);
    }
    const okRows = (task.rows as ImportRowResult[]).filter((r) => r.status === 'ok');

    let writeResult: { inserted: number; skipped: number };
    if (task.importType === 'style') {
      const items: StyleImportItem[] = okRows.map((r) => this.mapStyleRow(r.raw));
      const res = await this.styleService.bulkImportStyle(items);
      writeResult = { inserted: res.inserted, skipped: res.skipped };
    } else {
      const items: SkuImportItem[] = okRows.map((r) => this.mapSkuRow(r.raw));
      const res = await this.skuService.bulkImport(items);
      writeResult = { inserted: res.inserted, skipped: res.skipped };
    }

    const newSummary: ProductImportSummary = {
      ...task.summary,
      inserted: writeResult.inserted,
      skipped: writeResult.skipped,
    };

    await this.db
      .update(productImportTask)
      .set({ status: 'approved', summary: newSummary, updatedAt: new Date() })
      .where(eq(productImportTask.id, id));

    return this.getTask(id);
  }

  private mapStyleRow(raw: Record<string, any>): StyleImportItem {
    return {
      styleNo: toStrTrim(raw.styleNo),
      name: toStrTrim(raw.name),
      colorGroupCode: toStrTrim(raw.colorGroupCode),
      sizeGroupCode: toStrTrim(raw.sizeGroupCode),
      category: toStr(raw.category),
      season: toStr(raw.season),
      brand: toStr(raw.brand),
      wave: toStr(raw.wave),
      year: toStr(raw.year),
      fit: toStr(raw.fit),
      subCategory: toStr(raw.subCategory),
      tagPrice: toNum(raw.tagPrice),
      costPrice: toNum(raw.costPrice),
      supplyPrice: toNum(raw.supplyPrice),
      status: toStr(raw.status),
      remark: toStr(raw.remark),
    };
  }

  private mapSkuRow(raw: Record<string, any>): SkuImportItem {
    return {
      skuCode: toStrTrim(raw.skuCode),
      styleNo: toStrTrim(raw.styleNo),
      color: toStrTrim(raw.color),
      size: toStrTrim(raw.size),
      barcode: toStr(raw.barcode),
      costPrice: toNum(raw.costPrice) ?? undefined,
      tagPrice: toNum(raw.tagPrice) ?? undefined,
      supplyPrice: toNum(raw.supplyPrice) ?? undefined,
      safetyStockMin: toNum(raw.safetyStockMin) ?? undefined,
      safetyStockMax: toNum(raw.safetyStockMax) ?? undefined,
      status: toStr(raw.status) ?? undefined,
    };
  }

  private toView(row: any): ProductImportTaskView {
    return {
      id: row.id,
      importType: row.importType,
      status: row.status,
      fileName: row.fileName ?? null,
      fileUrl: row.fileUrl ?? null,
      totalRows: Number(row.totalRows ?? 0),
      summary: (row.summary as ProductImportSummary) ?? {
        total: 0,
        ok: 0,
        existed: 0,
        unsupported: 0,
        missingMasterData: 0,
        inserted: 0,
        skipped: 0,
      },
      rows: (row.rows as ImportRowResult[]) ?? [],
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      createdBy: row.createdBy ?? null,
    };
  }
}
