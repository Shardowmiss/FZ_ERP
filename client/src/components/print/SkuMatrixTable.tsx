import React from 'react';

export interface SkuMatrixItem {
  styleNo: string;
  styleName?: string;
  brand?: string;
  season?: string;
  color: string;
  size: string;
  quantity: number;
}

interface SkuMatrixProps {
  items: SkuMatrixItem[];
  allSizesByStyle?: Record<string, string[]>;
  showAllSizes?: boolean;
}

interface StyleGroup {
  styleNo: string;
  styleName?: string;
  brand?: string;
  season?: string;
  colors: string[];
  sizes: string[];
  matrix: Record<string, Record<string, number | null>>;
  colorTotals: Record<string, number>;
  sizeTotals: Record<string, number>;
  grandTotal: number;
}

function buildStyleGroups(
  items: SkuMatrixItem[],
  allSizesByStyle?: Record<string, string[]>,
  showAllSizes = false,
): StyleGroup[] {
  const byStyle = new Map<string, StyleGroup>();
  for (const item of items) {
    let group = byStyle.get(item.styleNo);
    if (!group) {
      group = {
        styleNo: item.styleNo,
        styleName: item.styleName,
        brand: item.brand,
        season: item.season,
        colors: [],
        sizes: [],
        matrix: {},
        colorTotals: {},
        sizeTotals: {},
        grandTotal: 0,
      };
      byStyle.set(item.styleNo, group);
    }
    if (!group.colors.includes(item.color)) group.colors.push(item.color);
    if (!group.sizes.includes(item.size)) group.sizes.push(item.size);
    if (!group.matrix[item.color]) group.matrix[item.color] = {};
            group.matrix[item.color][item.size] = item.quantity;
    group.colorTotals[item.color] = (group.colorTotals[item.color] || 0) + item.quantity;
    group.sizeTotals[item.size] = (group.sizeTotals[item.size] || 0) + item.quantity;
    group.grandTotal += item.quantity;
  }

  if (showAllSizes && allSizesByStyle) {
    for (const [styleNo, allSizes] of Object.entries(allSizesByStyle)) {
      const group = byStyle.get(styleNo);
      if (!group) continue;
      const existing = new Set(group.sizes);
      for (const sz of allSizes) {
        if (!existing.has(sz)) {
          group.sizes.push(sz);
          group.sizeTotals[sz] = 0;
          for (const color of group.colors) {
            group.matrix[color][sz] = null;
          }
        }
      }
    }
  }

  return Array.from(byStyle.values());
}

export const SkuMatrixTable: React.FC<SkuMatrixProps> = ({ items, allSizesByStyle, showAllSizes = false }) => {
  const groups = buildStyleGroups(items, allSizesByStyle, showAllSizes);

  return (
    <div className="print-matrix-wrapper">
      {groups.map((group) => (
        <div key={group.styleNo} className="print-style-group">
          <div className="print-style-header">
            <span><strong>款号：</strong>{group.styleNo}</span>
            {group.styleName && <span><strong>款名：</strong>{group.styleName}</span>}
            {group.brand && <span><strong>品牌：</strong>{group.brand}</span>}
            {group.season && <span><strong>季节：</strong>{group.season}</span>}
          </div>
          <table key={`${group.styleNo}-${group.sizes.length}-${group.sizes.join('|')}`} className="print-matrix-table">
            <thead>
              <tr>
                <th className="print-th-color">颜色 / 尺码</th>
                {group.sizes.map((size: string) => (
                  <th key={size} className="print-th-size">{size}</th>
                ))}
                <th className="print-th-total">小计</th>
              </tr>
            </thead>
            <tbody>
              {group.colors.map((color: string) => (
                <tr key={color}>
                  <td className="print-td-color">{color}</td>
                  {group.sizes.map((size: string) => (
                    <td key={size} className="print-td-qty">
                      {group.matrix[color]?.[size] ?? ''}
                    </td>
                  ))}
                  <td className="print-td-total">{group.colorTotals[color] || 0}</td>
                </tr>
              ))}
              <tr className="print-tr-total">
                <td className="print-td-color">合计</td>
                {group.sizes.map((size: string) => (
                  <td key={size} className="print-td-total">{group.sizeTotals[size] || 0}</td>
                ))}
                <td className="print-td-total print-td-grand">{group.grandTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default SkuMatrixTable;
