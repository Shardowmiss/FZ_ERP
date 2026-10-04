import { useState, useEffect } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { useOffline } from '@client/src/contexts/OfflineContext';
import * as settingsApi from '@client/src/api/settings';
import * as salesApi from '@client/src/api/sales';
import type { Employee, SuspendedOrder, SaleItem } from '@shared/api.interface';

interface EmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emp: Employee) => void;
}

export function EmployeeDialog({
  open,
  onOpenChange,
  onSelect,
}: EmployeeDialogProps) {
  const [list, setList] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || list.length > 0) return;
    setLoading(true);
    settingsApi
      .getEmployees({ role: 'sales', status: 'active', page: 1, pageSize: 50 })
      .then((res) => setList(res.items ?? []))
      .catch((err) => logger.error('get employees failed', err as Error))
      .finally(() => setLoading(false));
  }, [open, list.length]);

  const handleSelect = (emp: Employee) => {
    onSelect(emp);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm bg-white">
        <DialogHeader>
          <DialogTitle>选择导购</DialogTitle>
        </DialogHeader>
        <div className="max-h-64 overflow-y-auto border border-pos-line-soft rounded-md bg-white">
          {loading ? (
            <div className="p-4 text-center text-sm text-pos-ink-3">
              加载中...
            </div>
          ) : list.length === 0 ? (
            <div className="p-4 text-center text-sm text-pos-ink-3">
              暂无导购
            </div>
          ) : (
            list.map((emp) => (
              <div
                key={emp.id}
                onClick={() => handleSelect(emp)}
                 className="px-3 py-2.5 border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50 cursor-pointer text-sm text-pos-ink"
              >
                {emp.name}
                <span className="text-xs text-pos-ink-3 ml-2">{emp.code}</span>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SuspendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (order: SuspendedOrder) => void;
  isOffline?: boolean;
}

export function SuspendDialog({
  open,
  onOpenChange,
  onRestore,
  isOffline = false,
}: SuspendDialogProps) {
  const [orders, setOrders] = useState<SuspendedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const offline = useOffline();

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    if (isOffline) {
      // 离线模式：从 IndexedDB 读取挂单
      offline
        .getOfflineSuspendedList()
        .then((list) => {
          const suspendedList: SuspendedOrder[] = list.map((item) => {
            const data = item.orderData as {
              cart?: SaleItem[];
              memberId?: string;
              employeeId?: string;
              payAmount?: number;
              totalTagAmount?: number;
              storeId?: string;
            };
            return {
              id: item.clientId,
              storeId: data.storeId || '',
              memberId: data.memberId,
              employeeId: data.employeeId,
              items: data.cart || [],
              totalAmount: data.payAmount ?? data.totalTagAmount ?? 0,
              status: 'suspended',
              createdAt: new Date(item.createdAt).toISOString(),
              updatedAt: new Date(item.createdAt).toISOString(),
            };
          });
          setOrders(suspendedList);
        })
        .catch((err: Error) =>
          logger.error('get offline suspended orders failed', err),
        )
        .finally(() => setLoading(false));
    } else {
      salesApi
        .getSuspendedOrders()
        .then((res) => setOrders(res))
        .catch((err) => logger.error('get suspended orders failed', err as Error))
        .finally(() => setLoading(false));
    }
  }, [open, isOffline, offline]);

  const handleRestore = async (order: SuspendedOrder) => {
    if (isOffline) {
      // 离线取单：从 IndexedDB 中删除该挂单（避免同一挂单被反复取出重复结算）
      try {
        await offline.removeOfflineSuspendedRecord(order.id);
      } catch (err) {
        logger.error('remove offline suspended failed', err as Error);
      }
    } else {
      // 在线取单：必须调用服务端销挂（activateSuspended）把挂单标记为已激活，
      // 否则同一挂单可被反复取出、反复结算，造成重复收款。
      try {
        await salesApi.activateSuspendedOrder(order.id);
      } catch (err) {
        logger.error('activate suspended order failed', err as Error);
        toast.error('取单失败：销挂失败，请稍后重试');
        return; // 销挂失败则禁止恢复，避免重复结算
      }
    }
    onRestore(order);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>取单</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto border border-pos-line-soft rounded-md bg-white">
          {loading ? (
            <div className="p-4 text-center text-sm text-pos-ink-3">
              加载中...
            </div>
          ) : orders.length === 0 ? (
            <div className="p-4 text-center text-sm text-pos-ink-3">
              暂无挂单
            </div>
          ) : (
            orders.map((order) => (
              <div
                key={order.id}
                onClick={() => handleRestore(order)}
                 className="px-3 py-2.5 border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-pos-ink">
                    {order.memberName || '散客'}
                  </span>
                  <span className="text-sm font-semibold text-pos-accent tabular-nums">
                    ¥{order.totalAmount.toFixed(2)}
                  </span>
                </div>
                <div className="text-xs text-pos-ink-3 mt-0.5">
                  {order.items.length}项商品 ·{' '}
                  {new Date(order.createdAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {order.employeeName && ` · 导购：${order.employeeName}`}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
