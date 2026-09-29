import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { financeApi } from '@client/src/api/finance';
import { baseApi } from '@client/src/api/base';
import type { FinanceReceipt, Receivable } from '@shared/api.interface';
import DocPage from '@/components/DocPage/DocPage';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

interface WriteoffFormItem {
  receivableId: string;
  receivableNo: string;
  amount: number;
  receivedAmount: number;
  balance: number;
  writeoffAmount: number;
}

const paymentMethodLabel: Record<string, string> = {
  cash: '现金',
  bank: '转账',
  check: '支票',
  other: '其他',
};

const ReceiptEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id;
  const viewOnlyFromQuery = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [docData, setDocData] = useState<FinanceReceipt | null>(null);

  const [customerOptions, setCustomerOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const [formCustomerId, setFormCustomerId] = useState<string>('');
  const [formReceiptDate, setFormReceiptDate] = useState<string>('');
  const [formAmount, setFormAmount] = useState<number>(0);
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>('bank');
  const [formHandler, setFormHandler] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formWriteoffs, setFormWriteoffs] = useState<WriteoffFormItem[]>([]);

  const [showPickReceivable, setShowPickReceivable] = useState<boolean>(false);
  const [receivableOptions, setReceivableOptions] = useState<Receivable[]>([]);
  const [receivableLoading, setReceivableLoading] = useState<boolean>(false);
  const [selectedReceivableIds, setSelectedReceivableIds] = useState<string[]>([]);

  const viewOnly = viewOnlyFromQuery || (docData?.status === 'approved');

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const customers = await baseApi.customer.options();
        setCustomerOptions(customers);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  useEffect(() => {
    if (isNew) {
      setFormReceiptDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDoc = async (): Promise<void> => {
      setLoading(true);
      try {
        const receipt = await financeApi.receipt.get(id as string);
        setDocData(receipt);
        setFormCustomerId(receipt.customerId);
        setFormReceiptDate(receipt.receiptDate.slice(0, 10));
        setFormAmount(receipt.amount);
        setFormPaymentMethod(receipt.paymentMethod);
        setFormHandler(receipt.handler ?? '');
        setFormRemark(receipt.remark ?? '');
        setFormWriteoffs(
          (receipt.writeoffs ?? []).map((w) => ({
            receivableId: w.receivableId,
            receivableNo: w.receivableNo,
            amount: 0,
            receivedAmount: 0,
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

  const loadCustomerReceivables = async (): Promise<void> => {
    if (!formCustomerId) {
      toast('请先选择客户');
      return;
    }
    setReceivableLoading(true);
    try {
      const res = await financeApi.receivable.list({
        page: 1,
        pageSize: 100,
        customerId: formCustomerId,
        status: '',
      });
      const pending = res.items.filter((r: Receivable) => r.balance > 0.001);
      setReceivableOptions(pending);
      setSelectedReceivableIds(formWriteoffs.map((w: WriteoffFormItem) => w.receivableId));
      setShowPickReceivable(true);
    } catch {
      toast.error('加载应收单失败');
    } finally {
      setReceivableLoading(false);
    }
  };

  const handleSelectReceivable = (rid: string, checked: boolean): void => {
    setSelectedReceivableIds((prev) =>
      checked ? [...prev, rid] : prev.filter((x) => x !== rid),
    );
  };

  const confirmPickReceivables = (): void => {
    const existingMap = new Map(formWriteoffs.map((w: WriteoffFormItem) => [w.receivableId, w]));
    const next: WriteoffFormItem[] = selectedReceivableIds
      .map((rid: string) => {
        const r = receivableOptions.find((x) => x.id === rid);
        if (!r) return null;
        const existing = existingMap.get(rid);
        return {
          receivableId: r.id,
          receivableNo: r.receivableNo,
          amount: r.amount,
          receivedAmount: r.receivedAmount,
          balance: r.balance,
          writeoffAmount: existing?.writeoffAmount ?? r.balance,
        };
      })
      .filter((x): x is WriteoffFormItem => x !== null);
    setFormWriteoffs(next);
    const total = next.reduce((sum, item) => sum + item.writeoffAmount, 0);
    setFormAmount(Number(total.toFixed(2)));
    setShowPickReceivable(false);
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
    if (!formCustomerId) { toast('请选择客户'); return false; }
    if (!formReceiptDate) { toast('请选择收款日期'); return false; }
    if (!formAmount || formAmount <= 0) { toast('收款金额必须大于0'); return false; }
    if (formWriteoffs.length === 0) { toast('请添加核销明细'); return false; }
    const totalWo = formWriteoffs.reduce((s, it) => s + it.writeoffAmount, 0);
    if (Math.abs(totalWo - formAmount) > 0.01) {
      toast('核销金额合计需等于收款金额');
      return false;
    }
    return true;
  };

  const handleSave = async (): Promise<void> => {
    if (saving || submitting) return;
    if (!validate()) return;
    setSaving(true);
    const data = {
      customerId: formCustomerId,
      receiptDate: formReceiptDate,
      amount: Number(formAmount),
      paymentMethod: formPaymentMethod,
      handler: formHandler || undefined,
      remark: formRemark || undefined,
      writeoffs: formWriteoffs.map((it: WriteoffFormItem) => ({
        receivableId: it.receivableId,
        writeoffAmount: Number(it.writeoffAmount),
      })),
    };
    try {
      if (isNew) {
        await financeApi.receipt.create(data);
      } else {
        await financeApi.receipt.update(id as string, data);
      }
      toast.success('保存成功');
      navigate('/finance/receipt');
    } catch (e) {
      toast.error(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (saving || submitting || isNew) return;
    if (!await showConfirm('确定审核该收款单吗？审核后不可修改。')) return;
    setSubmitting(true);
    try {
      await financeApi.receipt.approve(id as string);
      toast.success('审核成功');
      navigate('/finance/receipt');
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
          <label className="block text-gray-500 mb-1">收款单号</label>
          <div className="text-gray-800">{docData.receiptNo}</div>
        </div>
      )}
      <div>
        <label className="block text-gray-700 mb-1">客户 *</label>
        {viewOnly ? (
          <div className="text-gray-800">{customerOptions.find((c) => c.id === formCustomerId)?.name ?? '-'}</div>
        ) : (
          <select
            value={formCustomerId}
            onChange={(e) => setFormCustomerId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          >
            <option value="">请选择</option>
            {customerOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">收款日期 *</label>
        {viewOnly ? (
          <div className="text-gray-800">{formReceiptDate}</div>
        ) : (
          <input
            type="date"
            value={formReceiptDate}
            onChange={(e) => setFormReceiptDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          />
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">收款金额 *</label>
        {viewOnly ? (
          <div className="text-gray-800 font-medium">¥ {formAmount.toFixed(2)}</div>
        ) : (
          <input
            type="number"
            step="0.01"
            value={formAmount}
            onChange={(e) => setFormAmount(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          />
        )}
      </div>
      <div>
        <label className="block text-gray-700 mb-1">收款方式</label>
        {viewOnly ? (
          <div className="text-gray-800">{paymentMethodLabel[formPaymentMethod] ?? formPaymentMethod}</div>
        ) : (
          <select
            value={formPaymentMethod}
            onChange={(e) => setFormPaymentMethod(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
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
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
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
              onClick={loadCustomerReceivables}
              className="text-sm text-blue-500 hover:text-blue-600"
            >
              + 添加核销单
            </button>
          )}
        </div>
        <div className="border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-3 py-2 text-left font-medium">应收单号</th>
                <th className="px-3 py-2 text-right font-medium">应收金额</th>
                <th className="px-3 py-2 text-right font-medium">已收金额</th>
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
                  <tr key={it.receivableId} className="border-t border-gray-100">
                    <td className="px-3 py-2">{it.receivableNo}</td>
                    <td className="px-3 py-2 text-right">¥{it.amount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">¥{it.receivedAmount.toFixed(2)}</td>
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
                          className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:outline-none focus:border-blue-500"
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
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
          />
        )}
      </div>

      {showPickReceivable && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[680px] max-w-[95vw] max-h-[75vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-medium">选择待核销应收单</h3>
              <button onClick={() => setShowPickReceivable(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="overflow-auto flex-1 p-5">
              {receivableLoading ? (
                <div className="py-12 text-center text-gray-400">加载中...</div>
              ) : receivableOptions.length === 0 ? (
                <div className="py-12 text-center text-gray-400">该客户暂无待核销应收单</div>
              ) : (
                <table className="w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="px-3 py-2 text-left w-10"></th>
                      <th className="px-3 py-2 text-left font-medium">应收单号</th>
                      <th className="px-3 py-2 text-right font-medium">应收金额</th>
                      <th className="px-3 py-2 text-right font-medium">已收金额</th>
                      <th className="px-3 py-2 text-right font-medium">余额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receivableOptions.map((r: Receivable) => (
                      <tr key={r.id} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedReceivableIds.includes(r.id)}
                            onChange={(e) => handleSelectReceivable(r.id, e.target.checked)}
                            className="w-4 h-4"
                          />
                        </td>
                        <td className="px-3 py-2">{r.receivableNo}</td>
                        <td className="px-3 py-2 text-right">¥{r.amount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">¥{r.receivedAmount.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-red-500">¥{r.balance.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setShowPickReceivable(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={confirmPickReceivables}
                className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
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
      title="收款单"
      docNo={docData?.receiptNo}
      status={docData?.status}
      backPath="/finance/receipt"
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

export default ReceiptEditPage;
