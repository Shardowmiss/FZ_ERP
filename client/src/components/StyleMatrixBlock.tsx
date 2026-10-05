import React, { useMemo, useState } from 'react';
import { Trash2, ChevronDown, ChevronRight, Eraser, Grid3X3 } from 'lucide-react';
import type { Sku } from '@shared/api.interface';
import { toast } from 'sonner';

export interface StyleMatrixCell {
  qty: number;
  price: number;
}

export interface StyleMatrix {
  [color: string]: {
    [size: string]: StyleMatrixCell;
  };
}

export interface StyleBlockData {
  styleId: string;
  styleNo: string;
  styleName: string;
  brand?: string;
  skuList: Sku[];
  matrix: StyleMatrix;
  collapsed?: boolean;
}

interface StyleMatrixBlockProps {
  block: StyleBlockData;
  onChange: (styleId: string, matrix: StyleMatrix) => void;
  onRemove?: (styleId: string) => void;
  onToggleCollapse?: (styleId: string) => void;
  readOnly?: boolean;
  showPrice?: boolean;
  priceLabel?: string;
  qtyStep?: number;
  priceStep?: string;
  maxQtyMap?: Record<string, Record<string, number>>;
}

const StyleMatrixBlock: React.FC<StyleMatrixBlockProps> = ({
  block,
  onChange,
  onRemove,
  onToggleCollapse,
  readOnly = false,
  showPrice = true,
  priceLabel = '单价',
  qtyStep = 1,
  priceStep = '0.01',
  maxQtyMap,
}) => {
  const { skuList, matrix, styleId, styleNo, styleName, brand, collapsed } = block;

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

  const handleCellChange = (
    color: string,
    size: string,
    field: 'qty' | 'price',
    rawValue: number,
  ): void => {
    const colorObj = matrix[color] || {};
    const existing = colorObj[size] || { qty: 0, price: 0 };
    let value = rawValue;
    if (field === 'qty') {
      if (value < 0) value = 0;
      const max = maxQtyMap?.[color]?.[size];
      if (max !== undefined && value > max) value = max;
    }
    const newMatrix: StyleMatrix = {
      ...matrix,
      [color]: { ...colorObj, [size]: { ...existing, [field]: value } },
    };
    onChange(styleId, newMatrix);
  };

  const handleFillRow = (color: string): void => {
    if (readOnly) return;
    const val = window.prompt(`请输入【${color}】整行填充数量：`, '0');
    if (val === null) return;
    const qty = Number(val);
    if (isNaN(qty) || qty < 0) {
      toast('请输入有效数量');
      return;
    }
    const newMatrix: StyleMatrix = { ...matrix };
    for (const size of sizes) {
      const existing = newMatrix[color]?.[size] || { qty: 0, price: 0 };
      const max = maxQtyMap?.[color]?.[size];
      const finalQty = max !== undefined && qty > max ? max : qty;
      if (!newMatrix[color]) newMatrix[color] = {};
      newMatrix[color][size] = { ...existing, qty: finalQty };
    }
    onChange(styleId, newMatrix);
  };

  const handleFillColumn = (size: string): void => {
    if (readOnly) return;
    const val = window.prompt(`请输入【${size}】整列填充数量：`, '0');
    if (val === null) return;
    const qty = Number(val);
    if (isNaN(qty) || qty < 0) {
      toast('请输入有效数量');
      return;
    }
    const newMatrix: StyleMatrix = { ...matrix };
    for (const color of colors) {
      const existing = newMatrix[color]?.[size] || { qty: 0, price: 0 };
      const max = maxQtyMap?.[color]?.[size];
      const finalQty = max !== undefined && qty > max ? max : qty;
      if (!newMatrix[color]) newMatrix[color] = {};
      newMatrix[color][size] = { ...existing, qty: finalQty };
    }
    onChange(styleId, newMatrix);
  };

  const handleClearAll = (): void => {
    if (readOnly) return;
    const newMatrix: StyleMatrix = {};
    for (const color of colors) {
      newMatrix[color] = {};
      for (const size of sizes) {
        const existing = matrix[color]?.[size] || { qty: 0, price: 0 };
        newMatrix[color][size] = { ...existing, qty: 0 };
      }
    }
    onChange(styleId, newMatrix);
    toast('已清空数量');
  };

  if (skuList.length === 0) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-800">{styleNo}</span>
            <span className="text-gray-500 text-sm">{styleName}</span>
          </div>
        </div>
        <div className="p-6 text-center text-gray-400 text-sm">暂无SKU数据</div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-2 cursor-pointer select-none"
          onClick={() => onToggleCollapse?.(styleId)}>
          {collapsed ? <ChevronRight size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
          <Grid3X3 size={16} className="text-primary" />
          <span className="font-medium text-gray-800">{styleNo}</span>
          <span className="text-gray-500 text-sm">{styleName}</span>
          {brand && <span className="text-gray-400 text-xs px-1.5 py-0.5 bg-gray-100 rounded">{brand}</span>}
          <span className="text-primary text-xs font-medium ml-2">
            合计 {totals.totalQty} 件
            {showPrice && ` / ¥${totals.totalAmount.toFixed(2)}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <>
              <button
                onClick={handleClearAll}
                className="text-gray-500 hover:text-orange-600 text-xs inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-orange-50"
                title="清空本款号数量"
              >
                <Eraser size={12} /> 清空
              </button>
              {onRemove && (
                <button
                  onClick={() => onRemove(styleId)}
                  className="text-red-500 hover:text-red-600 text-xs inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50"
                >
                  <Trash2 size={12} /> 移除
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="p-3">
          <div className="overflow-x-auto">
            <table
                key={`${sizes.length}-${showPrice ? 'p' : 'np'}-${readOnly ? 'ro' : 'rw'}`}
                className="w-full text-sm border-collapse border border-gray-200 rounded"
              >
              <thead>
                <tr className="bg-gray-50 text-gray-600 font-medium">
                  <th className="text-left px-3 py-2 border-b border-r border-gray-200 w-24">
                    颜色 / 尺码
                  </th>
                  {sizes.map((size: string) => (
                    <th
                      key={size}
                      colSpan={showPrice ? 2 : 1}
                      className="text-center px-2 py-2 border-b border-r border-gray-200 w-20"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>{size}</span>
                        {!readOnly && (
                          <button
                            onClick={() => handleFillColumn(size)}
                            className="text-[10px] text-primary hover:text-primary/90 hover:bg-blue-50 px-1 py-0.5 rounded"
                            title="整列填充"
                          >
                            填充
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th
                    colSpan={showPrice ? 2 : 1}
                    className="text-center px-2 py-2 border-b border-gray-200 bg-blue-50 text-primary/90"
                  >
                    行合计
                  </th>
                  <th className="text-center px-2 py-2 border-b border-r border-gray-200 bg-gray-50 w-12">
                    {!readOnly ? '操作' : null}
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
                          {priceLabel}
                        </th>
                      </React.Fragment>
                    ))}
                    <th className="text-center px-2 py-1.5 border-b border-r border-gray-200 font-normal bg-blue-50">
                      数量
                    </th>
                    <th className="text-center px-2 py-1.5 border-b border-gray-200 font-normal bg-blue-50">
                      金额
                    </th>
                    <th className="border-b border-r border-gray-200"></th>
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
                    <tr key={`${styleId}-${color}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-700 bg-gray-50 w-24">
                        {color}
                      </td>
                      {sizes.map((size: string) => {
                        const cell = matrix[color]?.[size];
                        const qty = cell?.qty || 0;
                        const price = cell?.price || 0;
                        const max = maxQtyMap?.[color]?.[size];
                        return (
                          <React.Fragment key={size}>
                            <td className="px-1 py-1 border-b border-r border-gray-200">
                              <input
                                type="number"
                                min={0}
                                max={max}
                                step={qtyStep}
                                value={qty}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                  handleCellChange(color, size, 'qty', Number(e.target.value))
                                }
                                disabled={readOnly}
                                className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-600"
                                title={`${color} / ${size}${max !== undefined ? ` (最多${max})` : ''}`}
                              />
                            </td>
                            {showPrice && (
                              <td className="px-1 py-1 border-b border-r border-gray-200">
                                <input
                                  type="number"
                                  min={0}
                                  step={priceStep}
                                  value={price}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    handleCellChange(color, size, 'price', Number(e.target.value))
                                  }
                                  disabled={readOnly}
                                  className="w-full px-2 py-1 text-center border border-gray-200 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-600"
                                />
                              </td>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <td className="px-3 py-2 border-b border-r border-gray-200 text-center font-medium text-primary bg-blue-50">
                        {rowQty}
                      </td>
                      {showPrice && (
                        <td className="px-3 py-2 border-b border-gray-200 text-center font-medium text-primary bg-blue-50">
                          ¥{rowAmount.toFixed(2)}
                        </td>
                      )}
                      <td className="px-1 py-1 border-b border-r border-gray-200 text-center">
                        {!readOnly && (
                          <button
                            onClick={() => handleFillRow(color)}
                            className="text-[10px] text-primary hover:text-primary/90 hover:bg-blue-50 px-2 py-1 rounded"
                            title="整行填充"
                          >
                            整行填充
                          </button>
                        )}
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
                        <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary">
                          {colQty}
                        </td>
                        {showPrice && (
                          <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary text-xs">
                            ¥{colAmount.toFixed(2)}
                          </td>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <td className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary/90 text-base">
                    {totals.totalQty}
                  </td>
                  {showPrice && (
                    <td className="px-3 py-2 border-t border-gray-200 text-center text-primary/90 text-base">
                      ¥{totals.totalAmount.toFixed(2)}
                    </td>
                  )}
                  <td className="border-t border-r border-gray-200"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StyleMatrixBlock;
