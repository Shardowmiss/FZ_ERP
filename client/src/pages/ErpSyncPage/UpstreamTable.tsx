import type { ErpSyncStatus } from '@shared/api.interface';
import { upTypeNameMap, formatDateTime, mapStatus, statusIconMap } from './sync-constants';

interface UpstreamTableProps {
  items: ErpSyncStatus[];
  loading: boolean;
  syncingTypes: Set<string>;
  onSync: (type: string) => void;
}

export default function UpstreamTable({ items, loading, syncingTypes, onSync }: UpstreamTableProps) {
  if (loading && items.length === 0) {
    return <div className="text-center py-16 text-pos-ink-3 text-sm">加载中...</div>;
  }
  if (items.length === 0) {
    return <div className="text-center py-16 text-pos-ink-3 text-sm">暂无上行数据</div>;
  }

  return (
    <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-pos-paper">
          <tr>
            <th className="text-left font-semibold text-pos-ink px-4 py-3">单据类型</th>
            <th className="text-right font-semibold text-pos-ink px-4 py-3">今日待同步</th>
            <th className="text-right font-semibold text-pos-ink px-4 py-3">历史累计</th>
            <th className="text-left font-semibold text-pos-ink px-4 py-3">最后同步</th>
            <th className="text-center font-semibold text-pos-ink px-4 py-3">状态</th>
            <th className="text-center font-semibold text-pos-ink px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const name = upTypeNameMap[item.dataType] ?? item.dataName;
            const isSyncing = syncingTypes.has(item.dataType);
            const status = isSyncing ? 'syncing' : mapStatus(item.lastSyncStatus);
            return (
              <tr key={item.dataType} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
                <td className="px-4 py-3 font-medium text-pos-ink">{name}</td>
                <td className="px-4 py-3 text-right text-pos-accent font-medium tabular-nums">
                  {item.pendingCount}
                </td>
                <td className="px-4 py-3 text-right text-pos-ink tabular-nums">
                  {item.totalCount.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-pos-ink-3">{formatDateTime(item.lastSyncAt)}</td>
                <td className="px-4 py-3 text-center">{statusIconMap[status]}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => onSync(item.dataType)}
                    disabled={isSyncing}
                    className="text-xs text-pos-accent hover:text-[#A8401F] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    立即上传
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
