import { RefreshCw } from 'lucide-react';
import type { SyncLog } from '@shared/api.interface';
import { formatDateTime, formatDuration, mapStatus, statusTextMap, getTaskName } from './sync-constants';

interface SyncLogTableProps {
  logs: SyncLog[];
  loading: boolean;
  direction: string;
  onDirectionChange: (dir: string) => void;
  onRefresh: () => void;
}

export default function SyncLogTable({ logs, loading, direction, onDirectionChange, onRefresh }: SyncLogTableProps) {
  const filteredLogs = direction === 'all'
    ? logs
    : logs.filter((log) => log.direction === direction);

  return (
    <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
        <span className="text-sm font-medium text-pos-ink">同步日志</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {[
              { key: 'all', label: '全部' },
              { key: 'downstream', label: '下行' },
              { key: 'upstream', label: '上行' },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => onDirectionChange(opt.key)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                  direction === opt.key
                    ? 'bg-pos-accent text-white'
                    : 'text-pos-ink-2 hover:bg-pos-paper'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={onRefresh}
            className="text-xs px-3 py-1.5 border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1"
          >
            <RefreshCw size={12} /> 刷新
          </button>
        </div>
      </div>
      {loading && filteredLogs.length === 0 ? (
        <div className="text-center py-16 text-pos-ink-3 text-sm">加载中...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="text-center py-16 text-pos-ink-3 text-sm">暂无同步日志</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-pos-paper">
            <tr>
              <th className="text-left font-semibold text-pos-ink px-4 py-2.5">时间</th>
              <th className="text-center font-semibold text-pos-ink px-4 py-2.5">方向</th>
              <th className="text-left font-semibold text-pos-ink px-4 py-2.5">任务名称</th>
              <th className="text-right font-semibold text-pos-ink px-4 py-2.5">重试次数</th>
              <th className="text-center font-semibold text-pos-ink px-4 py-2.5">状态</th>
              <th className="text-right font-semibold text-pos-ink px-4 py-2.5">耗时</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => {
              const st = mapStatus(log.status);
              const dirLabel = log.direction === 'downstream' ? '下行' : log.direction === 'upstream' ? '上行' : log.direction;
              return (
                <tr key={log.id} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
                  <td className="px-4 py-2.5 text-pos-ink-3 font-mono text-xs">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      log.direction === 'upstream'
                        ? 'bg-pos-info-bg text-pos-info'
                        : 'bg-pos-accent-light text-pos-accent'
                    }`}>
                      {dirLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-pos-ink">
                    {getTaskName(log.dataType)}
                    {log.docNo && <span className="text-pos-ink-3 text-xs ml-2">({log.docNo})</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-pos-ink-2 tabular-nums">{log.retryCount}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs ${
                      st === 'success' ? 'text-pos-ok' :
                      st === 'syncing' ? 'text-pos-accent' :
                      st === 'warning' ? 'text-pos-warn' :
                      st === 'failed' ? 'text-pos-danger' : 'text-pos-ink-3'
                    }`}>
                      {statusTextMap[st]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-pos-ink-3 tabular-nums">
                    {formatDuration(log.durationMs)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
