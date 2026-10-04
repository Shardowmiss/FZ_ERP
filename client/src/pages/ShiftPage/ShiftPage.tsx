import { useState, useEffect, Fragment, type ReactNode } from 'react';
import {
  Clock, User, DollarSign, Receipt, CreditCard, Smartphone, Wallet,
  LogOut, PlayCircle, RefreshCw, ChevronDown, ChevronUp, Printer, Download, Calendar,
  AlertTriangle,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import * as shiftApi from '@client/src/api/shift';
import type { Shift, Eod } from '@shared/api.interface';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { useOffline } from '@client/src/contexts/OfflineContext';
import { useAuth } from '@client/src/contexts/AuthContext';
import { printHtmlDocument, downloadTextFile } from '@client/src/lib/print';
import AsyncState from '@client/src/components/AsyncState';
import { errMsg } from '@client/src/lib/errMsg';
import OfflineBanner from '@client/src/components/ui/offline-banner';

import { STORE_ID, STORE_NAME } from '@client/src/lib/store';
const TABS = [
  { key: 'handover', label: '交接班' },
  { key: 'history', label: '历史班次' },
  { key: 'zreport', label: '日结Z报表' },
];
const PAY_METHODS: Record<string, { label: string; icon: typeof DollarSign }> = {
  cash: { label: '现金', icon: DollarSign },
  wechat: { label: '微信支付', icon: Smartphone },
  alipay: { label: '支付宝', icon: CreditCard },
  bank_card: { label: '银行卡', icon: Wallet },
  stored_value: { label: '储值卡', icon: CreditCard },
  points: { label: '积分抵扣', icon: CreditCard },
};
const fmtTime = (iso: string) => {
  try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};
const fmtMoney = (v: number | undefined | null) =>
  Number(v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ShiftPage() {
  const { employee } = useAuth();
  const cashierId = employee?.id ?? '';
  const [activeTab, setActiveTab] = useState('handover');
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(true);
  const [cashCount, setCashCount] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [historyList, setHistoryList] = useState<Shift[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [zDate, setZDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); });
  const [eodList, setEodList] = useState<Eod[]>([]);
  const [loadingEod, setLoadingEod] = useState(true);
  /** 三个区块各自的加载失败原因；此前只弹一闪而过的 toast，页面停留在空态且无重试入口 */
  const [errCurrent, setErrCurrent] = useState<string | null>(null);
  const [errHistory, setErrHistory] = useState<string | null>(null);
  const [errEod, setErrEod] = useState<string | null>(null);

  const offline = useOffline();
  const isOffline = offline.effectivelyOffline;
  const offlinePending = offline.pendingCount;

  const fetchCurrent = async () => {
    setLoadingCurrent(true);
    setErrCurrent(null);
    try {
      const data = await shiftApi.getCurrentShift(STORE_ID);
      setCurrentShift(data);
      // U-修复：此前用 cashExpected 预填「实点现金」，收银员不数钱直接交班
      // 也能得到 0 长短款，盘点机制形同虚设。这里保持为空，强制人工清点。
    } catch (err) {
      logger.error('fetchCurrent failed', err as Error);
      setErrCurrent(errMsg(err, '加载当前班次失败'));
    } finally { setLoadingCurrent(false); }
  };
  const fetchHistory = async () => {
    setLoadingHistory(true);
    setErrHistory(null);
    try {
      const data = await shiftApi.getShiftHistory({ storeId: STORE_ID, page: 1, pageSize: 20 });
      setHistoryList(data.items ?? []);
    } catch (err) {
      logger.error('fetchHistory failed', err as Error);
      setErrHistory(errMsg(err, '加载历史班次失败'));
    } finally { setLoadingHistory(false); }
  };
  const fetchEod = async () => {
    setLoadingEod(true);
    setErrEod(null);
    try {
      const data = await shiftApi.getEodList({ storeId: STORE_ID, startDate: zDate, endDate: zDate, page: 1, pageSize: 5 });
      setEodList(data.items ?? []);
    } catch (err) {
      logger.error('fetchEod failed', err as Error);
      setErrEod(errMsg(err, '加载日结报表失败'));
    } finally { setLoadingEod(false); }
  };

  useEffect(() => { if (activeTab === 'handover') fetchCurrent(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab]);
  useEffect(() => { if (activeTab === 'zreport') fetchEod(); }, [activeTab, zDate]);

  const handleOpen = async () => {
    const cash = parseFloat(openingCash);
    if (isNaN(cash) || cash < 0) { toast.error('请输入有效的备用金金额'); return; }
    setSubmitting(true);
    try {
      const data = await shiftApi.openShift({ storeId: STORE_ID, cashierId, openingCash: cash });
      setCurrentShift(data); toast.success('开班成功');
    } catch (err) { logger.error('openShift failed', err as Error); toast.error(errMsg(err, '开班失败')); }
    finally { setSubmitting(false); }
  };

  const handleClose = async () => {
    if (!currentShift) return;
    const actual = parseFloat(cashCount);
    if (isNaN(actual) || actual < 0) { toast.error('请输入有效的实点现金金额'); return; }
    if (!await showConfirm('确认要交班吗？交班后不可撤销。')) return;
    setSubmitting(true);
    try {
      const data = await shiftApi.closeShift(currentShift.id, { closingCash: actual, cashActual: actual });
      setCurrentShift(data); toast.success('交班成功'); setActiveTab('history'); fetchHistory();
    } catch (err) { logger.error('closeShift failed', err as Error); toast.error(errMsg(err, '交班失败')); }
    finally { setSubmitting(false); }
  };

  const currentEod = eodList[0] ?? null;

  // P1-7：Z 报导出为 CSV（原先按钮无行为）
  const handleExportEod = () => {
    const eod = currentEod;
    if (!eod) return;
    const rows: Array<[string, string | number]> = [
      ['日结日期', eod.eodDate],
      ['日结单号', eod.eodNo],
      ['门店', STORE_NAME],
      ['总销售金额', eod.totalSales.toFixed(2)],
      ['总交易单数', eod.orderCount],
      ['客单价', eod.avgTicket.toFixed(2)],
      ['退货金额', eod.totalRefund.toFixed(2)],
      ['折扣金额', eod.totalDiscount.toFixed(2)],
      ['实收金额', eod.netSales.toFixed(2)],
    ];
    for (const p of eod.payments ?? []) {
      rows.push([`支付方式·${PAY_METHODS[p.payMethod]?.label ?? p.payMethod}`, p.netAmount.toFixed(2)]);
    }
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    downloadTextFile(`Z报_${eod.eodDate}_${eod.eodNo}.csv`, csv);
    toast.success('日结报表已导出');
  };

  // P1-7：Z 报打印（原先按钮无行为）
  const handlePrintEod = () => {
    const eod = currentEod;
    if (!eod) return;
    const paymentRows = (eod.payments ?? [])
      .map(
        (p) =>
          `<div class="row"><span>${PAY_METHODS[p.payMethod]?.label ?? p.payMethod}</span><span>${p.netAmount.toFixed(2)}</span></div>`,
      )
      .join('');
    const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" /><title>Z报 ${eod.eodNo}</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: "Courier New", SimSun, monospace; font-size: 12px; color:#000; width:76mm; margin:0; }
  .center{text-align:center} .title{font-size:15px;font-weight:bold}
  .row{display:flex;justify-content:space-between;font-size:11px;line-height:1.6}
  .dashed{border-top:1px dashed #000;margin:4px 0;padding-top:4px}
  .total{font-size:14px;font-weight:bold}
</style></head><body>
  <div class="center"><div class="title">日结 Z 报表</div>
  <div class="row"><span>${eod.eodDate}</span><span>${eod.eodNo}</span></div>
  <div>${STORE_NAME}</div></div>
  <div class="dashed">
    <div class="row"><span>总销售金额</span><span>${eod.totalSales.toFixed(2)}</span></div>
    <div class="row"><span>总交易单数</span><span>${eod.orderCount} 单</span></div>
    <div class="row"><span>客单价</span><span>${eod.avgTicket.toFixed(2)}</span></div>
    <div class="row"><span>退货金额</span><span>-${eod.totalRefund.toFixed(2)}</span></div>
    <div class="row"><span>折扣金额</span><span>-${eod.totalDiscount.toFixed(2)}</span></div>
    <div class="row total"><span>实收金额</span><span>${eod.netSales.toFixed(2)}</span></div>
  </div>
  ${paymentRows ? `<div class="dashed"><div class="row"><b>分支付方式</b></div>${paymentRows}</div>` : ''}
  <div class="dashed center" style="font-size:10px">打印时间 ${new Date().toLocaleString('zh-CN')}</div>
</body></html>`;
    printHtmlDocument(html);
  };

  const isOpen = currentShift?.status === 'open';
  const cashExpected = currentShift?.cashExpected ?? 0;
  const cashActualNum = parseFloat(cashCount) || 0;
  const cashDiff = cashActualNum - cashExpected;
  const cashMatch = isOpen ? cashDiff === 0 && cashCount !== '' : (currentShift?.cashDiff ?? 0) === 0;

  const Loader = () => (
    <div className="bg-white rounded-xl border border-pos-line shadow-sm p-12 text-center text-pos-ink-3">
      <RefreshCw size={20} className="animate-spin inline mr-2" /> 加载中...
    </div>
  );

  const renderHandover = () => {
    if (errCurrent) return <AsyncState error={errCurrent} onRetry={() => void fetchCurrent()} />;
    if (loadingCurrent) return <Loader />;
    if (!currentShift) {
      return (
        <div className="max-w-md mx-auto mt-16 bg-white rounded-xl border border-pos-line shadow-sm p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-full bg-pos-paper flex items-center justify-center mb-4">
            <PlayCircle size={28} className="text-pos-accent" />
          </div>
          <h3 className="text-lg font-semibold text-pos-ink mb-2">当前没有进行中的班次</h3>
          <p className="text-sm text-pos-ink-3 mb-6">请输入备用金金额，开始新的班次</p>
          <div className="text-left mb-6">
            <label className="text-xs text-pos-ink-3 block mb-1.5">开班备用金</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3">¥</span>
              <input type="text" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)}
                className="w-full h-12 pl-8 pr-3 border border-pos-line rounded-lg text-lg font-semibold text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors tabular-nums" />
            </div>
          </div>
          <button onClick={handleOpen} disabled={submitting}
            className="w-full h-11 bg-pos-accent text-white rounded-lg font-medium hover:bg-pos-accent-hover transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
            <PlayCircle size={18} /> {submitting ? '开班中...' : '开班'}
          </button>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-pos-line shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-pos-accent-light flex items-center justify-center text-pos-accent"><Clock size={20} /></div>
              <div>
                <div className="text-xs text-pos-ink-3">当前班次</div>
                <div className="text-lg font-semibold text-pos-ink">{currentShift.shiftNo}</div>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${isOpen ? 'bg-pos-ok-bg text-pos-ok border-pos-ok/30' : 'bg-pos-paper text-pos-ink-3 border-pos-line-soft'}`}>
              {isOpen && <span className="inline-block w-1.5 h-1.5 rounded-full bg-pos-ok mr-1.5 animate-pulse" />}
              {isOpen ? '当班中' : '已交班'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <InfoCell icon={<User size={12} />} label="收银员" value={currentShift.cashierName || '-'} />
            <InfoCell icon={<Clock size={12} />} label="开班时间" value={fmtTime(currentShift.startTime)} />
            <InfoCell icon={<DollarSign size={12} />} label="销售金额" value={`¥${fmtMoney(currentShift.saleAmount)}`} accent />
            <InfoCell icon={<Receipt size={12} />} label="交易单数" value={`${currentShift.saleCount} 单`} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-pos-line shadow-sm p-5">
            <h3 className="text-sm font-medium text-pos-ink mb-4 flex items-center gap-2">
              <DollarSign size={16} className="text-pos-accent" /> 现金录入
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-pos-ink-3 block mb-1.5">系统应收现金</label>
                <div className="text-2xl font-semibold text-pos-ink tabular-nums">¥{fmtMoney(cashExpected)}</div>
              </div>
              <div>
                <label className="text-xs text-pos-ink-3 block mb-1.5">实点现金金额</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-pos-ink-3">¥</span>
                  <input type="text" value={cashCount} onChange={(e) => setCashCount(e.target.value)} disabled={!isOpen}
                    className="w-full h-12 pl-8 pr-3 border border-pos-line rounded-lg text-lg font-semibold text-pos-ink focus:outline-none focus:border-pos-accent focus:ring-1 focus:ring-pos-accent/20 transition-colors tabular-nums disabled:bg-pos-paper/50 disabled:text-pos-ink-3" />
                </div>
              </div>
              <div className={`text-sm ${cashMatch ? 'text-pos-ok' : 'text-pos-danger'}`}>
                {cashMatch ? '✓ 账实相符' : `⚠ 差异金额 ¥${cashDiff.toFixed(2)}`}
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-pos-line shadow-sm p-5">
            <h3 className="text-sm font-medium text-pos-ink mb-4 flex items-center gap-2">
              <Receipt size={16} className="text-pos-accent" /> 本班统计
            </h3>
            <div className="space-y-3">
              <KV label="销售金额" value={`¥${fmtMoney(currentShift.saleAmount)}`} bold />
              <KV label="退货金额" value={`-¥${fmtMoney(currentShift.refundAmount)}`} danger />
              <KV label="交易单数" value={`${currentShift.saleCount} 单`} />
              <div className="flex items-center justify-between pt-2 border-t border-pos-line">
                <span className="text-sm font-medium text-pos-ink">实收现金</span>
                <span className="text-lg font-bold text-pos-accent tabular-nums">¥{fmtMoney(cashExpected)}</span>
              </div>
            </div>
          </div>
        </div>
        {isOpen && (
          <div className="flex justify-end">
            <button onClick={handleClose} disabled={submitting}
              className="h-11 px-8 bg-pos-accent text-white rounded-lg font-medium hover:bg-pos-accent-hover transition-colors flex items-center gap-2 disabled:opacity-60">
              <LogOut size={18} /> {submitting ? '交班中...' : '确认交班'}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderHistory = () => {
    if (errHistory) return <AsyncState error={errHistory} onRetry={() => void fetchHistory()} />;
    if (loadingHistory) return <Loader />;
    if (historyList.length === 0) return <div className="bg-white rounded-xl border border-pos-line shadow-sm p-12 text-center text-pos-ink-3">暂无历史班次记录</div>;
    const ths = ['班次号', '收银员', '开班时间', '交班时间', '销售金额', '单数', '状态', '操作'];
    return (
      <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
          <span className="text-sm font-medium text-pos-ink">历史班次</span>
          <button onClick={fetchHistory}
            className="text-xs px-3 py-1.5 border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1">
            <RefreshCw size={12} /> 刷新
          </button>
        </div>
         <table className="w-full text-sm">
           <thead className="bg-pos-paper"><tr>
             {ths.map((h) => (
               <th key={h} className={`font-semibold text-pos-ink px-4 py-2.5 ${
                 h === '销售金额' ? 'text-right' : ['单数', '状态', '操作'].includes(h) ? 'text-center' : 'text-left'
               }`}>{h}</th>
             ))}
           </tr></thead>
           <tbody>
             {historyList.map((s) => (
               <Fragment key={s.id}>
                 <tr className="border-b border-pos-line-soft hover:bg-pos-accent-light/50">
                  <td className="px-4 py-3 font-medium text-pos-ink">{s.shiftNo}</td>
                  <td className="px-4 py-3 text-pos-ink-2">{s.cashierName || '-'}</td>
                  <td className="px-4 py-3 text-pos-ink-2">{fmtTime(s.startTime)}</td>
                  <td className="px-4 py-3 text-pos-ink-2">{s.endTime ? fmtTime(s.endTime) : '进行中'}</td>
                  <td className="px-4 py-3 text-right font-medium text-pos-ink tabular-nums">¥{fmtMoney(s.saleAmount)}</td>
                  <td className="px-4 py-3 text-center text-pos-ink">{s.saleCount}</td>
                  <td className="px-4 py-3 text-center">
                     <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${s.status === 'open' ? 'bg-pos-ok-bg text-pos-ok' : 'bg-pos-paper text-pos-ink-3'}`}>
                       {s.status === 'open' ? '当班中' : '已交班'}
                     </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      className="text-xs text-pos-accent hover:text-pos-accent-hover flex items-center gap-0.5 mx-auto">
                      查看明细 {expandedId === s.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </button>
                  </td>
                </tr>
                 {expandedId === s.id && (
                   <tr className="bg-pos-paper/50 border-b border-pos-line-soft">
                    <td colSpan={8} className="px-6 py-4">
                      <div className="grid grid-cols-4 gap-6 text-sm">
                        <Detail label="备用金" value={`¥${fmtMoney(s.openingCash)}`} />
                        <Detail label="应收现金" value={`¥${fmtMoney(s.cashExpected)}`} />
                        <Detail label="实点现金" value={`¥${fmtMoney(s.cashActual)}`} />
                        <Detail label="长短款" value={`${(s.cashDiff ?? 0) >= 0 ? '+' : ''}¥${fmtMoney(s.cashDiff)}`}
                          tone={(s.cashDiff ?? 0) === 0 ? 'ok' : 'danger'} />
                      </div>
                    </td>
                  </tr>
                )}
               </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderZReport = () => {
    if (errEod) return <AsyncState error={errEod} onRetry={() => void fetchEod()} />;
    if (loadingEod) return <Loader />;
    const eod = eodList[0];
    return (
      <div className="bg-white rounded-xl border border-pos-line shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-pos-ink">日结 Z 报表</h3>
            <p className="text-sm text-pos-ink-3 mt-1">
              {eod ? `${eod.eodDate} · ${STORE_NAME} · ${eod.eodNo}` : '请选择日期查看报表'}
            </p>
            {offlinePending > 0 && (
              <p className="text-xs text-pos-warn mt-2 flex items-center gap-1">
                <AlertTriangle size={12} />
                数据含离线暂估，补传后以正式数据为准
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-pos-ink-3" />
            <input type="date" value={zDate} onChange={(e) => setZDate(e.target.value)}
              className="text-sm border border-pos-line rounded-md px-2 py-1 text-pos-ink focus:outline-none focus:border-pos-accent" />
          </div>
        </div>
        {!eod ? (
          <div className="text-center py-16 text-pos-ink-3">该日期暂无日结报表</div>
        ) : (
          <>
            <div className="max-w-md mx-auto space-y-4">
              <KV label="总销售金额" value={`¥${fmtMoney(eod.totalSales)}`} bold />
              <KV label="总交易单数" value={`${eod.orderCount} 单`} />
              <KV label="客单价" value={`¥${fmtMoney(eod.avgTicket)}`} />
              <KV label="退货金额" value={`-¥${fmtMoney(eod.totalRefund)}`} danger />
              <div className="flex items-center justify-between py-3 border-t border-pos-line">
                <span className="font-medium text-pos-ink">实收金额</span>
                <span className="text-lg font-bold text-pos-accent tabular-nums">¥{fmtMoney(eod.netSales)}</span>
              </div>
            </div>
            {eod.payments && eod.payments.length > 0 && (
              <div className="max-w-md mx-auto mt-8 pt-6 border-t border-pos-line">
                <h4 className="text-sm font-medium text-pos-ink mb-3">分支付方式收款</h4>
                <div className="space-y-2">
                  {eod.payments.map((p) => {
                    const info = PAY_METHODS[p.payMethod] || { label: p.payMethod, icon: CreditCard };
                    const Icon = info.icon;
                    return (
                      <div key={p.payMethod} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-pos-paper flex items-center justify-center text-pos-ink-3"><Icon size={13} /></div>
                          <span className="text-sm text-pos-ink">{info.label}</span>
                        </div>
                        <span className="text-sm font-medium text-pos-ink tabular-nums">¥{fmtMoney(p.netAmount)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="mt-8 flex justify-center gap-3">
              <button
                onClick={handleExportEod}
                className="px-4 py-2 border border-pos-line rounded-lg text-sm text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1.5"
              >
                <Download size={14} /> 导出报表
              </button>
              <button
                onClick={handlePrintEod}
                className="px-4 py-2 bg-pos-accent text-white rounded-lg text-sm font-medium hover:bg-pos-accent-hover transition-colors flex items-center gap-1.5"
              >
                <Printer size={14} /> 打印Z报
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-pos-ink">交接班</h1>
          <p className="text-xs text-pos-ink-3 mt-0.5">运营 / 交接班</p>
        </div>
      </header>

      <OfflineBanner
        isOffline={isOffline}
        pendingCount={offlinePending}
        pendingWarning={`尚有 ${offlinePending} 笔离线单据未同步，日结数据含离线暂估，补传后以正式数据为准`}
      />
      <div className="px-5 py-2 bg-white border-b border-pos-line flex-shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors border-b-2 ${
                activeTab === tab.key ? 'text-pos-accent font-medium border-pos-accent bg-pos-paper/30' : 'text-pos-ink-3 hover:text-pos-ink border-transparent hover:border-pos-line-soft'
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'handover' && renderHandover()}
        {activeTab === 'history' && renderHistory()}
        {activeTab === 'zreport' && renderZReport()}
      </div>
    </div>
  );
}

function InfoCell({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-pos-ink-3 flex items-center gap-1 mb-1">{icon} {label}</div>
      <div className={`text-base font-medium text-pos-ink ${accent ? 'font-semibold text-pos-accent' : ''} tabular-nums`}>{value}</div>
    </div>
  );
}

function KV({ label, value, bold, danger }: { label: string; value: string; bold?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-pos-line-soft">
      <span className="text-pos-ink-3">{label}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${danger ? 'text-pos-danger' : 'text-pos-ink'}`}>{value}</span>
    </div>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  const color = tone === 'ok' ? 'text-pos-ok' : tone === 'danger' ? 'text-pos-danger' : 'text-pos-ink';
  return (
    <div>
      <div className="text-pos-ink-3 mb-1">{label}</div>
      <div className={`font-medium tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
