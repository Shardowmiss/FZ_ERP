import type { Style, StockMatrix, Color, Size } from '@shared/api.interface';

/**
 * 离线模式 Mock 数据
 *
 * 离线核心层（IndexedDB 数据层）就绪前，这里提供本地缓存商品数据。
 * 待核心层完成后，改为从 useOffline().masterData.styles 读取。
 */

export const MOCK_LOCAL_STYLES: Style[] = [
  { id: 'SW260101', name: '真丝斜裁连衣裙', category: 'dress', colorIds: ['C01', 'C02', 'C03'], sizeIds: ['S', 'M', 'L', 'XL'], tagPrice: 1288, costPrice: 520, status: 'active', createdAt: '2026-01-15T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260102', name: '羊毛西装外套', category: 'coat', colorIds: ['C01', 'C04'], sizeIds: ['S', 'M', 'L', 'XL'], tagPrice: 1980, costPrice: 820, status: 'active', createdAt: '2026-01-20T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260103', name: '醋酸缎面半裙', category: 'skirt', colorIds: ['C02', 'C05'], sizeIds: ['S', 'M', 'L'], tagPrice: 699, costPrice: 280, status: 'active', createdAt: '2026-02-01T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260104', name: '羊绒针织衫', category: 'knit', colorIds: ['C01', 'C04', 'C06'], sizeIds: ['S', 'M', 'L', 'XL'], tagPrice: 899, costPrice: 380, status: 'active', createdAt: '2026-02-10T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260105', name: '亚麻阔腿裤', category: 'pants', colorIds: ['C01', 'C02'], sizeIds: ['S', 'M', 'L', 'XL'], tagPrice: 599, costPrice: 240, status: 'active', createdAt: '2026-02-15T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260106', name: '真丝衬衫', category: 'shirt', colorIds: ['C01', 'C03', 'C07'], sizeIds: ['S', 'M', 'L'], tagPrice: 799, costPrice: 320, status: 'active', createdAt: '2026-03-01T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260107', name: '风衣外套', category: 'coat', colorIds: ['C04', 'C08'], sizeIds: ['S', 'M', 'L', 'XL'], tagPrice: 2580, costPrice: 1080, status: 'active', createdAt: '2026-03-10T00:00:00', updatedAt: '2026-09-10T00:00:00' },
  { id: 'SW260108', name: '针织连衣裙', category: 'dress', colorIds: ['C06', 'C01'], sizeIds: ['S', 'M', 'L'], tagPrice: 1080, costPrice: 450, status: 'active', createdAt: '2026-03-15T00:00:00', updatedAt: '2026-09-10T00:00:00' },
];

const COLOR_HEX_MAP = [
  '#1B2A36', '#C4532F', '#F4F2EC', '#2E4A5E',
  '#8A9AA8', '#3A7D5A', '#C08A2D', '#B4403A',
];

const COLOR_NAMES = ['墨蓝', '砖红', '米白', '深灰', '雾蓝', '松绿', '焦糖', '酒红'];

/**
 * 为指定款式生成本地 mock 库存矩阵
 * 用于离线模式下替代 stockApi.getStockMatrix
 */
export function buildLocalStockMatrix(style: Style): StockMatrix {
  const colors: Color[] = style.colorIds.map((cid, i) => ({
    id: cid,
    name: COLOR_NAMES[i % COLOR_NAMES.length],
    hex: COLOR_HEX_MAP[i % COLOR_HEX_MAP.length],
    createdAt: '',
    updatedAt: '',
  }));
  const sizes: Size[] = style.sizeIds.map((sid, i) => ({
    id: sid,
    sortOrder: i,
    createdAt: '',
    updatedAt: '',
  }));
  const matrix: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  colors.forEach((c, ci) => {
    matrix[c.id] = {};
    let rowSum = 0;
    sizes.forEach((s, si) => {
      // 确定性伪随机：低库存概率 ~20%，0 库存 ~15%
      const seed = (ci * 7 + si * 13 + style.id.length) % 20;
      const qty = seed < 3 ? 0 : seed < 6 ? seed : 10 + (seed % 20);
      matrix[c.id][s.id] = qty;
      rowSum += qty;
      colTotals[s.id] = (colTotals[s.id] ?? 0) + qty;
      grandTotal += qty;
    });
    rowTotals[c.id] = rowSum;
  });
  return {
    styleId: style.id,
    styleName: style.name,
    colors,
    sizes,
    matrix,
    rowTotals,
    colTotals,
    grandTotal,
  };
}

/**
 * 离线模式本地商品搜索
 */
export function searchLocalStyles(keyword: string): Style[] {
  const kw = keyword.toLowerCase().trim();
  if (!kw) return [];
  return MOCK_LOCAL_STYLES.filter(
    (s) =>
      s.id.toLowerCase().includes(kw) ||
      s.name.toLowerCase().includes(kw) ||
      s.category.toLowerCase().includes(kw),
  ).slice(0, 20);
}
