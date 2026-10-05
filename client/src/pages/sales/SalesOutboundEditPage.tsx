import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { salesApi } from '@client/src/api/sales';
import { baseApi } from '@client/src/api/base';
import type {
  SalesOutbound,
  SalesOrder,
  SalesOrderItem,
  Warehouse,
  Style,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import { useAuth } from '@client/src/contexts/AuthContext';
import StyleMatrixBlock, {
  type StyleBlockData,
  type StyleMatrix,
} from '@client/src/components/StyleMatrixBlock';
import { buildBlocksFromItems, flattenToSkus, calcBlocksTotal } from '@client/src/components/styleMatrixUtils';
import DocPage from '@client/src/components/DocPage/DocPage';

const BACK_PATH = '/sales/outbound';

interface OutboundExtraInfo {
  orderItemId: string;
  batchNo: string;
}

interface StyleBlockExtra {
  batchNo: string;
  skuExtra: Record<string, OutboundExtraInfo>;
}

export default function SalesOutboundEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const { hasPermission } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [approvedOrders, setApprovedOrders] = useState<SalesOrder[]>([]);
  const [allStyles, setAllStyles] = useState<Style[]>([]);

  const [formOrderId, setFormOrderId] = useState('');
  const [formWarehouseId, setFormWarehouseId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [outboundNo, setOutboundNo] = useState('');
  const [status, setStatus] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [warehouseName, setWarehouseName] = useState('');

  const [blocks, setBlocks] = useState<StyleBlockData[]>([]);
  const [blockExtras, setBlockExtras] = useState<Record<string, StyleBlockExtra>>({});
  const [maxQtyMaps, setMaxQtyMaps] = useState<Record<string, Record<string, Record<string, number>>>>({});

  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printWarehouseName, setPrintWarehouseName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState(0);
  const [printRemark, setPrintRemark] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const styleNoToIdMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of allStyles) {
      map[s.styleNo] = s.id;
    }
    return map;
  }, [allStyles]);

  const styleIdToStyleMap = useMemo(() => {
    const map: Record<string, Style> = {};
    for (const s of allStyles) {
      map[s.id] = s;
    }
    return map;
  }, [allStyles]);

  // Load initial options
  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [w, orders, styles] = await Promise.all([
          baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' }),
          salesApi.order.list({ page: 1, pageSize: 1000, status: 'booked' }),
          baseApi.style.list({ page: 1, pageSize: 1000 }),
        ]);
        setWarehouses(w.items);
        setApprovedOrders(orders.items);
        setAllStyles(styles.items);
        if (isNew) {
          setFormWarehouseId(w.items[0]?.id || '');
          setFormDate(new Date().toISOString().slice(0, 10));
        }
      } catch (e: unknown) {
        logger.error('加载基础数据失败', e);
      }
    };
    void loadOpts();
  }, []);

  // Load detail for view mode
  useEffect(() => {
    if (isNew) return;
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const detail = await salesApi.outbound.get(id as string);
        setOutboundNo(detail.outboundNo);
        setStatus(detail.status);
        setCustomerName(detail.customerName);
        setWarehouseName(detail.warehouseName);
        setFormOrderId(detail.orderId);
        setFormWarehouseId(detail.warehouseId);
        setFormDate(detail.outboundDate.slice(0, 10));
        setFormRemark(detail.remark || '');

        const items = detail.items || [];
        const viewBlocks = await buildBlocksFromItems(
          items.map((it: any) => ({
            styleId: styleNoToIdMap[it.styleNo] || '',
            styleNo: it.styleNo,
            skuId: it.skuId,
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            price: it.price,
          })),
          (styleId: string) => baseApi.sku.byStyle(styleId),
        );

        const extras: Record<string, StyleBlockExtra> = {};
        for (const block of viewBlocks) {
          const skuExtra: Record<string, OutboundExtraInfo> = {};
          const blockItems = items.filter((it: any) => it.styleNo === block.styleNo);
          let firstBatchNo = '';
          for (const it of blockItems) {
            if (it.skuId) {
              skuExtra[it.skuId] = {
                orderItemId: it.orderItemId || '',
                batchNo: it.batchNo || '',
              };
              if (!firstBatchNo && it.batchNo) firstBatchNo = it.batchNo;
            }
          }
          extras[block.styleId] = { batchNo: firstBatchNo, skuExtra };
        }

        setBlocks(viewBlocks);
        setBlockExtras(extras);
        setMaxQtyMaps({});

        setPrintDocNo(detail.outboundNo);
        setPrintDocDate(detail.outboundDate.slice(0, 10));
        setPrintPartnerName(detail.customerName);
        setPrintWarehouseName(detail.warehouseName);
        setPrintTotalAmount(detail.totalAmount);
        setPrintRemark(detail.remark || '');
        setPrintItems(items.map((it: any) => ({
          styleNo: it.styleNo || it.skuCode,
          color: it.color,
          size: it.size,
          quantity: it.quantity,
        })));
      } catch (e: unknown) {
        logger.error('加载详情失败', e);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    // Wait for styles to load first
    if (allStyles.length > 0) {
      void loadDetail();
    }
  }, [id, isNew, allStyles.length]);

  const onOrderChange = async (orderId: string) => {
    setFormOrderId(orderId);
    if (!orderId) {
      setBlocks([]);
      setBlockExtras({});
      setMaxQtyMaps({});
      return;
    }
    try {
      let styleList = allStyles;
      if (styleList.length === 0) {
        const res = await baseApi.style.list({ page: 1, pageSize: 1000 });
        styleList = res.items;
        setAllStyles(res.items);
      }
      const styleNoToIdLocal: Record<string, string> = {};
      for (const s of styleList) {
        styleNoToIdLocal[s.styleNo] = s.id;
      }
      const detail = await salesApi.order.get(orderId);
      const orderItems = (detail.items || []).filter(
        (it: SalesOrderItem) => it.quantity > 0,
      );

      const byStyleNo = new Map<string, SalesOrderItem[]>();
      for (const it of orderItems) {
        if (!byStyleNo.has(it.styleNo)) byStyleNo.set(it.styleNo, []);
        byStyleNo.get(it.styleNo)!.push(it);
      }

      const newBlocks: StyleBlockData[] = [];
      const newExtras: Record<string, StyleBlockExtra> = {};
      const newMaxQtyMaps: Record<string, Record<string, Record<string, number>>> = {};

      for (const [styleNo, items] of byStyleNo.entries()) {
        const styleId = styleNoToIdLocal[styleNo];
        if (!styleId) {
          logger.warn(`未找到款号 ${styleNo} 对应的 styleId，跳过`);
          continue;
        }
        const styleInfo = styleIdToStyleMap[styleId];

        try {
          const skus = await baseApi.sku.byStyle(styleId);
          const orderSkuIds = new Set(items.map((it: SalesOrderItem) => it.skuId));
          const filteredSkus = skus.filter((s) => orderSkuIds.has(s.id));

          const matrix: StyleMatrix = {};
          const maxQtyMap: Record<string, Record<string, number>> = {};
          const skuExtra: Record<string, OutboundExtraInfo> = {};

          for (const sku of filteredSkus) {
            const orderItem = items.find((it: SalesOrderItem) => it.skuId === sku.id);
            if (!orderItem) continue;
            const availableQty = Number((orderItem.quantity - orderItem.deliveredQty).toFixed(3));

            if (!matrix[sku.color]) matrix[sku.color] = {};
            matrix[sku.color][sku.size] = {
              qty: availableQty,
              price: orderItem.price,
            };

            if (!maxQtyMap[sku.color]) maxQtyMap[sku.color] = {};
            maxQtyMap[sku.color][sku.size] = availableQty;

            skuExtra[sku.id] = {
              orderItemId: orderItem.id,
              batchNo: '',
            };
          }

          newBlocks.push({
            styleId,
            styleNo,
            styleName: styleInfo?.name || '',
            brand: styleInfo?.brand,
            skuList: filteredSkus,
            matrix,
            collapsed: false,
          });
          newExtras[styleId] = { batchNo: '', skuExtra };
          newMaxQtyMaps[styleId] = maxQtyMap;
        } catch (e) {
          logger.error(`加载款号 ${styleNo} SKU失败`, e);
        }
      }

      setBlocks(newBlocks);
      setBlockExtras(newExtras);
      setMaxQtyMaps(newMaxQtyMaps);
    } catch (e) {
      logger.error('加载订单明细失败', e);
      setBlocks([]);
      setBlockExtras({});
      setMaxQtyMaps({});
    }
  };

  const handleMatrixChange = (styleId: string, matrix: StyleMatrix) => {
    setBlocks((prev) =>
      prev.map((b) => (b.styleId === styleId ? { ...b, matrix } : b)),
    );
  };

  const handleToggleCollapse = (styleId: string) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.styleId === styleId ? { ...b, collapsed: !b.collapsed } : b,
      ),
    );
  };

  const handleBatchNoChange = (styleId: string, value: string) => {
    setBlockExtras((prev) => {
      const extra = prev[styleId];
      if (!extra) return prev;
      const newExtra: StyleBlockExtra = {
        batchNo: value,
        skuExtra: { ...extra.skuExtra },
      };
      for (const skuId of Object.keys(newExtra.skuExtra)) {
        newExtra.skuExtra[skuId] = {
          ...newExtra.skuExtra[skuId],
          batchNo: value,
        };
      }
      return { ...prev, [styleId]: newExtra };
    });
  };

  const totals = useMemo(() => calcBlocksTotal(blocks), [blocks]);

  const handleSave = async () => {
    if (saving) return;
    if (!formOrderId) { toast('请选择销售订单'); return; }
    if (!formWarehouseId) { toast('请选择仓库'); return; }
    if (!formDate) { toast('请选择出库日期'); return; }
    if (blocks.length === 0) { toast('无明细可出库'); return; }
    if (totals.totalQty <= 0) { toast('出库数量必须大于0'); return; }
    setSaving(true);
    try {
      const flatItems = flattenToSkus(blocks);
      const submitItems = flatItems
        .map((it) => {
          const extra = blockExtras[it.styleId]?.skuExtra[it.skuId];
          return {
            orderItemId: extra?.orderItemId || '',
            quantity: Number(it.quantity.toFixed(3)),
            batchNo: extra?.batchNo || undefined,
          };
        })
        .filter((it) => it.orderItemId && it.quantity > 0);

      if (submitItems.length === 0) { toast('无有效出库明细'); return; }

      await salesApi.outbound.create({
        orderId: formOrderId,
        warehouseId: formWarehouseId,
        outboundDate: formDate,
        remark: formRemark,
        items: submitItems,
      });
      toast('创建成功');
      navigate(BACK_PATH);
    } catch (e: unknown) {
      logger.error('创建失败', e);
      toast('创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = (): void => {
    const flat = flattenToSkus(blocks);
    setPrintDocNo(outboundNo);
    setPrintDocDate(formDate);
    setPrintPartnerName(customerName);
    setPrintWarehouseName(warehouseName);
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

  if (loading) {
    return <div className="p-10 text-center text-gray-400">加载中...</div>;
  }

  const pageTitle = viewOnly ? '查看销售出库' : '新增销售出库';

  const headerContent = (
    <div className="grid grid-cols-3 gap-4">
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">销售订单 <span className="text-red-500">*</span></label>
        <select
          value={formOrderId}
          onChange={(e) => { void onOrderChange(e.target.value); }}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">请选择订单</option>
          {approvedOrders.map((o: SalesOrder) => (
            <option key={o.id} value={o.id}>{o.orderNo} - {o.customerName}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">仓库 <span className="text-red-500">*</span></label>
        <select
          value={formWarehouseId}
          onChange={(e) => setFormWarehouseId(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">请选择仓库</option>
          {warehouses.map((w: Warehouse) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">出库日期 <span className="text-red-500">*</span></label>
        <input
          type="date"
          value={formDate}
          onChange={(e) => setFormDate(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        />
      </div>
      <div className="flex flex-col col-span-3">
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
      <div className="mb-2 text-sm font-medium">明细</div>
      <div className="space-y-3 mb-4">
        {blocks.length === 0 && <div className="text-center py-8 text-gray-400 border border-gray-200 rounded">暂无明细</div>}
        {blocks.map((block: StyleBlockData) => (
          <div key={block.styleId}>
            <StyleMatrixBlock
              block={block}
              onChange={handleMatrixChange}
              onToggleCollapse={handleToggleCollapse}
              readOnly={viewOnly}
              showPrice={true}
              priceLabel="成交价"
              qtyStep={0.001}
              priceStep="0.01"
              maxQtyMap={maxQtyMaps[block.styleId]}
            />
            <div className="flex items-center gap-2 mt-2 px-3">
              <label className="text-xs text-gray-500 w-16 shrink-0">批次号：</label>
              {viewOnly ? (
                <span className="text-sm text-gray-700">
                  {blockExtras[block.styleId]?.batchNo || '-'}
                </span>
              ) : (
                <input
                  type="text"
                  value={blockExtras[block.styleId]?.batchNo || ''}
                  onChange={(e) => handleBatchNoChange(block.styleId, e.target.value)}
                  placeholder="请输入本款号批次号"
                  className="border border-gray-300 rounded px-2 py-1 text-xs w-60"
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-6 text-sm border-t border-gray-200 pt-3">
        <div>
          总数量：<span className="font-semibold text-primary">{totals.totalQty.toFixed(3)}</span>
        </div>
        <div>
          总金额：<span className="font-semibold text-red-500">¥{totals.totalAmount.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );

  const showPrint = viewOnly && hasPermission('sales:outbound:print');

  return (
    <>
      <DocPage
        title={pageTitle}
        docNo={outboundNo}
        status={status}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={viewOnly ? undefined : handleSave}
        onPrint={showPrint ? handlePrint : undefined}
        header={headerContent}
        saving={saving}
      >
        {detailContent}
      </DocPage>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="销售出库单"
        landscape={printItems.length > 30}
      >
        <SkuDocPrintContent
          docType="销售出库单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerName={printPartnerName}
          warehouseName={printWarehouseName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </>
  );
}
