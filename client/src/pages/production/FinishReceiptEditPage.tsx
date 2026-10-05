import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type {
  ProductionFinishReceiptItem,
  Warehouse,
  Sku,
} from '@shared/api.interface';
import DocPage from '@client/src/components/DocPage/DocPage';
import { errMsg } from '@/utils/errMsg';

const BACK_PATH = '/production/finish-receipt';

interface ReceiptItemForm {
  id: string;
  skuId: string;
  skuCode: string;
  color: string;
  size: string;
  qty: number;
}

const FinishReceiptEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [workOrderOptions, setWorkOrderOptions] = useState<{ id: string; orderNo: string }[]>([]);

  const [formWorkOrderId, setFormWorkOrderId] = useState<string>('');
  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formReceiptDate, setFormReceiptDate] = useState<string>('');
  const [formDefectiveQty, setFormDefectiveQty] = useState<number>(0);
  const [formRemark, setFormRemark] = useState<string>('');
  const [formItems, setFormItems] = useState<ReceiptItemForm[]>([]);

  const [receiptNo, setReceiptNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const totalFinishedQty = formItems.reduce((sum: number, it: ReceiptItemForm) => sum + it.qty, 0);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [wh, skuList, wo] = await Promise.all([
          baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' }),
          baseApi.sku.list({ page: 1, pageSize: 1000 }),
          productionApi.workOrder.list({ page: 1, pageSize: 1000, status: 'producing' }),
        ]);
        setWarehouses(wh.items);
        setSkus(skuList.items);
        setWorkOrderOptions(wo.items.map((it) => ({ id: it.id, orderNo: it.orderNo })));
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  useEffect(() => {
    if (isNew) {
      setFormWarehouseId(warehouses[0]?.id ?? '');
      setFormReceiptDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const detail = await productionApi.finishReceipt.get(id as string);
        setReceiptNo(detail.receiptNo);
        setStatus(detail.status);
        setFormWorkOrderId(detail.workOrderId);
        setFormWarehouseId(detail.warehouseId);
        setFormReceiptDate(detail.receiptDate.slice(0, 10));
        setFormDefectiveQty(detail.defectiveQty);
        setFormRemark(detail.remark ?? '');
        setFormItems((detail.items ?? []).map((it: ProductionFinishReceiptItem) => ({
          id: it.id,
          skuId: it.skuId,
          skuCode: it.skuCode ?? '',
          color: it.color ?? '',
          size: it.size ?? '',
          qty: it.qty,
        })));
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const addItem = (): void => {
    const first = skus[0];
    if (!first) { toast('暂无SKU'); return; }
    setFormItems([...formItems, {
      id: `tmp_${Date.now()}`,
      skuId: first.id,
      skuCode: first.skuCode,
      color: first.color,
      size: first.size,
      qty: 0,
    }]);
  };

  const updateItem = (index: number, field: keyof ReceiptItemForm, value: string | number): void => {
    const newItems = [...formItems];
    const item = { ...newItems[index] };
    if (field === 'skuId') {
      const sku = skus.find((s: Sku) => s.id === value);
      if (sku) {
        item.skuId = sku.id;
        item.skuCode = sku.skuCode;
        item.color = sku.color;
        item.size = sku.size;
      }
    } else if (field === 'qty') {
      item.qty = Number(value) || 0;
    } else {
      (item as Record<string, string | number>)[field] = value;
    }
    newItems[index] = item;
    setFormItems(newItems);
  };

  const removeItem = (index: number): void => {
    setFormItems(formItems.filter((_: ReceiptItemForm, i: number) => i !== index));
  };

  const doSave = async (): Promise<boolean> => {
    if (!formWorkOrderId) { toast('请选择生产工单'); return false; }
    if (!formWarehouseId) { toast('请选择入库仓库'); return false; }
    if (!formReceiptDate) { toast('请选择入库日期'); return false; }
    if (formItems.length === 0) { toast('请添加明细'); return false; }
    const data = {
      workOrderId: formWorkOrderId,
      warehouseId: formWarehouseId,
      receiptDate: formReceiptDate,
      finishedQty: totalFinishedQty,
      defectiveQty: Number(formDefectiveQty),
      remark: formRemark,
      items: formItems.map((it: ReceiptItemForm) => ({
        skuId: it.skuId,
        qty: Number(it.qty.toFixed(3)),
      })),
    };
    try {
      if (isNew) {
        await productionApi.finishReceipt.create(data);
      } else {
        await productionApi.finishReceipt.update(id as string, data);
      }
      toast('保存成功');
      return true;
    } catch (e) {
      toast(errMsg(e, '保存失败'));
      return false;
    }
  };

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    const ok = await doSave();
    setSaving(false);
    if (ok) navigate(BACK_PATH);
  };

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    const ok = await doSave();
    if (ok && !isNew) {
      try {
        await productionApi.finishReceipt.approve(id as string);
        toast('审核成功');
        navigate(BACK_PATH);
      } catch (e) {
        toast(errMsg(e, '审核失败'));
      }
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看完工入库单' : isNew ? '新增完工入库单' : '编辑完工入库单';

  const headerContent = (
    <div className="grid grid-cols-3 gap-4 text-sm">
      <div>
        <label className="block text-gray-600 mb-1">完工单号</label>
        <input
          type="text"
          value={receiptNo || '自动生成'}
          disabled
          className="w-full border border-gray-300 rounded px-3 py-1.5 bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">生产工单 <span className="text-red-500">*</span></label>
        <select
          value={formWorkOrderId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWorkOrderId(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {workOrderOptions.map((wo: { id: string; orderNo: string }) => (
            <option key={wo.id} value={wo.id}>{wo.orderNo}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">入库仓库 <span className="text-red-500">*</span></label>
        <select
          value={formWarehouseId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWarehouseId(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {warehouses.map((w: Warehouse) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">入库日期 <span className="text-red-500">*</span></label>
        <input
          type="date"
          value={formReceiptDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormReceiptDate(e.target.value)}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">完工总数量</label>
        <input
          type="text"
          value={totalFinishedQty}
          disabled
          className="w-full border border-gray-300 rounded px-3 py-1.5 bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">次品数量</label>
        <input
          type="number"
          value={formDefectiveQty}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormDefectiveQty(Number(e.target.value))}
          disabled={viewOnly}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100"
        />
      </div>
      <div className="col-span-3">
        <label className="block text-gray-600 mb-1">备注</label>
        <textarea
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormRemark(e.target.value)}
          disabled={viewOnly}
          rows={2}
          className="w-full border border-gray-300 rounded px-3 py-1.5 disabled:bg-gray-100 resize-none"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-700">SKU 明细</h2>
        {!viewOnly && (
          <button onClick={addItem} className="text-sm text-primary hover:text-primary">+ 添加行</button>
        )}
      </div>
      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">SKU编码</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">颜色</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">尺码</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">数量</th>
              {!viewOnly && <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">操作</th>}
            </tr>
          </thead>
          <tbody>
            {formItems.length === 0 && (
              <tr>
                <td colSpan={viewOnly ? 4 : 5} className="text-center py-4 text-gray-400">
                  暂无明细
                </td>
              </tr>
            )}
            {formItems.map((it: ReceiptItemForm, i: number) => (
              <tr key={it.id} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  {viewOnly ? (
                    it.skuCode
                  ) : (
                    <select
                      value={it.skuId}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateItem(i, 'skuId', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
                    >
                      {skus.map((s: Sku) => (
                        <option key={s.id} value={s.id}>{s.skuCode}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2">{it.color}</td>
                <td className="px-3 py-2">{it.size}</td>
                <td className="px-3 py-2 text-right">
                  {viewOnly ? it.qty.toFixed(0) : (
                    <input
                      type="number"
                      step="1"
                      value={it.qty}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(i, 'qty', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right"
                    />
                  )}
                </td>
                {!viewOnly && (
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => removeItem(i)} className="text-red-500 text-xs hover:underline">删除</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <DocPage
      title={pageTitle}
      docNo={receiptNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={handleSave}
      onSubmit={!viewOnly && !isNew && status === 'draft' ? handleSubmit : undefined}
      saving={saving}
      submitting={submitting}
      header={headerContent}
    >
      {detailContent}
    </DocPage>
  );
};

export default FinishReceiptEditPage;
