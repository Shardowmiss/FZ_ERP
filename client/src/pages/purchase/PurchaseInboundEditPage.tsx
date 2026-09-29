import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { purchaseApi } from '@client/src/api/purchase';
import { baseApi } from '@client/src/api/base';
import type { PurchaseInboundItem, PurchaseOrder, PurchaseOrderItem } from '@shared/api.interface';
import DocPage from '@client/src/components/DocPage/DocPage';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { errMsg } from '@/utils/errMsg';

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

const BACK_PATH = '/purchase/inbound';

const PurchaseInboundEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [approvedOrders, setApprovedOrders] = useState<PurchaseOrder[]>([]);

  const [formOrderId, setFormOrderId] = useState<string>('');
  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formInboundDate, setFormInboundDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [formItems, setFormItems] = useState<InboundFormItem[]>([]);

  const [inboundNo, setInboundNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [supplierName, setSupplierName] = useState<string>('');
  const [warehouseName, setWarehouseName] = useState<string>('');

  const [printOpen, setPrintOpen] = useState<boolean>(false);
  const [printItems, setPrintItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState<string>('');
  const [printDocDate, setPrintDocDate] = useState<string>('');
  const [printPartnerName, setPrintPartnerName] = useState<string>('');
  const [printWarehouseName, setPrintWarehouseName] = useState<string>('');
  const [printTotalAmount, setPrintTotalAmount] = useState<number>(0);
  const [printRemark, setPrintRemark] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);

  // Load options
  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [w] = await Promise.all([
          baseApi.warehouse.options(),
        ]);
        setWarehouseOptions(w);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  // Load approved orders for new mode
  useEffect(() => {
    if (!isNew) return;
    const loadOrders = async (): Promise<void> => {
      try {
        const res = await purchaseApi.order.list({ page: 1, pageSize: 100, status: 'booked' });
        setApprovedOrders(res.items);
      } catch {
        // ignore
      }
    };
    loadOrders();
  }, [isNew]);

  // Load detail for view mode
  useEffect(() => {
    if (isNew) {
      setFormInboundDate(new Date().toISOString().slice(0, 10));
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const inbound = await purchaseApi.inbound.get(id as string);
        setInboundNo(inbound.inboundNo);
        setStatus(inbound.status);
        setSupplierName(inbound.supplierName);
        setWarehouseName(inbound.warehouseName);
        setFormOrderId(inbound.orderId);
        setFormWarehouseId(inbound.warehouseId);
        setFormInboundDate(inbound.inboundDate.slice(0, 10));
        setFormRemark(inbound.remark ?? '');
        setFormItems((inbound.items ?? []).map((it: PurchaseInboundItem) => ({
          orderItemId: it.orderItemId,
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          unit: it.unit,
          orderQty: 0,
          receivedQty: 0,
          quantity: it.quantity,
          price: it.price,
          batchNo: it.batchNo ?? '',
        })));
        setPrintDocNo(inbound.inboundNo);
        setPrintDocDate(inbound.inboundDate.slice(0, 10));
        setPrintPartnerName(inbound.supplierName);
        setPrintWarehouseName(inbound.warehouseName);
        setPrintTotalAmount(inbound.totalAmount);
        setPrintRemark(inbound.remark ?? '');
      } catch {
        toast('加载详情失败');
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const handleOrderChange = async (orderId: string): Promise<void> => {
    setFormOrderId(orderId);
    if (!orderId) {
      setFormItems([]);
      return;
    }
    try {
      const order = await purchaseApi.order.get(orderId);
      const items: InboundFormItem[] = (order.items ?? [])
        .filter((it: PurchaseOrderItem) => it.quantity - it.receivedQty > 0)
        .map((it: PurchaseOrderItem) => ({
          orderItemId: it.id,
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          unit: it.unit,
          orderQty: it.quantity,
          receivedQty: it.receivedQty,
          quantity: it.quantity - it.receivedQty,
          price: it.price,
          batchNo: '',
        }));
      setFormItems(items);
    } catch {
      toast('加载订单明细失败');
    }
  };

  const updateItemField = (idx: number, field: keyof InboundFormItem, value: string | number): void => {
    setFormItems(prev => prev.map((it: InboundFormItem, i: number) => {
      if (i !== idx) return it;
      return { ...it, [field]: value };
    }));
  };

  const totalAmount = formItems.reduce((sum: number, it: InboundFormItem) => sum + it.quantity * it.price, 0);

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    if (!formOrderId) { toast('请选择采购订单'); return; }
    if (!formWarehouseId) { toast('请选择仓库'); return; }
    if (!formInboundDate) { toast('请选择入库日期'); return; }
    if (formItems.length === 0) { toast('没有可入库的物料'); return; }
    const validItems = formItems.filter((it: InboundFormItem) => it.quantity > 0);
    if (validItems.length === 0) { toast('请填写入库数量'); return; }
    setSaving(true);
    const data = {
      orderId: formOrderId,
      warehouseId: formWarehouseId,
      inboundDate: formInboundDate,
      remark: formRemark,
      items: validItems.map((it: InboundFormItem) => ({
        orderItemId: it.orderItemId,
        quantity: Number(it.quantity),
        price: Number(it.price),
        batchNo: it.batchNo || undefined,
      })),
    };
    try {
      await purchaseApi.inbound.create(data);
      toast('保存成功');
      navigate(BACK_PATH);
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = (): void => {
    const items: MaterialListItem[] = formItems.map((it: InboundFormItem) => ({
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

  const pageTitle = viewOnly ? '查看采购入库' : '新增采购入库';

  const headerContent = (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-600 mb-1">采购订单<span className="text-red-500">*</span></label>
          <select
            disabled={viewOnly}
            value={formOrderId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { void handleOrderChange(e.target.value); }}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
          >
            <option value="">请选择采购订单</option>
            {approvedOrders.map((o: PurchaseOrder) => (
              <option key={o.id} value={o.id}>{o.orderNo} - {o.supplierName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">仓库<span className="text-red-500">*</span></label>
          <select
            disabled={viewOnly}
            value={formWarehouseId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWarehouseId(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
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
          <label className="block text-gray-600 mb-1">入库日期<span className="text-red-500">*</span></label>
          <input
            type="date"
            disabled={viewOnly}
            value={formInboundDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormInboundDate(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
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
          className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-blue-500 disabled:bg-gray-100"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-700">入库明细</h2>
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItemField(idx, 'quantity', Number(e.target.value))}
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
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateItemField(idx, 'batchNo', e.target.value)}
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
  );

  return (
    <>
      <DocPage
        title={pageTitle}
        docNo={inboundNo || undefined}
        status={status || undefined}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={!viewOnly ? handleSave : undefined}
        onPrint={inboundNo ? handlePrint : undefined}
        saving={saving}
        header={headerContent}
      >
        {detailContent}
      </DocPage>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="采购入库单"
      >
        <MaterialDocPrintContent
          docType="采购入库单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="供应商"
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

export default PurchaseInboundEditPage;
