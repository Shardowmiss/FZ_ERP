import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import DocPage from '@client/src/components/DocPage/DocPage';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { errMsg } from '@/utils/errMsg';

interface ReturnFormItem {
  materialId: string;
  materialCode: string;
  materialName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  batchNo: string;
  returnQty: number;
}

interface PurchaseReturnDetail {
  id: string;
  returnNo: string;
  inboundId: string;
  inboundNo: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName?: string;
  warehouseId: string;
  warehouseName?: string;
  returnDate: string;
  totalAmount: number;
  status: string;
  remark?: string;
  items?: Array<{
    id: string;
    materialId: string;
    materialCode: string;
    materialName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    batchNo?: string;
  }>;
}

const BACK_PATH = '/purchase/return';

const PurchaseReturnEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [loading, setLoading] = useState<boolean>(false);
  const [inboundOptions, setInboundOptions] = useState<any[]>([]);
  const [viewItem, setViewItem] = useState<PurchaseReturnDetail | null>(null);

  const [formInboundId, setFormInboundId] = useState<string>('');
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

  // Load approved inbounds for new mode
  useEffect(() => {
    if (!isNew) return;
    const loadInbounds = async (): Promise<void> => {
      try {
        const res = await axiosForBackend.get('/api/purchase/inbound?pageSize=100&status=approved');
        setInboundOptions(res.data.items || []);
      } catch (error) {
        logger.error('加载入库单失败', error);
      }
    };
    loadInbounds();
  }, [isNew]);

  // Load detail for view mode
  useEffect(() => {
    if (isNew) {
      setFormReturnDate(new Date().toISOString().split('T')[0]);
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await axiosForBackend.get(`/api/purchase/return/${id}`);
        const data: PurchaseReturnDetail = res.data;
        setViewItem(data);
        setReturnNo(data.returnNo);
        setStatus(data.status);
        setFormInboundId(data.inboundId);
        setFormReturnDate(data.returnDate);
        setFormRemark(data.remark || '');
        // For view mode, populate form items from detail
        setFormItems((data.items ?? []).map((it) => ({
          materialId: it.materialId,
          materialCode: it.materialCode,
          materialName: it.materialName,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          amount: it.amount,
          batchNo: it.batchNo || '',
          returnQty: it.quantity,
        })));
        setPrintDocNo(data.returnNo);
        setPrintDocDate(data.returnDate);
        setPrintPartnerName(data.supplierName || '');
        setPrintWarehouseName(data.warehouseName || '');
        setPrintTotalAmount(data.totalAmount);
        setPrintRemark(data.remark || '');
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const handleInboundChange = async (inboundId: string): Promise<void> => {
    setFormInboundId(inboundId);
    setFormItems([]);
    if (!inboundId) return;
    try {
      const res = await axiosForBackend.get(`/api/purchase/inbound/${inboundId}`);
      const inbound = res.data;
      const items: ReturnFormItem[] = inbound.items?.map((it: any) => ({
        materialId: it.materialId,
        materialCode: it.materialCode,
        materialName: it.materialName,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        amount: it.quantity * it.unitPrice,
        batchNo: it.batchNo || '',
        returnQty: 0,
      })) || [];
      setFormItems(items);
    } catch (error) {
      logger.error('加载入库单明细失败', error);
    }
  };

  const updateReturnQty = (index: number, returnQty: number): void => {
    const items = [...formItems];
    items[index] = { ...items[index], returnQty, amount: returnQty * items[index].unitPrice };
    items[index].amount = Number((returnQty * items[index].unitPrice).toFixed(2));
    setFormItems(items);
  };

  const totalAmount = formItems.reduce((sum: number, it: ReturnFormItem) => sum + (it.amount || 0), 0);

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    if (!formInboundId) {
      toast('请选择入库单');
      return;
    }
    const returnItems = formItems
      .filter((it: ReturnFormItem) => it.returnQty > 0)
      .map((it: ReturnFormItem) => ({
        materialId: it.materialId,
        quantity: it.returnQty,
        unitPrice: it.unitPrice,
        batchNo: it.batchNo,
      }));
    if (returnItems.length === 0) {
      toast('请填写至少一行退货数量');
      return;
    }
    setSaving(true);
    try {
      await axiosForBackend.post('/api/purchase/return', {
        inboundId: formInboundId,
        returnDate: formReturnDate,
        remark: formRemark,
        items: returnItems,
      });
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
    if (viewItem) {
      const items: MaterialListItem[] = (viewItem.items ?? []).map((it) => ({
        code: it.materialCode,
        name: it.materialName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.unitPrice,
        amount: it.amount,
      }));
      setPrintItems(items);
      setPrintOpen(true);
    } else {
      const items: MaterialListItem[] = formItems
        .filter((it: ReturnFormItem) => it.returnQty > 0)
        .map((it: ReturnFormItem) => ({
          code: it.materialCode,
          name: it.materialName,
          unit: it.unit,
          quantity: it.returnQty,
          price: it.unitPrice,
          amount: it.returnQty * it.unitPrice,
        }));
      setPrintItems(items);
      setPrintOpen(true);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看采购退货' : '新增采购退货';

  // View mode header with full info
  const viewHeaderContent = viewItem ? (
    <div className="grid grid-cols-2 gap-4 text-sm">
      <div><span className="text-gray-500">退货单号：</span>{viewItem.returnNo}</div>
      <div><span className="text-gray-500">状态：</span>{viewItem.status === 'draft' ? '草稿' : viewItem.status === 'approved' ? '已审核' : viewItem.status}</div>
      <div><span className="text-gray-500">入库单号：</span>{viewItem.inboundNo}</div>
      <div><span className="text-gray-500">供应商：</span>{viewItem.supplierName || '-'}</div>
      <div><span className="text-gray-500">仓库：</span>{viewItem.warehouseName || '-'}</div>
      <div><span className="text-gray-500">退货日期：</span>{viewItem.returnDate}</div>
      <div className="col-span-2"><span className="text-gray-500">备注：</span>{viewItem.remark || '-'}</div>
    </div>
  ) : null;

  // Edit mode header
  const editHeaderContent = (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-gray-600 mb-1">入库单 *</label>
          <select
            value={formInboundId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { void handleInboundChange(e.target.value); }}
            className="w-full border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:border-primary"
          >
            <option value="">请选择已审核的入库单</option>
            {inboundOptions.map((i: any) => (
              <option key={i.id} value={i.id}>
                {i.inboundNo} - {i.supplierName} - ¥{i.totalAmount?.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
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
      </div>
      {formItems.length === 0 ? (
        <div className="py-6 text-center text-gray-400 border border-dashed border-gray-300 rounded">
          {viewOnly ? '暂无明细' : '请先选择入库单'}
        </div>
      ) : viewOnly ? (
        <table className="w-full text-sm border border-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-gray-600 font-medium">物料编码</th>
              <th className="px-3 py-2 text-left text-gray-600 font-medium">物料名称</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">数量</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">单价</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">金额</th>
            </tr>
          </thead>
          <tbody>
            {formItems.map((it: ReturnFormItem) => (
              <tr key={it.materialId + (it.batchNo || '')} className="border-t border-gray-200">
                <td className="px-3 py-2">{it.materialCode}</td>
                <td className="px-3 py-2">{it.materialName}</td>
                <td className="px-3 py-2 text-right">{it.quantity.toFixed(3)} {it.unit}</td>
                <td className="px-3 py-2 text-right">{it.unitPrice.toFixed(4)}</td>
                <td className="px-3 py-2 text-right">¥{it.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
              <td colSpan={4} className="px-3 py-2 text-right">合计：</td>
              <td className="px-3 py-2 text-right text-primary/90">¥{totalAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <table className="w-full text-sm border border-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-3 py-2 text-left text-gray-600 font-medium">物料编码</th>
              <th className="px-3 py-2 text-left text-gray-600 font-medium">物料名称</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">入库数量</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">退货数量*</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">单价</th>
              <th className="px-3 py-2 text-right text-gray-600 font-medium">金额</th>
            </tr>
          </thead>
          <tbody>
            {formItems.map((it: ReturnFormItem, idx: number) => (
              <tr key={it.materialId + (it.batchNo || '')} className="border-t border-gray-200">
                <td className="px-3 py-2">{it.materialCode}</td>
                <td className="px-3 py-2">{it.materialName}</td>
                <td className="px-3 py-2 text-right">{it.quantity.toFixed(3)} {it.unit}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    max={it.quantity}
                    value={it.returnQty || 0}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateReturnQty(idx, Number(e.target.value))}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-primary"
                  />
                </td>
                <td className="px-3 py-2 text-right text-gray-500">{it.unitPrice.toFixed(4)}</td>
                <td className="px-3 py-2 text-right">¥{(it.amount || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
              <td colSpan={5} className="px-3 py-2 text-right">合计：</td>
              <td className="px-3 py-2 text-right text-primary/90">¥{totalAmount.toFixed(2)}</td>
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

export default PurchaseReturnEditPage;
