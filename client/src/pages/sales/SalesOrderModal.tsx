import { useState, useEffect, useMemo } from 'react';
import { baseApi } from '@client/src/api/base';
import { salesApi } from '@client/src/api/sales';
import type { SalesOrder, SalesOrderItem, Customer, Style, Sku } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import { Printer } from 'lucide-react';
import { useAuth } from '@client/src/contexts/AuthContext';
import StyleMatrixBlock from '@client/src/components/StyleMatrixBlock';
import type { StyleBlockData, StyleMatrix } from '@client/src/components/StyleMatrixBlock';
import { buildStyleBlock, flattenToSkus, buildBlocksFromItems, calcBlocksTotal } from '@client/src/components/styleMatrixUtils';
import { errMsg } from '@/utils/errMsg';

interface SalesOrderModalProps {
  visible: boolean;
  viewMode: boolean;
  editId: string | null;
  customers: Customer[];
  skus: Sku[];
  onClose: () => void;
  onSaved: () => void;
}

export default function SalesOrderModal({
  visible, viewMode, editId, customers, onClose, onSaved,
}: SalesOrderModalProps) {
  // skus prop 保留以兼容父组件调用；矩阵模式下通过 baseApi.sku.byStyle 按款号加载
  const { hasPermission } = useAuth();
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formOrderDate, setFormOrderDate] = useState('');
  const [formDeliveryDate, setFormDeliveryDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [formOrderNo, setFormOrderNo] = useState('');
  const [formCustomerName, setFormCustomerName] = useState('');
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

  useEffect(() => {
    if (!visible) return;
    void initModal();
  }, [visible, editId]);

  const initModal = async (): Promise<void> => {
    await loadStyleOptions();
    if (editId) {
      await loadDetail(editId);
    } else {
      resetForm();
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

  const resetForm = (): void => {
    setFormCustomerId('');
    setFormOrderDate(new Date().toISOString().slice(0, 10));
    setFormDeliveryDate('');
    setFormRemark('');
    setFormOrderNo('');
    setFormCustomerName('');
    setBlocks([]);
    setAddStyleId('');
  };

  const loadDetail = async (id: string): Promise<void> => {
    setLoading(true);
    try {
      const detail: SalesOrder = await salesApi.order.get(id);
      setFormCustomerId(detail.customerId);
      setFormOrderDate(detail.orderDate.slice(0, 10));
      setFormDeliveryDate(detail.deliveryDate?.slice(0, 10) || '');
      setFormRemark(detail.remark || '');
      setFormOrderNo(detail.orderNo);
      setFormCustomerName(detail.customerName);

      const items = detail.items || [];
      if (items.length === 0) {
        setBlocks([]);
        return;
      }

      // 通过 styleNo 反查 styleId，再用 buildBlocksFromItems 还原矩阵
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

      // 补齐 styleName / brand
      const filled = restoredBlocks.map((b: StyleBlockData) => {
        const opt = styleOptions.find((s: Style) => s.id === b.styleId || s.styleNo === b.styleNo);
        return {
          ...b,
          styleName: b.styleName || opt?.name || '',
          brand: b.brand || opt?.brand,
        };
      });
      setBlocks(filled);
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
    setPrintDocNo(formOrderNo);
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

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (submitting) return;
    if (!formCustomerId) { toast('请选择客户'); return; }
    if (!formOrderDate) { toast('请选择订单日期'); return; }

    const flatItems = flattenToSkus(blocks);
    if (flatItems.length === 0) { toast('请至少录入一条SKU数量'); return; }

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

    setSubmitting(true);
    try {
      if (editId) {
        await salesApi.order.update(editId, data);
        toast('修改成功');
      } else {
        await salesApi.order.create(data);
        toast('创建成功');
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      logger.error('保存失败', e);
      toast(errMsg(e, '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-[1100px] max-w-[95vw] max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="font-semibold">
            {viewMode ? '查看订单' : editId ? '编辑订单' : '新增订单'}
          </h3>
          <div className="flex items-center gap-2">
            {(viewMode || editId) && hasPermission('sales:order:print') && (
              <button onClick={handlePrint} className="text-primary hover:underline text-sm inline-flex items-center gap-1">
                <Printer size={14} /> 打印
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-12 text-gray-400">加载中...</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="flex flex-col">
                  <label className="text-xs text-gray-500 mb-1">客户 <span className="text-red-500">*</span></label>
                  <select
                    value={formCustomerId}
                    onChange={(e) => setFormCustomerId(e.target.value)}
                    disabled={viewMode}
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
                    disabled={viewMode}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-gray-500 mb-1">交货日期</label>
                  <input
                    type="date"
                    value={formDeliveryDate}
                    onChange={(e) => setFormDeliveryDate(e.target.value)}
                    disabled={viewMode}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-xs text-gray-500 mb-1">备注</label>
                  <input
                    type="text"
                    value={formRemark}
                    onChange={(e) => setFormRemark(e.target.value)}
                    disabled={viewMode}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
                  />
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">明细</span>
                {!viewMode && (
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
                      className="text-primary text-sm hover:underline disabled:text-gray-400"
                    >
                      {addingStyle ? '加载中...' : '+ 添加款号'}
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-3 mb-4">
                {blocks.length === 0 && (
                  <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
                    {viewMode ? '暂无明细' : '暂无明细，请先添加款号'}
                  </div>
                )}
                {blocks.map((block: StyleBlockData) => (
                  <StyleMatrixBlock
                    key={block.styleId}
                    block={block}
                    onChange={handleMatrixChange}
                    onRemove={!viewMode ? handleRemoveStyle : undefined}
                    onToggleCollapse={handleToggleCollapse}
                    readOnly={viewMode}
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
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50"
          >取消</button>
          {!viewMode && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-4 py-1.5 bg-primary text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >{submitting ? '保存中...' : '保存'}</button>
          )}
        </div>
      </div>

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
    </div>
  );
}
