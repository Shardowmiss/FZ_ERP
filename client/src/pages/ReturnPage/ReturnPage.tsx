import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, RefreshCw, ChevronRight, ArrowLeftRight, SearchX, Loader2, Package, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { useOffline } from '@client/src/contexts/OfflineContext';
import * as salesApi from '@client/src/api/sales';
import * as returnsApi from '@client/src/api/returns';
import type { SaleOrder, SaleItem, ReturnOrder, ReturnItem } from '@shared/api.interface';

import { STORE_ID } from '@client/src/lib/store';
import { useCurrentShift } from '@client/src/hooks/useCurrentShift';
const REFUND_METHODS = [
  { key: 'original', label: '原路退回' },
  { key: 'cash', label: '现金退款' },
  { key: 'card', label: '银行卡' },
  { key: 'wechat', label: '微信' },
  { key: 'alipay', label: '支付宝' },
];
const TABS = [
  { key: 'search', label: '搜索原单' },
  { key: 'records', label: '退货记录' },
];
type TabKey = 'search' | 'records';

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const getReturnable = (it: SaleItem) => it.qty - (it.refundedQty ?? 0);
const methodLabel = (m: string) => REFUND_METHODS.find((x) => x.key === m)?.label ?? m;
const round2 = (v: number) => Math.round(v * 100) / 100;
/**
 * 退货单价计算（P1-3 修复：按行占比分摊整单优惠，避免多退钱）
 * - 优先用行实付金额 lineAmount 反推单位实付价（含行内折扣）
 * - 否则按整单折扣率 orderDiscountRatio 对单价打折（整单满减/会员折扣等）
 */
const calcRefundUnitPrice = (it: SaleItem, orderDiscountRatio: number): number => {
  const qty = it.qty || 1;
  if (it.lineAmount && it.lineAmount > 0) return round2(it.lineAmount / qty);
  return round2((it.unitPrice ?? 0) * orderDiscountRatio);
};

const genTempReturnNo = (): string => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `TH${date}${rand}`;
};

export default function ReturnPage() {
  const { effectivelyOffline, getOfflineOrderList, createOfflineReturn, getOfflineReturnList } = useOffline();

  // F-5：退货同样必须归属班次，否则班次的退款金额统计缺失，现金长短款算不平
  const { shiftId: currentShiftId, error: shiftError } = useCurrentShift(
    STORE_ID,
    !effectivelyOffline,
  );

  const [tab, setTab] = useState<TabKey>('search');
  const [keyword, setKeyword] = useState('');
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SaleOrder | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [retQty, setRetQty] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState('original');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [records, setRecords] = useState<ReturnOrder[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // 整单折扣率：实付 / 原价合计，≤1；用于退货时按行占比分摊整单优惠（P1-3）
  const orderDiscountRatio = useMemo(() => {
    if (!detail) return 1;
    const its = detail.items ?? [];
    const gross = its.reduce((s, it) => s + (it.unitPrice ?? 0) * (it.qty || 0), 0);
    const net = detail.payAmount ?? detail.totalAmount ?? gross;
    return gross > 0 ? Math.min(1, Math.max(0, net / gross)) : 1;
  }, [detail]);

  const searchOrdersOnline = useCallback(async (kw: string) => {
    if (!kw.trim()) return setOrders([]);
    setOrdersLoading(true);
    try {
      const res = await salesApi.getOrders({ keyword: kw.trim(), page: 1, pageSize: 20, storeId: STORE_ID });
      setOrders(res.items);
    } catch (e) {
      logger.error('searchOrders failed', e as Error);
      toast.error('搜索单据失败'); setOrders([]);
    } finally { setOrdersLoading(false); }
  }, []);

  const searchOrdersOffline = useCallback(async (kw: string) => {
    if (!kw.trim()) return setOrders([]);
    setOrdersLoading(true);
    try {
      const offlineList = await getOfflineOrderList() as SaleOrder[];
      const lowerKw = kw.trim().toLowerCase();
      const filtered = offlineList.filter((o) => {
        if (!o) return false;
        const orderNo = o.orderNo ?? '';
        const memberPhone = (o as SaleOrder & { memberPhone?: string }).memberPhone ?? '';
        return orderNo.toLowerCase().includes(lowerKw) || memberPhone.toLowerCase().includes(lowerKw);
      });
      setOrders(filtered);
      if (filtered.length === 0) {
        toast.info('离线模式下未找到本地单据，请联网后重试');
      }
    } catch (e) {
      logger.error('searchOrdersOffline failed', e as Error);
      setOrders([]);
    } finally { setOrdersLoading(false); }
  }, [getOfflineOrderList]);

  const searchOrders = useCallback(async (kw: string) => {
    if (effectivelyOffline) {
      await searchOrdersOffline(kw);
    } else {
      await searchOrdersOnline(kw);
    }
  }, [effectivelyOffline, searchOrdersOnline, searchOrdersOffline]);

  useEffect(() => {
    if (tab !== 'search') return;
    const t = setTimeout(() => searchOrders(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword, tab, searchOrders]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      if (effectivelyOffline) {
        // 离线：从已加载的列表中找
        const found = orders.find((o) => o.id === id);
        if (found) {
          setDetail(found);
          const init: Record<string, number> = {};
          (found.items ?? []).forEach((it) => { if (it.id) init[it.id] = 0; });
          setRetQty(init);
        } else {
          setDetail(null);
          toast.warning('离线模式下无法加载单据详情');
        }
      } else {
        const o = await salesApi.getOrderById(id);
        setDetail(o);
        const init: Record<string, number> = {};
        (o.items ?? []).forEach((it) => { if (it.id) init[it.id] = 0; });
        setRetQty(init);
      }
    } catch (e) {
      logger.error('loadDetail failed', e as Error);
      toast.error('加载明细失败'); setDetail(null);
    } finally { setDetailLoading(false); }
  }, [effectivelyOffline, orders]);

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      if (effectivelyOffline) {
        // 离线：直接从本地 IndexedDB 读取，刷新页面也不丢（P1-2 修复）
        const list = (await getOfflineReturnList()) as ReturnOrder[];
        setRecords(list);
      } else {
        const res = await returnsApi.getReturns({ storeId: STORE_ID, page: 1, pageSize: 20 });
        setRecords(res.items);
      }
    } catch (e) {
      logger.error('loadRecords failed', e as Error);
      toast.error('加载退货记录失败');
    } finally { setRecordsLoading(false); }
  }, [effectivelyOffline, getOfflineReturnList]);

  useEffect(() => { if (tab === 'records') loadRecords(); }, [tab, loadRecords]);

  const items = detail?.items ?? [];
  const totalRefund = items.reduce((s, it) => s + calcRefundUnitPrice(it, orderDiscountRatio) * (retQty[it.id ?? ''] ?? 0), 0);
  const totalQty = items.reduce((s, it) => s + (retQty[it.id ?? ''] ?? 0), 0);

  const chgQty = (id: string, delta: number, max: number) =>
    setRetQty((p) => ({ ...p, [id]: Math.max(0, Math.min(max, (p[id] ?? 0) + delta)) }));

  const handleSelect = (id: string) => { setSelectedId(id); loadDetail(id); };

  const submitReturn = async () => {
    if (!detail || totalQty === 0) {
      if (totalQty === 0) toast.warning('请选择退货商品');
      return;
    }
    setSubmitting(true);
    try {
      const list: ReturnItem[] = items.filter((it) => (retQty[it.id ?? ''] ?? 0) > 0).map((it) => {
        const q = retQty[it.id ?? ''] ?? 0;
        const netPrice = calcRefundUnitPrice(it, orderDiscountRatio);
        return {
          originalItemId: it.id!,
          skuId: it.skuId,
          styleId: it.styleId,
          styleName: it.styleName,
          colorId: it.colorId,
          sizeId: it.sizeId,
          qty: q,
          // P1-3：按行占比分摊整单优惠，refundPrice / lineAmount 用实付单价，避免多退
          refundPrice: netPrice,
          lineAmount: round2(netPrice * q),
        };
      });

      if (effectivelyOffline) {
        // 离线：写入本地退货队列
        const tempNo = genTempReturnNo();
        const returnOrder: ReturnOrder = {
          id: tempNo,
          returnNo: tempNo,
          originalOrderNo: detail.orderNo,
          storeId: STORE_ID,
          memberId: detail.memberId,
          totalQty,
          refundAmount: Math.round(totalRefund * 100) / 100,
          refundMethod,
          status: 'offline_pending',
          syncedToErp: false,
          syncStatus: 'pending',
          remark: reason || undefined,
          // F-5：离线退货也带班次，联网同步后班次统计才完整
          shiftId: currentShiftId ?? undefined,
          items: list,
          memberName: detail.memberName,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await createOfflineReturn(returnOrder);
        toast.success('离线退货已暂存，联网后自动同步');
        setSelectedId(null); setDetail(null); setRetQty({});
        setReason(''); setRefundMethod('original');
      } else {
        await returnsApi.createReturn({
          storeId: STORE_ID,
          originalOrderNo: detail.orderNo,
          memberId: detail.memberId,
          items: list,
          refundMethod,
          remark: reason || undefined,
          // F-5：班次归属
          shiftId: currentShiftId ?? undefined,
        });
        toast.success('退货成功');
        setSelectedId(null); setDetail(null); setRetQty({});
        setReason(''); setRefundMethod('original');
        searchOrders(keyword);
      }
    } catch (e) {
      logger.error('createReturn failed', e as Error);
      toast.error(effectivelyOffline ? '离线退货失败，请重试' : '退货失败，请重试');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-pos-ink">退换货</h1>
          <span className="text-xs text-pos-ink-3">收银 / 退换货</span>
        </div>
        {effectivelyOffline && (
          <div className="flex items-center gap-1.5 bg-pos-warn-bg/60 border border-pos-warn/30 rounded-lg px-3 py-1.5 text-xs text-pos-warn">
            <WifiOff size={12} />
            离线退货 · 待同步
          </div>
        )}
      </header>

      <div className="px-5 py-2 bg-white border-b border-pos-line flex-shrink-0">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key as TabKey)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? 'border-pos-accent text-pos-accent' : 'border-transparent text-pos-ink-3 hover:text-pos-ink-2'
              }`}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === 'search' ? (
        <>
          <div className="px-5 py-3 bg-white border-b border-pos-line flex-shrink-0">
            <div className="relative w-96">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3" />
              <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
                placeholder={effectivelyOffline ? '离线模式：搜索本地暂存单' : '输入零售单号 / 手机号搜索原单'}
                className="w-full h-10 pl-9 pr-3 bg-pos-paper border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors" />
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden p-4 gap-4">
            {/* 左侧单据列表 */}
            <div className="w-72 bg-white rounded-xl border border-pos-line shadow-sm flex flex-col flex-shrink-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-pos-line bg-pos-paper">
                <span className="text-sm font-medium text-pos-ink">历史单据</span>
                <span className="text-xs text-pos-ink-3 ml-2">{orders.length} 条</span>
                {effectivelyOffline && (
                  <span className="text-[10px] text-pos-warn ml-2">（本地）</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {ordersLoading ? (
                  <div className="flex items-center justify-center py-10"><Loader2 size={20} className="animate-spin text-pos-ink-3" /></div>
                ) : orders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-pos-ink-3 gap-2">
                    <SearchX size={24} />
                    <span className="text-xs">{keyword ? '无匹配单据' : effectivelyOffline ? '输入关键词搜索本地单据' : '输入关键词搜索'}</span>
                  </div>
                ) : orders.map((o) => (
                  <div key={o.id} onClick={() => handleSelect(o.id)}
                    className={`px-4 py-3 border-b border-pos-line-soft cursor-pointer transition-colors ${
                      selectedId === o.id ? 'bg-pos-accent-light/50 border-l-2 border-l-pos-accent' : 'hover:bg-pos-accent-light/50'
                    }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-pos-ink">{o.orderNo}</span>
                      <ChevronRight size={14} className="text-pos-ink-3" />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-pos-ink-3">{fmtDate(o.createdAt)}</span>
                      <span className="text-xs text-pos-ink-3">{o.totalQty} 件</span>
                    </div>
                    <div className="text-sm font-semibold text-pos-accent mt-1 tabular-nums">¥{o.payAmount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 右侧明细 + 底部操作 */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <div className="bg-white rounded-xl border border-pos-line shadow-sm flex-1 flex flex-col overflow-hidden">
                <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
                  <span className="text-sm font-medium text-pos-ink">{detail ? `单据明细 · ${detail.orderNo}` : '请选择单据'}</span>
                  {detail && (
                    <button className="text-xs text-pos-accent hover:text-[#A8401F] transition-colors flex items-center gap-1">
                      <ArrowLeftRight size={12} /> 申请换货
                    </button>
                  )}
                </div>
                {detailLoading ? (
                  <div className="flex-1 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-pos-ink-3" /></div>
                ) : detail && items.length > 0 ? (
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-pos-paper sticky top-0">
                        <tr>
                          <th className="text-left font-semibold text-pos-ink px-4 py-2.5">款号/品名</th>
                          <th className="text-left font-semibold text-pos-ink px-2 py-2.5">色/码</th>
                          <th className="text-center font-semibold text-pos-ink px-2 py-2.5">原数量</th>
                          <th className="text-center font-semibold text-pos-ink px-2 py-2.5">可退</th>
                          <th className="text-center font-semibold text-pos-ink px-2 py-2.5">退货数</th>
                          <th className="text-right font-semibold text-pos-ink px-4 py-2.5">金额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => {
                          const k = it.id ?? '';
                          const q = retQty[k] ?? 0;
                          const max = getReturnable(it);
                          return (
                             <tr key={k} className="border-b border-pos-line-soft hover:bg-pos-accent-light/50">
                              <td className="px-4 py-3">
                                <div className="font-medium text-pos-ink">{it.styleName}</div>
                                <div className="text-xs text-pos-ink-3">{it.styleId}</div>
                              </td>
                              <td className="px-2 text-pos-ink-2">{it.colorId} / {it.sizeId}</td>
                              <td className="px-2 text-center text-pos-ink">{it.qty}</td>
                              <td className="px-2 text-center text-pos-ok">{max}</td>
                              <td className="px-2 text-center">
                                <div className="inline-flex items-center border border-pos-line rounded-md">
                                  <button onClick={() => chgQty(k, -1, max)} disabled={q === 0}
                                    className="w-6 h-6 flex items-center justify-center text-pos-ink-3 hover:text-pos-ink border-r border-pos-line disabled:opacity-40">-</button>
                                  <span className="w-8 text-center text-pos-ink tabular-nums">{q}</span>
                                  <button onClick={() => chgQty(k, 1, max)} disabled={q >= max}
                                    className="w-6 h-6 flex items-center justify-center text-pos-ink-3 hover:text-pos-ink border-l border-pos-line disabled:opacity-40">+</button>
                                </div>
                              </td>
                              <td className="px-4 text-right font-medium text-pos-ink tabular-nums">¥{(it.unitPrice * q).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-pos-ink-3 text-sm">选择左侧单据查看明细</div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-pos-line shadow-sm p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 flex items-center gap-6 flex-wrap">
                    <div>
                      <div className="text-xs text-pos-ink-3 mb-1">退款方式</div>
                      <div className="flex gap-2 flex-wrap">
                        {REFUND_METHODS.map((opt) => (
                          <button key={opt.key} onClick={() => setRefundMethod(opt.key)}
                            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                              refundMethod === opt.key ? 'bg-pos-accent text-white border-pos-accent' : 'border-pos-line text-pos-ink-2 hover:bg-pos-paper'
                            }`}>{opt.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 max-w-xs">
                      <div className="text-xs text-pos-ink-3 mb-1">退货原因</div>
                      <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="选填"
                        className="w-full h-9 px-3 bg-pos-paper border border-pos-line rounded-md text-sm text-pos-ink focus:outline-none focus:border-pos-accent transition-colors" />
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-xs text-pos-ink-3">预计退款</div>
                      <div className="text-xl font-bold text-pos-danger tabular-nums">-¥{totalRefund.toFixed(2)}</div>
                    </div>
                    <button onClick={submitReturn}
                      disabled={totalQty === 0 || submitting || !detail || detailLoading}
                      className="h-10 px-6 bg-pos-accent text-white rounded-lg font-medium hover:bg-[#A8401F] transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      {effectivelyOffline ? '离线退货' : '确认退货'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-pos-line bg-pos-paper">
              <span className="text-sm font-medium text-pos-ink">退货记录</span>
              <span className="text-xs text-pos-ink-3 ml-2">{records.length} 条</span>
              {effectivelyOffline && (
                <span className="text-[10px] text-pos-warn ml-2">（本地暂存）</span>
              )}
            </div>
            {recordsLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-pos-ink-3" /></div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-pos-ink-3 gap-2">
                <Package size={32} /><span className="text-sm">暂无退货记录</span>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-pos-paper sticky top-0">
                  <tr>
                    <th className="text-left font-semibold text-pos-ink px-4 py-2.5">退货单号</th>
                    <th className="text-left font-semibold text-pos-ink px-4 py-2.5">原单号</th>
                    <th className="text-center font-semibold text-pos-ink px-2 py-2.5">件数</th>
                    <th className="text-right font-semibold text-pos-ink px-4 py-2.5">退款金额</th>
                    <th className="text-center font-semibold text-pos-ink px-4 py-2.5">退款方式</th>
                    <th className="text-center font-semibold text-pos-ink px-4 py-2.5">状态</th>
                    <th className="text-right font-semibold text-pos-ink px-4 py-2.5">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b border-pos-line-soft hover:bg-pos-accent-light/50">
                      <td className="px-4 py-3 font-medium text-pos-ink">{r.returnNo}</td>
                      <td className="px-4 py-3 text-pos-ink-2">{r.originalOrderNo}</td>
                      <td className="px-2 text-center text-pos-ink tabular-nums">{r.totalQty}</td>
                      <td className="px-4 text-right font-medium text-pos-danger tabular-nums">-¥{r.refundAmount.toFixed(2)}</td>
                      <td className="px-4 text-center text-pos-ink-2">{methodLabel(r.refundMethod)}</td>
                      <td className="px-4 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.status === 'completed' ? 'bg-pos-ok-bg text-pos-ok' :
                          r.status === 'offline_pending' || r.status === 'pending' ? 'bg-pos-warn-bg text-pos-warn' :
                          'bg-pos-warn-bg text-pos-warn'
                        }`}>
                          {r.status === 'completed' ? '已完成' :
                           r.status === 'offline_pending' || r.status === 'pending' ? '待同步' : r.status}
                        </span>
                      </td>
                      <td className="px-4 text-right text-pos-ink-3 text-xs">{fmtDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
