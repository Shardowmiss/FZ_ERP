import { WifiOff, RefreshCw, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';

export interface OfflineBannerProps {
  /** 待同步笔数 */
  pendingCount: number;
  /** 点击「立即同步」回调（不传则不显示同步按钮，适用于页面内只读提示） */
  onSyncNow?: () => void;
  /** 是否正在同步 */
  isSyncing?: boolean;
  /** 同步进度 0-100，可选 */
  syncProgress?: number;
  /** 是否刚刚同步成功（显示绿色提示） */
  justSynced?: boolean;
  /** 是否在线（控制按钮可用性） */
  isOnline?: boolean;
  /** 是否离线（不传时由 isOnline 推导） */
  isOffline?: boolean;
  /** 在线但有未同步单据时显示的提示文案 */
  pendingWarning?: string;
  /** 紧凑模式（用于内嵌场景，高度更低） */
  compact?: boolean;
}

/**
 * 统一离线状态横幅（P2-9：原先存在两套横幅组件，此处收敛为唯一实现）
 *
 * 状态优先级：
 * 1. justSynced  -> 绿色「同步完成」
 * 2. isSyncing   -> 进度条
 * 3. 离线        -> 橙色横幅（传了 onSyncNow 才显示「立即同步」按钮）
 * 4. 在线但有待同步 -> 黄色警告条（pendingWarning）
 * 5. 其余        -> 不渲染
 */
export default function OfflineBanner({
  pendingCount,
  onSyncNow,
  isSyncing = false,
  syncProgress = 0,
  justSynced = false,
  isOnline = true,
  isOffline,
  pendingWarning,
  compact = false,
}: OfflineBannerProps) {
  const offline = isOffline ?? !isOnline;

  // 1. 同步成功绿色提示
  if (justSynced) {
    return (
      <div
        className={`flex items-center justify-center gap-2 bg-pos-ok-bg text-pos-ok ${
          compact ? 'h-7 text-xs' : 'h-9 text-sm'
        } font-medium`}
      >
        <CheckCircle2 size={compact ? 14 : 16} />
        同步完成 · 所有离线交易已上传成功
      </div>
    );
  }

  // 2. 同步中进度
  if (isSyncing) {
    return (
      <div
        className={`flex items-center justify-center gap-3 bg-pos-accent-light text-pos-accent ${
          compact ? 'h-7 text-xs' : 'h-9 text-sm'
        } font-medium`}
      >
        <Loader2 size={compact ? 14 : 16} className="animate-spin" />
        <span>同步中…</span>
        <div className="w-32 h-1.5 bg-white/60 rounded-full overflow-hidden">
          <div
            className="h-full bg-pos-accent rounded-full transition-all duration-300"
            style={{ width: `${syncProgress}%` }}
          />
        </div>
        <span className="tabular-nums">{syncProgress}%</span>
      </div>
    );
  }

  // 3. 离线状态（主色浅底横幅）
  if (offline) {
    return (
      <div
        className={`flex items-center justify-between px-4 bg-gradient-to-r from-pos-accent-light to-pos-accent-tint text-pos-accent border-b border-pos-accent-border ${
          compact ? 'h-8 text-xs' : 'h-10 text-sm'
        }`}
      >
        <div className="flex items-center gap-2">
          <WifiOff size={compact ? 14 : 16} className="flex-shrink-0" />
          <span className="font-medium">
            {onSyncNow ? (
              <>
                离线模式 · 已有 <span className="tabular-nums">{pendingCount}</span>{' '}
                笔交易待同步
              </>
            ) : (
              <>离线营业中，操作将暂存本地，联网后自动同步</>
            )}
          </span>
        </div>
        {onSyncNow ? (
          <button
            onClick={onSyncNow}
            disabled={!isOnline}
            className={`flex items-center gap-1.5 px-3 rounded-md font-medium transition-colors ${
              compact ? 'h-6 text-xs' : 'h-7 text-xs'
            } ${
              isOnline
                ? 'bg-pos-accent text-white hover:bg-pos-accent-hover'
                : 'bg-pos-accent/20 text-pos-accent/60 cursor-not-allowed'
            }`}
          >
            <RefreshCw size={compact ? 11 : 13} />
            立即同步
          </button>
        ) : (
          <span className="font-medium tabular-nums">待上传 {pendingCount} 单</span>
        )}
      </div>
    );
  }

  // 4. 在线但有未同步单据
  if (pendingCount > 0) {
    return (
      <div
        className={`flex items-center px-4 bg-pos-warn-bg text-pos-warn border-b border-pos-warn/20 ${
          compact ? 'h-8 text-xs' : 'h-9 text-sm'
        }`}
      >
        <AlertTriangle size={compact ? 13 : 15} className="flex-shrink-0 mr-2" />
        <span>{pendingWarning ?? `尚有 ${pendingCount} 笔离线单据未同步`}</span>
      </div>
    );
  }

  // 5. 正常在线且无待同步 -> 不显示
  return null;
}
