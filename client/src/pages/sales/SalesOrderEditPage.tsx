import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { baseApi } from '@client/src/api/base';
import { salesApi } from '@client/src/api/sales';
import type { SalesOrder, SalesOrderItem, Customer, Style } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import { useAuth } from '@client/src/contexts/AuthContext';
import StyleMatrixBlock from '@client/src/components/StyleMatrixBlock';
import type { StyleBlockData, StyleMatrix } from '@client/src/components/StyleMatrixBlock';
import { buildStyleBlock, flattenToSkus, buildBlocksFromItems, calcBlocksTotal } from '@client/src/components/styleMatrixUtils';
import DocPage from '@client/src/components/DocPage/DocPage';
import { errMsg } from '@/utils/errMsg';

const BACK_PATH = '/sales/order';

export default function SalesOrderEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const { hasPermission } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [orderNo, setOrderNo] = useState('');
  const [formCustomerName, setFormCustomerName] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const [blocks, setBlocks] = useState<StyleBlockData[]>([]);
  const [styleOptions, setStyleOptions] = useState<Style[]>([]);
  const [addStyleId, setAddStyleId] = useState('');
  const [addingStyle, setAddingStyle] = useState(false);

  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState(0);
  const [printRemark, setPrintRemark] = useState('');

  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const init = async (): Promise<void> => {
      await Promise.all([loadCustomers(), loadStyleOptions()]);
      if (isNew) {
        setFormOrderDate(new Date().toISOString().slice(0, 10));
      } else {
        await loadDetail(id as string);
      }
    };
    void init();
  }, [id, isNew]);

  const loadCustomers = async (): Promise<void> => {
    try {
      const res = await baseApi.customer.list({ page: 1, pageSize: 1000, status: 'active' });
      setCustomers(res.items);
    } catch (e: unknown) {
      logger.error('加载客户失败', e);
    }
  };

  const loadStyleOptions = async (): Promise<void> => {
    try {
      const result = await baseApi.style.list({ page: 1, pageSize: 500 });
      setStyleOptions(result.items || []);
    } catch (e: unknown) {
      logger.error('加载款号列表失败', e);
    }
  };

  const loadDetail = async (detailId: string): Promise<void> => {
    setLoading(true);
    try {
      const detail: SalesOrder = await salesApi.order.get(detailId);
      setFormCustomerId(detail.customerId);
      setFormOrderDate(detail.orderDate.slice(0, 10));
      setFormDeliveryDate(detail.deliveryDate?.slice(0, 10) || '');
      setFormRemark(detail.remark || '');
      setOrderNo(detail.orderNo);
      setFormCustomerName(detail.customerName);
      setStatus(detail.status);

      const items = detail.items || [];
      if (items.length === 0) {
        setBlocks([]);
        return;
      }

      const itemsWithStyleId = items.map((item: SalesOrderItem) => {
        const styleOpt = styleOptions.find((s: Style) => s.styleNo === item.styleNo);
        return {
          styleId: styleOpt?.id || '',
          styleNo: item.styleNo,
          skuId: item.skuId,
          color: item.color,
          size: item.size,
          quantity: item.quantity,
          price: item.price,
        };
      });

      const restoredBlocks: StyleBlockData[] = await buildBlocksFromItems(
        itemsWithStyleId,
        (styleId: string) => baseApi.sku.byStyle(styleId),
      );

      const filled = restoredBlocks.map((b: StyleBlockData) => {
        const opt = styleOptions.find((s: Style) => s.id === b.styleId || s.styleNo === b.styleNo);
        return {
          ...b,
          styleName: b.styleName || opt?.name || '',
          brand: b.brand || opt?.brand,
        };
      });
      setBlocks(filled);

      setPrintDocNo(detail.orderNo);
      setPrintDocDate(detail.orderDate.slice(0, 10));
      setPrintPartnerName(detail.customerName);
      setPrintTotalAmount(detail.totalAmount);
      setPrintRemark(detail.remark || '');
      setPrintItems(
        items.map((it: SalesOrderItem) => ({
          styleNo: it.styleNo,
          color: it.color,
          size: it.size,
          quantity: it.quantity,
        })),
      );
    } catch (e: unknown) {
      logger.error('加载订单详情失败', e);
      toast('加载详情失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAddStyle = async (): Promise<void> => {
    if (!addStyleId) {
      toast('请选择款号');
      return;
    }
    if (blocks.some((b: StyleBlockData) => b.styleId === addStyleId)) {
      toast('该款号已添加');
      return;
    }
    const styleOpt = styleOptions.find((s: Style) => s.id === addStyleId);
    if (!styleOpt) return;
    setAddingStyle(true);
    try {
      const skus = await baseApi.sku.byStyle(addStyleId);
      const block = buildStyleBlock(
        styleOpt.id,
        styleOpt.styleNo,
        styleOpt.name,
        skus,
        'supplyPrice',
        styleOpt.brand,
      );
      setBlocks((prev) => [...prev, block]);
      setAddStyleId('');
    } catch (e: unknown) {
      logger.error('加载款号SKU失败', e);
      toast('加载SKU失败');
    } finally {
      setAddingStyle(false);
    }
  };

  const handleMatrixChange = (styleId: string, matrix: StyleMatrix): void => {
    setBlocks((prev) =>
      prev.map((b: StyleBlockData) => (b.styleId === styleId ? { ...b, matrix } : b)),
    );
  };

  const handleRemoveStyle = (styleId: string): void => {
    setBlocks((prev) => prev.filter((b: StyleBlockData) => b.styleId !== styleId));
  };

  const handleToggleCollapse = (styleId: string): void => {
    setBlocks((prev) =>
      prev.map((b: StyleBlockData) =>
        b.styleId === styleId ? { ...b, collapsed: !b.collapsed } : b,
      ),
    );
  };

  const totals = useMemo(() => calcBlocksTotal(blocks), [blocks]);

  const handlePrint = (): void => {
    const flat = flattenToSkus(blocks);
    setPrintDocNo(orderNo);
    setPrintDocDate(formOrderDate);
    setPrintPartnerName(formCustomerName);
    setPrintTotalAmount(totals.totalAmount);
    setPrintRemark(formRemark);
    setPrintItems(
      flat.map((item) => ({
        styleNo: item.styleNo,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
      })),
    );
    setPrintOpen(true);
  };

  const doSave = async (): Promise<boolean> => {
    if (!formCustomerId) { toast('请选择客户'); return false; }
    if (!formOrderDate) { toast('请选择订单日期'); return false; }

    const flatItems = flattenToSkus(blocks);
    if (flatItems.length === 0) { toast('请至少录入一条SKU数量'); return false; }

    const data = {
      customerId: formCustomerId,
      orderDate: formOrderDate,
      deliveryDate: formDeliveryDate || undefined,
      remark: formRemark,
      items: flatItems.map((item) => ({
        skuId: item.skuId,
        quantity: Number(item.quantity.toFixed(3)),
        price: Number(item.price.toFixed(2)),
        amount: Number(item.amount.toFixed(2)),
      })),
    };

    try {
      if (isNew) {
        await salesApi.order.create(data);
      } else {
        await salesApi.order.update(id as string, data);
      }
      toast('保存成功');
      return true;
    } catch (e: unknown) {
      logger.error('保存失败', e);
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
        await salesApi.order.audit(id as string);
        toast('审核成功');
        navigate(BACK_PATH);
      } catch (e: unknown) {
        logger.error('提交失败', e);
        toast(errMsg(e, '提交失败'));
      }
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看销售订单' : isNew ? '新增销售订单' : '编辑销售订单';

  const headerContent = (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">客户 <span className="text-red-500">*</span></label>
        <select
          value={formCustomerId}
          onChange={(e) => setFormCustomerId(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">请选择客户</option>
          {customers.map((c: Customer) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">订单日期 <span className="text-red-500">*</span></label>
        <input
          type="date"
          value={formOrderDate}
          onChange={(e) => setFormOrderDate(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">交货日期</label>
        <input
          type="date"
          value={formDeliveryDate}
          onChange={(e) => setFormDeliveryDate(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">备注</label>
        <input
          type="text"
          value={formRemark}
          onChange={(e) => setFormRemark(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">明细</span>
        {!viewOnly && (
          <div className="flex items-center gap-2">
            <select
              value={addStyleId}
              onChange={(e) => setAddStyleId(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1 text-sm w-60"
              disabled={addingStyle}
            >
              <option value="">请选择款号</option>
              {styleOptions.map((s: Style) => (
                <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
              ))}
            </select>
            <button
              onClick={handleAddStyle}
              disabled={addingStyle}
              className="text-blue-500 text-sm hover:underline disabled:text-gray-400"
            >
              {addingStyle ? '加载中...' : '+ 添加款号'}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 mb-4">
        {blocks.length === 0 && (
          <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
            {viewOnly ? '暂无明细' : '暂无明细，请先添加款号'}
          </div>
        )}
        {blocks.map((block: StyleBlockData) => (
          <StyleMatrixBlock
            key={block.styleId}
            block={block}
            onChange={handleMatrixChange}
            onRemove={!viewOnly ? handleRemoveStyle : undefined}
            onToggleCollapse={handleToggleCollapse}
            readOnly={viewOnly}
            showPrice={true}
            priceLabel="成交价"
          />
        ))}
      </div>

      <div className="text-right text-sm space-x-4">
        <span>
          总数量：<span className="font-semibold">{totals.totalQty}</span>
        </span>
        <span>
          总金额：<span className="font-semibold text-red-500">¥{totals.totalAmount.toFixed(2)}</span>
        </span>
      </div>
    </div>
  );

  const showPrint = (viewOnly || !isNew) && hasPermission('sales:order:print');

  return (
    <>
      <DocPage
        title={pageTitle}
        docNo={orderNo}
        status={status}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={viewOnly ? undefined : handleSave}
        onSubmit={viewOnly || isNew ? undefined : handleSubmit}
        onPrint={showPrint ? handlePrint : undefined}
        header={headerContent}
        saving={saving}
        submitting={submitting}
      >
        {detailContent}
      </DocPage>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="销售订单"
        landscape={printItems.length > 30}
      >
        <SkuDocPrintContent
          docType="销售订单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerName={printPartnerName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </>
  );
}
