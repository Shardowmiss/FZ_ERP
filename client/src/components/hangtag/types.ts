/* ------------------------------------------------------------------ *
 * 吊牌打印模板 —— 类型 / 字段目录 / 纸张预设
 *
 * 后端 `hangtag_template` 表：
 *   contentConfig jsonb  →  { title?, subtitle?, footer?, fields: FieldBlock[] }
 *   styleConfig   jsonb  →  { paper?, paperWidthMm?, paperHeightMm?, orientation?, fontSize?, layout?, columns?, paddingMm?, bg? }
 *
 * 本文件为纯前端声明，零后端改动即可复用现有模板 CRUD 接口。
 * ------------------------------------------------------------------ */

/** 打印字段渲染类型 */
export type FieldType = 'text' | 'barcode' | 'qrcode';

/** 画布上一个字段块的几何与样式（坐标单位：毫米 mm，相对纸张左上角） */
export interface FieldBlock {
  /** 模板内唯一 id（与 key 区分，允许同一字段多次放置） */
  id: string;
  /** 字段键（对应 FIELD_CATALOG.key） */
  key: string;
  /** 显示标签（打印时作为字段说明文字，可选） */
  label: string;
  /** 渲染类型 */
  type: FieldType;
  /** 左上角 X（mm） */
  x: number;
  /** 左上角 Y（mm） */
  y: number;
  /** 宽（mm） */
  w: number;
  /** 高（mm） */
  h: number;
  /** 字号（px，打印时按纸张缩放） */
  fontSize?: number;
  /** 是否加粗 */
  bold?: boolean;
  /** 水平对齐 */
  align?: 'left' | 'center' | 'right';
  /** 文字颜色（CSS 颜色） */
  color?: string;
  /** 值前缀（如 "款号："） */
  prefix?: string;
  /** 值后缀（如 "元"） */
  suffix?: string;
  /** 是否在打印快照中显示（后端 contentSnapshot 按此过滤） */
  show?: boolean;
}

/** 模板内容配置 */
export interface HangtagContentConfig {
  /** 标题（顶部静态文字） */
  title?: string;
  /** 副标题（标题下方静态文字） */
  subtitle?: string;
  /** 页脚（底部静态文字） */
  footer?: string;
  /** 拖拽放置的字段块列表 */
  fields: FieldBlock[];
}

/** 模板样式配置（纸张 + 基础样式） */
export interface HangtagStyleConfig {
  /** 预设键：对应 PAPER_PRESETS.key，'CUSTOM' 表示自定义 */
  paper?: string;
  /** 纸张宽（mm） */
  paperWidthMm?: number;
  /** 纸张高（mm） */
  paperHeightMm?: number;
  /** 方向 */
  orientation?: 'portrait' | 'landscape';
  /** 基础字号（px，字段未单独设置时使用） */
  fontSize?: number;
  /** 布局（预留：vertical 纵向 / horizontal 横向，仅作语义标记） */
  layout?: 'vertical' | 'horizontal';
  /** 预留：每页列数（批量打印排版用） */
  columns?: number;
  /** 内边距（mm） */
  paddingMm?: number;
  /** 卡片背景色（CSS 颜色） */
  bg?: string;
}

/** 后端模板完整行 */
export interface HangtagTemplateFull {
  id: string;
  code: string;
  name: string;
  contentConfig: HangtagContentConfig;
  styleConfig: HangtagStyleConfig;
  isDefault?: boolean;
  status?: string;
  remark?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 字段目录项（可从调色板拖入画布的字段） */
export interface FieldCatalogItem {
  key: string;
  label: string;
  type: FieldType;
  /** 拖入时的默认宽（mm） */
  defaultW: number;
  /** 拖入时的默认高（mm） */
  defaultH: number;
  /** 预览/样例值 */
  sample: string;
}

/**
 * 可拖拽字段目录。
 * 数据来源：style（款号/品名/品牌/品类/季节/年份/吊牌价/成本价）、
 * sku（条码）、以及打印时产生的 颜色/尺码/数量/唯一码/溯源二维码/供应商。
 */
export const FIELD_CATALOG: FieldCatalogItem[] = [
  { key: 'styleNo', label: '款号', type: 'text', defaultW: 60, defaultH: 8, sample: 'GM26-001' },
  { key: 'styleName', label: '品名', type: 'text', defaultW: 70, defaultH: 8, sample: '纯棉圆领短袖T恤' },
  { key: 'brand', label: '品牌', type: 'text', defaultW: 50, defaultH: 7, sample: '古茗' },
  { key: 'category', label: '品类', type: 'text', defaultW: 40, defaultH: 7, sample: 'T恤' },
  { key: 'season', label: '季节', type: 'text', defaultW: 30, defaultH: 7, sample: '夏' },
  { key: 'year', label: '年份', type: 'text', defaultW: 30, defaultH: 7, sample: '2026' },
  { key: 'tagPrice', label: '吊牌价', type: 'text', defaultW: 45, defaultH: 8, sample: '¥89.00' },
  { key: 'costPrice', label: '成本价', type: 'text', defaultW: 45, defaultH: 7, sample: '¥32.00' },
  { key: 'skuBarcode', label: '商品条码', type: 'barcode', defaultW: 70, defaultH: 22, sample: '6901234567890' },
  { key: 'color', label: '颜色', type: 'text', defaultW: 40, defaultH: 7, sample: '经典黑' },
  { key: 'size', label: '尺码', type: 'text', defaultW: 30, defaultH: 7, sample: 'L' },
  { key: 'quantity', label: '数量', type: 'text', defaultW: 35, defaultH: 7, sample: '12' },
  { key: 'uniqueCode', label: '唯一码', type: 'text', defaultW: 60, defaultH: 8, sample: 'GM260000123' },
  { key: 'traceQr', label: '溯源二维码', type: 'qrcode', defaultW: 30, defaultH: 30, sample: '' },
  { key: 'supplier', label: '供应商', type: 'text', defaultW: 70, defaultH: 7, sample: '浙江某某服饰有限公司' },
];

/** 字段目录快速索引 */
export const FIELD_MAP: Record<string, FieldCatalogItem> = Object.fromEntries(
  FIELD_CATALOG.map((f) => [f.key, f]),
);

/** 纸张预设 */
export interface PaperPreset {
  key: string;
  label: string;
  w: number;
  h: number;
}

export const PAPER_PRESETS: PaperPreset[] = [
  { key: 'A4', label: 'A4 (210×297mm)', w: 210, h: 297 },
  { key: 'A5', label: 'A5 (148×210mm)', w: 148, h: 210 },
  { key: 'A6', label: 'A6 (105×148mm)', w: 105, h: 148 },
  { key: 'LABEL_40x30', label: '标签 40×30mm', w: 40, h: 30 },
  { key: 'LABEL_50x30', label: '标签 50×30mm', w: 50, h: 30 },
  { key: 'LABEL_60x40', label: '标签 60×40mm', w: 60, h: 40 },
  { key: 'LABEL_100x60', label: '标签 100×60mm', w: 100, h: 60 },
  { key: 'CUSTOM', label: '自定义', w: 80, h: 50 },
];

export const PAPER_MAP: Record<string, PaperPreset> = Object.fromEntries(
  PAPER_PRESETS.map((p) => [p.key, p]),
);

/** 每毫米对应像素（96 DPI：1mm ≈ 3.7795px） */
export const PX_PER_MM = 3.7795;

/** 预览/设计器使用的样例数据（与后端 style/sku 字段一一对应） */
export const SAMPLE_DATA: Record<string, string> = {
  styleNo: 'GM26-001',
  styleName: '纯棉圆领短袖T恤',
  brand: '古茗',
  category: 'T恤',
  season: '夏',
  year: '2026',
  tagPrice: '¥89.00',
  costPrice: '¥32.00',
  skuBarcode: '6901234567890',
  color: '经典黑',
  size: 'L',
  quantity: '12',
  uniqueCode: 'GM260000123',
  traceQr: '',
  supplier: '浙江某某服饰有限公司',
};

/** 解析纸张有效尺寸（考虑方向对调）与内边距（mm） */
export function resolvePaper(style?: HangtagStyleConfig): {
  key: string;
  w: number;
  h: number;
  orientation: 'portrait' | 'landscape';
  paddingMm: number;
  bg: string;
} {
  const s = style || {};
  const preset = s.paper ? PAPER_MAP[s.paper] : undefined;
  let w = s.paperWidthMm ?? preset?.w ?? 105;
  let h = s.paperHeightMm ?? preset?.h ?? 148;
  const orientation = s.orientation ?? 'portrait';
  if (orientation === 'landscape') {
    [w, h] = [h, w];
  }
  return {
    key: s.paper ?? 'CUSTOM',
    w,
    h,
    orientation,
    paddingMm: s.paddingMm ?? 4,
    bg: s.bg ?? '#ffffff',
  };
}

/** 新建模板时的默认内容 + 样式（一个开箱即用的 A6 吊牌布局） */
export function createDefaultTemplate(): {
  contentConfig: HangtagContentConfig;
  styleConfig: HangtagStyleConfig;
} {
  const mk = (
    key: string,
    x: number,
    y: number,
    overrides: Partial<FieldBlock> = {},
  ): FieldBlock => {
    const cat = FIELD_MAP[key];
    return {
      id: `${key}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      label: cat?.label ?? key,
      type: cat?.type ?? 'text',
      x,
      y,
      w: overrides.w ?? cat?.defaultW ?? 50,
      h: overrides.h ?? cat?.defaultH ?? 8,
      fontSize: overrides.fontSize,
      bold: overrides.bold,
      align: overrides.align ?? 'left',
      color: overrides.color,
      prefix: overrides.prefix,
      suffix: overrides.suffix,
      show: overrides.show ?? true,
    };
  };

  return {
    contentConfig: {
      title: '古茗 GUMING',
      subtitle: '官方正品 · 扫码溯源',
      footer: '感谢选购，请妥善保存吊牌',
      fields: [
        mk('styleName', 8, 16, { w: 90, h: 9, fontSize: 12, bold: true }),
        mk('styleNo', 8, 27, { w: 70, h: 7, fontSize: 9, prefix: '款号 ' }),
        mk('brand', 8, 36, { w: 50, h: 7, fontSize: 9, prefix: '品牌 ' }),
        mk('category', 60, 36, { w: 40, h: 7, fontSize: 9, prefix: '品类 ' }),
        mk('color', 8, 45, { w: 45, h: 7, fontSize: 9, prefix: '颜色 ' }),
        mk('size', 60, 45, { w: 40, h: 7, fontSize: 9, prefix: '尺码 ' }),
        mk('tagPrice', 8, 54, { w: 50, h: 9, fontSize: 12, bold: true, color: '#d4380d', prefix: '吊牌价 ' }),
        mk('skuBarcode', 8, 66, { w: 90, h: 22 }),
        mk('traceQr', 78, 88, { w: 28, h: 28 }),
      ],
    },
    styleConfig: {
      paper: 'A6',
      paperWidthMm: 105,
      paperHeightMm: 148,
      orientation: 'portrait',
      fontSize: 9,
      paddingMm: 4,
      bg: '#ffffff',
    },
  };
}
