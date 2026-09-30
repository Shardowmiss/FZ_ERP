import { useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { DialogFooter } from '@client/src/components/ui/dialog';
import * as membersApi from '@client/src/api/members';
import type { Member } from '@shared/api.interface';

interface RechargeDialogProps {
  member: Member;
  onSuccess: () => void;
}

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];
const PAY_METHODS = ['微信支付', '支付宝', '银行卡', '现金'];

export default function RechargeDialog({
  member,
  onSuccess,
}: RechargeDialogProps) {
  const [amount, setAmount] = useState('');
  const [payMethod, setPayMethod] = useState('微信支付');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAmountClick = (val: number) => {
    setAmount(String(val));
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('请输入正确的充值金额');
      return;
    }

    setSubmitting(true);
    try {
      await membersApi.recharge(member.id, {
        amount: numAmount,
        payMethod,
      });
      onSuccess();
    } catch (error) {
      logger.error('recharge failed', error as Error);
      const err = error as { response?: { data?: { message?: string } } };
      setErrorMsg(err.response?.data?.message || '充值失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    'w-full h-9 px-3 bg-white border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors';
  const labelClass = 'block text-xs text-pos-ink-2 mb-1.5';

  return (
    <div className="space-y-4">
      {/* Member info */}
      <div className="bg-pos-paper rounded-lg p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-pos-ink">
            {member.name || '未命名'}
          </div>
          <div className="text-xs text-pos-ink-3 tabular-nums mt-0.5">
            {member.phone}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-pos-ink-3">当前储值余额</div>
          <div className="text-lg font-semibold text-pos-accent tabular-nums">
            ¥{member.storedValue.toFixed(2)}
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="text-xs text-pos-danger bg-pos-danger-bg px-3 py-2 rounded-md">
          {errorMsg}
        </div>
      )}

      <div>
        <label className={labelClass}>充值金额</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3 text-sm">
            ¥
          </span>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="请输入充值金额"
            className={`${fieldClass} pl-7`}
          />
        </div>
        <div className="flex gap-2 mt-2">
          {QUICK_AMOUNTS.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => handleAmountClick(val)}
              className={`flex-1 h-8 text-xs rounded-md border transition-colors tabular-nums ${
                amount === String(val)
                   ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                     : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
               }`}
             >
               ¥{val}
             </button>
           ))}
         </div>
       </div>

       <div>
         <label className={labelClass}>支付方式</label>
         <div className="grid grid-cols-2 gap-2">
           {PAY_METHODS.map((method) => (
             <button
               key={method}
               type="button"
               onClick={() => setPayMethod(method)}
               className={`h-9 px-3 text-xs rounded-md border transition-colors ${
                 payMethod === method
                   ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                  : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
              }`}
            >
              {method}
            </button>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          type="button"
          className="border-pos-line text-pos-ink-2"
          onClick={onSuccess}
        >
          取消
        </Button>
        <Button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="bg-pos-accent hover:bg-pos-accent-hover text-white border-pos-accent"
        >
          {submitting ? '充值中...' : '确认充值'}
        </Button>
      </DialogFooter>
    </div>
  );
}
