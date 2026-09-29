import { Trash2, Plus, Minus, WifiOff } from 'lucide-react';
import type { SaleItem, PromotionDiscountDetail } from '@shared/api.interface';

interface CartPanelProps {
  items: SaleItem[];
  totalQty: number;
  totalTagAmount: number;
  totalDiscount: number;
  payAmount: number;
  discounts: PromotionDiscountDetail[];
  isOffline?: boolean;
  onUpdateQty: (id: string, delta: number) => void;
  onRemoveItem: (id: string) => void;
  onClear: () => void;
  onCheckout: () => void;
  onSuspend: () => void;
}

export default function CartPanel({
  items,
  totalQty,
  totalTagAmount,
  totalDiscount,
  payAmount,
  discounts,
  isOffline = false,
  onUpdateQty,
  onRemoveItem,
  onClear,
  onCheckout,
  onSuspend,
}: CartPanelProps) {
  return (
    <div className="w-[360px] border-l border-pos-line bg-white flex flex-col flex-shrink-0">
      <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
        <span className="font-medium text-pos-ink">购物车</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-pos-ink-3">{totalQty} 件商品</span>
          {items.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-pos-ink-3 hover:text-pos-danger transition-colors"
            >
              清空
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-pos-ink-3 text-sm">
            购物车为空
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
               className="p-3 border-b border-pos-line-soft hover:bg-pos-accent-light/50 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-pos-ink truncate">
                    {item.styleName}
                  </div>
                  <div className="text-xs text-pos-ink-3 mt-0.5">
                    {item.styleId} · {item.colorId} / {item.sizeId}
                  </div>
                </div>
                <button
                  onClick={() => item.id && onRemoveItem(item.id)}
                  className="text-pos-ink-3 hover:text-pos-danger ml-2 p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center border border-pos-line rounded-md">
                  <button
                    onClick={() => item.id && onUpdateQty(item.id, -1)}
                    className="w-6 h-6 flex items-center justify-center text-pos-ink-3 hover:text-pos-ink border-r border-pos-line"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-8 text-center text-sm text-pos-ink tabular-nums">
                    {item.qty}
                  </span>
                  <button
                    onClick={() => item.id && onUpdateQty(item.id, 1)}
                    className="w-6 h-6 flex items-center justify-center text-pos-ink-3 hover:text-pos-ink border-l border-pos-line"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-pos-ink tabular-nums">
                    ¥{item.lineAmount.toFixed(2)}
                  </div>
                  {(item.discountAmount ?? 0) > 0 && (
                    <div className="text-[10px] text-pos-ink-3 line-through tabular-nums">
                      ¥{(item.tagPrice * item.qty).toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 优惠明细 */}
      {discounts.length > 0 && (
        <div className="border-t border-pos-line px-4 py-3 bg-pos-paper/30">
          <div className="text-xs text-pos-ink-3 mb-2">优惠明细</div>
          {discounts.map((d, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-xs py-0.5"
            >
              <span className="text-pos-ink-2 truncate flex-1 mr-2">
                {d.promotionName}
              </span>
              <span className="text-pos-danger font-medium tabular-nums">
                -¥{d.discountAmount.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 金额汇总 */}
      <div className="border-t border-pos-line p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-pos-ink-3">商品数量</span>
          <span className="text-pos-ink tabular-nums">{totalQty} 件</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-pos-ink-3">吊牌金额</span>
          <span className="text-pos-ink tabular-nums">
            ¥{totalTagAmount.toFixed(2)}
          </span>
        </div>
         <div className="flex justify-between text-sm">
           <span className="text-pos-ink-3">优惠金额</span>
           <span className="font-semibold text-pos-danger tabular-nums">
             -¥{totalDiscount.toFixed(2)}
           </span>
         </div>
         <div className="flex justify-between items-center pt-3 border-t border-pos-line">
            <div>
              <span className="text-pos-ink font-semibold">应付金额</span>
              {isOffline && (
                <div className="text-[10px] text-pos-warn flex items-center gap-1 mt-0.5">
                  <WifiOff size={10} />
                  离线交易 · 待同步
                </div>
              )}
            </div>
            <span className="text-2xl font-bold text-pos-ink tabular-nums">
              ¥{payAmount.toFixed(2)}
            </span>
          </div>
      </div>

      {/* 操作按钮 */}
      <div className="p-4 border-t border-pos-line space-y-2">
         <button
          onClick={onCheckout}
          disabled={items.length === 0}
          className="w-full h-11 bg-pos-accent text-white rounded-lg font-medium hover:bg-[#A8401F] transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isOffline ? '离线结算' : '结算收款'}
        </button>
        <button
          onClick={onSuspend}
          disabled={items.length === 0}
          className="w-full h-9 border border-pos-line rounded-lg text-sm text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          挂单
        </button>
      </div>
    </div>
  );
}
