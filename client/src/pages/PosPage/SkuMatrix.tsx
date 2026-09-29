import { useState, useRef, useEffect } from 'react';
import { X, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { StockMatrix, Color, Size } from '@shared/api.interface';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';

/**
 * 单击延时判定窗口（毫秒）。
 * 浏览器一次双击会依次派发 2 次 click + 1 次 dblclick，
 * 若单击立即加购，双击会因「两次 click 各加 1 件 + 弹窗再确认 N 件」导致多买 2 件。
 */
const SINGLE_CLICK_DELAY = 250;

interface SkuMatrixProps {
  matrix: StockMatrix | null;
  styleTagPrice: number;
  isOffline?: boolean;
  onClose: () => void;
  onAddToCart: (params: {
    colorId: string;
    colorName: string;
    sizeId: string;
    qty: number;
  }) => void;
}

export default function SkuMatrix({
  matrix,
  styleTagPrice,
  isOffline = false,
  onClose,
  onAddToCart,
}: SkuMatrixProps) {
  const [qtyDialogOpen, setQtyDialogOpen] = useState(false);
  const [selectedCell, setSelectedCell] = useState<{
    colorId: string;
    colorName: string;
    sizeId: string;
    qty: number;
    hasStock: boolean;
  } | null>(null);
  const [inputQty, setInputQty] = useState(1);

  // 单击延时判定的定时器句柄（P2-1 回归修复）
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  if (!matrix) return null;

  const colors: Color[] = matrix.colors;
  const sizes: Size[] = [...matrix.sizes].sort((a, b) => a.sortOrder - b.sortOrder);

  const handleCellClick = (
    colorId: string,
    colorName: string,
    sizeId: string,
    qty: number,
  ) => {
    // 任何新的点击都先取消上一次待执行的单击加购
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (qty <= 0) {
      // 无库存：打开弹窗（无加购副作用，不需延时判定）
      setSelectedCell({ colorId, colorName, sizeId, qty, hasStock: false });
      setQtyDialogOpen(true);
      return;
    }
    // 有库存：延时判定后再加购 1 件；若期间触发了双击，此加购会被取消
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      try {
        onAddToCart({ colorId, colorName, sizeId, qty: 1 });
        toast.success(`已加入 ${colorName}/${sizeId} ×1`);
      } catch (error) {
        logger.error('add to cart failed', error as Error);
      }
    }, SINGLE_CLICK_DELAY);
  };

  // 双击格子：取消待执行的单击加购，打开数量弹窗，支持自定义件数
  const handleCellDoubleClick = (
    colorId: string,
    colorName: string,
    sizeId: string,
    qty: number,
  ) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    const hasStock = qty > 0;
    setSelectedCell({ colorId, colorName, sizeId, qty, hasStock });
    setInputQty(1);
    setQtyDialogOpen(true);
  };

  const handleConfirmAdd = () => {
    if (!selectedCell) return;
    if (inputQty <= 0) return;
    try {
      onAddToCart({
        colorId: selectedCell.colorId,
        colorName: selectedCell.colorName,
        sizeId: selectedCell.sizeId,
        qty: inputQty,
      });
      // P2-4：断码预售——无库存色码允许登记预售单（原先只能看不能下单）
      if (!selectedCell.hasStock) {
        toast.warning(
          `已登记预售 ${selectedCell.colorName}/${selectedCell.sizeId} ×${inputQty}`,
          { description: '门店当前无库存，付款后 3-5 日内到货' },
        );
      }
      setQtyDialogOpen(false);
      setSelectedCell(null);
    } catch (error) {
      logger.error('add to cart failed', error as Error);
    }
  };

  const getCellClass = (qty: number) => {
    const base =
      'text-center py-3 border border-pos-line-soft cursor-pointer transition-colors select-none bg-white';
    if (qty === 0) {
      return `${base} bg-pos-line-soft text-pos-ink-3 hover:bg-pos-accent-light/30`;
    }
    if (qty < 5) {
      return `${base} text-pos-danger font-semibold hover:bg-pos-accent-light/50`;
    }
    return `${base} text-pos-ink hover:bg-pos-accent-light/50`;
  };

  return (
    <div className="flex-1 p-5 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-sm border border-pos-line p-5">
        <div className="flex items-start justify-between mb-4">
           <div>
             <div className="flex items-center gap-2">
               <div className="text-lg font-semibold text-pos-ink">
                 {matrix.styleId} · {matrix.styleName}
               </div>
               {isOffline && (
                 <span className="flex items-center gap-1 text-[10px] text-pos-warn bg-pos-warn-bg px-1.5 py-0.5 rounded font-medium">
                   <WifiOff size={10} />
                   本地库存
                 </span>
               )}
             </div>
             <div className="text-sm text-pos-ink-3 mt-1">
               吊牌价 ¥{styleTagPrice.toFixed(2)} · 共{colors.length}色{matrix.grandTotal}件
             </div>
           </div>
          <button
            onClick={onClose}
            className="text-pos-ink-3 hover:text-pos-ink p-1 rounded hover:bg-pos-paper transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                 <th className="text-left font-semibold text-pos-ink pb-2 pr-3 w-32 bg-pos-paper first:rounded-tl-lg">
                   颜色/尺码
                 </th>
                 {sizes.map((size) => (
                   <th
                     key={size.id}
                     className="font-semibold text-pos-ink pb-2 text-center w-14 bg-pos-paper"
                   >
                     {size.id}
                   </th>
                 ))}
                 <th className="font-semibold text-pos-ink pb-2 text-center w-14 bg-pos-paper last:rounded-tr-lg">
                   合计
                 </th>
              </tr>
            </thead>
            <tbody>
              {colors.map((color) => (
                <tr key={color.id}>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-4 h-4 rounded border border-pos-line flex-shrink-0"
                        style={{ backgroundColor: color.hex }}
                      ></span>
                      <span className="text-pos-ink text-sm">{color.name}</span>
                    </div>
                  </td>
                  {sizes.map((size) => {
                    const qty = matrix.matrix[color.id]?.[size.id] ?? 0;
                    return (
                      <td
                        key={size.id}
                        onClick={() =>
                          handleCellClick(color.id, color.name, size.id, qty)
                        }
                        onDoubleClick={() =>
                          handleCellDoubleClick(color.id, color.name, size.id, qty)
                        }
                        title="单击加购 1 件，双击自定义数量"
                        className={getCellClass(qty)}
                      >
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
                {sizes.map((size) => (
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

        <div className="flex items-center gap-4 mt-3 text-xs text-pos-ink-3">
           <span className="flex items-center gap-1">
             <span className="w-3 h-3 rounded bg-pos-line-soft border border-pos-line-soft"></span>
             断码可预售
           </span>
           <span className="flex items-center gap-1">
             <span className="w-3 h-3 rounded bg-white border border-pos-line-soft text-pos-danger font-bold text-[10px] flex items-center justify-center">
               3
             </span>
             低库存（＜5件）
           </span>
          <span>点击对应色码格添加商品到购物车</span>
        </div>
      </div>

      <Dialog open={qtyDialogOpen} onOpenChange={setQtyDialogOpen}>
         <DialogContent className="sm:max-w-sm bg-white">
          <DialogHeader>
            <DialogTitle>选择数量</DialogTitle>
          </DialogHeader>
          {selectedCell && (
            <div className="py-2">
              <div className="text-sm text-pos-ink-3 mb-3">
                {matrix.styleName} · {selectedCell.colorName} / {selectedCell.sizeId}
              </div>
              {selectedCell.hasStock ? (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-pos-ink-3">库存</span>
                    <span className="text-sm font-medium text-pos-ink">
                      {selectedCell.qty} 件
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-pos-ink-3">单价</span>
                    <span className="text-sm font-medium text-pos-accent">
                      ¥{styleTagPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-4">
                    <span className="text-sm text-pos-ink-2 font-medium">数量</span>
                    <div className="flex items-center border border-pos-line rounded-md">
                      <button
                        onClick={() =>
                          setInputQty((prev) => Math.max(1, prev - 1))
                        }
                        className="w-8 h-8 flex items-center justify-center text-pos-ink-3 hover:text-pos-ink border-r border-pos-line"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        value={inputQty}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val >= 1 && val <= selectedCell.qty) {
                            setInputQty(val);
                          }
                        }}
                        className="w-14 h-8 text-center text-sm text-pos-ink outline-none bg-transparent"
                      />
                      <button
                        onClick={() =>
                          setInputQty((prev) =>
                            Math.min(selectedCell.qty, prev + 1),
                          )
                        }
                        className="w-8 h-8 flex items-center justify-center text-pos-ink-3 hover:text-pos-ink border-l border-pos-line"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-4 pt-4 border-t border-pos-line-soft">
                    <span className="text-sm text-pos-ink-2">小计</span>
                    <span className="text-lg font-bold text-pos-accent tabular-nums">
                      ¥{(styleTagPrice * inputQty).toFixed(2)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="py-4 text-center">
                  <div className="text-pos-warn text-sm mb-2">
                    该色码门店无库存
                  </div>
                  <div className="text-xs text-pos-ink-3">
                    总仓有货，可做预售单
                    <br />
                    顾客付款后3-5日内到货
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setQtyDialogOpen(false)}>
              取消
            </Button>
            {selectedCell?.hasStock ? (
              <Button onClick={handleConfirmAdd}>加入购物车</Button>
            ) : (
              // P2-4：断码预售登记入口
              <Button onClick={handleConfirmAdd}>登记预售单</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
