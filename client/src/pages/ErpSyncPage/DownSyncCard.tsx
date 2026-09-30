import { RefreshCw } from 'lucide-react';
import type { ErpSyncStatus } from '@shared/api.interface';
import { downTypeIconMap, downTypeNameMap, formatDateTime, mapStatus, statusIconMap, statusTextMap } from './sync-constants';

interface DownSyncCardProps {
  item: ErpSyncStatus;
  onSync: (type: string) => void;
  syncing: boolean;
}

export default function DownSyncCard({ item, onSync, syncing }: DownSyncCardProps) {
  const Icon = downTypeIconMap[item.dataType] ?? (() => null);
  const name = downTypeNameMap[item.dataType] ?? item.dataName;
  const status = syncing ? 'syncing' : mapStatus(item.lastSyncStatus);

  return (
    <div className="bg-white rounded-xl border border-pos-line shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-pos-accent/10 flex items-center justify-center text-pos-accent">
            <Icon size={18} />
          </div>
          <div>
            <div className="font-medium text-pos-ink">{name}</div>
            <div className="text-xs text-pos-ink-3">共 {item.totalCount.toLocaleString()} 条</div>
          </div>
        </div>
        {statusIconMap[status]}
      </div>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-pos-ink-3">最后同步</span>
          <span className="text-pos-ink-2">{formatDateTime(item.lastSyncAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-pos-ink-3">同步状态</span>
          <span className={`font-medium ${
            status === 'success' ? 'text-pos-ok' :
            status === 'syncing' ? 'text-pos-accent' :
            status === 'warning' ? 'text-pos-warn' :
            status === 'failed' ? 'text-pos-danger' : 'text-pos-ink-3'
          }`}>
            {syncing ? '同步中...' : statusTextMap[status]}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-pos-ink-3">成功/失败</span>
          <span className="text-pos-ink-2 tabular-nums">
            <span className="text-pos-ok">{item.successCount}</span>
            <span className="text-pos-ink-3"> / </span>
            <span className={item.failedCount > 0 ? 'text-pos-danger' : 'text-pos-ink-2'}>
              {item.failedCount}
            </span>
          </span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-pos-line-soft flex items-center justify-between">
        <button
          onClick={() => onSync(item.dataType)}
          disabled={syncing}
          className="text-xs text-pos-accent hover:text-pos-accent-hover flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
          立即同步
        </button>
      </div>
    </div>
  );
}
