import React from 'react';
import { Loader2, Package, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';

/**
 * 通用列表表格（POS 侧统一列表抽象）
 *
 * 由原 pages/InventoryPage/InventoryListTable.tsx 提升而来，补齐三态：
 *   loading / empty / error
 * 此前各页面自实现列表，空态覆盖率仅 5/34、错误态基本缺失，
 * 接口失败时界面会停留在空白或旧数据，用户无法判断是「没数据」还是「加载失败」。
 *
 * 使用方式：传入 items / loading / error 与 renderRow，其余为可选。
 */

export interface ListTableProps<T extends { id: string }> {
  title: string;
  items: T[];
  loading: boolean;
  /** 错误信息；有值时优先展示错误态（可重试），为空则按 loading/empty 处理 */
  error?: string | null;
  /** 错误态下的重试回调，传入才显示「重试」按钮 */
  onRetry?: () => void;
  emptyText?: string;
  /** 空态图标，默认包裹图标 */
  emptyIcon?: React.ReactNode;
  actionLabel?: string;
  onAction?: (item: T) => void;
  actionDisabled?: (item: T) => boolean;
  renderRow: (item: T) => React.ReactNode;
  headerKeys: { key: string; align?: 'left' | 'right' | 'center' }[];
  onCreate?: () => void;
  createLabel?: string;
  /** 不需要操作列时可关闭 */
  hideActionColumn?: boolean;
}

export default function ListTable<T extends { id: string }>({
  title,
  items,
  loading,
  error = null,
  onRetry,
  emptyText = '暂无数据',
  emptyIcon,
  actionLabel = '查看',
  onAction,
  actionDisabled,
  renderRow,
  headerKeys,
  onCreate,
  createLabel,
  hideActionColumn = false,
}: ListTableProps<T>) {
  const colCount = headerKeys.length + (hideActionColumn ? 0 : 1);

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
              {!hideActionColumn && (
                <th className="text-center font-semibold text-pos-ink px-4 py-2.5 w-24">
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center">
                  <AlertTriangle size={28} className="mx-auto mb-2 text-pos-danger" />
                  <div className="text-pos-danger text-sm mb-2">{error}</div>
                  {onRetry && (
                    <button
                      onClick={onRetry}
                      className="text-xs text-pos-accent hover:text-pos-accent-hover inline-flex items-center gap-1"
                    >
                      <RefreshCw size={12} />
                      重试
                    </button>
                  )}
                </td>
              </tr>
            ) : loading && items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-pos-ink-3">
                  <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                  加载中...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-pos-ink-3">
                  {emptyIcon ?? <Package size={32} className="mx-auto mb-2 opacity-30" />}
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
                  {!hideActionColumn && (
                    <td className="px-4 py-3 text-center">
                      {onAction ? (
                        <button
                          onClick={() => onAction(item)}
                          disabled={actionDisabled?.(item)}
                          className="text-xs text-pos-accent hover:text-pos-accent-hover disabled:text-pos-ink-3 disabled:cursor-not-allowed"
                        >
                          {actionLabel}
                        </button>
                      ) : (
                        <button className="text-xs text-pos-ink-3 hover:text-pos-ink">
                          {actionLabel}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
