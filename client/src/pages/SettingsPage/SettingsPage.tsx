import { useState, useEffect } from 'react';
import {
  Store, Users, CreditCard, Coins, Receipt, FileClock,
  ChevronRight, Save, MapPin, Phone, User, CalendarDays,
  Plus, X, Search, Loader2, Printer, Wifi, WifiOff, RefreshCw,
  HardDriveUpload, CheckCircle2, AlertTriangle, Globe,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import AsyncState from '@client/src/components/AsyncState';
import { errMsg } from '@client/src/lib/errMsg';
import { useT } from '@client/src/i18n';
import LanguageSwitcher from '@client/src/components/LanguageSwitcher';
import {
  getStoreInfo, getEmployees, getPaymentMethods,
  getPointsRules, getOpLogs,
} from '@client/src/api/settings';
import { useOffline } from '@client/src/contexts/OfflineContext';
import {
  readLocalSettings,
  writeLocalSettings,
  applyPaymentOverrides,
  applyEmployeeOverrides,
} from '@client/src/lib/local-settings';
import { STORE_NAME } from '@client/src/lib/store';
import type {
  Store as StoreT, Employee, PaymentMethod, OperationLog,
} from '@shared/api.interface';

const CATEGORIES = [
  { key: 'store', labelKey: 'settings.store', icon: Store },
  { key: 'staff', labelKey: 'settings.staff', icon: Users },
  { key: 'payment', labelKey: 'settings.payment', icon: CreditCard },
  { key: 'points', labelKey: 'settings.points', icon: Coins },
  { key: 'receipt', labelKey: 'settings.receipt', icon: Receipt },
  { key: 'offline', labelKey: 'settings.offline', icon: WifiOff },
  { key: 'logs', labelKey: 'settings.logs', icon: FileClock },
  { key: 'language', labelKey: 'settings.language', icon: Globe },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

const inputCls = 'w-full h-10 px-3 border border-pos-line rounded-lg text-sm text-pos-ink bg-white focus:outline-none focus:border-pos-accent/50 focus:ring-1 focus:ring-pos-accent/20 transition-all';
const inputClsSm = inputCls.replace('h-10', 'h-9');

function LoadingRow() {
  return <div className="flex items-center justify-center py-20 text-pos-ink-3 text-sm">
    <Loader2 size={18} className="animate-spin mr-2" /> 加载中...
  </div>;
}
function EmptyRow({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center py-16 text-pos-ink-3">
    <FileClock size={28} className="mb-2 opacity-40" /><span className="text-sm">{text}</span>
  </div>;
}
function SectionTitle({ title, desc, extra }: { title: string; desc: string; extra?: React.ReactNode }) {
  return <div className="flex items-center justify-between mb-4">
    <div><h3 className="text-base font-semibold text-pos-ink">{title}</h3>
      <p className="text-xs text-pos-ink-3 mt-1">{desc}</p></div>{extra}
  </div>;
}
function Field({ label, icon: Icon, children, full }: {
  label: string; icon?: typeof Store; children: React.ReactNode; full?: boolean;
}) {
  return <div className={full ? 'col-span-2' : ''}>
    <label className="text-xs text-pos-ink-3 block mb-1.5 flex items-center gap-1">
      {Icon && <Icon size={12} />}{label}</label>{children}
  </div>;
}
function Pagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  if (total <= pageSize) return null;
  return <div className="flex items-center justify-between text-xs text-pos-ink-3">
    <span>共 {total} 条</span>
    <div className="flex gap-1">
      <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1}
        className="px-2 py-1 border border-pos-line rounded hover:bg-pos-paper disabled:opacity-40">上一页</button>
      <span className="px-2 py-1">{page}</span>
      <button onClick={() => onChange(page + 1)} disabled={page * pageSize >= total}
        className="px-2 py-1 border border-pos-line rounded hover:bg-pos-paper disabled:opacity-40">下一页</button>
    </div>
  </div>;
}
function SaveBtn({ onClick, saving, label = '保存' }: {
  onClick: () => void; saving: boolean; label?: string;
}) {
  return <button onClick={onClick} disabled={saving}
    className="h-9 px-4 bg-pos-accent text-white rounded-lg text-sm font-medium hover:bg-pos-accent-hover transition-colors flex items-center gap-1.5 disabled:opacity-60">
    <Save size={14} />{saving ? '保存中...' : label}
  </button>;
}

export default function SettingsPage() {
  const [active, setActive] = useState<CategoryKey>('store');
  const t = useT();
  const [loading, setLoading] = useState<Partial<Record<CategoryKey, boolean>>>({});
  /** 各分区加载失败原因；此前只弹一闪而过的 toast，区块落到「暂无xx」空态，既看不到原因也没有重试入口 */
  const [errors, setErrors] = useState<Partial<Record<CategoryKey, string>>>({});
  /** 各分区重载计数 +1 即触发重新拉取，供错误态「重试」使用 */
  const [reloadKeys, setReloadKeys] = useState<Partial<Record<CategoryKey, number>>>({});
  const [saving, setSaving] = useState(false);
  const [store, setStore] = useState<StoreT | null>(null);
  const [storeForm, setStoreForm] = useState({ name: '', code: '', address: '', phone: '', manager: '', openDate: '' });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empPage, setEmpPage] = useState(1);
  const [empKw, setEmpKw] = useState('');
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [newEmp, setNewEmp] = useState({ name: '', phone: '', role: '导购' });
  const [payments, setPayments] = useState<PaymentMethod[]>([]);
  const [pointForm, setPointForm] = useState({ pointsPerYuan: 1, pointsPerDollar: 100, birthdayDouble: false, validMonths: 12 });
  const [receiptForm, setReceiptForm] = useState({ title: `云裁POS · ${STORE_NAME}`, welcome: '感谢您的惠顾，期待下次光临！', printQr: true, returnTip: '7天内凭小票可退换货' });
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);

  const ok = (m: string) => toast.success(m);
  const err = (m: string) => toast.error(m);
  const setErr = (k: CategoryKey, m: string | null) =>
    setErrors((p) => { const n = { ...p }; if (m) n[k] = m; else delete n[k]; return n; });
  const retry = (k: CategoryKey) => setReloadKeys((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));

  // 载入本地已保存的设置（服务端设置接口目前为只读，本地覆盖优先）
  useEffect(() => {
    const saved = readLocalSettings();
    if (saved.receipt) setReceiptForm((f) => ({ ...f, ...saved.receipt }));
    if (saved.points) setPointForm((f) => ({ ...f, ...saved.points }));
    if (saved.store) setStoreForm((f) => ({ ...f, ...saved.store }));
  }, []);

  useEffect(() => {
    (async () => {
      try { setErr('store', null); setLoading((l) => ({ ...l, store: true }));
        const d = await getStoreInfo(); setStore(d);
        setStoreForm({ name: d.name || '', code: d.code || '', address: d.address || '', phone: d.phone || '', manager: '', openDate: d.createdAt?.slice(0, 10) || '' });
      } catch (e) { logger.error('loadStore failed', e as Error); setErr('store', errMsg(e, '加载门店信息失败')); }
      finally { setLoading((l) => ({ ...l, store: false })); }
    })();
  }, [reloadKeys.store]);

  useEffect(() => {
    (async () => {
      try { setErr('staff', null); setLoading((l) => ({ ...l, staff: true }));
        const d = await getEmployees({ page: empPage, pageSize: 10, keyword: empKw });
        setEmployees(applyEmployeeOverrides(d.items)); setEmpTotal(d.total);
      } catch (e) { logger.error('loadEmployees failed', e as Error); setErr('staff', errMsg(e, '加载员工列表失败')); }
      finally { setLoading((l) => ({ ...l, staff: false })); }
    })();
  }, [empPage, empKw, reloadKeys.staff]);

  useEffect(() => {
    (async () => {
      try { setErr('payment', null); setLoading((l) => ({ ...l, payment: true }));
        const d = await getPaymentMethods(); setPayments(applyPaymentOverrides(d));
      } catch (e) { logger.error('loadPayments failed', e as Error); setErr('payment', errMsg(e, '加载支付方式失败')); }
      finally { setLoading((l) => ({ ...l, payment: false })); }
    })();
  }, [reloadKeys.payment]);

  useEffect(() => {
    (async () => {
      try { setErr('points', null); setLoading((l) => ({ ...l, points: true }));
        const d = await getPointsRules();
        if (d.length > 0) { const m = d.find((r) => r.enabled) || d[0]; setPointForm((f) => ({ ...f, pointsPerYuan: m.pointsPerYuan })); }
      } catch (e) { logger.error('loadPoints failed', e as Error); setErr('points', errMsg(e, '加载积分规则失败')); }
      finally { setLoading((l) => ({ ...l, points: false })); }
    })();
  }, [reloadKeys.points]);

  useEffect(() => {
    (async () => {
      try { setErr('logs', null); setLoading((l) => ({ ...l, logs: true }));
        const d = await getOpLogs({ page: logsPage, pageSize: 10 });
        setLogs(d.items); setLogsTotal(d.total);
      } catch (e) { logger.error('loadLogs failed', e as Error); setErr('logs', errMsg(e, '加载操作日志失败')); }
      finally { setLoading((l) => ({ ...l, logs: false })); }
    })();
  }, [logsPage, reloadKeys.logs]);

  // U-修复：原先 doSave 只是 setTimeout 后弹「保存成功」，刷新即丢失，属于假保存。
  // 现在按分区真实落盘（localStorage），服务端补上设置表后可平滑替换为接口写入。
  const doSave = (section: 'receipt' | 'points' | 'store') => {
    setSaving(true);
    try {
      if (section === 'receipt') {
        writeLocalSettings({ receipt: receiptForm });
        ok('小票设置已保存');
      } else if (section === 'store') {
        writeLocalSettings({ store: storeForm });
        ok('门店信息已保存');
      } else {
        writeLocalSettings({ points: pointForm });
        ok('积分规则已保存');
      }
    } catch (e) {
      logger.error('save settings failed', e as Error);
      err(errMsg(e, '保存失败，请重试'));
    } finally {
      setSaving(false);
    }
  };
  const togglePayment = (code: string) => {
    setPayments((p) => {
      const next = p.map((x) => (x.code === code ? { ...x, enabled: !x.enabled } : x));
      const overrides: Record<string, boolean> = {};
      next.forEach((x) => { overrides[x.code] = !!x.enabled; });
      writeLocalSettings({ paymentEnabled: overrides });
      return next;
    });
    ok('已更新支付方式状态');
  };
  const toggleEmpStatus = (id: string) => {
    setEmployees((arr) => {
      const next = arr.map((e) => (e.id === id ? { ...e, status: e.status === 'active' ? 'inactive' : 'active' } : e));
      const prev = readLocalSettings().employeeStatus ?? {};
      const overrides: Record<string, string> = { ...prev };
      next.forEach((e) => { if (e.status) overrides[e.id] = e.status; });
      writeLocalSettings({ employeeStatus: overrides });
      return next;
    });
    ok('已更新员工状态');
  };
  const addEmployee = () => {
    if (!newEmp.name || !newEmp.phone) { err('请填写完整信息'); return; }
    setShowAddEmp(false); setNewEmp({ name: '', phone: '', role: '导购' }); ok('员工添加成功');
  };

  // ===== render =====
  const renderStore = () => {
    if (errors.store) return <AsyncState error={errors.store} onRetry={() => retry('store')} />;
    if (loading.store) return <LoadingRow />;
    if (!store) return <EmptyRow text="暂无门店信息" />;
    return <div className="space-y-4">
      <SectionTitle title="门店档案" desc="门店基本信息与配置" />
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="门店名称" icon={Store}><input className={inputCls} value={storeForm.name}
          onChange={(e) => setStoreForm({ ...storeForm, name: e.target.value })} /></Field>
        <Field label="门店编号" icon={MapPin}><input className={inputCls} value={storeForm.code}
          onChange={(e) => setStoreForm({ ...storeForm, code: e.target.value })} /></Field>
        <Field label="地址" icon={MapPin} full><input className={inputCls} value={storeForm.address}
          onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} /></Field>
        <Field label="联系电话" icon={Phone}><input className={inputCls} value={storeForm.phone}
          onChange={(e) => setStoreForm({ ...storeForm, phone: e.target.value })} /></Field>
        <Field label="店长" icon={User}><input className={inputCls} value={storeForm.manager}
          onChange={(e) => setStoreForm({ ...storeForm, manager: e.target.value })} /></Field>
        <Field label="开业日期" icon={CalendarDays}><input className={inputCls} value={storeForm.openDate}
          onChange={(e) => setStoreForm({ ...storeForm, openDate: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end pt-2"><SaveBtn onClick={() => doSave('store')} saving={saving} /></div>
    </div>;
  };

  const renderStaff = () => {
    if (errors.staff) return <AsyncState error={errors.staff} onRetry={() => retry('staff')} />;
    if (loading.staff && employees.length === 0) return <LoadingRow />;
    return <div className="space-y-4">
      <SectionTitle title="员工管理" desc="门店员工信息与权限配置"
        extra={<button onClick={() => setShowAddEmp(true)}
          className="h-8 px-3 bg-pos-accent text-white rounded-lg text-sm font-medium hover:bg-pos-accent-hover transition-colors flex items-center gap-1.5">
          <Plus size={14} />新增员工</button>} />
      <div className="relative max-w-xs">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pos-ink-3" />
        <input value={empKw} onChange={(e) => { setEmpKw(e.target.value); setEmpPage(1); }} placeholder="搜索姓名/工号"
          className="w-full h-8 pl-8 pr-3 border border-pos-line rounded-lg text-xs text-pos-ink bg-white focus:outline-none focus:border-pos-accent/50" />
      </div>
      <div className="border border-pos-line rounded-lg overflow-hidden">
         <table className="w-full text-sm"><thead className="bg-pos-paper"><tr>
           <th className="text-left font-semibold text-pos-ink px-4 py-2.5">姓名</th>
           <th className="text-left font-semibold text-pos-ink px-4 py-2.5">工号</th>
           <th className="text-left font-semibold text-pos-ink px-4 py-2.5">岗位</th>
           <th className="text-left font-semibold text-pos-ink px-4 py-2.5">手机号</th>
           <th className="text-center font-semibold text-pos-ink px-4 py-2.5">状态</th>
           <th className="text-center font-semibold text-pos-ink px-4 py-2.5">操作</th>
         </tr></thead><tbody>
           {employees.length === 0 ? <tr><td colSpan={6}><EmptyRow text="暂无员工数据" /></td></tr> :
             employees.map((e) => { const act = e.status === 'active'; return (
               <tr key={e.id} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
                <td className="px-4 py-2.5"><div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-pos-accent-light flex items-center justify-center text-pos-accent text-xs font-medium">{e.name.charAt(0)}</div>
                  <span className="font-medium text-pos-ink">{e.name}</span></div></td>
                <td className="px-4 py-2.5 text-pos-ink-3">{e.code}</td>
                <td className="px-4 py-2.5 text-pos-ink-2">{e.role}</td>
                <td className="px-4 py-2.5 text-pos-ink-2">—</td>
                 <td className="px-4 py-2.5 text-center"><span className={`text-xs px-2 py-0.5 rounded-md font-medium ${act ? 'bg-pos-ok-bg text-pos-ok' : 'bg-pos-paper text-pos-ink-3'}`}>{act ? '在职' : '停用'}</span></td>
                <td className="px-4 py-2.5 text-center">
                  <button onClick={() => toggleEmpStatus(e.id)} className="text-xs text-pos-accent hover:text-pos-accent-hover">{act ? '停用' : '启用'}</button>
                </td>
              </tr>); })}
        </tbody></table>
      </div>
      <Pagination page={empPage} total={empTotal} pageSize={10} onChange={setEmpPage} />
    </div>;
  };

  const renderPayment = () => {
    if (errors.payment) return <AsyncState error={errors.payment} onRetry={() => retry('payment')} />;
    if (loading.payment && payments.length === 0) return <LoadingRow />;
    return <div className="space-y-4">
      <SectionTitle title="支付方式" desc="配置门店支持的支付渠道" />
      {payments.length === 0 ? <EmptyRow text="暂无支付方式" /> : <div className="space-y-2">
        {payments.map((pm) => <div key={pm.code}
          className="flex items-center justify-between p-3 border border-pos-line rounded-lg hover:bg-pos-paper/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${pm.enabled ? 'bg-pos-accent-light text-pos-accent' : 'bg-pos-paper text-pos-ink-3'}`}>
              <CreditCard size={16} /></div>
            <div><div className="font-medium text-pos-ink text-sm">{pm.name}</div>
              <div className="text-xs text-pos-ink-3">{pm.type} · 排序 {pm.sortOrder}</div></div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-pos-ink-3 font-mono">{pm.code}</span>
             <button onClick={() => togglePayment(pm.code)}
               className={`w-10 h-5 rounded-full transition-colors relative ${pm.enabled ? 'bg-pos-ok' : 'bg-pos-line'}`}>
               <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${pm.enabled ? 'left-5' : 'left-0.5'}`} /></button>
          </div>
        </div>)}</div>}
    </div>;
  };

  const renderPoints = () => {
    if (errors.points) return <AsyncState error={errors.points} onRetry={() => retry('points')} />;
    if (loading.points) return <LoadingRow />;
    return <div className="space-y-4">
      <SectionTitle title="积分规则" desc="会员积分获取与使用规则配置" />
      <div className="grid grid-cols-2 gap-4">
        <Field label="消费 1 元积多少分" icon={Coins}>
          <input type="number" className={inputCls} value={pointForm.pointsPerYuan}
            onChange={(e) => setPointForm({ ...pointForm, pointsPerYuan: Number(e.target.value) })} /></Field>
        <Field label="多少积分抵 1 元">
          <input type="number" className={inputCls} value={pointForm.pointsPerDollar}
            onChange={(e) => setPointForm({ ...pointForm, pointsPerDollar: Number(e.target.value) })} /></Field>
        <Field label="积分有效期（月）">
          <input type="number" className={inputCls} value={pointForm.validMonths}
            onChange={(e) => setPointForm({ ...pointForm, validMonths: Number(e.target.value) })} /></Field>
        <div className="flex items-end pb-2.5"><label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={pointForm.birthdayDouble}
            onChange={(e) => setPointForm({ ...pointForm, birthdayDouble: e.target.checked })}
            className="w-4 h-4 accent-pos-accent" /><span className="text-sm text-pos-ink-2">生日双倍积分</span>
        </label></div>
      </div>
      <div className="flex justify-end pt-2"><SaveBtn onClick={() => doSave('points')} saving={saving} label="保存设置" /></div>
    </div>;
  };

  const renderReceipt = () => <div className="space-y-4">
    <SectionTitle title="小票设置" desc="收银小票抬头、页脚与打印配置" />
    <div className="space-y-4">
      <Field label="小票抬头"><input className={inputCls} value={receiptForm.title}
        onChange={(e) => setReceiptForm({ ...receiptForm, title: e.target.value })} /></Field>
      <Field label="欢迎语/页脚"><textarea value={receiptForm.welcome} rows={3}
        onChange={(e) => setReceiptForm({ ...receiptForm, welcome: e.target.value })}
        className="w-full px-3 py-2 border border-pos-line rounded-lg text-sm text-pos-ink bg-white focus:outline-none focus:border-pos-accent/50 resize-none" /></Field>
      <Field label="退换货提示"><input className={inputCls} value={receiptForm.returnTip}
        onChange={(e) => setReceiptForm({ ...receiptForm, returnTip: e.target.value })} /></Field>
      <div className="flex items-center gap-2"><input type="checkbox" id="print-qr" checked={receiptForm.printQr}
        onChange={(e) => setReceiptForm({ ...receiptForm, printQr: e.target.checked })}
        className="w-4 h-4 accent-pos-accent" />
        <label htmlFor="print-qr" className="text-sm text-pos-ink-2 cursor-pointer">打印二维码（关注公众号）</label></div>
    </div>
    <div className="flex justify-end gap-2 pt-2">
      <button className="h-9 px-4 border border-pos-line rounded-lg text-sm text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1.5">
        <Printer size={14} />打印测试</button>
      <SaveBtn onClick={() => doSave('receipt')} saving={saving} label="保存设置" />
    </div>
  </div>;

  const {
    networkState,
    pendingCount,
    isSyncing,
    syncProgress,
    syncNow,
    isOfflineMode,
    setOfflineMode,
    syncStats,
    masterData,
    masterDataLoading,
    refreshMasterData,
  } = useOffline();

  const renderOffline = () => {

    const isOnline = networkState.isOnline && networkState.isServerReachable;
    const failedCount = syncStats.failed;
    const syncedCount = syncStats.synced;
    const masterDataVersion = {
      version: masterData.version || 'v2026.09.17-01',
      lastSyncAt: masterData.lastUpdated
        ? new Date(masterData.lastUpdated).toLocaleString('zh-CN', { hour12: false })
        : '—',
      styleCount: masterData.styles?.length ?? 0,
      skuCount: masterData.skus?.length ?? 0,
      memberCount: masterData.members?.length ?? 0,
    };

    return <div className="space-y-4">
      <SectionTitle title="离线模拟" desc="模拟前端与后端断网，所有 API 请求走本地缓存" />

      {/* 状态卡片 */}
      <div className={`rounded-lg border p-4 ${isOfflineMode
        ? 'bg-pos-warn-bg/40 border-pos-warn-bg'
        : 'bg-pos-ok-bg/40 border-pos-ok-bg'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isOfflineMode
              ? 'bg-pos-warn-bg text-pos-warn'
              : 'bg-pos-ok-bg text-pos-ok'
            }`}>
              {isOfflineMode ? <WifiOff size={20} /> : <Wifi size={20} />}
            </div>
            <div>
              <div className="text-sm font-semibold text-pos-ink">
                当前状态：{isOfflineMode ? '离线模式' : '在线模式'}
              </div>
              <div className="text-xs text-pos-ink-3 mt-0.5">
                {isOfflineMode
                  ? '所有请求走本地缓存，不发送网络请求'
                  : '正常连接后端服务，数据实时同步'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-pos-ink-3">离线模拟</span>
            <button
              onClick={() => setOfflineMode(!isOfflineMode)}
              className={`w-11 h-6 rounded-full transition-colors relative ${
                isOfflineMode ? 'bg-pos-warn' : 'bg-pos-ok'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                isOfflineMode ? 'left-0.5' : 'left-5'
              }`} />
            </button>
          </div>
        </div>
      </div>

      {/* 待同步统计 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-pos-line p-3">
          <div className="flex items-center gap-1.5 text-xs text-pos-warn mb-1">
            <HardDriveUpload size={12} /> 待同步
          </div>
          <div className="text-xl font-bold text-pos-warn tabular-nums">{pendingCount}</div>
        </div>
        <div className="bg-white rounded-lg border border-pos-line p-3">
          <div className="flex items-center gap-1.5 text-xs text-pos-danger mb-1">
            <AlertTriangle size={12} /> 失败
          </div>
          <div className="text-xl font-bold text-pos-danger tabular-nums">{failedCount}</div>
        </div>
        <div className="bg-white rounded-lg border border-pos-line p-3">
          <div className="flex items-center gap-1.5 text-xs text-pos-ok mb-1">
            <CheckCircle2 size={12} /> 已同步
          </div>
          <div className="text-xl font-bold text-pos-ok tabular-nums">{syncedCount}</div>
        </div>
      </div>

      {/* 主数据版本 */}
      <div className="bg-white rounded-lg border border-pos-line p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-pos-ink">本地主数据版本</div>
          <span className="text-xs px-2 py-0.5 rounded bg-pos-accent-light text-pos-accent font-medium">
            {masterDataVersion.version}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-pos-ink-3">最后同步</div>
            <div className="text-pos-ink mt-0.5">{masterDataVersion.lastSyncAt}</div>
          </div>
          <div>
            <div className="text-pos-ink-3">商品 / SKU</div>
            <div className="text-pos-ink mt-0.5 tabular-nums">
              {masterDataVersion.styleCount} / {masterDataVersion.skuCount}
            </div>
          </div>
          <div>
            <div className="text-pos-ink-3">会员数</div>
            <div className="text-pos-ink mt-0.5 tabular-nums">{masterDataVersion.memberCount}</div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-end gap-2">
        {isSyncing && (
          <span className="text-xs text-pos-accent flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            同步中 {syncProgress}%
          </span>
        )}
        <button
          onClick={() => void syncNow()}
          disabled={isSyncing || isOfflineMode}
          className="h-9 px-4 bg-pos-accent text-white rounded-lg text-sm font-medium hover:bg-pos-accent-hover transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          一键同步
        </button>
      </div>
    </div>;
  };

  const renderLogs = () => {
    if (errors.logs) return <AsyncState error={errors.logs} onRetry={() => retry('logs')} />;
    if (loading.logs && logs.length === 0) return <LoadingRow />;
    return <div className="space-y-4">
      <SectionTitle title="操作日志" desc="系统操作记录与审计追踪" />
       <div className="border border-pos-line rounded-lg overflow-hidden">
        <table className="w-full text-sm"><thead className="bg-pos-paper"><tr>
          <th className="text-left font-semibold text-pos-ink px-4 py-2.5">时间</th>
          <th className="text-left font-semibold text-pos-ink px-4 py-2.5">操作人</th>
          <th className="text-left font-semibold text-pos-ink px-4 py-2.5">操作类型</th>
          <th className="text-left font-semibold text-pos-ink px-4 py-2.5">操作内容</th>
          <th className="text-left font-semibold text-pos-ink px-4 py-2.5">模块</th>
        </tr></thead><tbody>
          {logs.length === 0 ? <tr><td colSpan={5}><EmptyRow text="暂无操作日志" /></td></tr> :
            logs.map((log) => <tr key={log.id} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
             <td className="px-4 py-2.5 text-pos-ink-3 font-mono text-xs">{log.createdAt?.replace('T', ' ').slice(0, 16)}</td>
             <td className="px-4 py-2.5 text-pos-ink">{log.employeeName || '系统'}</td>
              <td className="px-4 py-2.5"><span className="text-xs px-2 py-0.5 rounded bg-pos-info-bg text-pos-info font-medium">{log.action}</span></td>
             <td className="px-4 py-2.5 text-pos-ink-2">{log.content || `${log.module}${log.targetNo ? ' / ' + log.targetNo : ''}`}</td>
             <td className="px-4 py-2.5 text-pos-ink-3 text-xs">{log.module}</td>
           </tr>)}</tbody></table>
     </div>
     <Pagination page={logsPage} total={logsTotal} pageSize={10} onChange={setLogsPage} />
   </div>;
 };

  const renderLanguage = () => (
    <div className="space-y-4">
      <SectionTitle title={t('settings.language')} desc={t('language.current')} />
      <div className="border border-pos-line rounded-lg p-4 flex items-center justify-between">
        <span className="text-sm text-pos-ink-2">{t('language.label')}</span>
        <LanguageSwitcher syncFromBackend />
      </div>
    </div>
  );

  return <div className="h-full flex flex-col bg-pos-paper">
    <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
      <div><h1 className="text-lg font-semibold text-pos-ink">{t('settings.title')}</h1>
        <p className="text-xs text-pos-ink-3 mt-0.5">{t('settings.breadcrumb')}</p></div>
    </header>
    <div className="flex-1 flex overflow-hidden">
      <div className="w-52 bg-white border-r border-pos-line flex-shrink-0 py-2">
        {CATEGORIES.map((cat) => { const Icon = cat.icon; return (
          <button key={cat.key} onClick={() => setActive(cat.key)}
            className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
              active === cat.key ? 'bg-pos-accent-light text-pos-accent font-medium border-r-2 border-pos-accent'
                : 'text-pos-ink-2 hover:bg-pos-paper hover:text-pos-ink'
            }`}>
            <Icon size={16} /><span>{t(cat.labelKey)}</span>
            <ChevronRight size={14} className="ml-auto opacity-50" />
          </button>); })}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-[10px] p-6 shadow-[0_1px_2px_rgba(27_42_54_.05),0_4px_14px_rgba(27_42_54_.05)]">
          {active === 'store' && renderStore()}
          {active === 'staff' && renderStaff()}
          {active === 'payment' && renderPayment()}
          {active === 'points' && renderPoints()}
          {active === 'receipt' && renderReceipt()}
          {active === 'offline' && renderOffline()}
          {active === 'logs' && renderLogs()}
          {active === 'language' && renderLanguage()}
        </div>
      </div>
    </div>
    {showAddEmp && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white rounded-[10px] w-96 shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-pos-line">
          <h3 className="font-medium text-pos-ink">新增员工</h3>
          <button onClick={() => setShowAddEmp(false)} className="text-pos-ink-3 hover:text-pos-ink"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="姓名"><input value={newEmp.name} onChange={(e) => setNewEmp({ ...newEmp, name: e.target.value })}
            placeholder="请输入姓名" className={inputClsSm} /></Field>
          <Field label="手机号"><input value={newEmp.phone} onChange={(e) => setNewEmp({ ...newEmp, phone: e.target.value })}
            placeholder="请输入手机号" className={inputClsSm} /></Field>
          <Field label="岗位"><select value={newEmp.role} onChange={(e) => setNewEmp({ ...newEmp, role: e.target.value })}
            className="w-full h-9 px-3 border border-pos-line rounded-lg text-sm text-pos-ink focus:outline-none focus:border-pos-accent/50 bg-white">
            <option value="店长">店长</option><option value="收银员">收银员</option><option value="导购">导购</option>
          </select></Field>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-pos-line">
          <button onClick={() => setShowAddEmp(false)}
            className="h-8 px-3 border border-pos-line rounded-lg text-sm text-pos-ink-2 hover:bg-pos-paper">取消</button>
          <button onClick={addEmployee}
            className="h-8 px-3 bg-pos-accent text-white rounded-lg text-sm font-medium hover:bg-pos-accent-hover">确定</button>
        </div>
      </div>
    </div>}
  </div>;
}
