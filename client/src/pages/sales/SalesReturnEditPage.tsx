import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { salesApi } from '@client/src/api/sales';
import { baseApi } from '@client/src/api/base';
import type {
  SalesReturn,
  SalesOutbound,
  SalesOutboundItem,
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

const BACK_PATH = '/sales/return';

export default function SalesReturnEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const { hasPermission } = useAuth();
  const [approvedOutbounds, setApprovedOutbounds] = useState<SalesOutbound[]>([]);
  const [allStyles, setAllStyles] = useState<Style[]>([]);

  const [formOutboundId, setFormOutboundId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [returnNo, setReturnNo] = useState('');
  const [status, setStatus] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [warehouseName, setWarehouseName] = useState('');

  const [blocks, setBlocks] = useState<StyleBlockData[]>([]);
  const [maxQtyMap, setMaxQtyMap] = useState<Record<string, Record<string, Record<string, number>>>>({});
  const [outboundItemIdMap, setOutboundItemIdMap] = useState<Record<string, Record<string, Record<string, string>>>>({});

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

  // Load initial options
  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [outbounds, styles] = await Promise.all([
          salesApi.outbound.list({ page: 1, pageSize: 1000, status: 'booked' }),
          baseApi.style.list({ page: 1, pageSize: 1000 }),
        ]);
        setApprovedOutbounds(outbounds.items);
        setAllStyles(styles.items);
        if (isNew) {
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
        const styleList = allStyles.length > 0 ? allStyles : (await baseApi.style.list({ page: 1, pageSize: 1000 })).items;
        const detail = await salesApi.return.get(id as string);
        setReturnNo(detail.returnNo);
        setStatus(detail.status);
        setCustomerName(detail.customerName);
        setWarehouseName(detail.warehouseName);
        setFormOutboundId(detail.outboundId);
        setFormDate(detail.returnDate.slice(0, 10));
        setFormRemark(detail.remark || '');

        const styleNoIdMap = new Map<string, string>();
        for (const s of styleList) {
          styleNoIdMap.set(s.styleNo, s.id);
        }

        const rawItems = detail.items || [];
        const viewItems = rawItems.map((it: any) => ({
          styleId: styleNoIdMap.get(it.styleNo || '') || '',
          styleNo: it.styleNo || it.skuCode || '',
          skuId: it.skuId,
          color: it.color,
          size: it.size,
          quantity: it.quantity,
          price: it.price,
        }));

        const viewBlocks = await buildBlocksFromItems(
          viewItems,
          (styleId: string) => baseApi.sku.byStyle(styleId),
          (item) => item.styleId || styleNoIdMap.get(item.styleNo) || '',
        );
        for (const blk of viewBlocks) {
          const styleInfo = styleList.find((s: Style) => s.id === blk.styleId);
          if (styleInfo) {
            blk.styleName = styleInfo.name || '';
            if (styleInfo.brand) blk.brand = styleInfo.brand;
          }
        }
        setBlocks(viewBlocks);
        setMaxQtyMap({});
        setOutboundItemIdMap({});

        setPrintDocNo(detail.returnNo);
        setPrintDocDate(detail.returnDate.slice(0, 10));
        setPrintPartnerName(detail.customerName);
        setPrintWarehouseName(detail.warehouseName);
        setPrintTotalAmount(detail.totalAmount);
        setPrintRemark(detail.remark || '');
        setPrintItems(rawItems.map((it: any) => ({
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
    void loadDetail();
  }, [id, isNew]);

  const onOutboundChange = async (outboundId: string) => {
    setFormOutboundId(outboundId);
    if (!outboundId) {
      setBlocks([]);
      setMaxQtyMap({});
      setOutboundItemIdMap({});
      return;
    }
    try {
      const styleList = allStyles.length > 0 ? allStyles : (await baseApi.style.list({ page: 1, pageSize: 1000 })).items;
      const detail = await salesApi.outbound.get(outboundId);
      const items: SalesOutboundItem[] = detail.items || [];
      if (items.length === 0) {
        setBlocks([]);
        setMaxQtyMap({});
        setOutboundItemIdMap({});
        return;
      }

      const styleNoIdMap = new Map<string, string>();
      for (const s of styleList) {
        styleNoIdMap.set(s.styleNo, s.id);
      }

      const byStyleNo = new Map<string, SalesOutboundItem[]>();
      for (const it of items) {
        const styleNo = it.styleNo || it.skuCode;
        if (!byStyleNo.has(styleNo)) byStyleNo.set(styleNo, []);
        byStyleNo.get(styleNo)!.push(it);
      }

      const newBlocks: StyleBlockData[] = [];
      const newMaxQtyMap: Record<string, Record<string, Record<string, number>>> = {};
      const newOutboundItemIdMap: Record<string, Record<string, Record<string, string>>> = {};

      for (const [styleNo, styleItems] of byStyleNo.entries()) {
        const styleId = styleNoIdMap.get(styleNo);
        if (!styleId) {
          logger.warn(`未找到款号 ${styleNo} 对应的 styleId，跳过`);
          continue;
        }
        try {
          const skus = await baseApi.sku.byStyle(styleId);
          const matrix: StyleMatrix = {};
          const colorMax: Record<string, Record<string, number>> = {};
          const colorItemId: Record<string, Record<string, string>> = {};

          for (const sku of skus) {
            if (!matrix[sku.color]) matrix[sku.color] = {};
            matrix[sku.color][sku.size] = { qty: 0, price: Number(sku.supplyPrice) || 0 };
          }
          for (const it of styleItems) {
            if (!matrix[it.color]) matrix[it.color] = {};
            if (!matrix[it.color][it.size]) {
              matrix[it.color][it.size] = { qty: 0, price: it.price };
            } else {
              matrix[it.color][it.size].price = it.price;
            }
            if (!colorMax[it.color]) colorMax[it.color] = {};
            colorMax[it.color][it.size] = it.quantity;
            if (!colorItemId[it.color]) colorItemId[it.color] = {};
            colorItemId[it.color][it.size] = it.id;
          }

          const styleInfo = allStyles.find((s: Style) => s.id === styleId);
          newBlocks.push({
            styleId,
            styleNo,
            styleName: styleInfo?.name || '',
            brand: styleInfo?.brand,
            skuList: skus,
            matrix,
            collapsed: false,
          });
          newMaxQtyMap[styleId] = colorMax;
          newOutboundItemIdMap[styleId] = colorItemId;
        } catch (e) {
          logger.error(`加载款号 ${styleNo} SKU失败`, e);
        }
      }

      setBlocks(newBlocks);
      setMaxQtyMap(newMaxQtyMap);
      setOutboundItemIdMap(newOutboundItemIdMap);
    } catch (e) {
      logger.error('加载出库单明细失败', e);
      setBlocks([]);
      setMaxQtyMap({});
      setOutboundItemIdMap({});
    }
  };

  const handleMatrixChange = (styleId: string, matrix: StyleMatrix) => {
    setBlocks((prev: StyleBlockData[]) =>
      prev.map((blk: StyleBlockData) =>
        blk.styleId === styleId ? { ...blk, matrix } : blk,
      ),
    );
  };

  const handleToggleCollapse = (styleId: string) => {
    setBlocks((prev: StyleBlockData[]) =>
      prev.map((blk: StyleBlockData) =>
        blk.styleId === styleId ? { ...blk, collapsed: !blk.collapsed } : blk,
      ),
    );
  };

  const totals = useMemo(() => calcBlocksTotal(blocks), [blocks]);

  const handleSave = async () => {
    if (saving) return;
    if (!formOutboundId) { toast('请选择出库单'); return; }
    if (!formDate) { toast('请选择退货日期'); return; }
    const flatSkus = flattenToSkus(blocks);
    if (flatSkus.length === 0) { toast('请填写退货数量'); return; }
    const submitItems = flatSkus
      .map((it) => {
        const outboundItemId = outboundItemIdMap[it.styleId]?.[it.color]?.[it.size];
        if (!outboundItemId) return null;
        return {
          outboundItemId,
          quantity: Number(it.quantity.toFixed(3)),
        };
      })
      .filter(Boolean) as { outboundItemId: string; quantity: number }[];
    if (submitItems.length === 0) { toast('请填写退货数量'); return; }
    setSaving(true);
    try {
      await salesApi.return.create({
        outboundId: formOutboundId,
        returnDate: formDate,
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
    setPrintDocNo(returnNo);
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

  const pageTitle = viewOnly ? '查看销售退货' : '新增销售退货';

  const headerContent = (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">出库单 <span className="text-red-500">*</span></label>
        <select
          value={formOutboundId}
          onChange={(e) => { void onOutboundChange(e.target.value); }}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        >
          <option value="">请选择出库单</option>
          {approvedOutbounds.map((o: SalesOutbound) => (
            <option key={o.id} value={o.id}>{o.outboundNo} - {o.customerName}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">退货日期 <span className="text-red-500">*</span></label>
        <input
          type="date"
          value={formDate}
          onChange={(e) => setFormDate(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        />
      </div>
      <div className="flex flex-col col-span-2">
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
        {blocks.length === 0 && (
          <div className="border border-gray-200 rounded-lg p-8 text-center text-gray-400 text-sm">
            暂无明细，请先选择出库单
          </div>
        )}
        {blocks.map((blk: StyleBlockData) => (
          <StyleMatrixBlock
            key={blk.styleId}
            block={blk}
            onChange={handleMatrixChange}
            onToggleCollapse={handleToggleCollapse}
            readOnly={viewOnly}
            showPrice={true}
            priceLabel="成交价"
            qtyStep={1}
            maxQtyMap={maxQtyMap[blk.styleId]}
          />
        ))}
      </div>
      <div className="text-right text-sm space-x-6">
        <span>总数量：<span className="font-semibold">{totals.totalQty}</span></span>
        <span>总金额：<span className="font-semibold text-red-500">¥{totals.totalAmount.toFixed(2)}</span></span>
      </div>
    </div>
  );

  const showPrint = viewOnly && hasPermission('sales:return:print');

  return (
    <>
      <DocPage
        title={pageTitle}
        docNo={returnNo}
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
        title="销售退货单"
        landscape={printItems.length > 30}
      >
        <SkuDocPrintContent
          docType="销售退货单"
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
