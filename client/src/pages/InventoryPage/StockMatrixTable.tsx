import type { StockMatrix, Color, Size } from '@shared/api.interface';

interface StockMatrixTableProps {
  matrix: StockMatrix;
  tagPrice?: number;
}

export default function StockMatrixTable({
  matrix,
  tagPrice,
}: StockMatrixTableProps) {
  const colors: Color[] = matrix.colors;
  const sizes: Size[] = [...matrix.sizes].sort(
    (a: Size, b: Size) => a.sortOrder - b.sortOrder,
  );

  const getCellClass = (qty: number): string => {
    const base = 'text-center py-2 border border-pos-line-soft';
    if (qty === 0) {
      return `${base} bg-pos-line-soft text-pos-ink-3`;
    }
    if (qty < 10) {
      return `${base} text-pos-danger font-medium`;
    }
    return `${base} text-pos-ink`;
  };

  return (
    <div className="overflow-x-auto">
      {tagPrice !== undefined && (
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="font-medium text-pos-ink">
              {matrix.styleId} · {matrix.styleName}
            </span>
            <span className="text-xs text-pos-ink-3 ml-2">
              吊牌价 ¥{tagPrice.toLocaleString()}
            </span>
          </div>
          <span className="text-sm font-semibold text-pos-accent">
            门店总库存：{matrix.grandTotal} 件
          </span>
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="text-left font-medium text-pos-ink-3 pb-2 pr-3 w-32">
              颜色/尺码
            </th>
            {sizes.map((size: Size) => (
              <th
                key={size.id}
                className="font-medium text-pos-ink-3 pb-2 text-center w-16"
              >
                {size.id}
              </th>
            ))}
            <th className="font-medium text-pos-ink-3 pb-2 text-center w-16">
              合计
            </th>
          </tr>
        </thead>
        <tbody>
          {colors.map((color: Color) => (
            <tr key={color.id}>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded border border-pos-line flex-shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <span className="text-pos-ink text-sm">{color.name}</span>
                </div>
              </td>
              {sizes.map((size: Size) => {
                const qty: number = matrix.matrix[color.id]?.[size.id] ?? 0;
                return (
                  <td key={size.id} className={getCellClass(qty)}>
                    {qty === 0 ? '—' : qty}
                  </td>
                );
              })}
              <td className="text-center py-2 font-medium text-pos-ink bg-pos-paper/30">
                {matrix.rowTotals[color.id] ?? 0}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-2 pr-3 font-medium text-pos-ink-3 text-sm">
              合计
            </td>
            {sizes.map((size: Size) => (
              <td
                key={size.id}
                className="text-center py-2 font-medium text-pos-ink bg-pos-paper/30"
              >
                {matrix.colTotals[size.id] ?? 0}
              </td>
            ))}
            <td className="text-center py-2 font-bold text-pos-accent bg-pos-accent-light/30">
              {matrix.grandTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
