import { useState, useEffect } from 'react';
import {
  Search, Tag, Percent, Gift, ShoppingBag, Users, Ticket,
  Calendar, Clock, Plus, X, Loader2,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import AsyncState from '@client/src/components/AsyncState';
import { errMsg } from '@client/src/lib/errMsg';
import { getPromotions, getPromotionById } from '@client/src/api/promotions';
import type { Promotion } from '@shared/api.interface';

const STATUS_TABS = [
  { key: 'active', label: '进行中' },
  { key: 'upcoming', label: '未开始' },
  { key: 'ended', label: '已结束' },
];

const TYPE_ICON: Record<string, React.ReactNode> = {
  full_reduction: <Tag size={14} />,
  threshold_discount: <Percent size={14} />,
  nth_discount: <ShoppingBag size={14} />,
  buy_gift: <Gift size={14} />,
  member_price: <Users size={14} />,
  coupon: <Ticket size={14} />,
};

const TYPE_LABEL: Record<string, string> = {
  full_reduction: '满减', threshold_discount: '满件折',
  nth_discount: '第二件折扣', buy_gift: '买赠',
  member_price: '会员价', coupon: '优惠券',
};

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-pos-ok-bg text-pos-ok border-pos-ok-bg',
  upcoming: 'bg-pos-warn-bg text-pos-warn border-pos-warn-bg',
  ended: 'bg-pos-paper text-pos-ink-3 border-pos-line',
};

const STATUS_LABEL: Record<string, string> = {
  active: '进行中', upcoming: '未开始', ended: '已结束',
};

const SOURCE_LABEL: Record<string, string> = {
  erp_down: '总部下发', store_local: '门店自定义',
};

function fmtRule(p: Promotion): string {
  const th = p.threshold ?? 0;
  const v = p.discountValue ?? 0;
  switch (p.type) {
    case 'full_reduction': return `满${th}减${v}`;
    case 'threshold_discount': return `满${th}件享${(v * 10).toFixed(1)}折`;
    case 'nth_discount': return `第${th}件${(v * 10).toFixed(1)}折`;
    case 'buy_gift': return `满${th}赠礼品`;
    case 'member_price': return `会员专享${(v * 10).toFixed(1)}折`;
    case 'coupon': return `满${th}可用券减${v}`;
    default: return p.name;
  }
}

const fmtDate = (s?: string): string => (s ? s.slice(0, 10) : '-');
const fmtPeriod = (p: Promotion): string => `${fmtDate(p.validFrom)} ~ ${fmtDate(p.validTo)}`;

export default function PromotionsPage() {
  const [activeTab, setActiveTab] = useState('active');
  const [searchValue, setSearchValue] = useState('');
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  /** 列表加载失败原因；此前失败会 setPromotions([])，界面显示「暂无促销活动」，与真的没数据无法区分 */
  const [listError, setListError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Promotion | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** 详情加载失败原因；此前固定显示「加载失败」，不含任何可诊断信息 */
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setListError(null);
      try {
        const res = await getPromotions({ status: activeTab, page: 1, pageSize: 50 });
        if (!cancelled) setPromotions(res.items || []);
      } catch (err) {
        logger.error('load promotions failed', err as Error);
        if (!cancelled) {
          setPromotions([]);
          setListError(errMsg(err, '促销活动加载失败，请检查网络后重试'));
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeTab, reloadKey]);

  useEffect(() => {
    if (!detailId) { setDetail(null); return; }
    let cancelled = false;
    async function load(): Promise<void> {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const data = await getPromotionById(detailId);
        if (!cancelled) setDetail(data);
      } catch (err) {
        logger.error('load promotion detail failed', err as Error);
        if (!cancelled) setDetailError(errMsg(err, '促销详情加载失败'));
      } finally { if (!cancelled) setDetailLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [detailId]);

  const filtered = promotions.filter((p: Promotion) =>
    p.name.toLowerCase().includes(searchValue.toLowerCase()),
  );

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-pos-ink">促销管理</h1>
          <p className="text-xs text-pos-ink-3 mt-0.5">运营 / 促销管理</p>
        </div>
        <button className="h-9 px-4 bg-pos-accent text-white rounded-lg text-sm font-medium hover:bg-pos-accent-hover transition-colors flex items-center gap-1.5">
          <Plus size={16} /> 新建促销
        </button>
      </header>

      <div className="px-5 py-3 bg-white border-b border-pos-line flex items-center gap-4 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
          <input type="text" value={searchValue} onChange={(e) => setSearchValue(e.target.value)}
            placeholder="搜索活动名称"
            className="w-full h-9 pl-9 pr-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors" />
        </div>
        <div className="flex items-center gap-1 bg-pos-paper rounded-lg p-1">
          {STATUS_TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === tab.key ? 'bg-white text-pos-ink font-medium shadow-sm' : 'text-pos-ink-3 hover:text-pos-ink'
              }`}>
              {tab.label}
               <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                 activeTab === tab.key ? 'bg-pos-accent-light text-pos-accent' : 'bg-pos-paper text-pos-ink-3'
               }`}>
                {activeTab === tab.key ? filtered.length : ''}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {listError ? (
          <AsyncState error={listError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-pos-ink-3">
            <Loader2 size={32} className="animate-spin mb-3" />
            <p className="text-sm">加载中...</p>
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((promo: Promotion) => (
              <div key={promo.id}
                className="bg-white rounded-xl border border-pos-line shadow-sm p-4 hover:shadow-md hover:border-pos-accent/30 transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-pos-accent-light flex items-center justify-center text-pos-accent">
                      {TYPE_ICON[promo.type] || <Tag size={14} />}
                    </div>
                    <div>
                      <h3 className="font-medium text-pos-ink group-hover:text-pos-accent transition-colors">{promo.name}</h3>
                      <span className="text-xs text-pos-ink-3">{TYPE_LABEL[promo.type] || promo.type}</span>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${STATUS_STYLE[promo.status] || STATUS_STYLE.ended}`}>
                    {STATUS_LABEL[promo.status] || promo.status}
                  </span>
                </div>
                <div className="bg-pos-paper rounded-lg p-3 mb-3">
                  <div className="text-xs text-pos-ink-3 mb-1">优惠规则</div>
                  <div className="text-sm text-pos-ink font-medium">{fmtRule(promo)}</div>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-pos-ink-3">
                    <Calendar size={12} /><span>{fmtPeriod(promo)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-pos-ink-3">
                    <Clock size={12} /><span>{SOURCE_LABEL[promo.source] || promo.source}</span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-pos-line-soft flex items-center justify-between">
                  <button onClick={() => setDetailId(promo.id)}
                    className="text-xs text-pos-accent hover:text-pos-accent-hover transition-colors">查看详情</button>
                  {promo.status === 'active' && (
                    <button className="text-xs text-pos-ink-3 hover:text-pos-danger transition-colors">终止活动</button>
                  )}
                  {promo.status === 'upcoming' && (
                    <button className="text-xs text-pos-ink-3 hover:text-pos-ink transition-colors">编辑</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-pos-ink-3">
            <Tag size={40} className="mb-3 opacity-30" />
            <p className="text-sm">{searchValue ? '未找到匹配的促销活动' : `暂无${STATUS_LABEL[activeTab]}的促销活动`}</p>
          </div>
        )}
      </div>

      {detailId && (
        <div className="fixed inset-0 bg-pos-ink/40 flex items-center justify-center z-50 p-4" onClick={() => setDetailId(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-pos-line">
              <h3 className="font-semibold text-pos-ink">促销详情</h3>
              <button onClick={() => setDetailId(null)} className="text-pos-ink-3 hover:text-pos-ink transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {detailError ? (
                <AsyncState error={detailError} compact />
              ) : detailLoading && !detail ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={24} className="animate-spin text-pos-accent" />
                </div>
              ) : detail ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-pos-accent-light flex items-center justify-center text-pos-accent">
                      {TYPE_ICON[detail.type] || <Tag size={18} />}
                    </div>
                    <div>
                      <div className="font-medium text-pos-ink">{detail.name}</div>
                      <div className="text-xs text-pos-ink-3">{TYPE_LABEL[detail.type] || detail.type}</div>
                    </div>
                    <span className={`ml-auto px-2 py-0.5 rounded text-xs font-medium border ${STATUS_STYLE[detail.status] || STATUS_STYLE.ended}`}>
                      {STATUS_LABEL[detail.status] || detail.status}
                    </span>
                  </div>
                  <div className="bg-pos-paper rounded-lg p-4">
                    <div className="text-xs text-pos-ink-3 mb-1">优惠规则</div>
                    <div className="text-base text-pos-ink font-medium">{fmtRule(detail)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {[
                      ['适用范围', detail.applyScope || '全部商品'],
                      ['来源', SOURCE_LABEL[detail.source] || detail.source],
                      ['有效期', fmtPeriod(detail)],
                      ['优先级', detail.priority],
                      ['会员专属', detail.isMemberOnly ? '是' : '否'],
                      ['使用门槛', detail.threshold ?? '无'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-xs text-pos-ink-3 mb-1">{k}</div>
                        <div className="text-pos-ink">{String(v)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-pos-line-soft">
                    <div className="text-xs text-pos-ink-3 mb-1">创建时间</div>
                    <div className="text-sm text-pos-ink">{fmtDate(detail.createdAt)}</div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-pos-ink-3 text-sm">加载失败</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
