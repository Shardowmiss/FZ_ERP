import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// 统一状态徽标：收敛散落在各页的 `bg-x-100 text-x-700` 手写 pill，
// 视觉口径集中在一处（圆角/字号/字重/语义色），后续换肤或校对只需改这里。
export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'neutral';

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'bg-green-100 text-green-700',
  warn: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-blue-100 text-blue-700',
  accent: 'bg-purple-100 text-purple-700',
  neutral: 'bg-gray-100 text-gray-600',
};

export interface StatusBadgeProps {
  tone?: StatusTone;
  /** 前置状态点（可选脉冲） */
  dot?: boolean;
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
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', toneClass, className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full bg-current', dotPulse ? 'animate-pulse' : '')} />}
      {children}
    </span>
  );
}
