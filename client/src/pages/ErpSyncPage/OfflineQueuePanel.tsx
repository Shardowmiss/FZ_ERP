import { useState, useEffect, Fragment } from 'react';
import {
  RefreshCw,
  Clock,
  Database,
  AlertTriangle,
  CheckCircle2,
  Play,
  Eye,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import OfflineDetailDialog from './OfflineDetailDialog';
import {
  getOfflineQueue,
  getMasterDataVersion,
  syncAllOffline,
  retryOfflineItem,
  type OfflineQueueItem,
  type MasterDataVersion,
} from '@client/src/api/offline-sync';
import { getSyncEngine } from '@client/src/lib/offline/sync-engine';
import type { PendingItem } from '@client/src/lib/offline/db';

const STATUS_MAP: Record<string, { label: string; className: string; dotClass: string }> = {
  pending: { label: '待同步', className: 'bg-pos-ink-3/10 text-pos-ink-3', dotClass: 'bg-pos-ink-3' },
  syncing: { label: '同步中', className: 'bg-pos-info-bg text-pos-info', dotClass: 'bg-pos-info' },
  synced: { label: '已同步', className: 'bg-pos-ok-bg text-pos-ok', dotClass: 'bg-pos-ok' },
  failed: { label: '失败', className: 'bg-pos-danger-bg text-pos-danger', dotClass: 'bg-pos-danger' },
  conflict: { label: '冲突', className: 'bg-pos-warn-bg text-pos-warn', dotClass: 'bg-pos-warn' },
};

const TYPE_MAP: Record<string, string> = {
  sale: '销售单',
  return: '退货单',
  suspend: '挂单',
  inventory: '库存调整',
  stock_adjust: '库存调整',
  stocktake: '盘点单',
  transfer_request: '要货申请',
  receipt: '收货单',
  member: '会员注册',
};

const PAY_METHOD_LABEL: Record<string, string> = {
  cash: '现金',
  wechat: '微信支付',
  alipay: '支付宝',
  bank_card: '银行卡',
  stored_value: '储值卡',
  points: '积分抵扣',
};

interface OfflineQueuePanelProps {
  compact?: boolean;
}

export default function OfflineQueuePanel({ compact = false }: OfflineQueuePanelProps) {
  const [items, setItems] = useState<OfflineQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState<MasterDataVersion | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [detailItem, setDetailItem] = useState<OfflineQueueItem | null>(null);
  // 本地死信（超过最大重试次数，需人工核对后重提）—— P1-4
  const [deadLetters, setDeadLetters] = useState<PendingItem[]>([]);
  const [requeueingId, setRequeueingId] = useState<string | null>(null);

  const loadDeadLetters = async () => {
    try {
      const list = await getSyncEngine().getDeadLetterItems();
      setDeadLetters(list);
    } catch (err) {
      logger.error('load dead letters failed', err as Error);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [res, ver] = await Promise.all([
        getOfflineQueue(statusFilter === 'all' ? {} : { status: statusFilter }),
        getMasterDataVersion(),
      ]);
      setItems(res.items);
      setVersion(ver);
    } catch (err) {
      logger.error('load offline queue failed', err as Error);
      toast.error('加载离线队列失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    void loadDeadLetters();
  }, [statusFilter]);

  const pendingCount = items.filter((i) => i.status === 'pending').length;
  const syncingCount = items.filter((i) => i.status === 'syncing').length;
  const failedCount = items.filter(
    (i) => i.status === 'failed' || i.status === 'conflict',
  ).length;
  const syncedCount = items.filter((i) => i.status === 'synced').length;

  const handleSyncAll = async () => {
    if (syncingAll) return;
    setSyncingAll(true);
    try {
      await syncAllOffline();
      toast.success('已触发全量同步');
      setTimeout(() => void loadData(), 2000);
    } catch (err) {
      logger.error('sync all failed', err as Error);
      toast.error('同步触发失败');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    try {
      await retryOfflineItem(id);
      toast.success('已触发重试');
      setTimeout(() => void loadData(), 1500);
    } catch (err) {
      logger.error('retry failed', err as Error);
      toast.error('重试触发失败');
    } finally {
      setRetryingId(null);
    }
  };

  // 人工核对后重提：重置为 pending 并清零重试次数，重新进入同步队列
  const handleRequeue = async (clientId: string, entityType: string) => {
    if (!window.confirm('确认将该单据重新放入同步队列？请确认已完成人工核对/改单。')) return;
    setRequeueingId(clientId);
    try {
      await getSyncEngine().retryItem(clientId, entityType);
      toast.success('已重新入队，稍后将自动重试');
      await loadDeadLetters();
      setTimeout(() => void loadData(), 1000);
    } catch (err) {
      logger.error('requeue failed', err as Error);
      toast.error('重提失败');
    } finally {
      setRequeueingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4">
      {/* 顶部统计卡片 + 主数据版本 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard
          label="待同步"
          value={pendingCount}
          tone="muted"
          icon={<Clock size={16} />}
        />
        <StatCard
          label="同步中"
          value={syncingCount}
          tone="info"
          icon={<RefreshCcw size={16} />}
        />
        <StatCard
          label="已同步"
          value={syncedCount}
          tone="ok"
          icon={<CheckCircle2 size={16} />}
        />
        <StatCard
          label="失败/冲突"
          value={failedCount}
          tone="danger"
          icon={<AlertTriangle size={16} />}
        />
        <div className="bg-white rounded-lg border border-pos-line p-3 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs text-pos-ink-3 mb-2">
            <Database size={12} /> 主数据版本
          </div>
          <div className="text-sm font-semibold text-pos-ink mb-0.5 tabular-nums">
            {version?.version ?? '—'}
          </div>
          <div className="text-[11px] text-pos-ink-3">
            最后同步：{version?.lastSyncAt ?? '—'}
          </div>
          <div className="text-[11px] text-pos-ink-3 mt-0.5">
            {version
              ? `${version.styleCount}款 · ${version.skuCount}SKU · ${version.memberCount}会员`
              : '加载中...'}
          </div>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-pos-ink-3">状态筛选：</span>
          {[
            { key: 'all', label: '全部' },
            { key: 'pending', label: '待上传' },
            { key: 'failed', label: '失败' },
            { key: 'conflict', label: '冲突' },
            { key: 'synced', label: '已同步' },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setStatusFilter(opt.key)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                statusFilter === opt.key
                  ? 'bg-pos-accent-light text-pos-accent font-medium'
                  : 'text-pos-ink-2 hover:bg-pos-paper'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="h-8 px-3 border border-pos-line rounded-lg text-xs text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncingAll || pendingCount + failedCount === 0}
            className="h-8 px-3 bg-pos-accent text-white rounded-lg text-xs font-medium hover:bg-[#A8401F] transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncingAll ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            立即同步全部
          </button>
        </div>
      </div>

      {/* 本地死信待处理工作台（P1-4：超过最大重试次数的单据不再静默丢失） */}
      {deadLetters.length > 0 && (
        <div className="border border-pos-danger/40 bg-pos-danger-bg/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-pos-danger" />
            <span className="text-sm font-semibold text-pos-danger">
              待处理（{deadLetters.length}）
            </span>
            <span className="text-xs text-pos-ink-3">
              以下单据重试已达上限，已停止自动重试。请人工核对/改单后重提，避免丢单。
            </span>
          </div>
          <div className="space-y-2">
            {deadLetters.map((d) => (
              <div
                key={`${d.entityType}-${d.clientId}`}
                className="flex items-center justify-between bg-white rounded-md border border-pos-line px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-mono text-pos-ink truncate">{d.clientId}</div>
                  <div className="text-[11px] text-pos-ink-3">
                    {TYPE_MAP[d.entityType] ?? d.entityType} · 已重试 {d.retryCount} 次
                  </div>
                </div>
                <button
                  onClick={() => void handleRequeue(d.clientId, d.entityType)}
                  disabled={requeueingId === d.clientId}
                  className="ml-3 h-7 px-3 text-xs bg-pos-accent text-white rounded-md hover:bg-[#A8401F] transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  {requeueingId === d.clientId ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <RefreshCw size={12} />
                  )}
                  人工重提
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 队列表格 */}
      <div className="border border-pos-line rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-pos-paper">
            <tr>
                      <th className="text-left font-semibold text-pos-ink px-4 py-2.5 w-36">
                        临时单号
                      </th>
                      <th className="text-left font-semibold text-pos-ink px-4 py-2.5 w-24">
                        类型
                      </th>
                      <th className="text-left font-semibold text-pos-ink px-4 py-2.5 w-24">
                        支付方式
                      </th>
                      <th className="text-right font-semibold text-pos-ink px-4 py-2.5 w-28">
                        金额
                      </th>
                      <th className="text-left font-semibold text-pos-ink px-4 py-2.5 w-40">
                        产生时间
                      </th>
                      <th className="text-center font-semibold text-pos-ink px-4 py-2.5 w-24">
                        状态
                      </th>
                      <th className="text-center font-semibold text-pos-ink px-4 py-2.5 w-20">
                        重试
                      </th>
                      <th className="text-center font-semibold text-pos-ink px-4 py-2.5 w-32">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-pos-ink-3 text-sm">
                          <Loader2 size={16} className="inline-block animate-spin mr-2" />
                          加载中...
                        </td>
                      </tr>
                    ) : items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-pos-ink-3 text-sm">
                          暂无离线交易记录
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const statusInfo = STATUS_MAP[item.status] ?? STATUS_MAP.pending;
                        const isExpanded = expandedId === item.id;
                        const showError =
                          (item.status === 'failed' || item.status === 'conflict') &&
                          item.errorMsg;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/30 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-pos-ink">
                        {item.tempNo || item.clientId?.slice(-12) || item.id?.slice(-12)}
                      </td>
                      <td className="px-4 py-2.5 text-pos-ink-2">
                        {TYPE_MAP[item.type] ?? item.typeName}
                      </td>
                      <td className="px-4 py-2.5 text-pos-ink-2 text-xs">
                        {item.payMethod
                          ? PAY_METHOD_LABEL[item.payMethod] ?? item.payMethod
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums text-pos-ink">
                        {item.amount === 0
                          ? '—'
                          : `¥${item.amount.toFixed(2)}`}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-pos-ink-3 font-mono">
                        {item.createdAt.replace('T', ' ').slice(0, 16)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-md font-medium inline-flex items-center gap-1 ${statusInfo.className}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass} ${item.status === 'syncing' ? 'animate-pulse' : ''}`} />
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-pos-ink-2 tabular-nums">
                        {item.retryCount}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setDetailItem(item)}
                            className="text-xs text-pos-info hover:underline flex items-center gap-0.5"
                            title="查看详情"
                          >
                            <Eye size={12} />
                            详情
                          </button>
                          {(item.status === 'failed' ||
                            item.status === 'conflict') && (
                            <button
                              onClick={() => void handleRetry(item.id)}
                              disabled={retryingId === item.id}
                              className="text-xs text-pos-accent hover:underline flex items-center gap-0.5 disabled:opacity-50"
                              title="重试"
                            >
                              {retryingId === item.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <RefreshCw size={12} />
                              )}
                              重试
                            </button>
                          )}
                          {showError && (
                            <button
                              onClick={() => toggleExpand(item.id)}
                              className="text-pos-ink-3 hover:text-pos-ink"
                              title={isExpanded ? '收起' : '展开错误'}
                            >
                              {isExpanded ? (
                                <ChevronUp size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && showError && (
                      <tr className="border-b border-pos-line-soft bg-pos-danger-bg/20">
                        <td colSpan={8} className="px-4 py-2">
                          <div className="flex items-start gap-2 text-xs text-pos-danger">
                            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                            <span>错误原因：{item.errorMsg}</span>
                            {item.conflictType && (
                              <span className="ml-2 px-1.5 py-0.5 bg-pos-warn-bg text-pos-warn rounded text-[10px] font-medium">
                                {item.conflictType}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 详情弹窗 */}
      <OfflineDetailDialog
        item={detailItem}
        open={detailItem !== null}
        onOpenChange={(o) => !o && setDetailItem(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: 'muted' | 'info' | 'ok' | 'danger' | 'warn';
  icon: React.ReactNode;
}) {
  const toneClasses = {
    muted: {
      bg: 'bg-pos-ink-3/10',
      text: 'text-pos-ink-3',
      border: 'border-pos-line-soft',
    },
    info: {
      bg: 'bg-pos-info-bg/50',
      text: 'text-pos-info',
      border: 'border-pos-info-bg',
    },
    warn: {
      bg: 'bg-pos-warn-bg/50',
      text: 'text-pos-warn',
      border: 'border-pos-warn-bg',
    },
    danger: {
      bg: 'bg-pos-danger-bg/50',
      text: 'text-pos-danger',
      border: 'border-pos-danger-bg',
    },
    ok: {
      bg: 'bg-pos-ok-bg/50',
      text: 'text-pos-ok',
      border: 'border-pos-ok-bg',
    },
  }[tone];

  return (
    <div
      className={`rounded-lg border ${toneClasses.border} ${toneClasses.bg} p-3 shadow-sm`}
    >
      <div
        className={`flex items-center gap-1.5 text-xs ${toneClasses.text} mb-1`}
      >
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${toneClasses.text}`}>
        {value}
      </div>
    </div>
  );
}
