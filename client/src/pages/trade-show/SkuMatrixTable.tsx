import React, { useMemo } from 'react';
import type { Sku } from '@shared/api.interface';

export interface SkuMatrix {
  [color: string]: { [size: string]: number };
}

interface SkuMatrixTableProps {
  skuList: Sku[];
  matrix: SkuMatrix;
  onChange?: (color: string, size: string, value: number) => void;
  readOnly?: boolean;
  loading?: boolean;
  emptyText?: string;
}

const SkuMatrixTable: React.FC<SkuMatrixTableProps> = ({
  skuList,
  matrix,
  onChange,
  readOnly = false,
  loading = false,
  emptyText = '暂无SKU数据',
}) => {
  const colors = useMemo(
    () => Array.from(new Set(skuList.map((s) => s.color))),
    [skuList],
  );
  const sizes = useMemo(
    () => Array.from(new Set(skuList.map((s) => s.size))),
    [skuList],
  );
  const tableKey = useMemo(
    () => `sku-matrix-${sizes.length}-${sizes.join('|')}`,
    [sizes],
  );

  const totalQty = useMemo(() => {
    let sum = 0;
    for (const color of Object.keys(matrix)) {
      for (const size of Object.keys(matrix[color])) {
        sum += matrix[color][size] || 0;
      }
    }
    return sum;
  }, [matrix]);

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        加载SKU中...
      </div>
    );
  }

  if (skuList.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-300 rounded">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto border border-gray-200 rounded">
      <table key={tableKey} className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600 font-medium">
            <th className="text-left px-3 py-2 border-b border-r border-gray-200 w-24">
              颜色 / 尺码
            </th>
            {sizes.map((size) => (
              <th
                key={size}
                className="text-center px-3 py-2 border-b border-r border-gray-200 w-20"
              >
                {size}
              </th>
            ))}
            <th className="text-center px-3 py-2 border-b border-gray-200 w-20 bg-blue-50">
              行合计
            </th>
          </tr>
        </thead>
        <tbody>
          {colors.map((color) => {
            const rowTotal = sizes.reduce(
              (sum, s) => sum + (matrix[color]?.[s] || 0),
              0,
            );
            return (
              <tr key={color} className="hover:bg-gray-50">
                <td className="px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-700 bg-gray-50">
                  {color}
                </td>
                {sizes.map((size) => (
                  <td
                    key={size}
                    className="px-1 py-1 border-b border-r border-gray-200"
                  >
                    <input
                      type="number"
                      min={0}
                      value={matrix[color]?.[size] || 0}
                      onChange={(e) =>
                        onChange?.(color, size, Number(e.target.value))
                      }
                      disabled={readOnly}
                      className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-600"
                    />
                  </td>
                ))}
                <td className="px-3 py-2 border-b border-gray-200 text-center font-medium text-primary bg-blue-50">
                  {rowTotal}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-medium">
            <td className="px-3 py-2 border-t border-r border-gray-200 text-gray-700">
              列合计
            </td>
            {sizes.map((size) => {
              const colTotal = colors.reduce(
                (sum, c) => sum + (matrix[c]?.[size] || 0),
                0,
              );
              return (
                <td
                  key={size}
                  className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary"
                >
                  {colTotal}
                </td>
              );
            })}
            <td className="px-3 py-2 border-t border-gray-200 text-center text-primary/90 text-base">
              {totalQty}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default SkuMatrixTable;
