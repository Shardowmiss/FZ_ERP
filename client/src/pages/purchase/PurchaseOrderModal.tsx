import React from 'react';
import { Printer } from 'lucide-react';
import type { PurchaseOrderItem } from '@shared/api.interface';

interface FormItem {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
}

interface OrderModalProps {
  visible: boolean;
  viewOnly: boolean;
  editId: string;
  formSupplierId: string;
  formOrderDate: string;
  formExpectDate: string;
  formRemark: string;
  formItems: FormItem[];
  supplierOptions: { id: string; code: string; name: string }[];
  materialOptions: { id: string; code: string; name: string; unit: string }[];
  onClose: () => void;
  onSave: () => void;
  submitting?: boolean;
  onSupplierChange: (val: string) => void;
  onOrderDateChange: (val: string) => void;
  onExpectDateChange: (val: string) => void;
  onRemarkChange: (val: string) => void;
  onAddRow: () => void;
  onRemoveRow: (idx: number) => void;
  onUpdateItemField: (idx: number, field: keyof FormItem, value: string | number) => void;
  onPrint: () => void;
}

const PurchaseOrderModal: React.FC<OrderModalProps> = ({
  visible, viewOnly, editId,
  formSupplierId, formOrderDate, formExpectDate, formRemark, formItems,
  supplierOptions, materialOptions,
  onClose, onSave, submitting = false,
  onSupplierChange, onOrderDateChange, onExpectDateChange, onRemarkChange,
  onAddRow, onRemoveRow, onUpdateItemField,
  onPrint,
}) => {
  if (!visible) return null;

  const totalAmount = formItems.reduce((sum: number, it: FormItem) => sum + it.quantity * it.price, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-base font-medium">
            {viewOnly ? '查看订单' : editId ? '编辑订单' : '新增订单'}
          </span>
          <div className="flex items-center gap-2">
            {editId && (
              <button onClick={onPrint} className="text-blue-500 hover:text-blue-600 text-sm flex items-center gap-1">
                <Printer size={14} /> 打印
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">供应商<span className="text-red-500">*</span></label>
              <select
                disabled={viewOnly}
                value={formSupplierId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onSupplierChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
              >
                <option value="">请选择供应商</option>
                {supplierOptions.map((s: { id: string; code: string; name: string }) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">订单日期<span className="text-red-500">*</span></label>
              <input
                type="date"
                disabled={viewOnly}
                value={formOrderDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onOrderDateChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">预计到货日期</label>
              <input
                type="date"
                disabled={viewOnly}
                value={formExpectDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onExpectDateChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
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
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-600 font-medium">明细</label>
              {!viewOnly && (
                <button onClick={onAddRow} className="text-sm text-blue-500 hover:text-blue-600">+ 添加行</button>
              )}
            </div>
            <table className="w-full text-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 text-gray-600">
                  <th className="text-left py-2 px-2 font-medium border-b border-gray-200">物料</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-24">数量</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-28">单价</th>
                  <th className="text-right py-2 px-2 font-medium border-b border-gray-200 w-28">金额</th>
                  {!viewOnly && (
                    <th className="text-center py-2 px-2 font-medium border-b border-gray-200 w-16">操作</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {formItems.length === 0 ? (
                  <tr>
                    <td colSpan={viewOnly ? 4 : 5} className="text-center py-6 text-gray-400">
                      {viewOnly ? '暂无明细' : '暂无明细，点击添加行'}
                    </td>
                  </tr>
                ) : (
                  formItems.map((item: FormItem, idx: number) => (
                    <tr key={item.id} className="border-b border-gray-100">
                      <td className="py-1.5 px-2">
                        {viewOnly ? (
                          <span>{item.materialCode} - {item.materialName}</span>
                        ) : (
                          <select
                            value={item.materialId}
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onUpdateItemField(idx, 'materialId', e.target.value)}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none"
                          >
                            {materialOptions.map((m: { id: string; code: string; name: string }) => (
                              <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
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
                      <td className="py-1.5 px-2 text-right">
                        {viewOnly ? (
                          <span>{item.price.toFixed(2)}</span>
                        ) : (
                          <input
                            type="number"
                            value={item.price}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdateItemField(idx, 'price', Number(e.target.value))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none"
                            step="0.01"
                          />
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right font-medium text-blue-600">
                        {(item.quantity * item.price).toFixed(2)}
                      </td>
                      {!viewOnly && (
                        <td className="py-1.5 px-2 text-center">
                          <button onClick={() => onRemoveRow(idx)} className="text-red-500 text-xs">删除</button>
                        </td>
                      )}
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
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >{submitting ? '保存中...' : '保存'}</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PurchaseOrderModal;
