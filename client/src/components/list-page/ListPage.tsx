import React, { useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';

export interface ListPageColumn<T> {
  key: string;
  title: string;
  dataIndex: keyof T | string;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  render?: (value: unknown, record: T, index: number) => React.ReactNode;
}

export interface ListPageProps<T> {
  title: string;
  columns: ListPageColumn<T>[];
  dataSource: T[];
  loading?: boolean;
  rowKey?: keyof T | ((record: T) => string);
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  searchBar?: React.ReactNode;
  showAddButton?: boolean;
  addButtonText?: string;
  onAdd?: () => void;
  showExportButton?: boolean;
  exportButtonText?: string;
  onExport?: () => void;
  extraActions?: React.ReactNode;
  emptyText?: string;
  className?: string;
}

function getRecordKey<T>(
  record: T,
  index: number,
  rowKey?: keyof T | ((record: T) => string)
): string {
  if (!rowKey) return String(index);
  if (typeof rowKey === 'function') return rowKey(record);
  return String(record[rowKey] ?? index);
}

function getValueByPath<T>(record: T, path: keyof T | string): unknown {
  const key = path as string;
  if (!key.includes('.')) return (record as Record<string, unknown>)[key];
  return key.split('.').reduce<unknown>((acc, k) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[k];
  }, record);
}

const ListPage = function <T>(props: ListPageProps<T>) {
  const {
    title,
    columns,
    dataSource,
    loading = false,
    rowKey,
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
    searchBar,
    showAddButton = false,
    addButtonText,
    onAdd,
    showExportButton = false,
    exportButtonText = '导出',
    onExport,
    extraActions,
    emptyText = '暂无数据',
    className,
  } = props;

  const rootRef = useRef<HTMLDivElement>(null);

  // 列表页键盘操作：Enter 新建、Ctrl/⌘+F 聚焦搜索。
  // 挂在统一抽象层，所有使用 ListPage 的列表页自动获得，无需逐页改造。
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      // 标签页缓存下可能有多个列表页同时挂载，仅对当前可见的页面生效，
      // 否则一次 Enter 会触发多个页面的新建。
      const root = rootRef.current;
      if (!root || (root as HTMLElement).offsetParent === null) return;

      const target = ev.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Ctrl/⌘ + F：聚焦搜索框
      if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'f' || ev.key === 'F')) {
        const first = root.querySelector('input, select') as HTMLElement | null;
        if (!first) return;
        ev.preventDefault();
        first.focus();
        return;
      }

      // Enter：新建（仅在非输入态，避免与表单回车提交冲突）
      if (
        ev.key === 'Enter' &&
        !isTyping &&
        !ev.ctrlKey &&
        !ev.metaKey &&
        !ev.altKey &&
        showAddButton &&
        onAdd
      ) {
        ev.preventDefault();
        onAdd();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAddButton, onAdd]);

  const hasActions =
    showAddButton || showExportButton || extraActions != null;

  const alignClass = (align?: 'left' | 'center' | 'right'): string => {
    switch (align) {
      case 'center':
        return 'text-center';
      case 'right':
        return 'text-right';
      default:
        return 'text-left';
    }
  };

  return (
    <div ref={rootRef} className={`bg-white rounded-lg shadow-sm p-5 ${className ?? ''}`}>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-xl font-semibold">{title}</h1>
        {hasActions && (
          <div className="flex gap-2">
            {showAddButton && (
              <button
                onClick={onAdd}
                title="快捷键：Enter"
                className="bg-primary text-white px-4 py-2 text-sm rounded transition-colors hover:bg-blue-600 flex items-center gap-1"
              >
                <Plus size={16} />
                {addButtonText ?? '+ 新增'}
              </button>
            )}
            {showExportButton && (
              <button
                onClick={onExport}
                className="border border-gray-300 text-gray-700 px-4 py-2 text-sm rounded transition-colors hover:bg-gray-50"
              >
                {exportButtonText}
              </button>
            )}
            {extraActions}
          </div>
        )}
      </div>

      {searchBar && (
        <div className="border-b border-gray-200 pb-4 mb-4">{searchBar}</div>
      )}

      <TableContainer>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 font-medium">
            <tr>
              {columns.map((col: ListPageColumn<T>) => (
                <th
                  key={col.key}
                  style={{ width: col.width }}
                  className={`px-4 py-3 border-b border-gray-200 ${alignClass(col.align)}`}
                >
                  {col.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  加载中...
                </td>
              </tr>
            ) : dataSource.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              dataSource.map((record: T, index: number) => (
                <tr
                  key={getRecordKey(record, index, rowKey)}
                  className="hover:bg-gray-50"
                >
                  {columns.map((col: ListPageColumn<T>) => {
                    const value = getValueByPath(record, col.dataIndex);
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-3 border-b border-gray-200 ${alignClass(col.align)}`}
                      >
                        {col.render
                          ? col.render(value, record, index)
                          : (value as React.ReactNode)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableContainer>

      <div className="mt-4">
        <DataPagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
    </div>
  );
} as <T>(props: ListPageProps<T>) => React.ReactElement;

export default ListPage;
