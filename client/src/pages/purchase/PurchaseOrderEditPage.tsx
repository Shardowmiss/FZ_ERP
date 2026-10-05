import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { purchaseApi } from '@client/src/api/purchase';
import { baseApi } from '@client/src/api/base';
import type { PurchaseOrderItem } from '@shared/api.interface';
import DocPage from '@client/src/components/DocPage/DocPage';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { errMsg } from '@/utils/errMsg';

interface FormItem {
  id: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
}

const BACK_PATH = '/purchase/order';

const PurchaseOrderEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [materialOptions, setMaterialOptions] = useState<{ id: string; code: string; name: string; unit: string }[]>([]);

  const [formSupplierId, setFormSupplierId] = useState<string>('');
  const [formOrderDate, setFormOrderDate] = useState<string>('');
  const [formExpectDate, setFormExpectDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formItems, setFormItems] = useState<FormItem[]>([]);

  const [orderNo, setOrderNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const [printOpen, setPrintOpen] = useState<boolean>(false);
  const [printItems, setPrintItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState<string>('');
  const [printDocDate, setPrintDocDate] = useState<string>('');
  const [printPartnerName, setPrintPartnerName] = useState<string>('');
  const [printTotalAmount, setPrintTotalAmount] = useState<number>(0);
  const [printRemark, setPrintRemark] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Load options
  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [s, m] = await Promise.all([
          baseApi.supplier.options(),
          baseApi.material.options(),
        ]);
        setSupplierOptions(s);
        setMaterialOptions(m);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  // Load detail for edit/view
  useEffect(() => {
    if (isNew) {
      setFormOrderDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const order = await purchaseApi.order.get(id as string);
        setOrderNo(order.orderNo);
        setStatus(order.status);
        setFormSupplierId(order.supplierId);
        setFormOrderDate(order.orderDate.slice(0, 10));
        setFormExpectDate(order.expectDate ? order.expectDate.slice(0, 10) : '');
        setFormRemark(order.remark ?? '');
        setFormItems((order.items ?? []).map((it: PurchaseOrderItem) => ({
          id: it.id,
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          unit: it.unit,
          quantity: it.quantity,
          price: it.price,
        })));
        setPrintDocNo(order.orderNo);
        setPrintDocDate(order.orderDate.slice(0, 10));
        setPrintPartnerName(order.supplierName);
        setPrintTotalAmount(order.totalAmount);
        setPrintRemark(order.remark ?? '');
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const handleAddRow = (): void => {
    const firstMat = materialOptions[0];
    setFormItems(prev => [...prev, {
      id: `tmp_${Date.now()}`,
      materialId: firstMat?.id ?? '',
      materialCode: firstMat?.code ?? '',
      materialName: firstMat?.name ?? '',
      unit: firstMat?.unit ?? '',
      quantity: 0,
      price: 0,
    }]);
  };

  const handleRemoveRow = (idx: number): void => {
    setFormItems(prev => prev.filter((_: FormItem, i: number) => i !== idx));
  };

  const updateItemField = (idx: number, field: keyof FormItem, value: string | number): void => {
    setFormItems(prev => prev.map((it: FormItem, i: number) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: value };
      if (field === 'materialId') {
        const mat = materialOptions.find((m: { id: string }) => m.id === value);
        if (mat) {
          updated.materialCode = mat.code;
          updated.materialName = mat.name;
          updated.unit = mat.unit;
        }
      }
      return updated;
    }));
  };

  const totalAmount = formItems.reduce((sum: number, it: FormItem) => sum + it.quantity * it.price, 0);

  const doSave = async (): Promise<boolean> => {
    if (!formSupplierId) { toast('请选择供应商'); return false; }
    if (!formOrderDate) { toast('请选择订单日期'); return false; }
    if (formItems.length === 0) { toast('请添加至少一条明细'); return false; }
    const data = {
      supplierId: formSupplierId,
      orderDate: formOrderDate,
      expectDate: formExpectDate || undefined,
      remark: formRemark,
      items: formItems.map((it: FormItem) => ({
        materialId: it.materialId,
        quantity: Number(it.quantity),
        price: Number(it.price),
      })),
    };
    try {
      if (isNew) {
        await purchaseApi.order.create(data);
      } else {
        await purchaseApi.order.update(id as string, data);
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
        await purchaseApi.order.audit(id as string);
        toast('审核成功');
        navigate(BACK_PATH);
      } catch (e) {
        toast(errMsg(e, '审核失败'));
      }
    }
    setSubmitting(false);
  };

  const handlePrint = (): void => {
    const items: MaterialListItem[] = formItems.map((it: FormItem) => ({
      code: it.materialCode,
      name: it.materialName,
      unit: it.unit,
      quantity: it.quantity,
      price: it.price,
      amount: it.quantity * it.price,
    }));
    setPrintItems(items);
    setPrintOpen(true);
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看采购订单' : isNew ? '新增采购订单' : '编辑采购订单';

  const headerContent = (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-600 mb-1">供应商<span className="text-red-500">*</span></label>
          <select
            disabled={viewOnly}
            value={formSupplierId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormSupplierId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary disabled:bg-gray-100"
          >
            <option value="">请选择供应商</option>
            {supplierOptions.map((s: { id: string; code: string; name: string }) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">订单日期<span className="text-red-500">*</span></label>
          <input
            type="date"
            disabled={viewOnly}
            value={formOrderDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormOrderDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary disabled:bg-gray-100"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-600 mb-1">预计到货日期</label>
          <input
            type="date"
            disabled={viewOnly}
            value={formExpectDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormExpectDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary disabled:bg-gray-100"
          />
        </div>
        <div />
      </div>
      <div>
        <label className="block text-gray-600 mb-1">备注</label>
        <textarea
          disabled={viewOnly}
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormRemark(e.target.value)}
          rows={2}
          className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary disabled:bg-gray-100"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-700">明细</h2>
        {!viewOnly && (
          <button onClick={handleAddRow} className="text-sm text-primary hover:text-primary">+ 添加行</button>
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
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateItemField(idx, 'materialId', e.target.value)}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItemField(idx, 'quantity', Number(e.target.value))}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItemField(idx, 'price', Number(e.target.value))}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none"
                      step="0.01"
                    />
                  )}
                </td>
                <td className="py-1.5 px-2 text-right font-medium text-primary">
                  {(item.quantity * item.price).toFixed(2)}
                </td>
                {!viewOnly && (
                  <td className="py-1.5 px-2 text-center">
                    <button onClick={() => handleRemoveRow(idx)} className="text-red-500 text-xs">删除</button>
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
  );

  return (
    <>
      <DocPage
        title={pageTitle}
        docNo={orderNo || undefined}
        status={status || undefined}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={!viewOnly ? handleSave : undefined}
        onSubmit={!viewOnly && !isNew && status === 'draft' ? handleSubmit : undefined}
        onPrint={orderNo ? handlePrint : undefined}
        saving={saving}
        submitting={submitting}
        header={headerContent}
      >
        {detailContent}
      </DocPage>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="采购订单"
      >
        <MaterialDocPrintContent
          docType="采购订单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="供应商"
          partnerName={printPartnerName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </>
  );
};

export default PurchaseOrderEditPage;
