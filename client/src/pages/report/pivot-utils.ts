import type {
  PivotDataSource,
  PivotField,
  PivotValueConfig,
  PivotResponse,
  PivotRow,
  PivotAggType,
} from '@shared/api.interface';

export interface PivotTemplate {
  name: string;
  dataSource: PivotDataSource;
  rows: string[];
  cols: string[];
  values: PivotValueConfig[];
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export const DIMENSION_FIELDS: PivotField[] = [
  { key: 'date', label: '日期', type: 'date', category: 'time' },
  { key: 'year', label: '年', type: 'year', category: 'time' },
  { key: 'month', label: '月', type: 'month', category: 'time' },
  { key: 'quarter', label: '季度', type: 'quarter', category: 'time' },
  { key: 'week', label: '周', type: 'week', category: 'time' },
  { key: 'day', label: '日', type: 'day', category: 'time' },
  { key: 'brand', label: '品牌', type: 'string', category: 'org' },
  { key: 'category', label: '大类', type: 'string', category: 'org' },
  { key: 'subCategory', label: '小类', type: 'string', category: 'org' },
  { key: 'store', label: '门店', type: 'string', category: 'org' },
  { key: 'customer', label: '客户', type: 'string', category: 'org' },
  { key: 'supplier', label: '供应商', type: 'string', category: 'org' },
  { key: 'warehouse', label: '仓库', type: 'string', category: 'org' },
  { key: 'styleNo', label: '款号', type: 'string', category: 'product' },
  { key: 'styleName', label: '款名', type: 'string', category: 'product' },
  { key: 'color', label: '颜色', type: 'string', category: 'product' },
  { key: 'size', label: '尺码', type: 'string', category: 'product' },
  { key: 'outboundNo', label: '单据号', type: 'string', category: 'other' },
];

export const MEASURE_FIELDS: PivotField[] = [
  { key: 'quantity', label: '数量', type: 'measure', category: 'measure' },
  { key: 'amount', label: '金额(含税)', type: 'measure', category: 'measure' },
  { key: 'cost', label: '成本', type: 'measure', category: 'measure' },
  { key: 'profit', label: '毛利', type: 'measure', category: 'measure' },
  { key: 'discount', label: '折扣额', type: 'measure', category: 'measure' },
  { key: 'avgPrice', label: '客单价', type: 'measure', category: 'measure' },
];

export const DIMENSION_GROUPS: { key: string; label: string; fields: string[] }[] = [
  {
    key: 'time',
    label: '时间维度',
    fields: ['date', 'year', 'month', 'quarter', 'week', 'day'],
  },
  {
    key: 'org',
    label: '组织维度',
    fields: ['brand', 'category', 'subCategory', 'store', 'customer', 'supplier', 'warehouse'],
  },
  {
    key: 'product',
    label: '商品维度',
    fields: ['styleNo', 'styleName', 'color', 'size'],
  },
  {
    key: 'other',
    label: '其他',
    fields: ['outboundNo'],
  },
];

export const DATA_SOURCE_OPTIONS: { value: PivotDataSource; label: string }[] = [
  { value: 'sales', label: '销售分析' },
  { value: 'purchase', label: '采购分析' },
  { value: 'inventory', label: '库存分析' },
  { value: 'transfer', label: '调拨分析' },
];

export const TEMPLATES: PivotTemplate[] = [
  {
    name: '月度销售趋势',
    dataSource: 'sales',
    rows: ['styleNo'],
    cols: ['month'],
    values: [
      { key: 'quantity', label: '销售数量', agg: 'sum' },
      { key: 'amount', label: '销售金额', agg: 'sum' },
    ],
  },
  {
    name: '门店销售排行',
    dataSource: 'sales',
    rows: ['store'],
    cols: [],
    values: [
      { key: 'amount', label: '销售金额', agg: 'sum' },
      { key: 'quantity', label: '数量', agg: 'sum' },
    ],
    sortBy: 'amount',
    sortDir: 'desc',
  },
  {
    name: '品牌×季度分析',
    dataSource: 'sales',
    rows: ['brand'],
    cols: ['quarter'],
    values: [
      { key: 'quantity', label: '销售数量', agg: 'sum' },
      { key: 'profit', label: '毛利', agg: 'sum' },
    ],
  },
];

export const AGG_OPTIONS: { value: PivotAggType; label: string }[] = [
  { value: 'sum', label: '求和' },
  { value: 'count', label: '计数' },
  { value: 'avg', label: '平均值' },
  { value: 'max', label: '最大值' },
  { value: 'min', label: '最小值' },
];

export function getFieldLabel(key: string): string {
  const dim = DIMENSION_FIELDS.find((f) => f.key === key);
  if (dim) return dim.label;
  const m = MEASURE_FIELDS.find((f) => f.key === key);
  if (m) return m.label;
  return key;
}

export function isMeasureField(key: string): boolean {
  return MEASURE_FIELDS.some((f) => f.key === key);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '-';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function exportToCSV(response: PivotResponse, filename: string): void {
  const { colLabels, colKeys, rowFields, rows, grandTotal } = response;
  const lines: string[] = [];

  // Multi-level header
  const maxHeaderLevel = colLabels.length;
  const rowHeaderCount = rowFields.length;
  for (let level = 0; level < maxHeaderLevel; level++) {
    const row: string[] = [];
    for (let i = 0; i < rowHeaderCount; i++) {
      row.push(level === maxHeaderLevel - 1 ? getFieldLabel(rowFields[i]) : '');
    }
    const labels = colLabels[level] || [];
    for (const lbl of labels) {
      row.push(csvEscape(lbl));
    }
    lines.push(row.join(','));
  }

  // Data rows
  for (const row of rows) {
    const line: string[] = [...row.rowValues];
    for (const colKey of colKeys) {
      const cell = row.cells[colKey];
      line.push(cell ? csvEscape(cell.formatted) : '-');
    }
    lines.push(line.join(','));
  }

  // Grand total
  if (grandTotal && Object.keys(grandTotal).length > 0) {
    const totalLine: string[] = new Array(rowHeaderCount - 1).fill('');
    totalLine.push('总计');
    for (const colKey of colKeys) {
      const cell = grandTotal[colKey];
      totalLine.push(cell ? csvEscape(cell.formatted) : '-');
    }
    lines.push(totalLine.join(','));
  }

  const csv = '\ufeff' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function getDateRange(
  preset: string,
): { startDate: string; endDate: string } {
  const now = new Date();
  const end = formatDate(now);
  let startDate = '';
  const endDate = end;

  switch (preset) {
    case 'today': {
      startDate = end;
      break;
    }
    case 'last7': {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      startDate = formatDate(d);
      break;
    }
    case 'last30': {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      startDate = formatDate(d);
      break;
    }
    case 'thisMonth': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = formatDate(d);
      break;
    }
    case 'lastMonth': {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
      startDate = formatDate(d);
      return { startDate, endDate: formatDate(lastDay) };
    }
    case 'thisYear': {
      const d = new Date(now.getFullYear(), 0, 1);
      startDate = formatDate(d);
      break;
    }
    default:
      break;
  }
  return { startDate, endDate };
}

function formatDate(d: Date | null | undefined): string {
  if (d == null) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function sortRowsByValue(
  rows: PivotRow[],
  colKey: string,
  dir: 'asc' | 'desc',
): PivotRow[] {
  return [...rows].sort((a, b) => {
    const av = a.cells[colKey]?.value ?? 0;
    const bv = b.cells[colKey]?.value ?? 0;
    return dir === 'asc' ? (av ?? 0) - (bv ?? 0) : (bv ?? 0) - (av ?? 0);
  });
}
