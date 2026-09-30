import React from 'react';
import { Printer } from 'lucide-react';
import type { PurchaseOrder } from '@shared/api.interface';

interface InboundFormItem {
  orderItemId: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  orderQty: number;
  receivedQty: number;
  quantity: number;
  price: number;
  batchNo: string;
}

interface InboundModalProps {
  visible: boolean;
  viewOnly: boolean;
  formOrderId: string;
  formWarehouseId: string;
  formInboundDate: string;
  formRemark: string;
  formItems: InboundFormItem[];
  approvedOrders: PurchaseOrder[];
  warehouseOptions: { id: string; code: string; name: string }[];
  onClose: () => void;
  onSave: () => void;
  submitting?: boolean;
  onOrderChange: (orderId: string) => void;
  onWarehouseChange: (val: string) => void;
  onInboundDateChange: (val: string) => void;
  onRemarkChange: (val: string) => void;
  onUpdateItemField: (idx: number, field: keyof InboundFormItem, value: string | number) => void;
  onPrint: () => void;
}

const PurchaseInboundModal: React.FC<InboundModalProps> = ({
  visible, viewOnly,
  formOrderId, formWarehouseId, formInboundDate, formRemark, formItems,
  approvedOrders, warehouseOptions,
  onClose, onSave, submitting = false,
  onOrderChange, onWarehouseChange, onInboundDateChange, onRemarkChange,
  onUpdateItemField,
  onPrint,
}) => {
  if (!visible) return null;

  const totalAmount = formItems.reduce((sum: number, it: InboundFormItem) => sum + it.quantity * it.price, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[950px] max-w-[95vw] max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-base font-medium">
            {viewOnly ? '查看入库单' : '新增入库单'}
          </span>
          <div className="flex items-center gap-2">
            {viewOnly && (
              <button onClick={onPrint} className="text-primary hover:text-blue-600 text-sm flex items-center gap-1">
                <Printer size={14} /> 打印
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">采购订单<span className="text-red-500">*</span></label>
              <select
                disabled={viewOnly}
                value={formOrderId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onOrderChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
              >
                <option value="">请选择采购订单</option>
                {approvedOrders.map((o: PurchaseOrder) => (
                  <option key={o.id} value={o.id}>{o.orderNo} - {o.supplierName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">仓库<span className="text-red-500">*</span></label>
              <select
                disabled={viewOnly}
                value={formWarehouseId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onWarehouseChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
              >
                <option value="">请选择仓库</option>
                {warehouseOptions.map((w: { id: string; code: string; name: string }) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">入库日期<span className="text-red-500">*</span></label>
              <input
                type="date"
                disabled={viewOnly}
                value={formInboundDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onInboundDateChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
              />
            </div>
            <div />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">备注</label>
            <textarea
              disabled={viewOnly}
              value={formRemark}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onRemarkChange(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-600 font-medium">入库明细</label>
            </div>
            <table className="w-full text-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="text-left py-2 px-2 font-medium border-b border-gray-200">物料编码</th>
                  <th className="text-left py-2 px-2 font-medium border-b border-gray-200">物料名称</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-20">订单数量</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-20">已入库</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-24">本次入库<span className="text-red-500">*</span></th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-24">单价</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-24">金额</th>
                  <th className="text-left py-2 px-2 font-medium border-b border-gray-200 w-28">批次号</th>
                </tr>
              </thead>
              <tbody>
                {formItems.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-6 text-gray-400">
                    {viewOnly ? '暂无明细' : '请先选择采购订单'}
                  </td></tr>
                ) : (
                  formItems.map((item: InboundFormItem, idx: number) => (
                    <tr key={item.orderItemId} className="border-b border-gray-100">
                      <td className="py-1.5 px-2">{item.materialCode}</td>
                      <td className="py-1.5 px-2">{item.materialName}</td>
                      <td className="py-1.5 px-2 text-right">{item.orderQty}</td>
                      <td className="py-1.5 px-2 text-right text-gray-500">{item.receivedQty}</td>
                      <td className="py-1.5 px-2 text-right">
                        {viewOnly ? (
                          <span>{item.quantity}</span>
                        ) : (
                          <input
                            type="number"
                            value={item.quantity}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdateItemField(idx, 'quantity', Number(e.target.value))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none"
                            step="0.001"
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-500">{item.price.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-right font-medium text-blue-600">
                        {(item.quantity * item.price).toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2">
                        {viewOnly ? (
                          <span>{item.batchNo || '-'}</span>
                        ) : (
                          <input
                            type="text"
                            value={item.batchNo}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdateItemField(idx, 'batchNo', e.target.value)}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                            placeholder="批次号"
                          />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="text-right mt-2 text-base font-semibold text-gray-800">
              总金额：<span className="text-red-500">¥ {totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >{viewOnly ? '关闭' : '取消'}</button>
          {!viewOnly && (
            <button
              onClick={onSave}
              disabled={submitting}
              className="px-4 py-1.5 text-sm bg-primary text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >{submitting ? '保存中...' : '保存'}</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseInboundModal;
