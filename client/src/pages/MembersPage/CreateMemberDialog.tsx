import { useState } from 'react';
import { WifiOff } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { DialogFooter } from '@client/src/components/ui/dialog';
import * as membersApi from '@client/src/api/members';
import { useOffline } from '@client/src/contexts/OfflineContext';
import type { Member } from '@shared/api.interface';

interface CreateMemberDialogProps {
  onSuccess: (member?: Member) => void;
}

const GENDER_OPTIONS = ['男', '女', '保密'];
const SIZE_OPTIONS = ['S', 'M', 'L', 'XL', 'XXL'];
const STYLE_OPTIONS = ['休闲', '商务', '运动', '优雅', '街头'];

const genTempMemberNo = (): string => {
  return `LOCAL_M${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
};

export default function CreateMemberDialog({
  onSuccess,
}: CreateMemberDialogProps) {
  const { effectivelyOffline, createOfflineMember } = useOffline();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState('');
  const [birthday, setBirthday] = useState('');
  const [preferSize, setPreferSize] = useState('');
  const [preferStyle, setPreferStyle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async () => {
    setErrorMsg('');
    if (!phone.trim()) {
      setErrorMsg('请输入手机号');
      return;
    }
    if (!/^1\d{10}$/.test(phone.trim())) {
      setErrorMsg('请输入正确的11位手机号');
      return;
    }
    if (!name.trim()) {
      setErrorMsg('请输入姓名');
      return;
    }

    setSubmitting(true);
    try {
      if (effectivelyOffline) {
        // 离线注册：写入本地队列
        const tempMemberNo = genTempMemberNo();
        const tempMember: Member = {
          id: tempMemberNo,
          memberNo: tempMemberNo,
          phone: phone.trim(),
          name: name.trim(),
          gender: gender || undefined,
          birthday: birthday || undefined,
          level: 'normal',
          points: 0,
          storedValue: 0,
          preferSize: preferSize || undefined,
          preferStyle: preferStyle || undefined,
          totalSpent: 0,
          totalCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await createOfflineMember({
          ...tempMember,
          isOfflineCreated: true,
        });
        onSuccess(tempMember);
      } else {
        await membersApi.createMember({
          phone: phone.trim(),
          name: name.trim(),
          gender: gender || undefined,
          birthday: birthday || undefined,
          preferSize: preferSize || undefined,
          preferStyle: preferStyle || undefined,
        });
        onSuccess();
      }
    } catch (error) {
      logger.error('createMember failed', error as Error);
      const err = error as { response?: { data?: { message?: string } } };
      setErrorMsg(err.response?.data?.message || '创建失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldClass =
    'w-full h-9 px-3 bg-white border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors';

  const labelClass = 'block text-xs text-pos-ink-2 mb-1.5';

  return (
    <div className="space-y-4">
      {effectivelyOffline && (
        <div className="flex items-center gap-2 bg-pos-warn-bg/60 border border-pos-warn/30 rounded-md px-3 py-2 text-xs text-pos-warn">
          <WifiOff size={12} className="flex-shrink-0" />
          <span>离线注册 · 联网后自动同步，会员号为临时编号</span>
        </div>
      )}
      {errorMsg && (
        <div className="text-xs text-pos-danger bg-pos-danger-bg px-3 py-2 rounded-md">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>
            手机号 <span className="text-pos-danger">*</span>
          </label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="请输入手机号"
            maxLength={11}
            className={fieldClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            姓名 <span className="text-pos-danger">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入姓名"
            className={fieldClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>性别</label>
          <div className="flex gap-2">
            {GENDER_OPTIONS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(gender === g ? '' : g)}
                className={`flex-1 h-9 px-2 text-xs rounded-md border transition-colors ${
                   gender === g
                     ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                     : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
                 }`}
               >
                 {g}
               </button>
             ))}
           </div>
         </div>
         <div>
           <label className={labelClass}>生日</label>
           <Input
             type="date"
             value={birthday}
             onChange={(e) => setBirthday(e.target.value)}
             className={fieldClass}
           />
         </div>
       </div>

       <div>
         <label className={labelClass}>偏好尺码</label>
         <div className="flex flex-wrap gap-2">
           {SIZE_OPTIONS.map((s) => (
             <button
               key={s}
               type="button"
               onClick={() => setPreferSize(preferSize === s ? '' : s)}
               className={`h-8 px-3 text-xs rounded-md border transition-colors ${
                 preferSize === s
                   ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                   : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
               }`}
             >
               {s}
             </button>
           ))}
         </div>
       </div>

       <div>
         <label className={labelClass}>偏好风格</label>
         <div className="flex flex-wrap gap-2">
           {STYLE_OPTIONS.map((s) => (
             <button
               key={s}
               type="button"
               onClick={() => setPreferStyle(preferStyle === s ? '' : s)}
               className={`h-8 px-3 text-xs rounded-md border transition-colors ${
                 preferStyle === s
                   ? 'border-pos-accent bg-pos-accent-light text-pos-accent font-medium'
                  : 'border-pos-line text-pos-ink-2 hover:border-pos-ink-3'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          type="button"
          className="border-pos-line text-pos-ink-2"
            onClick={() => onSuccess()}
          >
            取消
        </Button>
        <Button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="bg-pos-accent hover:bg-[#A8401F] text-white border-pos-accent"
        >
          {submitting ? '提交中...' : effectivelyOffline ? '离线注册' : '确认创建'}
        </Button>
      </DialogFooter>
    </div>
  );
}
