import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import type { OfflineQueueItem } from '@client/src/api/offline-sync';

const TYPE_MAP: Record<string, string> = {
  sale: '销售单',
  return: '退货单',
  suspend: '挂单',
  inventory: '库存调整',
  stock_adjust: '库存调整',
  stocktake: '盘点单',
  transfer_request: '要货申请',
  receipt: '收货单',
  member: '会员注册',
};

const PAY_METHOD_LABEL: Record<string, string> = {
  cash: '现金',
  wechat: '微信支付',
  alipay: '支付宝',
  card: '银行卡',
  stored: '储值卡',
};

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending: { label: '待同步', className: 'bg-pos-ink-3/10 text-pos-ink-3' },
  syncing: { label: '同步中', className: 'bg-pos-info-bg text-pos-info' },
  synced: { label: '已同步', className: 'bg-pos-ok-bg text-pos-ok' },
  failed: { label: '失败', className: 'bg-pos-danger-bg text-pos-danger' },
  conflict: { label: '冲突', className: 'bg-pos-warn-bg text-pos-warn' },
};

interface OfflineDetailDialogProps {
  item: OfflineQueueItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function OfflineDetailDialog({
  item,
  open,
  onOpenChange,
}: OfflineDetailDialogProps) {
  if (!item) return null;
  const statusInfo = STATUS_MAP[item.status] ?? STATUS_MAP.pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center justify-between">
            <span>单据详情</span>
            <button
              onClick={() => onOpenChange(false)}
              className="text-pos-ink-3 hover:text-pos-ink transition-colors"
            >
              <X size={16} />
            </button>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-pos-ink-3 mb-1">临时单号</div>
              <div className="font-mono text-pos-ink">
                {item.tempNo || item.clientId || item.id}
              </div>
            </div>
            <div>
              <div className="text-xs text-pos-ink-3 mb-1">类型</div>
              <div className="text-pos-ink">
                {TYPE_MAP[item.type] ?? item.typeName}
              </div>
            </div>
            <div>
              <div className="text-xs text-pos-ink-3 mb-1">金额</div>
              <div className="font-medium tabular-nums text-pos-ink">
                {item.amount === 0 ? '—' : `¥${item.amount.toFixed(2)}`}
              </div>
            </div>
            <div>
              <div className="text-xs text-pos-ink-3 mb-1">状态</div>
              <span
                className={`text-xs px-2 py-0.5 rounded-md font-medium inline-flex items-center gap-1 ${statusInfo.className}`}
              >
                {statusInfo.label}
              </span>
            </div>
            <div>
              <div className="text-xs text-pos-ink-3 mb-1">支付方式</div>
              <div className="text-pos-ink">
                {item.payMethod
                  ? PAY_METHOD_LABEL[item.payMethod] ?? item.payMethod
                  : '—'}
              </div>
            </div>
            <div>
              <div className="text-xs text-pos-ink-3 mb-1">重试次数</div>
              <div className="text-pos-ink tabular-nums">{item.retryCount}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-pos-ink-3 mb-1">产生时间</div>
              <div className="text-pos-ink font-mono text-xs">{item.createdAt}</div>
            </div>
          </div>
          {item.errorMsg && (
            <div className="p-3 bg-pos-danger-bg/30 rounded-lg text-xs text-pos-danger">
              <div className="font-medium mb-1">错误信息</div>
              <div>{item.errorMsg}</div>
              {item.conflictType && (
                <div className="mt-1 text-[11px]">
                  冲突类型：
                  <span className="px-1.5 py-0.5 bg-pos-warn-bg text-pos-warn rounded font-medium ml-1">
                    {item.conflictType}
                  </span>
                </div>
              )}
            </div>
          )}
          <div>
            <div className="text-xs text-pos-ink-3 mb-1.5">原始数据 (entityData)</div>
            <pre className="bg-pos-paper rounded-lg p-3 text-[11px] font-mono text-pos-ink-2 overflow-x-auto max-h-48 overflow-y-auto">
{JSON.stringify(item.entityData ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
