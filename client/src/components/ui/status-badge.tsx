// P0-4 状态徽标统一组件
// 此前各页状态徽标写法参差：有的带 border、有的用 rounded 有的用 rounded-md、
// SyncLogTable 甚至只有彩色文字无底色 pill。本组件统一收敛到 POS 令牌体系
// bg-pos-{tone}-bg / text-pos-{tone}，作为全场唯一的状态徽标出口。
import type { ReactNode } from 'react';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-pos-ok-bg text-pos-ok',
  warn: 'bg-pos-warn-bg text-pos-warn',
  danger: 'bg-pos-danger-bg text-pos-danger',
  info: 'bg-pos-info-bg text-pos-info',
  accent: 'bg-pos-accent-light text-pos-accent',
  neutral: 'bg-pos-paper text-pos-ink-2',
};

export interface StatusBadgeProps {
  tone?: StatusTone;
  /** 是否显示前置状态点（如离线队列同步中/已同步） */
  dot?: boolean;
  /** 状态点是否呼吸动画（仅同步中态使用） */
  dotPulse?: boolean;
  className?: string;
  children?: ReactNode;
}

export function StatusBadge({
  tone = 'neutral',
  dot = false,
  dotPulse = false,
  className = '',
  children,
}: StatusBadgeProps) {
  const toneClass = TONE_CLASS[tone] ?? TONE_CLASS.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium ${toneClass} ${className}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full bg-current ${dotPulse ? 'animate-pulse' : ''}`}
        />
      )}
      {children}
    </span>
  );
}
