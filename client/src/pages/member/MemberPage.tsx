import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SafeChart from '@client/src/components/SafeChart';
import { toast } from 'sonner';
import { memberApi } from '@client/src/api/member';
import type { MemberMergeCandidate, MemberMergeCandidateGroup, MemberMergeResult } from '@client/src/api/member';
import { useAuth } from '@client/src/contexts/AuthContext';
import { errMsg } from '@/utils/errMsg';
import type {
  Member,
  MemberTag,
  MemberProfile,
  MemberPoint,
} from '@shared/api.interface';
import { CHART_PRIMARY, CHART_POSITIVE } from '@client/src/lib/chart-colors';

const LEVEL_LABEL: Record<string, string> = {
  normal: '会员卡', silver: '银卡', gold: '金卡', diamond: '钻石卡', vip: 'VIP',
};

const MemberPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canMerge = hasPermission('member:merge');

  const [list, setList] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [tags, setTags] = useState<MemberTag[]>([]);
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [points, setPoints] = useState<MemberPoint[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<Member>>({ name: '', phone: '', level: 'normal' });
  const [pointDelta, setPointDelta] = useState(0);
  const [pointRemark, setPointRemark] = useState('');
  const [campaignTag, setCampaignTag] = useState('');
  const [campaignTitle, setCampaignTitle] = useState('');

  // 合并相关状态
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [candMap, setCandMap] = useState<Record<string, MemberMergeCandidate>>({});
  const [survivorId, setSurvivorId] = useState('');
  const [reason, setReason] = useState('');
  const [mergeResult, setMergeResult] = useState<MemberMergeResult | null>(null);

  const load = async () => {
    try {
      const r = await memberApi.list(page, 20, keyword || undefined);
      setList(r?.list ?? []); setTotal(r?.total ?? 0);
      // 单页选择：翻页/搜索后清空勾选，避免跨页误合并（防误操作）
      setSelectedIds([]);
    } catch { toast('加载失败'); }
  };
  const loadTags = async () => {
    try { setTags(await memberApi.tags()); } catch { /* noop */ }
  };

  useEffect(() => { load(); }, [page, keyword]);
  useEffect(() => { loadTags(); }, []);

  const saveMember = async () => {
    if (!form.name) { toast('请填写会员名称'); return; }
    try {
      if (form.id) await memberApi.update(form); else await memberApi.create(form);
      toast.success('已保存');
      setShowForm(false); setForm({ name: '', phone: '', level: 'normal' });
      load();
    } catch (e) { toast(errMsg(e, '保存失败')); }
  };

  const openProfile = async (m: Member) => {
    try {
      setProfile(await memberApi.profile(m.id));
      setPoints([]);
    } catch (e) { toast(errMsg(e, '加载画像失败')); }
  };

  const adjustPoints = async () => {
    if (!profile || pointDelta === 0) { toast('请输入积分变动'); return; }
    try {
      await memberApi.adjustPoints(profile.memberId, 'manual', pointDelta, pointRemark || '手工调整');
      toast.success('积分已调整');
      setPointDelta(0); setPointRemark('');
      openProfile({ id: profile.memberId } as Member);
      load();
    } catch (e) { toast('调整失败'); }
  };

  const sendCampaign = async () => {
    if (!campaignTag || !campaignTitle) { toast('请选择标签并填写标题'); return; }
    try {
      const r = await memberApi.campaign(campaignTag, campaignTitle);
      toast.success(`营销推送已提交，覆盖 ${r.affectedCount} 人`);
    } catch (e) { toast(errMsg(e, '推送失败')); }
  };

  // ===== 多选 =====
  const allOnPageSelected = list.length > 0 && list.every((m) => selectedIds.includes(m.id));
  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !list.some((m) => m.id === id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...list.map((m) => m.id)])));
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectedMembers = list.filter((m) => selectedIds.includes(m.id));

  // ===== 打开合并弹窗：拉取查重候选补全手机号脱敏 + 以订单数辅助判断保留方 =====
  const openMergeModal = async () => {
    if (selectedIds.length < 2) return;
    setMergeLoading(true);
    try {
      // candidates 非必填：失败（如网络/权限）不阻断合并，仅失去手机号脱敏与默认排序提示
      const groups = (await memberApi.mergeCandidates().catch(() => [] as MemberMergeCandidateGroup[])) || [];
      const map: Record<string, MemberMergeCandidate> = {};
      for (const g of groups) for (const m of g.members) map[m.id] = m;
      setCandMap(map);
      // 默认 survivor = 订单数最多者（更多交易历史，作为保留方更合理；并列取先选）
      const ranked = [...selectedMembers].sort(
        (a, b) => (map[b.id]?.orderCount ?? b.orderCount ?? 0) - (map[a.id]?.orderCount ?? a.orderCount ?? 0),
      );
      setSurvivorId(ranked[0]?.id || '');
      setReason('');
      setMergeResult(null);
      setMergeModalOpen(true);
    } finally {
      setMergeLoading(false);
    }
  };

  const handleMergeConfirm = async () => {
    if (!survivorId) { toast('请选择保留会员（survivor）'); return; }
    const mergedIds = selectedIds.filter((id) => id !== survivorId);
    if (mergedIds.length === 0) { toast('请至少勾选一个被合并会员'); return; }
    setMergeLoading(true);
    try {
      const res = await memberApi.merge({
        survivorId,
        mergedIds,
        reason: reason.trim() || undefined,
      });
      setMergeResult(res);
      setSelectedIds([]);
      toast.success(`合并成功，批次号 ${res.runId}`);
    } catch (e) {
      toast(errMsg(e, '合并失败'));
    } finally {
      setMergeLoading(false);
    }
  };

  const closeMergeModal = () => {
    setMergeModalOpen(false);
    setMergeResult(null);
    load();
  };

  const catOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 80, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: { type: 'category' as const, data: [...(profile?.categoryBreakdown || [])].reverse().map((c) => c.category), axisLabel: { fontSize: 10 } },
    series: [{ type: 'bar' as const, data: [...(profile?.categoryBreakdown || [])].reverse().map((c) => c.amount), itemStyle: { color: CHART_POSITIVE, borderRadius: [0, 4, 4, 0] }, barWidth: 14 }],
  };
  const monthOption = {
    tooltip: { trigger: 'axis' as const }, grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category' as const, data: profile?.purchaseMonths.map((m) => m.month) || [], axisLabel: { fontSize: 10, rotate: 45 } },
    yAxis: { type: 'value' as const },
    series: [{ type: 'line' as const, data: profile?.purchaseMonths.map((m) => m.amount) || [], itemStyle: { color: CHART_PRIMARY }, areaStyle: { color: 'rgba(59,130,246,0.15)' } }],
  };

  return (
    <div className="p-5 space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-800">会员私域运营</h1>
          <div className="flex items-center gap-2">
            {canMerge && (
              <button
                onClick={openMergeModal}
                disabled={selectedIds.length < 2 || mergeLoading}
                className="px-4 py-2 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                合并重复会员（{selectedIds.length}）
              </button>
            )}
            <button onClick={() => { setForm({ name: '', phone: '', level: 'normal' }); setShowForm((v) => !v); }} className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600">
              {showForm ? '收起' : '新增会员'}
            </button>
          </div>
        </div>

        {showForm && (
          <div className="border border-gray-200 rounded p-4 mb-3 flex gap-3 flex-wrap items-end">
            <input placeholder="会员名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm" />
            <input placeholder="手机号" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm" />
            <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} className="px-3 py-2 border border-gray-300 rounded text-sm">
              {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button onClick={saveMember} className="px-4 py-2 bg-emerald-500 text-white rounded text-sm hover:bg-emerald-600">保存</button>
          </div>
        )}

        <div className="flex items-center gap-3 mb-3">
          <input placeholder="搜索会员名称" value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded text-sm w-48" />
          {canMerge && selectedIds.length >= 2 && (
            <span className="text-xs text-amber-700">
              已选 {selectedIds.length} 个会员，点击「合并重复会员」选择保留方并完成合并
            </span>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-medium">
              <th className="w-8 px-2 py-2 text-center">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  className="cursor-pointer"
                  aria-label="全选本页"
                />
              </th>
              <th className="px-3 py-2 text-left">会员号</th>
              <th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-left">等级</th>
              <th className="px-3 py-2 text-right">累计消费</th>
              <th className="px-3 py-2 text-right">订单数</th>
              <th className="px-3 py-2 text-right">积分</th>
              <th className="px-3 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">暂无会员</td></tr>
            ) : (
              list.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(m.id)}
                      onChange={() => toggleSelect(m.id)}
                      className="cursor-pointer"
                      aria-label={`选择 ${m.name}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-700">{m.memberNo}</td>
                  <td className="px-3 py-2 text-gray-700">{m.name}</td>
                  <td className="px-3 py-2 text-gray-600">{LEVEL_LABEL[m.level] || m.level}</td>
                  <td className="px-3 py-2 text-right text-gray-700">¥{(m.totalSpent ?? 0).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{m.orderCount}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{m.points}</td>
                  <td className="px-3 py-2 text-center"><button onClick={() => openProfile(m)} className="text-primary text-xs">画像</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="text-xs text-gray-400 mt-2">共 {total} 人</div>
      </div>

      {profile && (
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-medium text-gray-800">会员画像 · {profile.memberName}</div>
            <button onClick={() => setProfile(null)} className="text-gray-400 text-xs">关闭</button>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { label: '累计消费', value: `¥${profile.totalSpent.toFixed(2)}` },
              { label: '客单价', value: `¥${profile.avgOrderValue.toFixed(2)}` },
              { label: '订单数', value: String(profile.orderCount) },
              { label: '积分', value: String(profile.points) },
            ].map((c) => (
              <div key={c.label} className="bg-gray-50 rounded p-3">
                <div className="text-lg font-semibold text-gray-800">{c.value}</div>
                <div className="text-xs text-gray-500 mt-1">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">类目消费分布</div>
              <SafeChart option={catOption} style={{ height: 260 }} />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">月度消费趋势</div>
              <SafeChart option={monthOption} style={{ height: 260 }} />
            </div>
          </div>
          <div className="flex gap-3 flex-wrap items-end border-t border-gray-100 pt-3">
            <input type="number" placeholder="积分变动" value={pointDelta} onChange={(e) => setPointDelta(Number(e.target.value))} className="px-3 py-2 border border-gray-300 rounded text-sm w-28" />
            <input placeholder="备注" value={pointRemark} onChange={(e) => setPointRemark(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm w-40" />
            <button onClick={adjustPoints} className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600">调整积分</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-5">
        <h2 className="text-base font-medium text-gray-800 mb-3">标签与精准营销</h2>
        <div className="flex gap-2 flex-wrap mb-4">
          {tags.length === 0 ? <span className="text-xs text-gray-400">暂无标签</span> : tags.map((t) => (
            <span key={t.id} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">{t.name}</span>
          ))}
        </div>
        <div className="flex gap-3 flex-wrap items-end">
          <select value={campaignTag} onChange={(e) => setCampaignTag(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm">
            <option value="">选择标签</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input placeholder="营销标题" value={campaignTitle} onChange={(e) => setCampaignTitle(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm w-48" />
          <button onClick={sendCampaign} className="px-4 py-2 bg-rose-500 text-white rounded text-sm hover:bg-rose-600">发起推送</button>
        </div>
      </div>

      {mergeModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[680px] max-w-[95vw] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">合并重复会员</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={closeMergeModal}>×</button>
            </div>

            {mergeResult ? (
              <div className="p-6 flex-1 overflow-y-auto">
                <div className="rounded bg-green-50 border border-green-200 p-4 text-sm text-green-800 space-y-1">
                  <p className="font-medium">合并成功</p>
                  <p>批次号（runId）：<span className="font-mono">{mergeResult.runId}</span></p>
                  <p>已合并 {mergeResult.mergedCount} 个会员到保留会员（被合并方仅打标，未删除；积分/储值经账本事件安全转移，关联订单全部改指保留方）。</p>
                  <p>
                    转移积分 {mergeResult.movedPoints} · 转移储值 ¥{(mergeResult.movedStoredValue / 100).toFixed(2)} ·
                    合并消费额 ¥{mergeResult.movedTotalSpent.toFixed(2)} · 合并订单数 {mergeResult.movedOrderCount}
                  </p>
                  <p className="text-gray-500">
                    该合并已写入 member_merge_log。如需回滚，可前往{' '}
                    <Link to="/base/member-merge-audit" className="text-primary hover:underline" onClick={closeMergeModal}>
                      会员合并审计
                    </Link>{' '}
                    凭批次号整批回滚。
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-5 flex-1 overflow-y-auto">
                <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  合并后，被合并会员<strong>不会被删除</strong>，仅打上「已合并」标记；其积分/储值经账本事件安全转移给保留会员，
                  关联零售订单全部改指保留方。该操作可经审计日志按批次回滚。
                </div>

                <p className="text-sm text-gray-600 mb-2">请选择保留会员（survivor）：</p>
                <div className="space-y-2">
                  {selectedMembers.map((m) => {
                    const cand = candMap[m.id];
                    const orderCount = cand?.orderCount ?? m.orderCount ?? 0;
                    const storedYuan = cand?.storedValue != null ? (cand.storedValue / 100).toFixed(2) : '—';
                    const phoneText = cand?.phoneMasked ? ` · ${cand.phoneMasked}` : '';
                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-3 border rounded p-3 cursor-pointer transition-colors ${
                          survivorId === m.id ? 'border-primary bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="survivor"
                          checked={survivorId === m.id}
                          onChange={() => setSurvivorId(m.id)}
                          className="cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{m.name}</div>
                          <div className="text-xs text-gray-500 truncate">{m.memberNo}{phoneText}</div>
                        </div>
                        <div className="text-right text-xs whitespace-nowrap">
                          <div className="text-gray-500">订单数 / 储值</div>
                          <div className="font-medium">{orderCount} · ¥{storedYuan}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <label className="block text-sm text-gray-700 mb-1">合并原因（可选，写入审计日志）</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="如：同一顾客重复注册，保留有交易的会员"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={closeMergeModal}
                disabled={mergeLoading}
              >
                {mergeResult ? '关闭' : '取消'}
              </button>
              {!mergeResult && (
                <button
                  className="px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleMergeConfirm}
                  disabled={mergeLoading || !survivorId}
                >
                  {mergeLoading ? '合并中...' : `确认合并（${selectedIds.length - (survivorId ? 1 : 0)} 个被合并）`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemberPage;
