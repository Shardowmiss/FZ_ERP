/**
 * 页面内离线横幅 —— 统一收敛到 components/OfflineBanner.tsx（P2-9）
 *
 * 保留原有 props（isOffline / pendingCount / pendingWarning），
 * 内部委托给唯一的横幅实现，避免两套 UI 各写一遍。
 */
import OfflineBanner from '../OfflineBanner';

interface OfflineBannerProps {
  isOffline: boolean;
  pendingCount: number;
  pendingWarning?: string;
}

export default function PageOfflineBanner({
  isOffline,
  pendingCount,
  pendingWarning,
}: OfflineBannerProps) {
  return (
    <OfflineBanner
      isOffline={isOffline}
      isOnline={!isOffline}
      pendingCount={pendingCount}
      pendingWarning={pendingWarning}
      compact
    />
  );
}
