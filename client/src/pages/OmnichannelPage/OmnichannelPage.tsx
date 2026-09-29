import { useState, useEffect, useMemo } from 'react';
import { Search, Truck, Package, User, Clock, ShoppingBag, X, MapPin, Phone, Info } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { omnichannel as omniApi } from '@client/src/api';
import type { OmnichannelOrder } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';

const TABS = [
  { key: 'pending_ship', label: '待发货' },
  { key: 'pending_pickup', label: '待自提' },
  { key: 'all', label: '全部' },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '待发货', cls: 'bg-pos-warn-bg text-pos-warn border-pos-warn/30' },
  paid: { label: '待发货', cls: 'bg-pos-warn-bg text-pos-warn border-pos-warn/30' },
  ready: { label: '待自提', cls: 'bg-pos-info-bg text-pos-info border-pos-info/30' },
  shipped: { label: '已发货', cls: 'bg-pos-ok-bg text-pos-ok border-pos-ok/30' },
  completed: { label: '已完成', cls: 'bg-pos-paper text-pos-ink-3 border-pos-line-soft' },
};

const TYPE_LABEL: Record<string, string> = { ship: '网订店发', pickup: '到店自提' };

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function maskPhone(p?: string): string {
  if (!p) return '';
  return p.length >= 11 ? p.slice(0, 3) + '****' + p.slice(-4) : p;
}

export default function OmnichannelPage() {
  const [activeTab, setActiveTab] = useState('pending_ship');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<OmnichannelOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<OmnichannelOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      let status: string | undefined;
      let type: string | undefined;
      if (activeTab === 'pending_ship') { status = 'pending'; type = 'ship'; }
      if (activeTab === 'pending_pickup') { status = 'ready'; type = 'pickup'; }
      const res = await omniApi.getOmnichannelOrders({ status, type, pageSize: 50 });
      setOrders(res.items || []);
    } catch (e) {
      logger.error('fetch omnichannel orders failed', e as Error);
      setOrders([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { void fetchList(); }, [activeTab]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return orders;
    return orders.filter((o) =>
      o.orderNo.toLowerCase().includes(kw) ||
      (o.memberName && o.memberName.toLowerCase().includes(kw)) ||
      (o.memberPhone && o.memberPhone.includes(kw)),
    );
  }, [orders, search]);

  const counts = useMemo(() => {
    const c = { pending_ship: 0, pending_pickup: 0, all: orders.length };
    for (const o of orders) {
      if (o.type === 'ship' && (o.status === 'pending' || o.status === 'paid')) c.pending_ship++;
      if (o.type === 'pickup' && (o.status === 'ready' || o.status === 'paid')) c.pending_pickup++;
    }
    return c;
  }, [orders]);

  const todayCount = useMemo(() => {
    const today = new Date().toDateString();
    return orders.filter((o) => new Date(o.createdAt).toDateString() === today).length;
  }, [orders]);

  const handleShip = async (id: string): Promise<void> => {
    if (!await showConfirm('确认发货？')) return;
    try {
      await omniApi.shipOrder(id, {});
      await fetchList();
    } catch (e) {
      logger.error('ship order failed', e as Error);
      toast('发货失败，请重试');
    }
  };

  const handlePickup = async (order: OmnichannelOrder): Promise<void> => {
    if (!order.pickupCode) { toast('缺少自提码，无法核销'); return; }
    if (!await showConfirm(`确认核销自提码 ${order.pickupCode}？`)) return;
    try {
      await omniApi.pickupOrder(order.id);
      await fetchList();
    } catch (e) {
      logger.error('pickup order failed', e as Error);
      toast('核销失败，请重试');
    }
  };

  const openDetail = async (id: string): Promise<void> => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const data = await omniApi.getOrderDetail(id);
      setDetail(data);
    } catch (e) {
      logger.error('fetch order detail failed', e as Error);
    } finally { setDetailLoading(false); }
  };

  const badge = (s: string) => STATUS_BADGE[s] || { label: s, cls: 'bg-pos-paper text-pos-ink-3 border-pos-line-soft' };
  const canShip = (o: OmnichannelOrder) => o.type === 'ship' && (o.status === 'pending' || o.status === 'paid');
  const canPick = (o: OmnichannelOrder) => o.type === 'pickup' && (o.status === 'ready' || o.status === 'paid');
  const isDone = (o: OmnichannelOrder) => o.status === 'shipped' || o.status === 'completed';

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-pos-ink">全渠道履约</h1>
          <p className="text-xs text-pos-ink-3 mt-0.5">决策 / 全渠道履约</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-pos-ink-3">今日新增订单</span>
          <span className="text-base font-semibold text-pos-accent tabular-nums">{todayCount} 单</span>
        </div>
      </header>

      <div className="px-5 py-3 bg-white border-b border-pos-line flex items-center gap-4 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索订单号 / 收货人 / 手机号"
            className="w-full h-9 pl-9 pr-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-pos-paper rounded-lg p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`px-4 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 ${
                activeTab === t.key ? 'bg-white text-pos-ink font-medium shadow-sm' : 'text-pos-ink-2 hover:text-pos-ink'
              }`}>
              {t.label}
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                activeTab === t.key ? 'bg-pos-accent-light text-pos-accent font-medium' : 'bg-pos-line-soft text-pos-ink-3'
              }`}>
                {counts[t.key as keyof typeof counts]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 text-pos-ink-3">
            <div className="w-8 h-8 border-2 border-pos-accent/30 border-t-pos-accent rounded-full animate-spin mb-3" />
            <p className="text-sm">加载中...</p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-pos-ink-3">
            <Package size={40} className="mb-3 opacity-30" />
            <p className="text-sm">暂无订单</p>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((order) => {
              const b = badge(order.status);
              return (
                 <div key={order.id}
                   className="bg-white rounded-xl border border-pos-line shadow-sm p-4 hover:shadow-md hover:border-pos-accent/30 transition-all">
                   <div className="flex items-start justify-between mb-3">
                     <div className="flex items-center gap-3">
                       <div className="w-9 h-9 rounded-lg bg-pos-accent-light flex items-center justify-center text-pos-accent">
                         {order.type === 'pickup' ? <User size={18} /> : <Truck size={18} />}
                       </div>
                       <div>
                         <div className="flex items-center gap-2">
                           <span className="font-medium text-pos-ink">{order.orderNo}</span>
                           <span className={`px-2 py-0.5 rounded text-xs font-medium border ${b.cls}`}>{b.label}</span>
                         </div>
                         <div className="flex items-center gap-3 mt-0.5 text-xs text-pos-ink-2">
                           <span className="flex items-center gap-1"><ShoppingBag size={10} /> {order.channel}</span>
                           <span>{TYPE_LABEL[order.type] || order.type}</span>
                           <span className="flex items-center gap-1"><Clock size={10} /> {fmtTime(order.createdAt)}</span>
                         </div>
                       </div>
                     </div>
                     <div className="text-right">
                       <div className="text-xs text-pos-ink-3">订单金额</div>
                       <div className="text-lg font-bold text-pos-accent tabular-nums">¥{order.totalAmount.toFixed(2)}</div>
                     </div>
                   </div>
                   <div className="bg-pos-paper/50 rounded-lg p-3 mb-3">
                     {(order.items || []).map((it) => (
                       <div key={it.id || it.skuId} className="flex items-center justify-between py-1 last:pt-1 first:pb-1">
                         <div className="flex items-center gap-2">
                           <Package size={12} className="text-pos-ink-3" />
                           <span className="text-sm text-pos-ink">{it.styleName}</span>
                           <span className="text-xs text-pos-ink-2">{it.colorId} / {it.sizeId}</span>
                         </div>
                         <span className="text-sm text-pos-ink-2">x{it.qty}</span>
                       </div>
                     ))}
                   </div>
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2 text-sm">
                       <div className="w-6 h-6 rounded-full bg-pos-paper flex items-center justify-center text-pos-ink-3 text-xs">
                         {(order.memberName || '?').charAt(0)}
                       </div>
                       <span className="text-pos-ink">{order.memberName || '匿名用户'}</span>
                       <span className="text-pos-ink-2">{maskPhone(order.memberPhone)}</span>
                       {order.pickupCode && (
                         <span className="ml-2 px-2 py-0.5 bg-pos-accent-light text-pos-accent rounded text-xs font-mono font-medium">
                           自提码 {order.pickupCode}
                         </span>
                       )}
                     </div>
                     <div className="flex items-center gap-2">
                       {canShip(order) && (
                         <>
                           <button onClick={() => openDetail(order.id)}
                             className="px-3 py-1.5 text-xs border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors">
                             查看详情
                           </button>
                           <button onClick={() => handleShip(order.id)}
                             className="px-4 py-1.5 text-xs bg-pos-accent text-white rounded-md font-medium hover:bg-[#A8401F] transition-colors flex items-center gap-1">
                             <Truck size={12} /> 确认发货
                           </button>
                         </>
                       )}
                       {canPick(order) && (
                         <>
                           <button onClick={() => openDetail(order.id)}
                             className="px-3 py-1.5 text-xs border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors">
                             查看详情
                           </button>
                           <button onClick={() => handlePickup(order)}
                             className="px-4 py-1.5 text-xs bg-pos-accent text-white rounded-md font-medium hover:bg-[#A8401F] transition-colors flex items-center gap-1">
                             <User size={12} /> 确认核销
                           </button>
                         </>
                       )}
                       {isDone(order) && (
                         <button onClick={() => openDetail(order.id)}
                           className="px-3 py-1.5 text-xs border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors">
                           查看详情
                         </button>
                       )}
                     </div>
                   </div>
                 </div>
              );
            })}
          </div>
        )}
      </div>

      {detail !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDetail(null)}>
           <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
             <div className="flex items-center justify-between px-5 py-4 border-b border-pos-line">
               <h3 className="font-semibold text-pos-ink">订单详情</h3>
               <button onClick={() => setDetail(null)} className="text-pos-ink-3 hover:text-pos-ink"><X size={18} /></button>
             </div>
             {detailLoading ? (
               <div className="p-10 text-center text-pos-ink-3 text-sm">加载中...</div>
             ) : (
               <div className="p-5 space-y-4 text-sm">
                 <div><span className="text-pos-ink-3">订单号：</span><span className="font-medium text-pos-ink">{detail.orderNo}</span></div>
                 <div className="grid grid-cols-2 gap-3">
                   <div><span className="text-pos-ink-3">渠道：</span><span className="text-pos-ink">{detail.channel}</span></div>
                   <div><span className="text-pos-ink-3">类型：</span><span className="text-pos-ink">{TYPE_LABEL[detail.type] || detail.type}</span></div>
                   <div><span className="text-pos-ink-3">下单时间：</span><span className="text-pos-ink">{fmtTime(detail.createdAt)}</span></div>
                   <div><span className="text-pos-ink-3">金额：</span><span className="font-semibold text-pos-accent">¥{detail.totalAmount.toFixed(2)}</span></div>
                 </div>
                 <div className="border-t border-pos-line-soft pt-3">
                   <div className="text-xs text-pos-ink-3 mb-2 flex items-center gap-1"><Info size={12} /> 商品明细</div>
                   <div className="space-y-2">
                     {(detail.items || []).map((it) => (
                       <div key={it.id || it.skuId} className="flex items-center justify-between bg-pos-paper/50 rounded-lg px-3 py-2">
                         <div>
                           <div className="text-pos-ink">{it.styleName}</div>
                           <div className="text-xs text-pos-ink-2">{it.colorId} / {it.sizeId}</div>
                         </div>
                         <div className="text-right">
                           <div className="text-pos-ink">x{it.qty}</div>
                           <div className="text-xs text-pos-ink-2">¥{it.price.toFixed(2)}</div>
                         </div>
                       </div>
                     ))}
                   </div>
                 </div>
                 <div className="border-t border-pos-line-soft pt-3">
                   <div className="text-xs text-pos-ink-3 mb-2 flex items-center gap-1"><User size={12} /> 收货人</div>
                   <div className="text-pos-ink">{detail.memberName || '匿名用户'}</div>
                   <div className="text-pos-ink-2 flex items-center gap-1 mt-1"><Phone size={12} /> {detail.memberPhone || '-'}</div>
                 </div>
                 {detail.address && (
                   <div className="border-t border-pos-line-soft pt-3">
                     <div className="text-xs text-pos-ink-3 mb-2 flex items-center gap-1"><MapPin size={12} /> 收件地址</div>
                     <div className="text-pos-ink">{detail.address}</div>
                   </div>
                 )}
                 {detail.pickupCode && (
                   <div className="border-t border-pos-line-soft pt-3">
                     <div className="text-xs text-pos-ink-3 mb-2">自提码</div>
                     <span className="px-3 py-1 bg-pos-accent-light text-pos-accent rounded font-mono font-medium">{detail.pickupCode}</span>
                   </div>
                 )}
                 {detail.shippedAt && (
                   <div className="border-t border-pos-line-soft pt-3">
                     <div className="text-xs text-pos-ink-3 mb-2">发货时间</div>
                     <div className="text-pos-ink">{fmtTime(detail.shippedAt)}</div>
                   </div>
                 )}
                 {detail.sourceNo && (
                   <div className="border-t border-pos-line-soft pt-3">
                     <div className="text-xs text-pos-ink-3 mb-2">外部单号</div>
                     <div className="text-pos-ink">{detail.sourceNo}</div>
                   </div>
                 )}
               </div>
             )}
           </div>
        </div>
      )}
    </div>
  );
}
