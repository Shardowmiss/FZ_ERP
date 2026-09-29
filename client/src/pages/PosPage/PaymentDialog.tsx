import { useState, useEffect } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { WifiOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import type { Member, Employee, SaleItem } from '@shared/api.interface';

interface PaymentDialogProps {
  open: boolean;
  onClose: () => void;
  // 抹零金额随支付明细一并上报，由服务端统一参与应付金额计算。
  // 注意：payments 保持顾客实际支付金额不变，不在前端二次扣减，
  // 否则会出现「钱箱实收 98 元、系统记账 97.5 元」的账务错乱。
  onConfirm: (payments: PaymentInput[], roundingAmount: number) => void;
  payAmount: number;
  member: Member | null;
  employee: Employee | null;
  items: SaleItem[];
  isOffline?: boolean;
}

export interface PaymentInput {
  payMethod: string;
  amount: number;
  changeAmount: number;
}

const PAYMENT_METHODS = [
  { code: 'cash', name: '现金', icon: '💵', needMember: false, onlineOnly: false },
  { code: 'wechat', name: '微信支付', icon: '💚', needMember: false, onlineOnly: true },
  { code: 'alipay', name: '支付宝', icon: '💙', needMember: false, onlineOnly: true },
  { code: 'bank_card', name: '银行卡', icon: '💳', needMember: false, onlineOnly: true },
  { code: 'stored_value', name: '储值余额', icon: '💰', needMember: true, onlineOnly: false },
  { code: 'points', name: '积分抵扣', icon: '⭐', needMember: true, onlineOnly: false },
];

export default function PaymentDialog({
  open,
  onClose,
  onConfirm,
  payAmount,
  member,
  items,
  isOffline = false,
}: PaymentDialogProps) {
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [activeMethod, setActiveMethod] = useState<string>('');
  // 抹零金额（元）：收银员一键抹去零头，最终顾客少付此金额
  const [rounding, setRounding] = useState<number>(0);

  // 抹零后的应付金额
  const effectivePay = Math.max(0, Math.round((payAmount - rounding) * 100) / 100);

  useEffect(() => {
    if (open) {
      // 离线时默认现金，在线时默认微信
      const defaultMethod = isOffline ? 'cash' : 'wechat';
      setAmounts({ [defaultMethod]: payAmount });
      setActiveMethod(defaultMethod);
      setRounding(0);
    }
  }, [open, payAmount, isOffline]);

  const handleAmountChange = (code: string, value: string) => {
    const num = parseFloat(value);
    setAmounts((prev) => ({
      ...prev,
      [code]: isNaN(num) || num < 0 ? 0 : Math.round(num * 100) / 100,
    }));
  };

  const getTotalPaid = () => {
    return Object.values(amounts).reduce(
      (sum: number, val: number) => sum + (val || 0),
      0,
    );
  };

  const getCashChange = () => {
    const cashAmount = amounts['cash'] || 0;
    // 非现金支付方式多付不应算作找零（修复 P2-7）
    const nonCashTotal = Object.entries(amounts).reduce(
      (sum: number, [code, val]) => {
        if (code === 'cash') return sum;
        return sum + (val || 0);
      },
      0,
    );
    // 现金应付 = 抹零后应找平的金额 − 非现金已付
    const cashOwed = Math.max(0, effectivePay - nonCashTotal);
    return Math.max(0, Math.round((cashAmount - cashOwed) * 100) / 100);
  };

  // 余额/积分超限校验（修复 P0-7）
  const getBalanceError = (): string | null => {
    if (!member) return null;
    const svAmt = amounts['stored_value'] || 0;
    if (svAmt > 0 && svAmt > Number(member.storedValue) + 0.001) {
      return `储值余额不足：当前 ¥${Number(member.storedValue).toFixed(2)}`;
    }
    const ptAmt = amounts['points'] || 0;
    const ptNeeded = Math.round(ptAmt * 100);
    if (ptAmt > 0 && ptNeeded > member.points) {
      return `积分不足：当前 ${member.points} 分（最多抵扣 ¥${(member.points / 100).toFixed(2)}）`;
    }
    return null;
  };

  const isMethodDisabled = (code: string): boolean => {
    const m = PAYMENT_METHODS.find((pm) => pm.code === code);
    if (!m) return true;
    if (m.needMember && !member) return true;
    if (isOffline && m.onlineOnly) return true;
    return false;
  };

  const handleMethodClick = (code: string) => {
    if (isMethodDisabled(code)) return;
    setActiveMethod(code);
    // 如果点击的支付方式还没填金额，且当前总支付不足，自动填入剩余金额
    const totalPaid = getTotalPaid();
    if (!amounts[code] && totalPaid < effectivePay) {
      const remaining = Math.round((effectivePay - totalPaid) * 100) / 100;
      setAmounts((prev) => ({
        ...prev,
        [code]: Math.max(0, remaining),
      }));
    }
  };

  const handleQuickFill = (code: string) => {
    const remaining = Math.max(0, Math.round((effectivePay - getTotalPaid() + (amounts[code] || 0)) * 100) / 100);
    setAmounts((prev) => ({ ...prev, [code]: remaining }));
  };

  const canConfirm = () => {
    const totalPaid = getTotalPaid();
    const cashChange = getCashChange();
    // 实付（扣除找零）需 >= 抹零后应支付金额
    if (totalPaid - cashChange < effectivePay - 0.01) return false;
    // 离线时不允许使用仅在线支付方式
    if (isOffline) {
      const hasOnlineOnly = Object.entries(amounts).some(([code, amt]) => {
        if (!amt || amt <= 0) return false;
        const m = PAYMENT_METHODS.find((pm) => pm.code === code);
        return m?.onlineOnly;
      });
      if (hasOnlineOnly) return false;
    }
    // 储值/积分余额不足禁止确认（修复 P0-7）
    if (getBalanceError()) return false;
    return true;
  };

  const handleConfirm = () => {
    if (!canConfirm()) return;
    try {
      const finalPayments: PaymentInput[] = Object.entries(amounts)
        .filter(([, v]) => v > 0)
        .map(([code, amount]) => ({
          payMethod: code,
          amount: Math.round(amount * 100) / 100,
          changeAmount: code === 'cash' ? getCashChange() : 0,
        }));

      onConfirm(finalPayments, Math.round(rounding * 100) / 100);
    } catch (error) {
      logger.error('payment confirm failed', error as Error);
    }
  };

  const totalPaid = getTotalPaid();
  const cashChange = getCashChange();
  const actualPaid = Math.round((totalPaid - cashChange) * 100) / 100;
  const balanceError = getBalanceError();

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-xl bg-white">
        <DialogHeader>
          <DialogTitle>结算收款</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 应付金额 */}
          <div className="bg-pos-paper rounded-lg p-4 text-center relative">
            {isOffline && (
              <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-pos-warn bg-white/80 px-2 py-0.5 rounded font-medium">
                <WifiOff size={10} />
                离线交易
              </div>
            )}
            <div className="text-xs text-pos-ink-3 mb-1">应付金额</div>
            <div className="text-2xl font-bold text-pos-ink tabular-nums">
              ¥{effectivePay.toFixed(2)}
            </div>
            {rounding > 0 && (
              <div className="text-xs text-pos-ok mt-1">
                已抹零 -¥{rounding.toFixed(2)}（原价 ¥{payAmount.toFixed(2)}）
              </div>
            )}
            <div className="text-xs text-pos-ink-3 mt-1">
              共{items.length}项 · {items.reduce((s, i) => s + i.qty, 0)}件商品
            </div>
          </div>

          {/* 支付方式 */}
          <div>
            <div className="text-sm font-medium text-pos-ink-2 mb-2">
              选择支付方式
            </div>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => {
                const disabled = isMethodDisabled(m.code);
                const offlineDisabled = isOffline && m.onlineOnly;
                const hasAmount = (amounts[m.code] || 0) > 0;
                return (
                  <div key={m.code} className="relative group">
                    <button
                      onClick={() => !disabled && handleMethodClick(m.code)}
                      disabled={disabled}
                      className={`w-full p-3 rounded-lg border text-center transition-all ${
                        activeMethod === m.code
                          ? 'border-pos-accent bg-pos-accent-light/30 text-pos-accent'
                          : hasAmount
                           ? 'border-pos-ok/30 bg-pos-ok-bg text-pos-ok'
                          : disabled
                          ? 'border-pos-line-soft bg-pos-paper/50 text-pos-ink-3/50 cursor-not-allowed'
                          : 'border-pos-line text-pos-ink-2 hover:border-pos-accent/40'
                      }`}
                    >
                      <div className="text-xl mb-1">{m.icon}</div>
                      <div className="text-xs font-medium">{m.name}</div>
                      {m.needMember && !member && (
                        <div className="text-[10px] text-pos-ink-3/50 mt-0.5">
                          需识别会员
                        </div>
                      )}
                      {offlineDisabled && (
                        <div className="text-[10px] text-pos-ink-3/50 mt-0.5 flex items-center justify-center gap-0.5">
                          <WifiOff size={9} />
                          需联网
                        </div>
                      )}
                      {hasAmount && (
                        <div className="text-[11px] font-semibold mt-0.5 tabular-nums">
                          ¥{amounts[m.code].toFixed(2)}
                        </div>
                      )}
                    </button>
                    {offlineDisabled && (
                      <div className="absolute left-1/2 -translate-x-1/2 -top-7 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 whitespace-nowrap bg-pos-ink text-white text-[10px] px-2 py-1 rounded">
                        需联网使用
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 当前支付方式金额输入 */}
          {activeMethod &&
            (!PAYMENT_METHODS.find((m) => m.code === activeMethod)
              ?.needMember || member) && (
              <div className="border border-pos-line rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-pos-ink-2">
                    {PAYMENT_METHODS.find((m) => m.code === activeMethod)?.name}{' '}
                    金额
                  </span>
                  <button
                    onClick={() => handleQuickFill(activeMethod)}
                    className="text-xs text-pos-accent hover:underline"
                  >
                    快捷填入剩余
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg text-pos-ink-3">¥</span>
                  <input
                    type="number"
                    value={amounts[activeMethod] || ''}
                    onChange={(e) =>
                      handleAmountChange(activeMethod, e.target.value)
                    }
                    className="flex-1 h-10 px-3 border border-pos-line rounded-md text-lg font-semibold text-pos-ink focus:outline-none focus:border-pos-accent tabular-nums"
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                  />
                </div>
                {activeMethod === 'stored_value' && member && (
                  <div className="text-xs text-pos-ink-3 mt-2">
                    当前储值余额：¥
                    {Number(member.storedValue).toFixed(2)}
                  </div>
                )}
                {activeMethod === 'points' && member && (
                  <div className="text-xs text-pos-ink-3 mt-2">
                    当前积分：{member.points}（100积分抵1元）
                  </div>
                )}
              </div>
            )}

          {/* 汇总 */}
           <div className="bg-pos-paper rounded-lg p-3 space-y-2 text-sm">
             <div className="flex justify-between items-center">
               <span className="text-pos-ink-3">已付金额</span>
               <span className="font-semibold text-pos-ink tabular-nums">
                 ¥{totalPaid.toFixed(2)}
               </span>
             </div>
             {cashChange > 0 && (
               <div className="flex justify-between items-center">
                 <span className="text-pos-ink-3">现金找零</span>
                 <span className="font-semibold text-pos-warn tabular-nums">
                   -¥{cashChange.toFixed(2)}
                 </span>
               </div>
             )}
             <div className="flex items-center justify-between pt-2 border-t border-pos-line-soft">
               <div className="flex items-center gap-2">
                 <span className="text-pos-ink font-semibold">实付合计</span>
                 <button
                   type="button"
                   onClick={() => setRounding(rounding > 0 ? 0 : Math.round((payAmount - Math.floor(payAmount)) * 100) / 100)}
                   disabled={Math.floor(payAmount) >= payAmount}
                   className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${
                     rounding > 0
                       ? 'bg-pos-ok-bg text-pos-ok border-pos-ok/30'
                       : 'border-pos-line text-pos-ink-2 hover:bg-white'
                   } disabled:opacity-40 disabled:cursor-not-allowed`}
                   title="抹去零头（如 ¥98.50 抹为 ¥98.00）"
                 >
                   {rounding > 0 ? '取消抹零' : '抹零'}
                 </button>
               </div>
               <span
                 className={`text-2xl font-bold tabular-nums ${
                   actualPaid >= effectivePay - 0.01
                     ? 'text-pos-ok'
                     : 'text-pos-danger'
                 }`}
               >
                 ¥{actualPaid.toFixed(2)}
               </span>
             </div>
             {balanceError && (
               <div className="text-xs text-pos-danger mt-1">
                 ⚠ {balanceError}
               </div>
             )}
           </div>
        </div>

        {isOffline && (
          <div className="flex items-center gap-2 bg-pos-warn-bg/40 border border-pos-warn-bg rounded-lg px-3 py-2 text-xs text-pos-warn mb-1">
            <WifiOff size={12} className="flex-shrink-0" />
            <span>当前处于离线模式，支付完成后交易将暂存本地，联网后自动同步。</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm()}>
            {isOffline ? '离线确认收款' : '确认收款'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
