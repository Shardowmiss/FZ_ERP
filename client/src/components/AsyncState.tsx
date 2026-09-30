import React from 'react';
import { Loader2, Inbox, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * 通用异步三态占位：loading / empty / error
 *
 * 背景：POS 各页面此前要么没有空态、要么把「加载失败」也渲染成空态，
 * 用户看到「暂无数据」时会误判为业务上确实没有数据，不会去重试或报障。
 *
 * 使用约定（优先级自上而下）：
 *   1. error 有值  → 错误态（红色警示 + 原因 + 可选重试按钮）
 *   2. loading     → 加载态
 *   3. empty       → 空态
 *   4. 都不命中    → 返回 null，由调用方自行渲染内容
 *
 * 因此调用方可以写：<AsyncState ... /> ?? <真正的内容 />
 * 也可以独立用于无容器场景（此时传 height 控制占位高度）。
 */

export interface AsyncStateProps {
  loading?: boolean;
  /** 是否为空（无数据）。仅在 loading=false 且无 error 时生效 */
  empty?: boolean;
  /** 错误信息；有值时优先级最高 */
  error?: string | null;
  /** 错误态重试回调，传入才显示「重试」按钮 */
  onRetry?: () => void;
  emptyText?: string;
  emptyIcon?: React.ReactNode;
  /** 占位高度，默认 py-16 */
  className?: string;
  /** 不传 className 时的紧凑模式（用于卡片内嵌，高度更小） */
  compact?: boolean;
}

export default function AsyncState({
  loading = false,
  empty = false,
  error = null,
  onRetry,
  emptyText = '暂无数据',
  emptyIcon,
  className,
  compact = false,
}: AsyncStateProps) {
  const pad = className ?? (compact ? 'py-8' : 'py-16');

  if (error) {
    return (
      <div className={`${pad} px-4 text-center`}>
        <AlertTriangle size={28} className="mx-auto mb-2 text-pos-danger" />
        <div className="text-sm text-pos-danger mb-2">{error}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs text-pos-accent hover:text-pos-accent-hover inline-flex items-center gap-1"
          >
            <RefreshCw size={12} />
            重试
          </button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`${pad} text-center text-pos-ink-3 text-sm`}>
        <Loader2 size={20} className="animate-spin mx-auto mb-2" />
        加载中...
      </div>
    );
  }

  if (empty) {
    return (
      <div className={`${pad} px-4 text-center text-pos-ink-3 text-sm`}>
        {emptyIcon ?? <Inbox size={32} className="mx-auto mb-2 opacity-30" />}
        {emptyText}
      </div>
    );
  }

  return null;
}

/**
 * 判断某块内容当前需要用占位替代。
 * 与 AsyncState 配套，便于调用方写出 `renderState() ?? <真实内容 />`。
 */
export function hasState(
  loading?: boolean,
  empty?: boolean,
  error?: string | null,
): boolean {
  return Boolean(error) || Boolean(loading) || Boolean(empty);
}
