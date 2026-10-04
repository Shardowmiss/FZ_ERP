import { useState, useEffect, useCallback } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  Wifi, WifiOff, RefreshCw, Download, Upload, FileText,
  ListChecks, Clock, Store as StoreIcon, RotateCcw, AlertCircle, HardDriveUpload,
} from 'lucide-react';
import { toast } from 'sonner';
import * as erpApi from '@client/src/api/erp-integration';
import type { ErpConnectionStatus, ErpSyncStatus, SyncLog } from '@shared/api.interface';
import DownSyncCard from './DownSyncCard';
import UpstreamTable from './UpstreamTable';
import SyncLogTable from './SyncLogTable';
import ApiListTable from './ApiListTable';
import OfflineQueuePanel from './OfflineQueuePanel';
import AsyncState from '@client/src/components/AsyncState';
import { errMsg } from '@client/src/lib/errMsg';
import { STORE_ID } from '@client/src/lib/store';

const tabs = [
  { key: 'down', label: '下行数据', icon: Download },
  { key: 'up', label: '上行数据', icon: Upload },
  { key: 'queue', label: '离线交易队列', icon: HardDriveUpload },
  { key: 'log', label: '同步日志', icon: FileText },
  { key: 'api', label: '接口清单', icon: ListChecks },
];

export default function ErpSyncPage() {
  const [activeTab, setActiveTab] = useState('down');
  const [status, setStatus] = useState<ErpConnectionStatus | null>(null);
  const [downList, setDownList] = useState<ErpSyncStatus[]>([]);
  const [upList, setUpList] = useState<ErpSyncStatus[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [logDirection, setLogDirection] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [syncingTypes, setSyncingTypes] = useState<Set<string>>(new Set());
  const [upSyncingTypes, setUpSyncingTypes] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState(false);
  const [togglingConn, setTogglingConn] = useState(false);
  /** 整页加载失败原因；此前各 loader 静默吞异常，失败时界面落到空态，用户无法区分「没数据」与「加载失败」 */
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const data = await erpApi.getStatus();
      setStatus(data);
    } catch (err) {
      logger.error('loadStatus error', err as Error);
      throw err;
    }
  }, []);

  const loadDownstream = useCallback(async () => {
    try {
      const data = await erpApi.getDownstreamSyncStatus();
      setDownList(data);
    } catch (err) {
      logger.error('loadDownstream error', err as Error);
      throw err;
    }
  }, []);

  const loadUpstream = useCallback(async () => {
    try {
      const data = await erpApi.getUpstreamSyncStatus();
      setUpList(data);
    } catch (err) {
      logger.error('loadUpstream error', err as Error);
      throw err;
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const params = logDirection !== 'all' ? { direction: logDirection, pageSize: 50 } : { pageSize: 50 };
      const data = await erpApi.getSyncLogs(params);
      setLogs(data.items ?? []);
    } catch (err) {
      logger.error('loadLogs error', err as Error);
      throw err;
    }
  }, [logDirection]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // 用 allSettled 而非 all：任一项失败不应阻断其他面板渲染，
    // 但要汇总出一条可见的失败原因，避免整页静默空态。
    const results = await Promise.allSettled([
      loadStatus(), loadDownstream(), loadUpstream(), loadLogs(),
    ]);
    const firstFailed = results.find((r) => r.status === 'rejected');
    if (firstFailed) {
      const reason = (firstFailed as PromiseRejectedResult).reason;
      setLoadError(errMsg(reason, '同步数据加载失败，请检查网络或联系管理员'));
    }
    setLoading(false);
  }, [loadStatus, loadDownstream, loadUpstream, loadLogs]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleToggleConnection = async () => {
    if (!status || togglingConn) return;
    const newOnline = !status.connected;
    setTogglingConn(true);
    try {
      await erpApi.toggleConnection(newOnline);
      setStatus({ ...status, connected: newOnline, mode: newOnline ? 'online' : 'offline' });
      toast.success(newOnline ? '已恢复网络连接' : '已切换到断网模式，单据将暂存本地');
    } catch (err) {
      logger.error('toggleConnection error', err as Error);
      toast.error('切换连接状态失败');
    } finally {
      setTogglingConn(false);
    }
  };

  const handleDownSync = async (type: string) => {
    setSyncingTypes((prev) => new Set(prev).add(type));
    try {
      await erpApi.syncDownstream(type);
      toast.success('同步任务已触发');
      setTimeout(async () => {
        await loadDownstream();
        await loadLogs();
        setSyncingTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }, 3000);
    } catch (err) {
      logger.error('syncDownstream error', err as Error);
      toast.error('同步触发失败');
      setSyncingTypes((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  };

  const handleUpSync = async (type: string) => {
    setUpSyncingTypes((prev) => new Set(prev).add(type));
    try {
      await erpApi.retryUpstream();
      toast.success('上传任务已触发');
      setTimeout(async () => {
        await loadUpstream();
        await loadStatus();
        await loadLogs();
        setUpSyncingTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }, 3000);
    } catch (err) {
      logger.error('handleUpSync error', err as Error);
      toast.error('上传触发失败');
      setUpSyncingTypes((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  };

  const handleRetryAll = async () => {
    if (retrying || !status?.connected) return;
    setRetrying(true);
    try {
      await erpApi.retryUpstream();
      toast.success('一键补传已触发，正在重新上传所有失败单据');
      setTimeout(async () => {
        await loadUpstream();
        await loadStatus();
        await loadLogs();
        setRetrying(false);
      }, 3000);
    } catch (err) {
      logger.error('retryAll error', err as Error);
      toast.error('补传触发失败');
      setRetrying(false);
    }
  };

  const offline = status?.mode === 'offline' || status?.connected === false;

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-pos-ink">ERP 对接中心</h1>
          <p className="text-xs text-pos-ink-3 mt-0.5">系统 / ERP对接中心</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadAll()}
            className="text-xs px-3 py-1.5 border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 刷新
          </button>
          <button className="text-xs px-3 py-1.5 border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1">
            <Clock size={12} /> 同步设置
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 连接状态卡片 */}
        {status ? (
          <div className={`rounded-xl shadow-sm p-5 border transition-colors ${
            offline
              ? 'bg-pos-warn-bg/40 border-pos-warn-bg'
              : 'bg-pos-ok-bg/40 border-pos-ok-bg'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center ${
                  offline ? 'bg-pos-warn-bg text-pos-warn' : 'bg-pos-ok-bg text-pos-ok'
                }`}>
                  {offline ? <WifiOff size={28} /> : <Wifi size={28} />}
                </div>
                <div>
                  <div className="text-lg font-semibold text-pos-ink">ERP 连接状态</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`w-2 h-2 rounded-full ${offline ? 'bg-pos-warn animate-pulse' : 'bg-pos-ok animate-pulse'}`} />
                    <span className={`text-sm font-medium ${offline ? 'text-pos-warn' : 'text-pos-ok'}`}>
                      {offline ? '断网模式 · 单据暂存本地' : '已连接 · 数据通信正常'}
                    </span>
                  </div>
                  <div className="text-xs text-pos-ink-3 mt-1 flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <StoreIcon size={11} /> 门店：{STORE_ID}
                    </span>
                    <span>服务器：erp.yuncai.com</span>
                    <span>延迟：{offline ? '—' : '23ms'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-4 text-center">
                  <div>
                    <div className="text-xs text-pos-ink-3">今日下行</div>
                    <div className="text-lg font-semibold text-pos-ink tabular-nums">
                      {status.downstreamCount?.toLocaleString() ?? 0}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-pos-line-soft" />
                  <div>
                    <div className="text-xs text-pos-ink-3">待上传</div>
                    <div className="text-lg font-semibold text-pos-accent tabular-nums">
                      {status.upstreamPending ?? 0}
                    </div>
                  </div>
                  <div className="w-px h-8 bg-pos-line-soft" />
                  <div>
                    <div className="text-xs text-pos-ink-3">上传失败</div>
                    <div className={`text-lg font-semibold tabular-nums ${
                      (status.upstreamFailed ?? 0) > 0 ? 'text-pos-danger' : 'text-pos-ok'
                    }`}>
                      {status.upstreamFailed ?? 0}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleRetryAll}
                    disabled={retrying || offline}
                    className="px-3 py-2 bg-pos-accent text-white rounded-lg text-sm hover:bg-pos-accent-hover transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={14} className={retrying ? 'animate-spin' : ''} />
                    一键补传
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-pos-ink-3">断网模拟</span>
                    <button
                      onClick={handleToggleConnection}
                      disabled={togglingConn}
                      className={`w-11 h-6 rounded-full transition-colors relative ${
                        offline ? 'bg-pos-warn' : 'bg-pos-ok'
                      }`}
                      aria-label="切换断网模式"
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${
                        offline ? 'left-0.5' : 'left-5'
                      }`} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

              {offline && (
              <div className="mt-4 pt-4 border-t border-pos-warn-bg flex items-start gap-2 text-pos-warn">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed">
                  当前处于断网模拟模式，所有POS操作产生的单据将暂存本地队列，恢复网络后可点击「一键补传」同步到ERP。
                  断网期间不影响门店正常收银和库存扣减。
                </div>
              </div>
            )}
          </div>
        ) : loadError ? (
          <div className="rounded-xl shadow-sm p-5 border border-pos-line bg-white">
            <AsyncState error={loadError} onRetry={() => void loadAll()} />
          </div>
        ) : (
          <div className="rounded-xl shadow-sm p-5 border border-pos-line bg-white">
            <div className="animate-pulse flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-pos-line-soft" />
              <div className="flex-1">
                <div className="h-5 w-32 bg-pos-line-soft rounded mb-2" />
                <div className="h-4 w-48 bg-pos-line-soft rounded" />
              </div>
            </div>
          </div>
        )}

        {/* Tabs 容器 */}
        <div className="bg-white rounded-xl border border-pos-line shadow-sm">
          <div className="px-4 py-2 border-b border-pos-line">
            <div className="flex items-center gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-4 py-2 text-sm rounded-t-lg transition-colors flex items-center gap-1.5 border-b-2 ${
                      activeTab === tab.key
                        ? 'text-pos-accent font-medium border-pos-accent -mb-px bg-pos-paper/30'
                        : 'text-pos-ink-3 hover:text-pos-ink border-transparent hover:border-pos-line-soft'
                    }`}
                  >
                    <Icon size={14} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="p-4">
            {activeTab === 'down' && (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                {downList.map((item) => (
                  <DownSyncCard
                    key={item.dataType}
                    item={item}
                    onSync={handleDownSync}
                    syncing={syncingTypes.has(item.dataType)}
                  />
                ))}
                <AsyncState
                  loading={loading && downList.length === 0}
                  empty={!loading && downList.length === 0}
                  error={loadError}
                  onRetry={() => void loadAll()}
                  emptyText="暂无下行数据"
                  className="col-span-full py-16 text-center text-pos-ink-3 text-sm"
                />
              </div>
            )}
            {activeTab === 'up' && (
              <UpstreamTable
                items={upList}
                loading={loading}
                error={loadError}
                onRetry={() => void loadAll()}
                syncingTypes={upSyncingTypes}
                onSync={handleUpSync}
              />
            )}
            {activeTab === 'queue' && <OfflineQueuePanel />}
            {activeTab === 'log' && (
              <SyncLogTable
                logs={logs}
                loading={loading}
                error={loadError}
                direction={logDirection}
                onDirectionChange={setLogDirection}
                onRefresh={() => void loadAll()}
              />
            )}
            {activeTab === 'api' && <ApiListTable />}
          </div>
        </div>
      </div>
    </div>
  );
}
