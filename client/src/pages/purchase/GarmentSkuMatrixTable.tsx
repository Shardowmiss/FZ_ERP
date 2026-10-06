import React, { useMemo } from 'react';
import type { Sku } from '@shared/api.interface';

export interface SkuQtyPriceMatrix {
  [color: string]: {
    [size: string]: { qty: number; price: number; acceptedQty?: number };
  };
}

export type MatrixMode = 'edit' | 'accept' | 'view';

interface GarmentSkuMatrixTableProps {
  skuList: Sku[];
  matrix: SkuQtyPriceMatrix;
  onChange?: (color: string, size: string, field: 'qty' | 'acceptedQty', value: number) => void;
  readOnly?: boolean;
  loading?: boolean;
  emptyText?: string;
  // 兼容旧调用方：未传 mode 时按 showPrice 决定是否展示单价列
  showPrice?: boolean;
  // 新模式：edit=审核前编辑（数量可填、无单价列、验收数量为0只读）；
  // accept=验收（数量只读、验收数量可填/扫码）；view=只读
  mode?: MatrixMode;
}

const GarmentSkuMatrixTable: React.FC<GarmentSkuMatrixTableProps> = ({
  skuList,
  matrix,
  onChange,
  readOnly = false,
  loading = false,
  emptyText = '暂无SKU数据',
  showPrice = true,
  mode,
}) => {
  const legacy = !mode;
  const isAccept = mode === 'accept';
  const isEdit = mode === 'edit';
  const isView = mode === 'view' || readOnly;
  const showAcceptCol = !legacy; // 新模式均展示验收数量列
  const qtyEditable = (legacy && !readOnly) || isEdit;
  const acceptEditable = isAccept && !readOnly;

  const colors = useMemo(
    () => Array.from(new Set(skuList.map((s: Sku) => s.color))),
    [skuList],
  );
  const sizes = useMemo(
    () => Array.from(new Set(skuList.map((s: Sku) => s.size))),
    [skuList],
  );

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalAmount = 0;
    let totalAccepted = 0;
    for (const color of Object.keys(matrix)) {
      for (const size of Object.keys(matrix[color])) {
        const cell = matrix[color][size];
        const qty = cell?.qty || 0;
        const price = cell?.price || 0;
        const accepted = cell?.acceptedQty || 0;
        totalQty += qty;
        totalAmount += qty * price;
        totalAccepted += accepted;
      }
    }
    return { totalQty, totalAmount, totalAccepted };
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

  // 行/列小计渲染
  const rowSummary = (color: string) => {
    let rowQty = 0;
    let rowAmount = 0;
    let rowAccepted = 0;
    for (const size of sizes) {
      const cell = matrix[color]?.[size];
      const qty = cell?.qty || 0;
      const price = cell?.price || 0;
      const accepted = cell?.acceptedQty || 0;
      rowQty += qty;
      rowAmount += qty * price;
      rowAccepted += accepted;
    }
    return { rowQty, rowAmount, rowAccepted };
  };

  const colSummary = (size: string) => {
    let colQty = 0;
    let colAmount = 0;
    let colAccepted = 0;
    for (const color of colors) {
      const cell = matrix[color]?.[size];
      const qty = cell?.qty || 0;
      const price = cell?.price || 0;
      const accepted = cell?.acceptedQty || 0;
      colQty += qty;
      colAmount += qty * price;
      colAccepted += accepted;
    }
    return { colQty, colAmount, colAccepted };
  };

  // 单元格数量输入
  const qtyCell = (color: string, size: string) => {
    const cell = matrix[color]?.[size];
    const qty = cell?.qty || 0;
    return (
      <td className="px-1 py-1 border-b border-r border-gray-200">
        <input
          type="number"
          min={0}
          value={qty}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange?.(color, size, 'qty', Number(e.target.value))
          }
          disabled={!qtyEditable}
          className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-600"
        />
      </td>
    );
  };

  // 单元格单价输入（仅 legacy 模式）
  const priceCell = (color: string, size: string) => {
    const cell = matrix[color]?.[size];
    const price = cell?.price || 0;
    return (
      <td className="px-1 py-1 border-b border-r border-gray-200">
        <input
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange?.(color, size, 'qty', Number(e.target.value))
          }
          disabled={true}
          className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-600"
        />
      </td>
    );
  };

  // 单元格验收数量输入
  const acceptCell = (color: string, size: string) => {
    const cell = matrix[color]?.[size];
    const accepted = cell?.acceptedQty || 0;
    return (
      <td className="px-1 py-1 border-b border-r border-gray-200">
        <input
          type="number"
          min={0}
          value={accepted}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange?.(color, size, 'acceptedQty', Number(e.target.value))
          }
          disabled={!acceptEditable}
          className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-600"
        />
      </td>
    );
  };

  // 列头：legacy 用 showPrice；新模式用 mode 决定
  const headerCols = legacy
    ? sizes.map((size) => (
        <React.Fragment key={size}>
          <th
            colSpan={showPrice ? 2 : 1}
            className="text-center px-3 py-2 border-b border-r border-gray-200 w-20"
          >
            {size}
          </th>
        </React.Fragment>
      ))
    : sizes.map((size) => (
        <React.Fragment key={size}>
          <th
            colSpan={isAccept ? 3 : 2}
            className="text-center px-3 py-2 border-b border-r border-gray-200 w-24"
          >
            {size}
          </th>
        </React.Fragment>
      ));

  return (
    <div className="overflow-x-auto border border-gray-200 rounded">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600 font-medium">
            <th
              className="text-left px-3 py-2 border-b border-r border-gray-200 w-24"
            >
              颜色 / 尺码
            </th>
            {headerCols}
            <th
              colSpan={legacy ? (showPrice ? 2 : 1) : (isAccept ? 3 : 2)}
              className="text-center px-3 py-2 border-b border-gray-200 bg-blue-50"
            >
              行合计
            </th>
          </tr>
          {legacy ? (
            showPrice && (
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
            )
          ) : (
            <tr className="bg-gray-50 text-gray-500 text-xs">
              {sizes.map((size: string) => (
                <React.Fragment key={size}>
                  <th className="text-center px-1 py-1.5 border-b border-r border-gray-200 font-normal">
                    数量
                  </th>
                  {isAccept && (
                    <th className="text-center px-1 py-1.5 border-b border-r border-gray-200 font-normal text-primary">
                      验收数量
                    </th>
                  )}
                  <th className="text-center px-1 py-1.5 border-b border-r border-gray-200 font-normal">
                    金额
                  </th>
                </React.Fragment>
              ))}
              <th className="text-center px-2 py-1.5 border-b border-r border-gray-200 font-normal bg-blue-50">
                数量
              </th>
              {isAccept && (
                <th className="text-center px-2 py-1.5 border-b border-r border-gray-200 font-normal bg-blue-50 text-primary">
                  验收数量
                </th>
              )}
              <th className="text-center px-2 py-1.5 border-b border-gray-200 font-normal bg-blue-50">
                金额
              </th>
            </tr>
          )}
        </thead>
        <tbody>
          {colors.map((color: string) => {
            const { rowQty, rowAmount, rowAccepted } = rowSummary(color);
            return (
              <tr key={color} className="hover:bg-gray-50">
                <td className="px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-700 bg-gray-50">
                  {color}
                </td>
                {legacy ? (
                  sizes.map((size: string) => (
                    <React.Fragment key={size}>
                      {qtyCell(color, size)}
                      {showPrice && priceCell(color, size)}
                    </React.Fragment>
                  ))
                ) : (
                  sizes.map((size: string) => (
                    <React.Fragment key={size}>
                      {qtyCell(color, size)}
                      {isAccept && acceptCell(color, size)}
                    </React.Fragment>
                  ))
                )}
                <td className="px-3 py-2 border-b border-r border-gray-200 text-center font-medium text-primary bg-blue-50">
                  {rowQty}
                </td>
                {isAccept && (
                  <td className="px-3 py-2 border-b border-r border-gray-200 text-center font-medium text-primary bg-blue-50">
                    {rowAccepted}
                  </td>
                )}
                <td className="px-3 py-2 border-b border-gray-200 text-center font-medium text-primary bg-blue-50">
                  ¥{rowAmount.toFixed(2)}
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
            {sizes.map((size: string) => {
              const { colQty, colAmount, colAccepted } = colSummary(size);
              return (
                <React.Fragment key={size}>
                  <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary">
                    {colQty}
                  </td>
                  {isAccept && (
                    <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary">
                      {colAccepted}
                    </td>
                  )}
                  <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary">
                    ¥{colAmount.toFixed(2)}
                  </td>
                </React.Fragment>
              );
            })}
            <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary/90 text-base">
              {totals.totalQty}
            </td>
            {isAccept && (
              <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary/90 text-base">
                {totals.totalAccepted}
              </td>
            )}
            <td className="px-3 py-2 border-t border-gray-200 text-center text-primary/90 text-base">
              ¥{totals.totalAmount.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

export default GarmentSkuMatrixTable;
