import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { financeApi } from '@client/src/api/finance';
import { baseApi } from '@client/src/api/base';
import type { FinancePayment, Payable } from '@shared/api.interface';
import DocPage from '@/components/DocPage/DocPage';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

interface WriteoffFormItem {
  payableId: string;
  payableNo: string;
  amount: number;
  paidAmount: number;
  balance: number;
  writeoffAmount: number;
}

const paymentMethodLabel: Record<string, string> = {
  cash: '现金',
  bank: '转账',
  check: '支票',
  other: '其他',
};

const PaymentEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id;
  const viewOnlyFromQuery = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [docData, setDocData] = useState<FinancePayment | null>(null);

  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const [formSupplierId, setFormSupplierId] = useState<string>('');
  const [formPaymentDate, setFormPaymentDate] = useState<string>('');
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>('bank');
  const [formHandler, setFormHandler] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formWriteoffs, setFormWriteoffs] = useState<WriteoffFormItem[]>([]);

  const [showPickPayable, setShowPickPayable] = useState<boolean>(false);
  const [payableOptions, setPayableOptions] = useState<Payable[]>([]);
  const [payableLoading, setPayableLoading] = useState<boolean>(false);
  const [selectedPayableIds, setSelectedPayableIds] = useState<string[]>([]);

  const viewOnly = viewOnlyFromQuery || (docData?.status === 'approved');

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const suppliers = await baseApi.supplier.options();
        setSupplierOptions(suppliers);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  useEffect(() => {
    if (isNew) {
      setFormPaymentDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDoc = async (): Promise<void> => {
      setLoading(true);
      try {
        const payment = await financeApi.payment.get(id as string);
        setDocData(payment);
        setFormSupplierId(payment.supplierId);
        setFormPaymentDate(payment.paymentDate.slice(0, 10));
        setFormAmount(payment.amount);
        setFormPaymentMethod(payment.paymentMethod);
        setFormHandler(payment.handler ?? '');
        setFormRemark(payment.remark ?? '');
        setFormWriteoffs(
          (payment.writeoffs ?? []).map((w) => ({
            payableId: w.payableId,
            payableNo: w.payableNo,
            amount: 0,
            paidAmount: 0,
            balance: 0,
            writeoffAmount: w.writeoffAmount,
          })),
        );
      } catch {
        toast.error('加载详情失败');
      } finally {
        setLoading(false);
      }
    };
    loadDoc();
  }, [id, isNew]);

  const loadSupplierPayables = async (): Promise<void> => {
    if (!formSupplierId) {
      toast('请先选择供应商');
      return;
    }
    setPayableLoading(true);
    try {
      const res = await financeApi.payable.list({
        page: 1,
        pageSize: 100,
        supplierId: formSupplierId,
        status: '',
      });
      const pending = res.items.filter((r: Payable) => r.balance > 0.001);
      setPayableOptions(pending);
      setSelectedPayableIds(formWriteoffs.map((w: WriteoffFormItem) => w.payableId));
      setShowPickPayable(true);
    } catch {
      toast.error('加载应付单失败');
    } finally {
      setPayableLoading(false);
    }
  };

  const handleSelectPayable = (pid: string, checked: boolean): void => {
    setSelectedPayableIds((prev) =>
      checked ? [...prev, pid] : prev.filter((x) => x !== pid),
    );
  };

  const confirmPickPayables = (): void => {
    const existingMap = new Map(formWriteoffs.map((w: WriteoffFormItem) => [w.payableId, w]));
    const next: WriteoffFormItem[] = selectedPayableIds
      .map((pid: string) => {
        const r = payableOptions.find((x) => x.id === pid);
        if (!r) return null;
        const existing = existingMap.get(pid);
        return {
          payableId: r.id,
          payableNo: r.payableNo,
          amount: r.amount,
          paidAmount: r.paidAmount,
          balance: r.balance,
          writeoffAmount: existing?.writeoffAmount ?? r.balance,
        };
      })
      .filter((x): x is WriteoffFormItem => x !== null);
    setFormWriteoffs(next);
    const total = next.reduce((sum, item) => sum + item.writeoffAmount, 0);
    setFormAmount(Number(total.toFixed(2)));
    setShowPickPayable(false);
  };

  const updateWriteoffAmount = (idx: number, value: number): void => {
    setFormWriteoffs((prev) =>
      prev.map((it: WriteoffFormItem, i: number) => {
        if (i !== idx) return it;
        return { ...it, writeoffAmount: value };
      }),
    );
  };

  const removeWriteoff = (idx: number): void => {
    setFormWriteoffs((prev) => prev.filter((_, i: number) => i !== idx));
  };

  useEffect(() => {
    const total = formWriteoffs.reduce((sum, item) => sum + item.writeoffAmount, 0);
    if (!viewOnly) setFormAmount(Number(total.toFixed(2)));
  }, [formWriteoffs, viewOnly]);

  const validate = (): boolean => {
    if (!formSupplierId) { toast('请选择供应商'); return false; }
    if (!formPaymentDate) { toast('请选择付款日期'); return false; }
    if (!formAmount || formAmount <= 0) { toast('付款金额必须大于0'); return false; }
    if (formWriteoffs.length === 0) { toast('请添加核销明细'); return false; }
    const totalWo = formWriteoffs.reduce((s, it) => s + it.writeoffAmount, 0);
    if (Math.abs(totalWo - formAmount) > 0.01) {
      toast('核销金额合计需等于付款金额');
      return false;
    }
    return true;
  };

  const handleSave = async (): Promise<void> => {
    if (saving || submitting) return;
    if (!validate()) return;
    setSaving(true);
    const data = {
      supplierId: formSupplierId,
      paymentDate: formPaymentDate,
      amount: Number(formAmount),
      paymentMethod: formPaymentMethod,
      handler: formHandler || undefined,
      remark: formRemark || undefined,
      writeoffs: formWriteoffs.map((it: WriteoffFormItem) => ({
        payableId: it.payableId,
        writeoffAmount: Number(it.writeoffAmount),
      })),
    };
    try {
      if (isNew) {
        await financeApi.payment.create(data);
      } else {
        await financeApi.payment.update(id as string, data);
      }
      toast.success('保存成功');
      navigate('/finance/payment');
    } catch (e) {
      toast.error(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (saving || submitting || isNew) return;
    if (!await showConfirm('确定审核该付款单吗？审核后不可修改。')) return;
    setSubmitting(true);
    try {
      await financeApi.payment.approve(id as string);
      toast.success('审核成功');
      navigate('/finance/payment');
    } catch (e) {
      toast.error(errMsg(e, '审核失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const headerForm = (
    <div className="grid grid-cols-2 gap-4 text-sm">
      {!isNew && docData && (
        <div>
          <label className="block text-gray-500 mb-1">付款单号</label>
          <div className="text-gray-800">{docData.paymentNo}</div>
        </div>
      )}
      <div>
        <label className="block text-gray-700 mb-1">供应商 *</label>
        {viewOnly ? (
          <div className="text-gray-800">{supplierOptions.find((c) => c.id === formSupplierId)?.name ?? '-'}</div>
        ) : (
          <select
            value={formSupplierId}
            onChange={(e) => setFormSupplierId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-primary"
          >
            <option value="">请选择</option>
            {supplierOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">付款日期 *</label>
        {viewOnly ? (
          <div className="text-gray-800">{formPaymentDate}</div>
        ) : (
          <input
            type="date"
            value={formPaymentDate}
            onChange={(e) => setFormPaymentDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-primary"
          />
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">付款金额 *</label>
        {viewOnly ? (
          <div className="text-gray-800 font-medium">¥ {formAmount.toFixed(2)}</div>
        ) : (
          <input
            type="number"
            step="0.01"
            value={formAmount}
            onChange={(e) => setFormAmount(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-primary"
          />
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">付款方式</label>
        {viewOnly ? (
          <div className="text-gray-800">{paymentMethodLabel[formPaymentMethod] ?? formPaymentMethod}</div>
        ) : (
          <select
            value={formPaymentMethod}
            onChange={(e) => setFormPaymentMethod(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-primary"
          >
            <option value="cash">现金</option>
            <option value="bank">转账</option>
            <option value="check">支票</option>
            <option value="other">其他</option>
          </select>
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">经办人</label>
        {viewOnly ? (
          <div className="text-gray-800">{formHandler || '-'}</div>
        ) : (
          <input
            type="text"
            value={formHandler}
            onChange={(e) => setFormHandler(e.target.value)}
            placeholder="请输入经办人"
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-primary"
          />
        )}
      </div>
    </div>
  );

  const detailContent = (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-gray-700 font-medium">核销明细</label>
          {!viewOnly && (
            <button
              onClick={loadSupplierPayables}
              className="text-sm text-primary hover:text-blue-600"
            >
              + 添加核销单
            </button>
          )}
        </div>
        <div className="border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left font-medium">应付单号</th>
                <th className="px-3 py-2 text-right font-medium">应付金额</th>
                <th className="px-3 py-2 text-right font-medium">已付金额</th>
                <th className="px-3 py-2 text-right font-medium">余额</th>
                <th className="px-3 py-2 text-right font-medium">本次核销金额</th>
                {!viewOnly && <th className="px-3 py-2 text-center font-medium w-20">操作</th>}
              </tr>
            </thead>
            <tbody>
              {formWriteoffs.length === 0 ? (
                <tr>
                  <td
                    colSpan={viewOnly ? 5 : 6}
                    className="py-6 text-center text-gray-400"
                  >
                    暂无核销明细
                  </td>
                </tr>
              ) : (
                formWriteoffs.map((it: WriteoffFormItem, idx: number) => (
                  <tr key={it.payableId} className="border-t border-gray-100">
                    <td className="px-3 py-2">{it.payableNo}</td>
                    <td className="px-3 py-2 text-right">¥{it.amount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">¥{it.paidAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-red-500">¥{it.balance.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      {viewOnly ? (
                        <span>¥{it.writeoffAmount.toFixed(2)}</span>
                      ) : (
                        <input
                          type="number"
                          step="0.01"
                          value={it.writeoffAmount}
                          onChange={(e) => updateWriteoffAmount(idx, Number(e.target.value))}
                          className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:border-primary"
                        />
                      )}
                    </td>
                    {!viewOnly && (
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => removeWriteoff(idx)}
                          className="text-red-500 hover:text-red-600 text-sm"
                        >
                          删除
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <label className="block text-gray-700 mb-1">备注</label>
        {viewOnly ? (
          <div className="text-gray-800">{formRemark || '-'}</div>
        ) : (
          <textarea
            value={formRemark}
            onChange={(e) => setFormRemark(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-primary"
          />
        )}
      </div>

      {showPickPayable && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[680px] max-w-[95vw] max-h-[75vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-medium">选择待核销应付单</h3>
              <button onClick={() => setShowPickPayable(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="overflow-auto flex-1 p-5">
              {payableLoading ? (
                <div className="py-12 text-center text-gray-400">加载中...</div>
              ) : payableOptions.length === 0 ? (
                <div className="py-12 text-center text-gray-400">该供应商暂无待核销应付单</div>
              ) : (
                <table className="w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="px-3 py-2 text-left w-10"></th>
                      <th className="px-3 py-2 text-left font-medium">应付单号</th>
                      <th className="px-3 py-2 text-right font-medium">应付金额</th>
                      <th className="px-3 py-2 text-right font-medium">已付金额</th>
                      <th className="px-3 py-2 text-right font-medium">余额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payableOptions.map((r: Payable) => (
                      <tr key={r.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedPayableIds.includes(r.id)}
                            onChange={(e) => handleSelectPayable(r.id, e.target.checked)}
                            className="w-4 h-4"
                          />
                        </td>
                        <td className="px-3 py-2">{r.payableNo}</td>
                        <td className="px-3 py-2 text-right">¥{r.amount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">¥{r.paidAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-red-500">¥{r.balance.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setShowPickPayable(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmPickPayables}
                className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (loading) {
    return <div className="p-12 text-center text-gray-400">加载中...</div>;
  }

  return (
    <DocPage
      title="付款单"
      docNo={docData?.paymentNo}
      status={docData?.status}
      backPath="/finance/payment"
      viewOnly={viewOnly}
      onSave={viewOnly ? undefined : handleSave}
      onSubmit={!isNew && docData?.status === 'draft' ? handleSubmit : undefined}
      saving={saving}
      submitting={submitting}
      header={headerForm}
    >
      {detailContent}
    </DocPage>
  );
};

export default PaymentEditPage;
