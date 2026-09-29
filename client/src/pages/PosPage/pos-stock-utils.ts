import type { StockMatrix, Color, Size } from '@shared/api.interface';
import type { StockMatrixResult } from '@client/src/lib/offline/master-data-cache';

/**
 * 将离线核心层 StockMatrixResult 转换为 UI 层 StockMatrix 格式
 * （补充 rowTotals / colTotals / grandTotal，以及 Color/Size 完整字段）
 */
export function convertStockMatrixResult(
  result: StockMatrixResult,
): StockMatrix {
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;

  for (const color of result.colors) {
    let rowSum = 0;
    for (const size of result.sizes) {
      const qty = result.matrix[color.id]?.[size.id] ?? 0;
      rowSum += qty;
      colTotals[size.id] = (colTotals[size.id] ?? 0) + qty;
      grandTotal += qty;
    }
    rowTotals[color.id] = rowSum;
  }

  return {
    styleId: result.styleId,
    styleName: result.styleName,
    colors: result.colors as unknown as Color[],
    sizes: result.sizes as unknown as Size[],
    matrix: result.matrix,
    rowTotals,
    colTotals,
    grandTotal,
  };
}
