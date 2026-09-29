import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { Printer, CheckCircle, QrCode, WifiOff } from 'lucide-react';
import { printReceipt } from './pos-receipt-print';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import type { SaleOrder } from '@shared/api.interface';

interface ReceiptDialogProps {
  open: boolean;
  order: SaleOrder | null;
  storeName: string;
  onClose: () => void;
  onDone: () => void;
  isOffline?: boolean;
  /** 服务端生成的正式单号（同步成功后回填） */
  serverOrderNo?: string;
  /** 本地临时单号 */
  tempOrderNo?: string;
}

export default function ReceiptDialog({
  open,
  order,
  storeName,
  onClose,
  onDone,
  isOffline = false,
  serverOrderNo,
  tempOrderNo,
}: ReceiptDialogProps) {
  if (!order) return null;

  // P1-7：真实打印（80mm 热敏小票），不再是占位空函数
  const handlePrint = () => {
    try {
      logger.info('print receipt', order.orderNo);
      printReceipt(order, { storeName, isOffline, serverOrderNo, tempOrderNo });
    } catch (err) {
      logger.error('print receipt failed', err as Error);
      toast.error('打印失败，请检查打印机设置');
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-center gap-2 text-pos-ok">
            <CheckCircle size={20} />
            {isOffline ? '离线交易已暂存' : '收款成功'}
          </DialogTitle>
          {isOffline && (
            <p className="text-center text-xs text-pos-warn flex items-center justify-center gap-1 mt-1">
              <WifiOff size={12} />
              待联网后自动同步到服务器
            </p>
          )}
        </DialogHeader>

        {/* 小票样式 */}
        <div className="bg-white border border-pos-line rounded-lg p-4 mx-auto w-[320px] shadow-sm font-mono text-xs text-pos-ink relative overflow-hidden">
          {/* 离线水印 */}
          {isOffline && (
            <div className="absolute top-16 -right-10 rotate-45 bg-pos-warn/10 text-pos-warn/30 text-xs font-bold px-10 py-1 tracking-widest select-none pointer-events-none">
              离线交易
            </div>
          )}
          {/* 门店信息 */}
          <div className="text-center mb-3">
            <div className="text-sm font-bold">{storeName}</div>
            <div className="text-[10px] text-pos-ink-3 mt-0.5 flex items-center justify-center gap-1">
              销售小票
              {isOffline && (
                <span className="text-pos-warn flex items-center gap-0.5 font-medium">
                  <WifiOff size={9} />
                  离线交易 · 待上传
                </span>
              )}
            </div>
          </div>

          {/* 单号时间 */}
          <div className="border-t border-dashed border-pos-line-soft pt-2 pb-2 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-pos-ink-3">
                {isOffline ? '临时单号' : '单号'}
              </span>
              <span className="tabular-nums">
                {isOffline ? tempOrderNo || order.orderNo : serverOrderNo || order.orderNo}
              </span>
            </div>
            {isOffline && serverOrderNo && (
              <div className="flex justify-between">
                <span className="text-pos-ink-3">正式单号</span>
                <span className="tabular-nums text-pos-ok">{serverOrderNo}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-pos-ink-3">时间</span>
              <span className="tabular-nums">{formatTime(order.createdAt)}</span>
            </div>
            {order.employeeName && (
              <div className="flex justify-between">
                <span className="text-pos-ink-3">导购</span>
                <span>{order.employeeName}</span>
              </div>
            )}
            {order.memberName && (
              <div className="flex justify-between">
                <span className="text-pos-ink-3">会员</span>
                <span>{order.memberName}</span>
              </div>
            )}
          </div>

          {/* 商品明细 */}
          <div className="border-t border-dashed border-pos-line-soft pt-2 pb-2">
            <div className="grid grid-cols-12 gap-1 text-[10px] text-pos-ink-3 mb-1">
              <div className="col-span-5">品名</div>
              <div className="col-span-2 text-center">色码</div>
              <div className="col-span-1 text-center">数</div>
              <div className="col-span-2 text-right">单价</div>
              <div className="col-span-2 text-right">金额</div>
            </div>
            {order.items?.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-1 text-[10px] py-0.5"
              >
                <div className="col-span-5 truncate">{item.styleName}</div>
                <div className="col-span-2 text-center truncate">
                  {item.colorId}/{item.sizeId}
                </div>
                <div className="col-span-1 text-center tabular-nums">
                  {item.qty}
                </div>
                <div className="col-span-2 text-right tabular-nums">
                  {/* U-修复：原先 toFixed(0) 会把 ¥199.50 印成 ¥200，小票与实收不符 */}
                  {item.unitPrice.toFixed(2)}
                </div>
                <div className="col-span-2 text-right tabular-nums">
                  {item.lineAmount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          {/* 优惠明细 */}
          {order.discounts && order.discounts.length > 0 && (
            <div className="border-t border-dashed border-pos-line-soft pt-2 pb-2">
              {order.discounts.map((d) => (
                <div
                  key={d.id}
                  className="flex justify-between text-[10px] text-pos-warn py-0.5"
                >
                  <span className="truncate mr-2">{d.name}</span>
                  <span className="tabular-nums">
                    -{d.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 支付明细 */}
          <div className="border-t border-dashed border-pos-line-soft pt-2 pb-2">
            {order.payments?.map((p) => (
              <div
                key={p.id}
                className="flex justify-between text-[10px] py-0.5"
              >
                <span className="text-pos-ink-3">
                  {p.payMethod === 'cash' && '现金'}
                  {p.payMethod === 'wechat' && '微信支付'}
                  {p.payMethod === 'alipay' && '支付宝'}
                  {p.payMethod === 'bank_card' && '银行卡'}
                  {p.payMethod === 'stored_value' && '储值余额'}
                  {p.payMethod === 'points' && '积分抵扣'}
                </span>
                <span className="tabular-nums">
                  {p.changeAmount > 0
                    ? `${p.amount.toFixed(2)} (找${p.changeAmount.toFixed(2)})`
                    : p.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {/* 合计 */}
          <div className="border-t border-dashed border-pos-line-soft pt-2 pb-2 space-y-0.5">
            <div className="flex justify-between text-[10px]">
              <span className="text-pos-ink-3">件数</span>
              <span className="tabular-nums">{order.totalQty} 件</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-pos-ink-3">吊牌金额</span>
              <span className="tabular-nums">
                ¥{order.totalAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-pos-ink-3">优惠</span>
              <span className="text-pos-warn tabular-nums">
                -¥{order.discountAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-1">
              <span>实收</span>
              <span className="text-pos-accent tabular-nums">
                ¥{order.payAmount.toFixed(2)}
              </span>
            </div>
            {order.pointsEarned > 0 && (
              <div className="flex justify-between text-[10px] text-pos-warn">
                <span>本次积分</span>
                <span className="tabular-nums">+{order.pointsEarned}分</span>
              </div>
            )}
          </div>

          {/* 退换货提示 */}
          <div className="border-t border-dashed border-pos-line-soft pt-2 text-[10px] text-pos-ink-3 text-center">
            <p>如需退换，请凭此小票7日内办理</p>
            <p>商品需保持吊牌完整、未穿着洗涤</p>
          </div>

          {/* 二维码占位 */}
          <div className="flex justify-center mt-3">
            <div className="w-20 h-20 border border-pos-line-soft rounded flex items-center justify-center bg-pos-paper/30">
              <QrCode size={48} className="text-pos-ink-2/60" />
            </div>
          </div>
          <div className="text-center text-[9px] text-pos-ink-3 mt-1">
            扫码关注 · 电子会员
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="secondary" onClick={handlePrint} className="flex-1">
            <Printer size={16} className="mr-1" /> 打印小票
          </Button>
          <Button onClick={onDone} className="flex-1">
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
