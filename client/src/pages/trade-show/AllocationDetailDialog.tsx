import React, { useState, useEffect, useMemo } from 'react';
import { tradeShowApi, baseApi } from '@client/src/api';
import type { AllocationOrder, AllocationItem, Sku } from '@shared/api.interface';
import { toast } from 'sonner';
import { Check, Printer } from 'lucide-react';
import PartyAllocationTable from './PartyAllocationTable';
import { errMsg } from '@/utils/errMsg';

interface AllocationDetailDialogProps {
  open: boolean;
  order: AllocationOrder | null;
  onClose: () => void;
  onSaved: () => void;
  onApproved: () => void;
  onPrint?: () => void;
}

interface PartyGroup {
  partyId: string;
  partyName: string;
  partyType: string;
  items: AllocationItem[];
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-500' },
  approved: { label: '已审核', className: 'bg-green-100 text-green-700' },
};

const AllocationDetailDialog: React.FC<AllocationDetailDialogProps> = ({
  open,
  order,
  onClose,
  onSaved,
  onApproved,
  onPrint,
}) => {
  const [detailItems, setDetailItems] = useState<AllocationItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [skuList, setSkuList] = useState<Sku[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setDetailLoading(true);
    setDetailEditing(false);
    const load = async () => {
      try {
        const [detail, skus] = await Promise.all([
          tradeShowApi.allocation.get(order.id),
          baseApi.sku.byStyle(order.styleId),
        ]);
        setDetailItems(detail.items || []);
        setSkuList(skus);
      } catch (e) {
        toast(errMsg(e, '加载明细失败'));
      } finally {
        setDetailLoading(false);
      }
    };
    load();
  }, [open, order]);

  const handleAllocatedChange = (itemId: string, value: number) => {
    setDetailItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, allocatedQty: value || 0 } : it,
      ),
    );
  };

  const totalAllocated = useMemo(
    () => detailItems.reduce((sum, it) => sum + it.allocatedQty, 0),
    [detailItems],
  );

  const totalPre = useMemo(
    () => detailItems.reduce((sum, it) => sum + it.preQty, 0),
    [detailItems],
  );

  const remainingQty = useMemo(() => {
    if (!order) return 0;
    return order.totalArrivedQty - totalAllocated;
  }, [order, totalAllocated]);

  const partyGroups = useMemo<PartyGroup[]>(() => {
    const map = new Map<string, PartyGroup>();
    for (const item of detailItems) {
      const partyId =
        item.submitterType === 'dealer'
          ? item.dealerId || 'unknown'
          : item.storeId || 'unknown';
      const partyName =
        item.submitterType === 'dealer'
          ? item.dealerName || '未知'
          : item.storeName || '未知';
      if (!map.has(partyId)) {
        map.set(partyId, {
          partyId,
          partyName,
          partyType: item.submitterType,
          items: [],
        });
      }
      map.get(partyId)!.items.push(item);
    }
    return Array.from(map.values());
  }, [detailItems]);

  const generatedDocSummary = useMemo(() => {
    const docs = new Set<string>();
    for (const it of detailItems) {
      if (it.generatedDocNo) {
        const type = it.generatedDocType === 'sales' ? '销售单' : '调拨单';
        docs.add(`${type}${it.generatedDocNo}`);
      }
    }
    return Array.from(docs).join('、');
  }, [detailItems]);

  const handleSave = async () => {
    if (!order) return;
    if (totalAllocated > order.totalArrivedQty) {
      toast('分配总量不能超过总到货量');
      return;
    }
    setSaving(true);
    try {
      await tradeShowApi.allocation.update(order.id, {
        items: detailItems.map((it) => ({
          id: it.id,
          allocatedQty: it.allocatedQty,
        })),
      });
      setDetailEditing(false);
      const detail = await tradeShowApi.allocation.get(order.id);
      setDetailItems(detail.items || []);
      toast('保存成功');
      onSaved();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!order) return;
    // 简单确认由外部传入，这里直接操作
    try {
      await tradeShowApi.allocation.approve(order.id);
      toast('审核成功，已生成下游单据');
      onApproved();
    } catch (e) {
      toast(errMsg(e, '审核失败'));
    }
  };

  const isApproved = order?.status === 'approved';

  if (!open || !order) return null;

  const renderStatus = (status: string) => {
    const cfg = STATUS_MAP[status] || STATUS_MAP.draft;
    return (
      <span
        className={`inline-block px-2 py-0.5 text-xs rounded ${cfg.className}`}
      >
        {cfg.label}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-medium">配货单明细</h3>
            {renderStatus(order.status)}
            {onPrint && (
              <button
                className="text-primary hover:text-blue-600 text-sm flex items-center gap-1 ml-2"
                onClick={onPrint}
              >
                <Printer size={14} />
                打印
              </button>
            )}
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 text-xl"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">配货单号：</span>
            <span className="font-medium">{order.allocationNo}</span>
          </div>
          <div>
            <span className="text-gray-500">订货会：</span>
            <span>{order.tradeShowName}</span>
          </div>
          <div>
            <span className="text-gray-500">款号：</span>
            <span>
              {order.styleNo} - {order.styleName}
            </span>
          </div>
          <div>
            <span className="text-gray-500">总到货量：</span>
            <span className="font-semibold text-blue-600">
              {order.totalArrivedQty}
            </span>
          </div>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {detailLoading ? (
            <div className="text-center py-12 text-gray-400">加载中...</div>
          ) : partyGroups.length === 0 ? (
            <div className="text-center py-12 text-gray-400 border border-dashed border-gray-300 rounded">
              暂无配货明细
            </div>
          ) : (
            partyGroups.map((group) => (
              <PartyAllocationTable
                key={group.partyId}
                items={group.items}
                skuList={skuList}
                partyName={group.partyName}
                partyType={group.partyType}
                editing={detailEditing && !isApproved}
                onAllocatedChange={handleAllocatedChange}
              />
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-gray-500">预订总量：</span>
                <span className="font-medium">{totalPre}</span>
              </div>
              <div>
                <span className="text-gray-500">总到货量：</span>
                <span className="font-medium text-blue-600">
                  {order.totalArrivedQty}
                </span>
              </div>
              <div>
                <span className="text-gray-500">已分配量：</span>
                <span
                  className={`font-medium ${
                    totalAllocated > order.totalArrivedQty
                      ? 'text-red-600'
                      : 'text-green-600'
                  }`}
                >
                  {totalAllocated}
                </span>
              </div>
              <div>
                <span className="text-gray-500">剩余可分配：</span>
                <span
                  className={`font-medium ${
                    remainingQty < 0 ? 'text-red-600' : 'text-orange-600'
                  }`}
                >
                  {remainingQty}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={onClose}
              >
                关闭
              </button>
              {!isApproved && !detailEditing && (
                <>
                  <button
                    className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
                    onClick={() => setDetailEditing(true)}
                    data-ai-section-type="button"
                  >
                    编辑配货
                  </button>
                  <button
                    className="px-4 py-2 bg-green-500 text-white text-sm rounded hover:bg-green-600 transition-colors flex items-center gap-1"
                    onClick={handleApprove}
                    data-ai-section-type="button"
                  >
                    <Check size={14} />
                    审核
                  </button>
                </>
              )}
              {detailEditing && (
                <>
                  <button
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                    onClick={() => setDetailEditing(false)}
                  >
                    取消
                  </button>
                  <button
                    className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? '保存中...' : '保存'}
                  </button>
                </>
              )}
            </div>
          </div>
          {isApproved && generatedDocSummary && (
            <div className="mt-2 text-xs text-gray-500 bg-green-50 px-3 py-2 rounded border border-green-200">
              已生成下游单据：{generatedDocSummary}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AllocationDetailDialog;
