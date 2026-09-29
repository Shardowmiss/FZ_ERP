import React, { useMemo } from 'react';
import type { Sku } from '@shared/api.interface';

export interface SkuQtyPriceMatrix {
  [color: string]: {
    [size: string]: { qty: number; price: number };
  };
}

interface GarmentSkuMatrixTableProps {
  skuList: Sku[];
  matrix: SkuQtyPriceMatrix;
  onChange?: (color: string, size: string, field: 'qty' | 'price', value: number) => void;
  readOnly?: boolean;
  loading?: boolean;
  emptyText?: string;
  showPrice?: boolean;
}

const GarmentSkuMatrixTable: React.FC<GarmentSkuMatrixTableProps> = ({
  skuList,
  matrix,
  onChange,
  readOnly = false,
  loading = false,
  emptyText = '暂无SKU数据',
  showPrice = true,
}) => {
  const colors = useMemo(
    () => Array.from(new Set(skuList.map((s: Sku) => s.color))),
    [skuList],
  );
  const sizes = useMemo(
    () => Array.from(new Set(skuList.map((s: Sku) => s.size))),
    [skuList],
  );
  const tableKey = useMemo(
    () => `sku-matrix-${sizes.length}-${sizes.join('|')}-${showPrice ? '2col' : '1col'}`,
    [sizes, showPrice],
  );

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalAmount = 0;
    for (const color of Object.keys(matrix)) {
      for (const size of Object.keys(matrix[color])) {
        const cell = matrix[color][size];
        const qty = cell?.qty || 0;
        const price = cell?.price || 0;
        totalQty += qty;
        totalAmount += qty * price;
      }
    }
    return { totalQty, totalAmount };
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
            <th
              rowSpan={showPrice ? 2 : 1}
              className="text-left px-3 py-2 border-b border-r border-gray-200 w-24"
            >
              颜色 / 尺码
            </th>
            {sizes.map((size: string) => (
              <th
                key={size}
                colSpan={showPrice ? 2 : 1}
                className="text-center px-3 py-2 border-b border-r border-gray-200 w-20"
              >
                {size}
              </th>
            ))}
            <th
              colSpan={showPrice ? 2 : 1}
              className="text-center px-3 py-2 border-b border-gray-200 bg-blue-50"
            >
              行合计
            </th>
          </tr>
          {showPrice && (
           <tr className="bg-gray-50 text-gray-500 text-xs">
               {sizes.map((size: string) => (
                 <React.Fragment key={size}>
                   <th className="text-center px-1 py-1.5 border-b border-r border-gray-200 font-normal">
                     数量
                   </th>
                   <th className="text-center px-1 py-1.5 border-b border-r border-gray-200 font-normal">
                     单价
                   </th>
                 </React.Fragment>
               ))}
               <th className="text-center px-2 py-1.5 border-b border-r border-gray-200 font-normal bg-blue-50">
                 数量
               </th>
               <th className="text-center px-2 py-1.5 border-b border-gray-200 font-normal bg-blue-50">
                 金额
               </th>
             </tr>
          )}
        </thead>
        <tbody>
          {colors.map((color: string) => {
            let rowQty = 0;
            let rowAmount = 0;
            for (const size of sizes) {
              const cell = matrix[color]?.[size];
              const qty = cell?.qty || 0;
              const price = cell?.price || 0;
              rowQty += qty;
              rowAmount += qty * price;
            }
            return (
              <tr key={color} className="hover:bg-gray-50">
                <td className="px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-700 bg-gray-50">
                  {color}
                </td>
                {sizes.map((size: string) => {
                  const cell = matrix[color]?.[size];
                  const qty = cell?.qty || 0;
                  const price = cell?.price || 0;
                  return (
                    <React.Fragment key={size}>
                      <td className="px-1 py-1 border-b border-r border-gray-200">
                        <input
                          type="number"
                          min={0}
                          value={qty}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            onChange?.(color, size, 'qty', Number(e.target.value))
                          }
                          disabled={readOnly}
                          className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-600"
                        />
                      </td>
                      {showPrice && (
                        <td className="px-1 py-1 border-b border-r border-gray-200">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={price}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                              onChange?.(color, size, 'price', Number(e.target.value))
                            }
                            disabled={readOnly}
                            className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-50 disabled:text-gray-600"
                          />
                        </td>
                      )}
                    </React.Fragment>
                  );
                })}
                <td className="px-3 py-2 border-b border-r border-gray-200 text-center font-medium text-blue-600 bg-blue-50">
                  {rowQty}
                </td>
                {showPrice && (
                  <td className="px-3 py-2 border-b border-gray-200 text-center font-medium text-blue-600 bg-blue-50">
                    ¥{rowAmount.toFixed(2)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-blue-50 font-medium">
            <td className="px-3 py-2 border-t border-r border-gray-200 text-gray-700">
              列合计
            </td>
            {sizes.map((size: string) => {
              let colQty = 0;
              let colAmount = 0;
              for (const color of colors) {
                const cell = matrix[color]?.[size];
                const qty = cell?.qty || 0;
                const price = cell?.price || 0;
                colQty += qty;
                colAmount += qty * price;
              }
              return (
                <React.Fragment key={size}>
                  <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-blue-600">
                    {colQty}
                  </td>
                  {showPrice && (
                    <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-blue-600 text-xs">
                      ¥{colAmount.toFixed(2)}
                    </td>
                  )}
                </React.Fragment>
              );
            })}
            <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-blue-700 text-base">
              {totals.totalQty}
            </td>
            {showPrice && (
              <td className="px-3 py-2 border-t border-gray-200 text-center text-blue-700 text-base">
                ¥{totals.totalAmount.toFixed(2)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default GarmentSkuMatrixTable;
