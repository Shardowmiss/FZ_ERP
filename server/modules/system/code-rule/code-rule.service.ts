import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { codeRule, codeMappingConfig, style, styleAttribute, styleAttrDef, styleAttrValue } from '@server/database/schema';
import { eq, and, desc, sql, like, inArray } from 'drizzle-orm';
import type {
  CodeRule,
  CodeRuleSegment,
  CodeMappingConfig,
  YearCode,
  SeasonCode,
  BrandCode,
  CategoryCode,
  SubCategoryCode,
  FitCode,
  ColorCodeMap,
  SizeCodeMap,
  StyleCodePreviewRequest,
  StyleCodePreviewResult,
} from '@shared/api.interface';

type CodeRuleInsert = typeof codeRule.$inferInsert;
type CodeMappingInsert = typeof codeMappingConfig.$inferInsert;

const DEFAULT_SEGMENTS: CodeRuleSegment[] = [
  { id: '1', type: 'fixed', enabled: true, order: 1, config: { value: 'GS' } },
  { id: '2', type: 'year', enabled: true, order: 2, config: { yearFormat: '4' } },
  { id: '3', type: 'separator', enabled: true, order: 3, config: { separator: '-' } },
  { id: '4', type: 'season', enabled: true, order: 4 },
  { id: '5', type: 'separator', enabled: true, order: 5, config: { separator: '-' } },
  { id: '6', type: 'category', enabled: true, order: 6 },
  { id: '7', type: 'subCategory', enabled: true, order: 7 },
  { id: '8', type: 'serial', enabled: true, order: 8, config: { serialDigits: 4, serialReset: 'year' } },
];

const DEFAULT_SEASONS: SeasonCode[] = [
  { name: '春', code: 'SP' },
  { name: '夏', code: 'SU' },
  { name: '秋', code: 'AW' },
  { name: '冬', code: 'WI' },
];

const DEFAULT_CATEGORIES: CategoryCode[] = [
  { name: '上衣', code: 'SY' },
  { name: '裤装', code: 'KZ' },
  { name: '裙装', code: 'QZ' },
  { name: '外套', code: 'WT' },
];

const DEFAULT_SUB_CATEGORIES: SubCategoryCode[] = [
  { category: '上衣', name: 'T恤', code: 'TX' },
  { category: '上衣', name: '衬衫', code: 'CS' },
  { category: '裤装', name: '牛仔裤', code: 'NZ' },
  { category: '裤装', name: '休闲裤', code: 'XK' },
  { category: '裙装', name: '连衣裙', code: 'LQ' },
  { category: '外套', name: '夹克', code: 'JK' },
];

const DEFAULT_FITS: FitCode[] = [
  { name: '修身', code: 'X' },
  { name: '常规', code: 'B' },
  { name: '宽松', code: 'K' },
  { name: 'Oversize', code: 'O' },
];

const DEFAULT_BRANDS: BrandCode[] = [
  { name: '默认品牌', code: 'DEF', sortOrder: 0, status: 'active' },
];

const DEFAULT_COLORS: ColorCodeMap[] = [
  { name: '黑色', code: 'BLK' },
  { name: '白色', code: 'WHT' },
  { name: '灰色', code: 'GRY' },
  { name: '藏青', code: 'NVY' },
  { name: '卡其', code: 'KHA' },
  { name: '驼色', code: 'CML' },
  { name: '红色', code: 'RED' },
  { name: '蓝色', code: 'BLU' },
  { name: '绿色', code: 'GRN' },
];

const DEFAULT_SIZES: SizeCodeMap[] = [
  { name: 'S', code: 'S' },
  { name: 'M', code: 'M' },
  { name: 'L', code: 'L' },
  { name: 'XL', code: 'XL' },
  { name: 'XXL', code: 'XXL' },
  { name: '28', code: '28' },
  { name: '30', code: '30' },
  { name: '32', code: '32' },
  { name: '34', code: '34' },
  { name: '36', code: '36' },
  { name: '100', code: '100' },
  { name: '110', code: '110' },
  { name: '120', code: '120' },
  { name: '130', code: '130' },
  { name: '140', code: '140' },
];

const DEFAULT_MAPPING: CodeMappingConfig = {
  years: [],
  seasons: DEFAULT_SEASONS,
  brands: [],
  categories: DEFAULT_CATEGORIES,
  subCategories: DEFAULT_SUB_CATEGORIES,
  fits: DEFAULT_FITS,
  colors: DEFAULT_COLORS,
  sizes: DEFAULT_SIZES,
  attrValues: {},
};

const SEGMENT_NAMES: Record<string, string> = {
  fixed: '固定字符',
  year: '年份',
  season: '季节',
  brand: '品牌',
  category: '商品大类',
  subCategory: '商品小类',
  fit: '版型',
  serial: '流水号',
  separator: '连接符',
};

function codeRuleRowToDto(row: typeof codeRule.$inferSelect): CodeRule {
  return {
    id: row.id,
    name: row.name,
    segments: row.segments as CodeRuleSegment[],
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class CodeRuleService {
  private readonly logger = new Logger(CodeRuleService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async getDefaultRule(): Promise<CodeRule> {
    const rows = await this.db
      .select()
      .from(codeRule)
      .where(eq(codeRule.isDefault, true))
      .limit(1);

    if (rows.length > 0) {
      return codeRuleRowToDto(rows[0]);
    }

    return {
      id: 'default',
      name: '默认编码规则',
      segments: DEFAULT_SEGMENTS,
      isDefault: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async saveRule(ruleData: {
    id?: string;
    name: string;
    segments: CodeRuleSegment[];
    isDefault?: boolean;
  }): Promise<CodeRule> {
    if (!ruleData.name?.trim()) {
      throw new BadRequestException('规则名称不能为空');
    }
    if (!ruleData.segments || ruleData.segments.length === 0) {
      throw new BadRequestException('编码段不能为空');
    }

    const result = await this.db.transaction(async (tx) => {
      if (ruleData.isDefault) {
        await tx.update(codeRule).set({ isDefault: false }).where(eq(codeRule.isDefault, true));
      }

      const values: CodeRuleInsert = {
        name: ruleData.name.trim(),
        segments: ruleData.segments as any,
        isDefault: ruleData.isDefault ?? false,
      };

      if (ruleData.id) {
        const updated = await tx
          .update(codeRule)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(codeRule.id, ruleData.id))
          .returning();
        if (updated.length === 0) {
          throw new BadRequestException('规则不存在');
        }
        return updated[0];
      } else {
        const inserted = await tx.insert(codeRule).values(values).returning();
        return inserted[0];
      }
    });

    return codeRuleRowToDto(result);
  }

  async getMappingConfig(): Promise<CodeMappingConfig> {
    const rows = await this.db.select().from(codeMappingConfig);
    const byKey = new Map<string, any>();
    for (const row of rows) {
      byKey.set(row.configKey, row.configData);
    }

    const [yearsAttr, seasonsAttr, brandsAttr, categoriesAttr, subCatsAttr, fitsAttr, attrDefs] = await Promise.all([
      this.db.select().from(styleAttribute).where(eq(styleAttribute.attrType, 'year')),
      this.db.select().from(styleAttribute).where(eq(styleAttribute.attrType, 'season')),
      this.db.select().from(styleAttribute).where(eq(styleAttribute.attrType, 'brand')),
      this.db.select().from(styleAttribute).where(eq(styleAttribute.attrType, 'category')),
      this.db.select().from(styleAttribute).where(eq(styleAttribute.attrType, 'sub_category')),
      this.db.select().from(styleAttribute).where(eq(styleAttribute.attrType, 'fit')),
      this.db.select().from(styleAttrDef).where(eq(styleAttrDef.status, 'active')),
    ]);

    const years: YearCode[] = yearsAttr.map((r) => ({
      name: r.attrName,
      code: r.attrCode,
    }));

    // 当「款号属性维护」尚未配置对应属性时，回退到内置默认编码，
    // 保证编码映射配置页与款号生成不会因缺数据而整体空白（DEFAULT_* 原为死代码，现恢复为回退值）
    const seasons: SeasonCode[] = seasonsAttr.length > 0
      ? seasonsAttr.map((r) => ({ name: r.attrName, code: r.attrCode }))
      : DEFAULT_SEASONS;

    const brands: BrandCode[] = brandsAttr.length > 0
      ? brandsAttr.map((r) => ({
          name: r.attrName,
          code: r.attrCode,
          sortOrder: r.sortOrder,
          status: r.status,
        }))
      : DEFAULT_BRANDS;

    const categories: CategoryCode[] = categoriesAttr.length > 0
      ? categoriesAttr.map((r) => ({ name: r.attrName, code: r.attrCode }))
      : DEFAULT_CATEGORIES;

    const catNameByCode = new Map<string, string>();
    for (const c of categoriesAttr) catNameByCode.set(c.attrCode, c.attrName);

    const subCategories: SubCategoryCode[] = subCatsAttr.length > 0
      ? subCatsAttr.map((r) => ({
          category: catNameByCode.get(r.parentCode ?? '') ?? '',
          name: r.attrName,
          code: r.attrCode,
        }))
      : DEFAULT_SUB_CATEGORIES;

    const fits: FitCode[] = fitsAttr.length > 0
      ? fitsAttr.map((r) => ({ name: r.attrName, code: r.attrCode }))
      : DEFAULT_FITS;

    let attrValues: Record<string, Array<{ name: string; code: string }>> = {};
    if (attrDefs.length > 0) {
      const defIds = attrDefs.map((d) => d.id);
      const allValues = await this.db
        .select()
        .from(styleAttrValue)
        .where(inArray(styleAttrValue.attrDefId, defIds));

      const defCodeById = new Map<string, string>();
      for (const d of attrDefs) defCodeById.set(d.id, d.attrCode.toLowerCase());

      for (const v of allValues) {
        const code = defCodeById.get(v.attrDefId);
        if (!code) continue;
        if (!attrValues[code]) attrValues[code] = [];
        attrValues[code].push({ name: v.valueName, code: v.valueCode });
      }
    }

    return {
      years,
      seasons,
      brands,
      categories,
      subCategories,
      fits,
      colors: (byKey.get('color') as ColorCodeMap[]) ?? DEFAULT_COLORS,
      sizes: (byKey.get('size') as SizeCodeMap[]) ?? DEFAULT_SIZES,
      attrValues,
    };
  }

  async saveMappingConfig(config: CodeMappingConfig): Promise<CodeMappingConfig> {
    const mappings: Array<{ key: string; data: any }> = [
      { key: 'color', data: config.colors },
      { key: 'size', data: config.sizes },
    ];

    await this.db.transaction(async (tx) => {
      for (const m of mappings) {
        const existing = await tx
          .select()
          .from(codeMappingConfig)
          .where(eq(codeMappingConfig.configKey, m.key));

        const values: CodeMappingInsert = {
          configKey: m.key,
          configData: m.data as any,
        };

        if (existing.length > 0) {
          await tx
            .update(codeMappingConfig)
            .set({ configData: m.data as any, updatedAt: new Date() })
            .where(eq(codeMappingConfig.configKey, m.key));
        } else {
          await tx.insert(codeMappingConfig).values(values);
        }
      }
    });

    return this.getMappingConfig();
  }

  async previewStyleCode(params: StyleCodePreviewRequest): Promise<StyleCodePreviewResult> {
    const [rule, mapping] = await Promise.all([
      this.getDefaultRule(),
      this.getMappingConfig(),
    ]);

    let serialNo: string = params.serialNo ?? '';
    if (!serialNo) {
      serialNo = await this.getNextSerialNo({
        year: params.year,
        category: params.category,
      });
    }

    const enabledSegments = rule.segments
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order);

    const breakdown: Array<{ segmentType: string; segmentName: string; value: string }> = [];
    let styleNo = '';

    for (const seg of enabledSegments) {
      const value = this.resolveSegmentValue(seg, params, mapping, serialNo);
      styleNo += value;
      breakdown.push({
        segmentType: seg.type,
        segmentName: SEGMENT_NAMES[seg.type] ?? seg.type,
        value,
      });
    }

    return { styleNo, breakdown };
  }

  async getNextSerialNo(params: { year?: string; category?: string }): Promise<string> {
    const rule = await this.getDefaultRule();
    const serialSegment = rule.segments.find((s) => s.type === 'serial' && s.enabled);
    const serialDigits = serialSegment?.config?.serialDigits ?? 4;
    const serialReset = serialSegment?.config?.serialReset ?? 'year';

    let maxSerial = 0;

    if (serialReset === 'year' && params.year) {
      const mapping = await this.getMappingConfig();
      const yearCode = mapping.years.find((y) => y.name === params.year)?.code ?? params.year;
      const yearStr = yearCode.length >= 4 ? yearCode.slice(-2) : yearCode;
      const rows = await this.db
        .select({ styleNo: style.styleNo })
        .from(style)
        .where(like(style.styleNo, `%${yearStr}%`));
      maxSerial = this.extractMaxSerial(rows.map((r) => r.styleNo), rule, serialDigits);
    } else if (serialReset === 'category' && params.category) {
      const mapping = await this.getMappingConfig();
      const catCode = mapping.categories.find((c) => c.name === params.category)?.code ?? '';
      if (catCode) {
        const rows = await this.db
          .select({ styleNo: style.styleNo })
          .from(style)
          .where(like(style.styleNo, `%${catCode}%`));
        maxSerial = this.extractMaxSerial(rows.map((r) => r.styleNo), rule, serialDigits);
      }
    } else {
      const rows = await this.db.select({ styleNo: style.styleNo }).from(style);
      maxSerial = this.extractMaxSerial(rows.map((r) => r.styleNo), rule, serialDigits);
    }

    const nextNum = maxSerial + 1;
    return String(nextNum).padStart(serialDigits, '0');
  }

  async generateStyleCode(params: StyleCodePreviewRequest): Promise<StyleCodePreviewResult> {
    // For now, same as preview; actual increment happens on style creation
    return this.previewStyleCode(params);
  }

  async getBrandOptions(): Promise<BrandCode[]> {
    const rows = await this.db
      .select()
      .from(styleAttribute)
      .where(eq(styleAttribute.attrType, 'brand'))
      .orderBy(styleAttribute.sortOrder, styleAttribute.attrCode);

    return rows.map((r) => ({
      name: r.attrName,
      code: r.attrCode,
      sortOrder: r.sortOrder,
      status: r.status,
    }));
  }

  private resolveSegmentValue(
    seg: CodeRuleSegment,
    params: StyleCodePreviewRequest,
    mapping: CodeMappingConfig,
    serialNo: string,
  ): string {
    switch (seg.type) {
      case 'fixed':
        return seg.config?.value ?? '';
      case 'year': {
        const yearAttr = mapping.years.find((y) => y.name === params.year);
        const yearVal = yearAttr?.code ?? params.year ?? new Date().getFullYear().toString();
        if (seg.config?.yearFormat === '2') {
          return yearVal.slice(-2);
        }
        return yearVal;
      }
      case 'season': {
        const seasonMap = mapping.seasons.find((s) => s.name === params.season);
        return seasonMap?.code ?? '';
      }
      case 'brand': {
        const brandMap = mapping.brands.find((b) => b.name === params.brand);
        return brandMap?.code ?? '';
      }
      case 'category': {
        const catMap = mapping.categories.find((c) => c.name === params.category);
        return catMap?.code ?? '';
      }
      case 'subCategory': {
        const subMap = mapping.subCategories.find(
          (s) => s.category === params.category && s.name === params.subCategory,
        );
        return subMap?.code ?? '';
      }
      case 'fit': {
        const fitMap = mapping.fits.find((f) => f.name === params.fit);
        return fitMap?.code ?? '';
      }
      case 'attribute': {
        const attrCode = seg.config?.attrCode?.toLowerCase() ?? '';
        if (!attrCode || !params.attributes) return '';
        const attrValueName = params.attributes[attrCode];
        if (!attrValueName) return '';
        const valueMap = mapping.attrValues?.[attrCode];
        if (!valueMap) return '';
        const match = valueMap.find((v) => v.name === attrValueName);
        return match?.code ?? '';
      }
      case 'serial':
        return serialNo;
      case 'separator':
        return seg.config?.separator ?? '';
      default:
        return '';
    }
  }

  private extractMaxSerial(styleNos: string[], rule: CodeRule, serialDigits: number): number {
    const enabledSegments = rule.segments
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order);

    const serialIndex = enabledSegments.findIndex((s) => s.type === 'serial');
    if (serialIndex === -1) return 0;

    let maxSerial = 0;
    for (const no of styleNos) {
      const serial = this.extractSerialFromCode(no, enabledSegments, serialIndex, serialDigits);
      if (serial > maxSerial) {
        maxSerial = serial;
      }
    }
    return maxSerial;
  }

  private extractSerialFromCode(
    code: string,
    segments: CodeRuleSegment[],
    serialIndex: number,
    serialDigits: number,
  ): number {
    let pos = 0;
    for (let i = 0; i < serialIndex; i++) {
      const seg = segments[i];
      // Estimate length of each preceding segment
      if (seg.type === 'fixed') {
        pos += seg.config?.value?.length ?? 0;
      } else if (seg.type === 'year') {
        pos += seg.config?.yearFormat === '2' ? 2 : 4;
      } else if (seg.type === 'season') {
        pos += 2;
      } else if (seg.type === 'brand') {
        pos += 2;
      } else if (seg.type === 'category') {
        pos += 2;
      } else if (seg.type === 'subCategory') {
        pos += 2;
      } else if (seg.type === 'fit') {
        pos += 1;
      } else if (seg.type === 'separator') {
        pos += seg.config?.separator?.length ?? 1;
      }
    }

    const serialStr = code.slice(pos, pos + serialDigits);
    const num = parseInt(serialStr, 10);
    return isNaN(num) ? 0 : num;
  }
}
