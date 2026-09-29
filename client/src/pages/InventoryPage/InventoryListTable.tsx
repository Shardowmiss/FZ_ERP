import { Loader2, Package } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';

export interface ListTableProps<T extends { id: string }> {
  title: string;
  items: T[];
  loading: boolean;
  emptyText?: string;
  actionLabel?: string;
  onAction?: (item: T) => void;
  actionDisabled?: (item: T) => boolean;
  renderRow: (item: T) => React.ReactNode;
  headerKeys: { key: string; align?: 'left' | 'right' | 'center' }[];
  onCreate?: () => void;
  createLabel?: string;
}

export default function ListTable<T extends { id: string }>({
  title,
  items,
  loading,
  emptyText = '暂无数据',
  actionLabel = '查看',
  onAction,
  actionDisabled,
  renderRow,
  headerKeys,
  onCreate,
  createLabel,
}: ListTableProps<T>) {
  const colCount = headerKeys.length + 1;

  return (
    <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
        <span className="text-sm font-medium text-pos-ink">{title}</span>
        {onCreate && (
          <Button size="sm" onClick={onCreate}>
            {createLabel || `新建${title.slice(0, 2)}`}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-pos-paper">
            <tr>
              {headerKeys.map((h) => (
                <th
                  key={h.key}
                  className={`text-${h.align || 'left'} font-semibold text-pos-ink px-4 py-2.5`}
                >
                  {h.key}
                </th>
              ))}
              <th className="text-center font-semibold text-pos-ink px-4 py-2.5 w-24">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-10 text-center text-pos-ink-3"
                >
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  加载中...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-4 py-10 text-center text-pos-ink-3"
                >
                  <Package size={32} className="mx-auto mb-2 opacity-30" />
                  {emptyText}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                 <tr
                   key={item.id}
                   className="border-b border-pos-line-soft hover:bg-pos-accent-light/50"
                 >
                  {renderRow(item)}
                  <td className="px-4 py-3 text-center">
                    {onAction ? (
                      <button
                        onClick={() => onAction(item)}
                        disabled={actionDisabled?.(item)}
                        className="text-xs text-pos-accent hover:text-[#A8401F] disabled:text-pos-ink-3 disabled:cursor-not-allowed"
                      >
                        {actionLabel}
                      </button>
                    ) : (
                      <button className="text-xs text-pos-ink-3 hover:text-pos-ink">
                        {actionLabel}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export const statusColorMap: Record<string, string> = {
  // 中文兼容
  已完成: 'bg-pos-ok-bg text-pos-ok',
  已入库: 'bg-pos-ok-bg text-pos-ok',
  待审批: 'bg-pos-warn-bg text-pos-warn',
  待收货: 'bg-pos-warn-bg text-pos-warn',
  处理中: 'bg-pos-info-bg text-pos-info',
  已拒绝: 'bg-pos-danger-bg text-pos-danger',
  进行中: 'bg-pos-info-bg text-pos-info',
  // 英文（后端实际返回）
  pending: 'bg-pos-warn-bg text-pos-warn',
  submitted: 'bg-pos-warn-bg text-pos-warn',
  draft: 'bg-pos-warn-bg text-pos-warn',
  received: 'bg-pos-ok-bg text-pos-ok',
  audited: 'bg-pos-ok-bg text-pos-ok',
  completed: 'bg-pos-ok-bg text-pos-ok',
  approved: 'bg-pos-ok-bg text-pos-ok',
  rejected: 'bg-pos-danger-bg text-pos-danger',
  processing: 'bg-pos-info-bg text-pos-info',
  cancelled: 'bg-pos-paper text-pos-ink-3',
};

export function getStatusClass(status: string): string {
  return `px-2 py-0.5 rounded-md font-medium ${statusColorMap[status] || 'bg-pos-paper text-pos-ink-3'}`;
}

export const statusLabelMap: Record<string, string> = {
  pending: '待收货',
  submitted: '待审批',
  draft: '草稿',
  received: '已入库',
  audited: '已审核',
  completed: '已完成',
  approved: '已审批',
  rejected: '已拒绝',
  processing: '处理中',
  cancelled: '已取消',
};

export function getStatusLabel(status: string): string {
  return statusLabelMap[status] || status;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
