import React, { useState, useEffect } from 'react';
import SafeChart from '@client/src/components/SafeChart';
import { toast } from 'sonner';
import { memberApi } from '@client/src/api/member';
import { errMsg } from '@/utils/errMsg';
import type {
  Member,
  MemberTag,
  MemberProfile,
  MemberPoint,
} from '@shared/api.interface';
import { CHART_PRIMARY, CHART_POSITIVE } from '@client/src/lib/chart-colors';

const LEVEL_LABEL: Record<string, string> = {
  normal: '普通', silver: '银卡', gold: '金卡', vip: 'VIP',
};

const MemberPage: React.FC = () => {
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

  const load = async () => {
    try {
      const r = await memberApi.list(page, 20, keyword || undefined);
      setList(r.list); setTotal(r.total);
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
          <button onClick={() => { setForm({ name: '', phone: '', level: 'normal' }); setShowForm((v) => !v); }} className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600">
            {showForm ? '收起' : '新增会员'}
          </button>
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

        <div className="flex gap-3 mb-3">
          <input placeholder="搜索会员名称" value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} className="px-3 py-2 border border-gray-300 rounded text-sm w-48" />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-medium">
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
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">暂无会员</td></tr>
            ) : (
              list.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-700">{m.memberNo}</td>
                  <td className="px-3 py-2 text-gray-700">{m.name}</td>
                  <td className="px-3 py-2 text-gray-600">{LEVEL_LABEL[m.level] || m.level}</td>
                  <td className="px-3 py-2 text-right text-gray-700">¥{m.totalSpent.toFixed(2)}</td>
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
    </div>
  );
};

export default MemberPage;
