import { useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { DialogFooter } from '@client/src/components/ui/dialog';
import * as membersApi from '@client/src/api/members';
import type { Member } from '@shared/api.interface';

interface IssueCouponDialogProps {
  member: Member;
  onSuccess: () => void;
}

type CouponType = 'full_reduction' | 'discount';

export default function IssueCouponDialog({
  member,
  onSuccess,
}: IssueCouponDialogProps) {
  const [type, setType] = useState<CouponType>('full_reduction');
  const [discountValue, setDiscountValue] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [validDays, setValidDays] = useState('30');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async () => {
    setErrorMsg('');
    setSuccessMsg('');

    const discountNum = Number(discountValue);
    if (!discountValue || isNaN(discountNum) || discountNum <= 0) {
      setErrorMsg(
        type === 'discount' ? '请输入正确的折扣率' : '请输入正确的面额',
      );
      return;
    }
    if (type === 'discount' && (discountNum < 0.1 || discountNum > 9.9)) {
      setErrorMsg('折扣率应在0.1-9.9之间');
      return;
    }

    const validDaysNum = Number(validDays);
    if (!validDays || isNaN(validDaysNum) || validDaysNum <= 0) {
      setErrorMsg('请输入正确的有效天数');
      return;
    }

    setSubmitting(true);
    try {
      await membersApi.issueCoupon(member.id, {
        type,
        discountValue: discountNum,
        minAmount: minAmount ? Number(minAmount) : 0,
        validDays: validDaysNum,
      });
      setSuccessMsg('优惠券发放成功');
      setTimeout(() => {
        onSuccess();
      }, 1000);
    } catch (error) {
      logger.error('issueCoupon failed', error as Error);
      const err = error as { response?: { data?: { message?: string } } };
      setErrorMsg(err.response?.data?.message || '发放失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    'w-full h-9 px-3 bg-white border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors';
  const labelClass = 'block text-xs text-pos-ink-2 mb-1.5';

  return (
    <div className="space-y-4">
      <div className="bg-pos-paper rounded-lg p-3">
        <div className="text-sm font-medium text-pos-ink">
          {member.name || '未命名'}
        </div>
        <div className="text-xs text-pos-ink-3 tabular-nums mt-0.5">
          {member.phone}
        </div>
      </div>

      {errorMsg && (
        <div className="text-xs text-pos-danger bg-pos-danger-bg px-3 py-2 rounded-md">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="text-xs text-pos-ok bg-pos-ok-bg px-3 py-2 rounded-md">
          {successMsg}
        </div>
      )}

      <div>
        <label className={labelClass}>优惠券类型</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType('full_reduction')}
            className={`flex-1 h-9 px-3 text-xs rounded-md border transition-colors ${
               type === 'full_reduction'
                 ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                 : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
             }`}
           >
             满减券
           </button>
           <button
             type="button"
             onClick={() => setType('discount')}
             className={`flex-1 h-9 px-3 text-xs rounded-md border transition-colors ${
               type === 'discount'
                 ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
            }`}
          >
            折扣券
          </button>
        </div>
      </div>

      {type === 'full_reduction' ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>面额（元）</label>
            <Input
              type="number"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              placeholder="如：50"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>最低消费（元）</label>
            <Input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder="如：200"
              className={fieldClass}
            />
          </div>
        </div>
      ) : (
        <div>
          <label className={labelClass}>折扣率（折）</label>
          <Input
            type="number"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
            placeholder="如：8.5 表示八五折"
            step="0.1"
            className={fieldClass}
          />
        </div>
      )}

      <div>
        <label className={labelClass}>有效天数</label>
        <Input
          type="number"
          value={validDays}
          onChange={(e) => setValidDays(e.target.value)}
          placeholder="有效期天数"
          className={fieldClass}
        />
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
          {submitting ? '发放中...' : '确认发放'}
        </Button>
      </DialogFooter>
    </div>
  );
}
