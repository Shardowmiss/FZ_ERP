import { useState } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import * as membersApi from '@client/src/api/members';
import type { Member } from '@shared/api.interface';

const LEVEL_COLORS: Record<string, string> = {
  normal: 'bg-gray-400',
  silver: 'bg-primary',
  gold: 'bg-yellow-500',
  black: 'bg-orange-600',
};

const LEVEL_NAMES: Record<string, string> = {
  normal: '普通',
  silver: '银卡',
  gold: '金卡',
  black: '黑卡',
};

interface MemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (member: Member) => void;
}

export default function MemberDialog({
  open,
  onOpenChange,
  onSelect,
}: MemberDialogProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setSearching(true);
    try {
      const res = await membersApi.getMembers({
        keyword: keyword.trim(),
        page: 1,
        pageSize: 20,
      });
      setResults(res.items);
    } catch (err) {
      logger.error('search members failed', err as Error);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (m: Member) => {
    onSelect(m);
    onOpenChange(false);
    setKeyword('');
    setResults([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>识别会员</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="输入手机号或会员号"
              className="flex-1 h-10 px-3 border border-pos-line rounded-md text-sm text-pos-ink focus:outline-none focus:border-pos-accent"
            />
            <button
              onClick={handleSearch}
              className="px-4 h-10 bg-pos-accent text-white text-sm rounded-md hover:bg-pos-accent-hover transition-colors"
            >
              搜索
            </button>
          </div>
           <div className="max-h-64 overflow-y-auto border border-pos-line-soft rounded-md bg-white">
            {searching ? (
              <div className="p-4 text-center text-sm text-pos-ink-3">
                搜索中...
              </div>
            ) : results.length === 0 ? (
              <div className="p-4 text-center text-sm text-pos-ink-3">
                {keyword ? '未找到会员' : '请输入关键词搜索'}
              </div>
            ) : (
              results.map((m) => (
                <div
                  key={m.id}
                  onClick={() => handleSelect(m)}
                   className="px-3 py-2.5 border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 rounded-full ${
                        LEVEL_COLORS[m.level] || 'bg-gray-400'
                      } flex items-center justify-center text-white text-[10px] font-medium`}
                    >
                      {(LEVEL_NAMES[m.level] || '普通').charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-pos-ink">
                      {m.name || '未命名'}
                    </span>
                    <span className="text-xs text-pos-ink-3">{m.phone}</span>
                  </div>
                  <div className="flex gap-3 text-[11px] text-pos-ink-3 mt-1 ml-8">
                    <span>积分 {m.points}</span>
                    <span>储值 ¥{Number(m.storedValue).toFixed(0)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
