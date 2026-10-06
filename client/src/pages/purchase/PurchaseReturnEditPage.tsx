import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import DocPage from '@client/src/components/DocPage/DocPage';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { baseApi } from '@client/src/api';
import type { ReturnContext, PurchaseReturn, PurchaseReturnReceiver } from '@shared/api.interface';
import { errMsg } from '@/utils/errMsg';

interface ReturnFormItem {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  batchNo: string;
}

interface OptionItem {
  id: string;
  code: string;
  name: string;
  unit?: string;
  type?: string;
}

const BACK_PATH = '/purchase/return';

const emptyItem = (): ReturnFormItem => ({
  materialId: '',
  materialCode: '',
  materialName: '',
  unit: '',
  quantity: 0,
  price: 0,
  amount: 0,
  batchNo: '',
});

const PurchaseReturnEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [ctx, setCtx] = useState<ReturnContext | null>(null);
  const [viewItem, setViewItem] = useState<PurchaseReturn | null>(null);

  const [warehouseOptions, setWarehouseOptions] = useState<OptionItem[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<OptionItem[]>([]);
  const [materialOptions, setMaterialOptions] = useState<OptionItem[]>([]);

  // HQ 可编辑字段
  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formReceiverId, setFormReceiverId] = useState<string>('');
  const [formReceiverName, setFormReceiverName] = useState<string>('');

  const [formReturnDate, setFormReturnDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formItems, setFormItems] = useState<ReturnFormItem[]>([]);

  const [returnNo, setReturnNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  const [printOpen, setPrintOpen] = useState<boolean>(false);
  const [printItems, setPrintItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState<string>('');
  const [printDocDate, setPrintDocDate] = useState<string>('');
  const [printPartnerName, setPrintPartnerName] = useState<string>('');
  const [printWarehouseName, setPrintWarehouseName] = useState<string>('');
  const [printTotalAmount, setPrintTotalAmount] = useState<number>(0);
  const [printRemark, setPrintRemark] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);

  const isHq = ctx?.accountType === 'hq';

  // 加载退货上下文 + 选项数据（新增态）
  useEffect(() => {
    if (!isNew) return;
    setFormReturnDate(new Date().toISOString().split('T')[0]);
    const init = async (): Promise<void> => {
      try {
        const ctxRes = await axiosForBackend.get<ReturnContext>('/api/purchase/return/return-context');
        const context = ctxRes.data;
        setCtx(context);
        // 物料选项始终需要（手动添加行）
        const materialRes = await baseApi.material.options();
        setMaterialOptions(materialRes);
        if (context.accountType === 'hq') {
          const [whRes, supRes] = await Promise.all([
            baseApi.warehouse.options(),
            baseApi.supplier.options(),
          ]);
          setWarehouseOptions(whRes);
          setSupplierOptions(supRes);
        }
      } catch (error) {
        logger.error('加载退货上下文失败', error);
        toast(errMsg(error, '加载退货上下文失败'));
      }
    };
    void init();
  }, [isNew]);

  // 加载详情（查看/编辑态）
  useEffect(() => {
    if (isNew) return;
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await axiosForBackend.get<PurchaseReturn>(`/api/purchase/return/${id}`);
        const data = res.data;
        setViewItem(data);
        setReturnNo(data.returnNo);
        setStatus(data.status);
        setFormReturnDate(data.returnDate);
        setFormRemark(data.remark || '');
        setFormItems((data.items ?? []).map((it) => ({
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          unit: it.unit,
          quantity: it.quantity,
          price: it.price,
          amount: it.amount,
          batchNo: it.batchNo || '',
        })));
        setPrintDocNo(data.returnNo);
        setPrintDocDate(data.returnDate);
        setPrintPartnerName(data.receiverName || '');
        setPrintWarehouseName(data.warehouseName || '');
        setPrintTotalAmount(data.totalAmount);
        setPrintRemark(data.remark || '');
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    void loadDetail();
  }, [id, isNew]);

  const addItem = (): void => {
    setFormItems((prev) => [...prev, emptyItem()]);
  };

  const removeItem = (index: number): void => {
    setFormItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMaterialChange = (index: number, materialId: string): void => {
    const m = materialOptions.find((o) => o.id === materialId);
    setFormItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const next = {
          ...it,
          materialId: m?.id ?? '',
          materialCode: m?.code ?? '',
          materialName: m?.name ?? '',
          unit: m?.unit ?? '',
        };
        next.amount = Number((next.quantity * next.price).toFixed(2));
        return next;
      }),
    );
  };

  const updateItem = (index: number, patch: Partial<ReturnFormItem>): void => {
    setFormItems((prev) =>
      prev.map((it, i) => {
        if (i !== index) return it;
        const next = { ...it, ...patch };
        next.amount = Number((next.quantity * next.price).toFixed(2));
        return next;
      }),
    );
  };

  const totalAmount = formItems.reduce((sum, it) => sum + (it.amount || 0), 0);

  const buildReceiver = (): PurchaseReturnReceiver | undefined => {
    if (isHq) {
      if (!formReceiverId) return undefined;
      return { type: 'supplier', id: formReceiverId, name: formReceiverName };
    }
    // 经销商：服务端按经销层级解析，这里仅做透明透传（服务端忽略）
    const store = ctx?.receiver?.store;
    if (!store) return undefined;
    return { type: 'store', id: store.id, name: store.name };
  };

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    if (isHq) {
      if (!formWarehouseId) {
        toast('请选择退货店仓');
        return;
      }
      if (!formReceiverId) {
        toast('请选择收货供应商');
        return;
      }
    }
    const validItems = formItems.filter((it) => it.materialId && it.quantity > 0);
    if (validItems.length === 0) {
      toast('请至少添加一行有效退货物料');
      return;
    }
    const payload: Record<string, unknown> = {
      returnDate: formReturnDate,
      remark: formRemark || undefined,
      items: validItems.map((it) => ({
        materialId: it.materialId,
        quantity: it.quantity,
        price: it.price,
        batchNo: it.batchNo || undefined,
      })),
    };
    if (isHq) {
      payload.warehouseId = formWarehouseId;
      payload.receiver = buildReceiver();
    } else if (ctx?.returnWarehouse?.id) {
      payload.warehouseId = ctx.returnWarehouse.id;
      payload.receiver = buildReceiver();
    }
    setSaving(true);
    try {
      await axiosForBackend.post('/api/purchase/return', payload);
      toast('创建成功');
      navigate(BACK_PATH);
    } catch (error) {
      logger.error('创建采购退货失败', error);
      toast(errMsg(error, '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = (): void => {
    const source = viewItem?.items ?? formItems;
    const items: MaterialListItem[] = source
      .filter((it) => it.quantity > 0)
      .map((it) => ({
        code: it.materialCode,
        name: it.materialName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.price,
        amount: it.amount,
      }));
    setPrintItems(items);
    setPrintOpen(true);
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看采购退货' : '新增采购退货';

  const receiverLabel = (item: PurchaseReturn | null): string => {
    if (!item) return '-';
    if (item.receiverType === 'supplier') return `供应商：${item.receiverName || '-'}`;
    return `上级店仓：${item.receiverName || '-'}`;
  };

  // 查看态表头
  const viewHeaderContent = viewItem ? (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div><span className="text-gray-500">退货单号：</span>{viewItem.returnNo}</div>
      <div>
        <span className="text-gray-500">状态：</span>
        {viewItem.status === 'draft' ? '草稿' : viewItem.status === 'approved' ? '已审核' : viewItem.status}
      </div>
      <div><span className="text-gray-500">退货店仓：</span>{viewItem.warehouseName || '-'}</div>
      <div><span className="text-gray-500">收货方：</span>{receiverLabel(viewItem)}</div>
      <div><span className="text-gray-500">退货日期：</span>{viewItem.returnDate}</div>
      <div><span className="text-gray-500">单据类型：</span>{viewItem.inboundId ? '退货(关联入库单)' : '退货(无单批量)'}</div>
      <div className="col-span-2"><span className="text-gray-500">备注：</span>{viewItem.remark || '-'}</div>
    </div>
  ) : null;

  // 编辑态表头
  const editHeaderContent = (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        {isHq ? (
          <>
            <div>
              <label className="block text-gray-600 mb-1">退货店仓 *</label>
              <select
                value={formWarehouseId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWarehouseId(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary"
              >
                <option value="">请选择退货店仓</option>
                {warehouseOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-600 mb-1">收货供应商 *</label>
              <select
                value={formReceiverId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const sup = supplierOptions.find((o) => o.id === e.target.value);
                  setFormReceiverId(e.target.value);
                  setFormReceiverName(sup?.name ?? '');
                }}
                className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary"
              >
                <option value="">请选择收货供应商</option>
                {supplierOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-gray-600 mb-1">退货店仓（本店仓）</label>
              <input
                value={ctx?.returnWarehouse?.name || '-'}
                readOnly
                className="w-full border border-gray-300 rounded px-3 py-1.5 bg-gray-50 text-gray-600"
              />
            </div>
            <div>
              <label className="block text-gray-600 mb-1">收货方（上级经销商店仓）</label>
              <input
                value={ctx?.receiver?.store?.name || '-'}
                readOnly
                className="w-full border border-gray-300 rounded px-3 py-1.5 bg-gray-50 text-gray-600"
              />
            </div>
          </>
        )}
        <div>
          <label className="block text-gray-600 mb-1">退货日期 *</label>
          <input
            type="date"
            value={formReturnDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormReturnDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary"
          />
        </div>
      </div>
      <div>
        <label className="block text-gray-600 mb-1">备注</label>
        <textarea
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormRemark(e.target.value)}
          className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary"
          rows={2}
        />
      </div>
    </div>
  );

  const headerContent = viewOnly ? viewHeaderContent : editHeaderContent;

  const detailContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-700">退货明细</h2>
        {!viewOnly && (
          <button
            type="button"
            onClick={addItem}
            className="px-3 py-1 text-sm border border-primary text-primary rounded hover:bg-primary/5"
          >
            + 添加物料
          </button>
        )}
      </div>
      {formItems.length === 0 ? (
        <div className="py-6 text-center text-gray-400 border border-dashed border-gray-300 rounded">
          {viewOnly ? '暂无明细' : '请点击「添加物料」录入退货明细'}
        </div>
      ) : (
        <table className="w-full text-sm border border-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-gray-600 font-medium">物料</th>
              <th className="px-3 py-2 text-left text-gray-600 font-medium">编码</th>
              <th className="px-3 py-2 text-left text-gray-600 font-medium">单位</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">数量*</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">单价*</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">金额</th>
              <th className="px-3 py-2 text-left text-gray-600 font-medium">批次</th>
              {!viewOnly && <th className="px-3 py-2 text-center text-gray-600 font-medium">操作</th>}
            </tr>
          </thead>
          <tbody>
            {formItems.map((it, idx) => (
              <tr key={idx} className="border-t border-gray-200">
                <td className="px-3 py-2">
                  {viewOnly ? (
                    it.materialName
                  ) : (
                    <select
                      value={it.materialId}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleMaterialChange(idx, e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="">选择物料</option>
                      {materialOptions.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600">{it.materialCode || '-'}</td>
                <td className="px-3 py-2 text-gray-600">{it.unit || '-'}</td>
                <td className="px-3 py-2 text-right">
                  {viewOnly ? (
                    `${it.quantity.toFixed(3)}`
                  ) : (
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={it.quantity || 0}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(idx, { quantity: Number(e.target.value) })}
                      className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-primary"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {viewOnly ? (
                    it.price.toFixed(4)
                  ) : (
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={it.price || 0}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(idx, { price: Number(e.target.value) })}
                      className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-primary"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-right">¥{it.amount.toFixed(2)}</td>
                <td className="px-3 py-2">
                  {viewOnly ? (
                    it.batchNo || '-'
                  ) : (
                    <input
                      type="text"
                      value={it.batchNo}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItem(idx, { batchNo: e.target.value })}
                      className="w-28 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  )}
                </td>
                {!viewOnly && (
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-red-500 hover:underline text-xs"
                    >
                      删除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
              <td colSpan={viewOnly ? 5 : 6} className="px-3 py-2 text-right">合计：</td>
              <td className="px-3 py-2 text-right text-primary/90">¥{totalAmount.toFixed(2)}</td>
              {!viewOnly && <td />}
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );

  return (
    <>
      <DocPage
        title={pageTitle}
        docNo={returnNo || undefined}
        status={status || undefined}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={!viewOnly ? handleSave : undefined}
        onPrint={returnNo ? handlePrint : undefined}
        saving={saving}
        header={headerContent as React.ReactNode}
      >
        {detailContent}
      </DocPage>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="采购退货单"
      >
        <MaterialDocPrintContent
          docType="采购退货单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="收货方"
          partnerName={printPartnerName}
          warehouseName={printWarehouseName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </>
  );
};

export default PurchaseReturnEditPage;
