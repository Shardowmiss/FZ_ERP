import { Wifi, WifiOff, Pause, Play, CloudUpload } from 'lucide-react';

interface PosHeaderProps {
  orderNo: string;
  isOnline: boolean;
  hasItems: boolean;
  offlinePendingCount?: number;
  onSuspend: () => void;
  onOpenSuspendDialog: () => void;
}

/**
 * POS 页面顶部栏
 * 抽离以控制 PosPage.tsx 文件大小
 */
export default function PosHeader({
  orderNo,
  isOnline,
  hasItems,
  offlinePendingCount = 0,
  onSuspend,
  onOpenSuspendDialog,
}: PosHeaderProps) {
  return (
    <div className="flex flex-col flex-shrink-0">
      {!isOnline && (
        <div className="h-7 px-4 bg-pos-accent text-white text-xs flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <WifiOff size={12} />
            离线营业中，交易将在联网后自动上传
          </span>
          <span className="flex items-center gap-1 font-medium tabular-nums bg-white/20 px-2 py-0.5 rounded">
            <CloudUpload size={11} />
            待上传 {offlinePendingCount} 单
          </span>
        </div>
      )}
      <header className="h-14 bg-white border-b border-pos-line flex items-center justify-between px-5">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-pos-ink">收银开单</h1>
        <span className="text-xs text-pos-ink-3 bg-pos-paper px-2 py-0.5 rounded font-mono">
          单号 {orderNo}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span
          className={`text-xs flex items-center gap-1 ${
            isOnline ? 'text-pos-ok' : 'text-pos-warn'
          }`}
        >
          {isOnline ? (
            <Wifi size={12} className="animate-pulse" />
          ) : (
            <WifiOff size={12} />
          )}
          {isOnline ? '网络正常' : '离线模式'}
        </span>
        <button
          onClick={onSuspend}
          disabled={!hasItems}
          className="text-xs px-3 py-1.5 bg-white border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Pause size={12} /> 挂单
        </button>
        <button
          onClick={onOpenSuspendDialog}
          className="text-xs px-3 py-1.5 bg-white border border-pos-line rounded-md text-pos-ink-2 hover:bg-pos-paper transition-colors flex items-center gap-1"
        >
          <Play size={12} /> 取单
        </button>
      </div>
      </header>
    </div>
  );
}
