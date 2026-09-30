import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Crown, ChevronLeft, ChevronRight, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { useOffline } from '@client/src/contexts/OfflineContext';
import AsyncState from '@client/src/components/AsyncState';
import { errMsg } from '@client/src/lib/errMsg';
import * as membersApi from '@client/src/api/members';
import type { Member, LevelCount } from '@shared/api.interface';
import CreateMemberDialog from './CreateMemberDialog';
import RechargeDialog from './RechargeDialog';
import IssueCouponDialog from './IssueCouponDialog';
import MemberDetailPanel from './MemberDetailPanel';

const LEVEL_TABS: { key: string; label: string; backendValue: string }[] = [
  { key: 'all', label: '全部', backendValue: '' },
  { key: 'normal', label: '普通', backendValue: 'normal' },
  { key: 'silver', label: '银卡', backendValue: 'silver' },
  { key: 'gold', label: '金卡', backendValue: 'gold' },
  { key: 'black', label: '黑卡', backendValue: 'black' },
];

const levelBadgeClass: Record<string, string> = {
  normal: 'bg-pos-paper text-pos-ink-2',
  silver: 'bg-pos-info-bg text-pos-info',
  gold: 'bg-pos-warn-bg text-pos-warn',
  black: 'bg-pos-accent-light text-pos-accent font-medium',
};

const levelLabelMap: Record<string, string> = {
  normal: '普通',
  silver: '银卡',
  gold: '金卡',
  black: '黑卡',
};

const PAGE_SIZE = 10;

export default function MembersPage() {
  const [activeLevel, setActiveLevel] = useState('all');
  const [searchValue, setSearchValue] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  /** 列表加载失败原因；此前 catch 只写日志，失败时表格落到「暂无会员数据」，用户无从判断是没数据还是接口挂了 */
  const [listError, setListError] = useState<string | null>(null);
  const [levelCounts, setLevelCounts] = useState<LevelCount[]>([]);
  const [offlineMembers, setOfflineMembers] = useState<Member[]>([]);

  const { effectivelyOffline, searchMembersMerged } = useOffline();

  const [showCreate, setShowCreate] = useState(false);
  const [showRecharge, setShowRecharge] = useState(false);
  const [showIssueCoupon, setShowIssueCoupon] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchMembersOnline = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const levelParam =
        activeLevel === 'all' ? undefined : activeLevel;
      const res = await membersApi.getMembers({
        keyword: searchKeyword || undefined,
        level: levelParam,
        page,
        pageSize: PAGE_SIZE,
      });
      setMembers(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('fetchMembers failed', error as Error);
      setListError(errMsg(error, '会员列表加载失败，请检查网络后重试'));
    } finally {
      setLoading(false);
    }
  }, [activeLevel, searchKeyword, page]);

  const fetchMembersOffline = useCallback(() => {
    setLoading(true);
    setListError(null);
    try {
      const kw = (searchKeyword || '').toLowerCase();
      const offlinePhones = new Set(offlineMembers.map((m) => m.phone));
      const cached = searchMembersMerged(searchKeyword || '')
        .filter((m) => !offlinePhones.has(m.phone))
        .map((m): Member => ({
          id: m.id, memberNo: m.memberNo, name: m.name, phone: m.phone,
          level: m.level, points: m.points, storedValue: 0,
          totalSpent: 0, totalCount: 0, createdAt: '', updatedAt: '',
        }));
      const matchedOffline = offlineMembers.filter((m: Member) =>
        !kw || m.name?.toLowerCase().includes(kw) ||
        m.phone.toLowerCase().includes(kw) || m.memberNo.toLowerCase().includes(kw)
      );
      let allMembers: Member[] = [...matchedOffline, ...cached];
      if (activeLevel !== 'all') allMembers = allMembers.filter((m) => m.level === activeLevel);
      const start = (page - 1) * PAGE_SIZE;
      setMembers(allMembers.slice(start, start + PAGE_SIZE));
      setTotal(allMembers.length);
    } catch (error) {
      logger.error('fetchMembersOffline failed', error as Error);
      setListError(errMsg(error, '本地会员缓存读取失败'));
    } finally { setLoading(false); }
  }, [activeLevel, searchKeyword, page, offlineMembers, searchMembersMerged]);

  const fetchMembers = useCallback(() => {
    if (effectivelyOffline) {
      fetchMembersOffline();
    } else {
      fetchMembersOnline();
    }
  }, [effectivelyOffline, fetchMembersOnline, fetchMembersOffline]);

  const fetchLevelCounts = useCallback(async () => {
    try {
      const res = await membersApi.getLevelCounts();
      setLevelCounts(res);
    } catch (error) {
      logger.error('fetchLevelCounts failed', error as Error);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  useEffect(() => {
    fetchLevelCounts();
  }, [fetchLevelCounts]);

  const getCountForLevel = (level: string): number => {
    if (level === 'all') return total;
    const found = levelCounts.find((c: LevelCount) => c.level === level);
    return found?.count ?? 0;
  };

  const handleSearch = () => {
    setSearchKeyword(searchValue.trim());
    setPage(1);
  };

  const handleLevelChange = (key: string) => {
    setActiveLevel(key);
    setPage(1);
  };

  const openDetail = (member: Member) => {
    setSelectedMember(member);
    setDetailOpen(true);
  };

  const openRecharge = (member: Member) => {
    setSelectedMember(member);
    setShowRecharge(true);
  };

  const openIssueCoupon = (member: Member) => {
    setSelectedMember(member);
    setShowIssueCoupon(true);
  };

  const handleCreated = (member?: Member) => {
    setShowCreate(false);
    if (effectivelyOffline && member) {
      // 离线：加入本地列表
      setOfflineMembers((prev) => [member, ...prev]);
      toast.success('离线注册成功，联网后自动同步');
    } else {
      fetchMembers();
      fetchLevelCounts();
    }
  };

  const handleRecharged = () => {
    setShowRecharge(false);
    fetchMembers();
    fetchLevelCounts();
    if (detailOpen && selectedMember) {
      // refresh detail
      membersApi.getMemberById(selectedMember.id).then((m) => {
        setSelectedMember(m);
      }).catch((e) => logger.error('refresh member failed', e));
    }
  };

  const handleCouponIssued = () => {
    setShowIssueCoupon(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      {/* Header */}
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold text-pos-ink">会员中心</h1>
            <p className="text-xs text-pos-ink-3 mt-0.5">运营 / 会员中心</p>
          </div>
          {effectivelyOffline && (
            <span className="flex items-center gap-1 bg-pos-warn-bg/60 border border-pos-warn/30 text-pos-warn text-[10px] px-2 py-0.5 rounded font-medium">
              <WifiOff size={10} />
              离线模式
            </span>
          )}
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-pos-accent hover:bg-pos-accent-hover text-white border-pos-accent"
        >
          <Plus size={16} /> 新增会员
        </Button>
      </header>

      {/* Search + Level tabs */}
      <div className="px-5 py-3 bg-white border-b border-pos-line flex items-center gap-4 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3 pointer-events-none"
          />
          <Input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={effectivelyOffline ? '离线：搜索本地会员' : '搜索会员姓名 / 手机号 / 会员号'}
            className="pl-9 bg-pos-paper border-pos-line text-sm text-pos-ink focus:border-pos-accent h-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {LEVEL_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleLevelChange(tab.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1 ${
                activeLevel === tab.key
                  ? 'bg-pos-accent text-white font-medium'
                  : 'text-pos-ink-2 hover:bg-pos-paper'
              }`}
            >
              {tab.label}
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  activeLevel === tab.key
                    ? 'bg-white/20 text-white'
                    : 'bg-pos-paper text-pos-ink-3'
                }`}
              >
                {getCountForLevel(tab.key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden p-4">
        <div className="h-full bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-pos-paper sticky top-0 z-10">
                <tr>
                  <th className="text-left font-semibold text-pos-ink px-4 py-3">
                    会员号 / 姓名
                  </th>
                  <th className="text-left font-semibold text-pos-ink px-4 py-3">
                    手机号
                  </th>
                  <th className="text-left font-semibold text-pos-ink px-4 py-3">
                    等级
                  </th>
                  <th className="text-right font-semibold text-pos-ink px-4 py-3">
                    积分余额
                  </th>
                  <th className="text-right font-semibold text-pos-ink px-4 py-3">
                    储值余额
                  </th>
                  <th className="text-right font-semibold text-pos-ink px-4 py-3">
                    消费总额
                  </th>
                  <th className="text-center font-semibold text-pos-ink px-4 py-3">
                    消费次数
                  </th>
                  <th className="text-left font-semibold text-pos-ink px-4 py-3">
                    最近消费
                  </th>
                  <th className="text-center font-semibold text-pos-ink px-4 py-3">
                    状态
                  </th>
                  <th className="text-center font-semibold text-pos-ink px-4 py-3">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {listError && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8">
                      <AsyncState error={listError} onRetry={fetchMembers} compact />
                    </td>
                  </tr>
                )}
                {!listError && loading && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-pos-ink-3"
                    >
                      加载中...
                    </td>
                  </tr>
                )}
                {!listError && !loading && members.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-12 text-center text-pos-ink-3"
                    >
                      暂无会员数据
                    </td>
                  </tr>
                )}
                {!listError && !loading &&
                  members.map((member: Member) => (
                    <tr
                      key={member.id}
                      className="border-b border-pos-line-soft hover:bg-pos-accent-light/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-pos-accent-light flex items-center justify-center text-pos-accent text-xs font-medium">
                            {member.name?.charAt(0) || '会'}
                          </div>
                          <div>
                            <div className="text-pos-ink font-medium">
                              {member.name || '未命名'}
                            </div>
                            <div className="text-xs text-pos-ink-3 tabular-nums">
                              {member.memberNo}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-pos-ink-2 tabular-nums">
                        {member.phone}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                         levelBadgeClass[member.level] ||
                             'bg-pos-paper text-pos-ink-2'
                          }`}
                        >
                          <Crown size={10} className="mr-1" />
                          {levelLabelMap[member.level] || member.level}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
                        {member.points.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
                        ¥{member.storedValue.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-pos-ink font-medium tabular-nums">
                        ¥{member.totalSpent.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center text-pos-ink tabular-nums">
                        {member.totalCount}
                      </td>
                      <td className="px-4 py-3 text-pos-ink-2 text-xs">
                        {member.lastPurchaseAt
                          ? new Date(member.lastPurchaseAt)
                              .toLocaleDateString('zh-CN')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-xs px-2 py-0.5 rounded bg-pos-ok-bg text-pos-ok">正常</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2 text-xs">
                          <button
                            onClick={() => openDetail(member)}
                            className="text-pos-accent hover:text-pos-accent-hover transition-colors"
                          >
                            详情
                          </button>
                          <span className="text-pos-line">|</span>
                          <button
                            onClick={() => openRecharge(member)}
                            className="text-pos-ink-2 hover:text-pos-accent transition-colors"
                          >
                            充值
                          </button>
                          <span className="text-pos-line">|</span>
                          <button
                            onClick={() => openIssueCoupon(member)}
                            className="text-pos-ink-2 hover:text-pos-accent transition-colors"
                          >
                            发券
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="px-4 py-3 border-t border-pos-line flex items-center justify-between flex-shrink-0">
            <span className="text-xs text-pos-ink-3">
              共 {total} 条记录
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="border-pos-line text-pos-ink-2 hover:bg-pos-paper"
              >
                <ChevronLeft size={14} /> 上一页
              </Button>
              <span className="px-3 py-1 text-xs text-pos-ink tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="border-pos-line text-pos-ink-2 hover:bg-pos-paper"
              >
                下一页 <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Member Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-white border-pos-line max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-pos-ink">新增会员</DialogTitle>
          </DialogHeader>
          <CreateMemberDialog onSuccess={handleCreated} />
        </DialogContent>
      </Dialog>

      {/* Recharge Dialog */}
      <Dialog open={showRecharge} onOpenChange={setShowRecharge}>
        <DialogContent className="bg-white border-pos-line max-w-md">
          <DialogHeader>
            <DialogTitle className="text-pos-ink">储值充值</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <RechargeDialog
              member={selectedMember}
              onSuccess={handleRecharged}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Issue Coupon Dialog */}
      <Dialog open={showIssueCoupon} onOpenChange={setShowIssueCoupon}>
        <DialogContent className="bg-white border-pos-line max-w-md">
          <DialogHeader>
            <DialogTitle className="text-pos-ink">发放优惠券</DialogTitle>
          </DialogHeader>
          {selectedMember && (
            <IssueCouponDialog
              member={selectedMember}
              onSuccess={handleCouponIssued}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Member Detail Panel */}
      <Dialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
      >
        <DialogContent
          className="bg-white border-pos-line max-w-3xl !max-h-[90vh] overflow-hidden p-0"
          showCloseButton
        >
          {selectedMember && (
            <MemberDetailPanel memberId={selectedMember.id} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
