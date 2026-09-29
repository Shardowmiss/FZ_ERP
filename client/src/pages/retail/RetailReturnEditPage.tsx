import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { retailApi } from '@client/src/api/retail';
import { baseApi } from '@client/src/api/base';
import type {
  RetailReturn,
  RetailOrder,
  RetailOrderItem,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import StyleMatrixBlock from '@client/src/components/StyleMatrixBlock';
import type { StyleBlockData, StyleMatrix } from '@client/src/components/StyleMatrixBlock';
import { calcBlocksTotal } from '@client/src/components/styleMatrixUtils';
import DocPage from '@client/src/components/DocPage/DocPage';

const RETURN_STATUS_MAP: Record<string, { label: string; variant: string }> = {
  draft: { label: '待退款', variant: 'bg-amber-100 text-amber-700' },
  refunded: { label: '已退款', variant: 'bg-green-100 text-green-700' },
  cancelled: { label: '已取消', variant: 'bg-gray-100 text-gray-600' },
};

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

interface ReturnItemForm {
  retailItemId: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  originalQty: number;
  returnQty: number;
  dealPrice: number;
  amount: number;
}

const BACK_PATH = '/retail/return';

export default function RetailReturnEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const fromOrderId = searchParams.get('fromOrder') || '';
  const viewOnly = !isNew && searchParams.get('view') === '1';
  const modalMode = isNew ? 'create' : 'view';

  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [filterStoreId, setFilterStoreId] = useState('');

  const [searchNo, setSearchNo] = useState('');
  const [searching, setSearching] = useState(false);
  const [originalOrder, setOriginalOrder] = useState<RetailOrder | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnItemForm[]>([]);
  const [returnBlocks, setReturnBlocks] = useState<StyleBlockData[]>([]);
  const [returnRemark, setReturnRemark] = useState('');
  const [maxQtyMaps, setMaxQtyMaps] = useState<Record<string, Record<string, Record<string, number>>>>({});

  // 打印状态
  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState<number | undefined>(undefined);
  const [printRemark, setPrintRemark] = useState('');
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

  const [returnNo, setReturnNo] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAllSizesByStyle = async (styleNos: string[]): Promise<Record<string, string[]>> => {
    const result: Record<string, string[]> = {};
    try {
      const allStylesRes = await baseApi.style.list({ page: 1, pageSize: 1000 });
      const sizeGroupMap = new Map<string, string>();
      for (const s of allStylesRes.items) {
        if (styleNos.includes(s.styleNo)) {
          sizeGroupMap.set(s.styleNo, s.sizeGroupId);
        }
      }
      const sizeGroupIds = Array.from(new Set(sizeGroupMap.values()));
      const sizesByGroup: Record<string, string[]> = {};
      for (const gid of sizeGroupIds) {
        try {
          const sg = await baseApi.sizeGroup.get(gid);
          sizesByGroup[gid] = sg.sizes;
        } catch (e) {
          sizesByGroup[gid] = [];
        }
      }
      for (const [styleNo, gid] of sizeGroupMap.entries()) {
        result[styleNo] = sizesByGroup[gid] || [];
      }
    } catch (e) {
      // 失败则返回空
    }
    return result;
  };

  const handleShowAllSizesChange = async (checked: boolean) => {
    setShowAllSizes(checked);
    if (checked) {
      const styleNos = Array.from(new Set(printItems.map((it: SkuMatrixItem) => it.styleNo)));
      const sizes = await loadAllSizesByStyle(styleNos);
      setAllSizesByStyle(sizes);
    } else {
      setAllSizesByStyle({});
    }
  };

  // Load stores
  useEffect(() => {
    const loadStores = async (): Promise<void> => {
      try {
        const res = await baseApi.store.options();
        setStoreOptions(res as StoreOption[]);
      } catch (e) { logger.error('加载门店失败', e); }
    };
    loadStores();
  }, []);

  // Build return blocks from items
  const buildReturnBlocks = async (items: ReturnItemForm[]): Promise<StyleBlockData[]> => {
    const blocks: StyleBlockData[] = [];
    const styleNoItemMap = new Map<string, ReturnItemForm[]>();
    for (const it of items) {
      if (!styleNoItemMap.has(it.styleNo)) styleNoItemMap.set(it.styleNo, []);
      styleNoItemMap.get(it.styleNo)!.push(it);
    }
    // Get style IDs
    try {
      const allStyles = await baseApi.style.list({ page: 1, pageSize: 1000 });
      const styleNoToId = new Map<string, { id: string; name: string; sizeGroupId: string; brand?: string }>();
      for (const s of allStyles.items) {
        styleNoToId.set(s.styleNo, { id: s.id, name: s.name, sizeGroupId: s.sizeGroupId, brand: s.brand });
      }
      const newMaxQtyMaps: Record<string, Record<string, Record<string, number>>> = {};
      for (const [styleNo, its] of styleNoItemMap.entries()) {
        const styleInfo = styleNoToId.get(styleNo);
        if (!styleInfo) continue;
        try {
          const skus = await baseApi.sku.byStyle(styleInfo.id);
          const matrix: StyleMatrix = {};
          const colorMax: Record<string, Record<string, number>> = {};
          for (const sku of skus) {
            if (!matrix[sku.color]) matrix[sku.color] = {};
            if (!colorMax[sku.color]) colorMax[sku.color] = {};
            const it = its.find((i: ReturnItemForm) => i.color === sku.color && i.size === sku.size);
            matrix[sku.color][sku.size] = {
              qty: it?.returnQty || 0,
              price: it?.dealPrice || 0,
            };
            colorMax[sku.color][sku.size] = it?.originalQty || 0;
          }
          blocks.push({
            styleId: styleInfo.id,
            styleNo,
            styleName: styleInfo.name,
            brand: styleInfo.brand,
            skuList: skus,
            matrix,
            collapsed: false,
          });
          newMaxQtyMaps[styleInfo.id] = colorMax;
        } catch {
          // skip
        }
      }
      setMaxQtyMaps(newMaxQtyMaps);
    } catch {
      // ignore
    }
    return blocks;
  };

  // Load from order if fromOrder param present
  useEffect(() => {
    if (!isNew || !fromOrderId) return;
    const loadFromOrder = async (): Promise<void> => {
      setLoading(true);
      try {
        const detail: RetailOrder = await retailApi.get(fromOrderId);
        if (detail.status !== 'settled') {
          toast('只有已结算的零售单才能退货');
          navigate(BACK_PATH);
          return;
        }
        setOriginalOrder(detail);
        const items: ReturnItemForm[] = (detail.items || []).map((it) => ({
          retailItemId: it.id,
          skuId: it.skuId,
          skuCode: it.skuCode,
          styleNo: it.styleNo || '',
          color: it.color,
          size: it.size,
          originalQty: it.quantity,
          returnQty: 0,
          dealPrice: it.dealPrice,
          amount: 0,
        }));
        setReturnItems(items);
        const blocks = await buildReturnBlocks(items);
        setReturnBlocks(blocks);
      } catch (e) {
        logger.error('加载原单失败', e);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadFromOrder();
  }, [fromOrderId, isNew]);

  // Load detail for view
  useEffect(() => {
    if (isNew) return;
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const detail: RetailReturn = await retailApi.returnGet(id);
        setReturnNo(detail.returnNo);
        setStatus(detail.status);
        setReturnRemark(detail.remark || '');
        // Build original order info
        setOriginalOrder({
          id: detail.originalRetailId,
          retailNo: detail.originalRetailNo,
          storeName: detail.storeName,
          totalAmount: detail.totalAmount,
          saleDate: detail.returnDate,
          items: (detail.items || []).map((it: any) => ({
            id: it.retailItemId,
            retailId: detail.originalRetailId,
            skuId: it.skuId,
            skuCode: it.skuCode,
            styleNo: it.styleNo || '',
            color: it.color,
            size: it.size,
            quantity: it.quantity,
            tagPrice: it.dealPrice,
            dealPrice: it.dealPrice,
            lineAmount: it.amount,
          })),
        } as RetailOrder);
        const items: ReturnItemForm[] = (detail.items || []).map((it: any) => ({
          retailItemId: it.retailItemId,
          skuId: it.skuId,
          skuCode: it.skuCode,
          styleNo: it.styleNo || '',
          color: it.color,
          size: it.size,
          originalQty: it.quantity,
          returnQty: it.quantity,
          dealPrice: it.dealPrice,
          amount: it.amount,
        }));
        setReturnItems(items);
        const blocks = await buildReturnBlocks(items);
        setReturnBlocks(blocks);
      } catch (e) {
        logger.error('加载详情失败', e);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew]);

  const totals = useMemo(() => calcBlocksTotal(returnBlocks), [returnBlocks]);

  const handleBlockChange = (styleId: string, matrix: StyleMatrix): void => {
    setReturnBlocks(returnBlocks.map((b: StyleBlockData) =>
      b.styleId === styleId ? { ...b, matrix } : b,
    ));
  };

  const handleToggleCollapse = (styleId: string): void => {
    setReturnBlocks(returnBlocks.map((b: StyleBlockData) =>
      b.styleId === styleId ? { ...b, collapsed: !b.collapsed } : b,
    ));
  };

  const searchOrder = async (): Promise<void> => {
    if (!searchNo.trim()) { toast('请输入原零售单号'); return; }
    setSearching(true);
    try {
      const res = await retailApi.list({
        keyword: searchNo.trim(),
        page: 1,
        pageSize: 10,
      });
      const order = res.items.find((it: RetailOrder) => it.retailNo === searchNo.trim());
      if (!order) {
        toast('未找到该零售单');
        setOriginalOrder(null);
        setReturnItems([]);
        setReturnBlocks([]);
        return;
      }
      const detail: RetailOrder = await retailApi.get(order.id);
      if (detail.status !== 'settled') {
        toast('只有已结算的零售单才能退货');
        return;
      }
      setOriginalOrder(detail);
      const items: ReturnItemForm[] = (detail.items || []).map((it) => ({
        retailItemId: it.id,
        skuId: it.skuId,
        skuCode: it.skuCode,
        styleNo: it.styleNo || '',
        color: it.color,
        size: it.size,
        originalQty: it.quantity,
        returnQty: 0,
        dealPrice: it.dealPrice,
        amount: 0,
      }));
      setReturnItems(items);
      const blocks = await buildReturnBlocks(items);
      setReturnBlocks(blocks);
    } catch (e) {
      logger.error('查询零售单失败', e);
      toast('查询失败');
    } finally { setSearching(false); }
  };

  const handleCreate = async (): Promise<void> => {
    if (!originalOrder) { toast('请先查询原零售单'); return; }
    const flatItems: ReturnItemForm[] = [];
    for (const block of returnBlocks) {
      for (const sku of block.skuList) {
        const cell = block.matrix[sku.color]?.[sku.size];
        const qty = cell?.qty || 0;
        if (qty > 0) {
          const origItem = returnItems.find(
            (it: ReturnItemForm) => it.skuId === sku.id ||
              (it.color === sku.color && it.size === sku.size && it.styleNo === block.styleNo),
          );
          flatItems.push({
            retailItemId: origItem?.retailItemId || '',
            skuId: sku.id,
            skuCode: sku.skuCode,
            styleNo: block.styleNo,
            color: sku.color,
            size: sku.size,
            originalQty: origItem?.originalQty || 0,
            returnQty: qty,
            dealPrice: cell?.price || 0,
            amount: Number((qty * (cell?.price || 0)).toFixed(2)),
          });
        }
      }
    }
    if (flatItems.length === 0) { toast('请选择退货商品和数量'); return; }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        originalRetailId: originalOrder.id,
        remark: returnRemark,
        items: flatItems.map((it: ReturnItemForm) => ({
          retailItemId: it.retailItemId,
          skuId: it.skuId,
          quantity: it.returnQty,
          dealPrice: it.dealPrice,
        })),
      };
      await retailApi.returnCreate(payload);
      toast('创建成功');
      navigate(BACK_PATH);
    } catch (e) {
      logger.error('创建退货单失败', e);
      toast('创建失败');
    } finally {
      setSaving(false);
    }
  };

  const openPrint = async (): Promise<void> => {
    try {
      const detail: RetailReturn = await retailApi.returnGet(id);
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: any) => ({
        styleNo: it.skuCode,
        color: it.color || '',
        size: it.size || '',
        quantity: it.quantity,
      }));
      setPrintItems(skuItems);
      setPrintDocNo(detail.returnNo);
      setPrintDocDate(detail.returnDate?.slice(0, 10) || '');
      setPrintPartnerName(detail.storeName);
      setPrintTotalAmount(detail.totalAmount);
      setPrintRemark(detail.remark || '');
      setPrintOpen(true);
    } catch (e) {
      logger.error('加载打印数据失败', e);
      toast('加载打印数据失败');
    }
  };

  const headerForm = (
    <div className="space-y-3">
      {modalMode === 'create' && (
        <div className="mb-4">
          <label className="text-xs text-gray-500 mb-1 block">原零售单号</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchNo}
              onChange={(e) => setSearchNo(e.target.value)}
              placeholder="输入原零售单号，点击查询"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm"
            />
            <button
              onClick={searchOrder}
              disabled={searching}
              className="bg-blue-500 text-white px-4 py-2 rounded text-sm hover:bg-blue-600 disabled:opacity-50"
            >{searching ? '查询中...' : '查询'}</button>
          </div>
        </div>
      )}

      {originalOrder && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
          <div className="flex justify-between mb-1">
            <span>单号：<span className="font-medium">{originalOrder.retailNo}</span></span>
            <span>门店：{originalOrder.storeName}</span>
            <span>日期：{originalOrder.saleDate?.slice(0, 10)}</span>
          </div>
          <div className="text-blue-700">
            原单总金额：¥{originalOrder.totalAmount?.toFixed(2)}
          </div>
        </div>
      )}

      {originalOrder && (
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">退货备注</label>
          <textarea
            value={returnRemark}
            onChange={(e) => setReturnRemark(e.target.value)}
            disabled={viewOnly}
            rows={2}
            placeholder="请输入退货原因/备注"
            className="border border-gray-300 rounded px-3 py-2 text-sm disabled:bg-gray-100"
          />
        </div>
      )}
    </div>
  );

  const detailContent = (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-700">退货明细</h2>

      {!originalOrder && !loading && (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-300 rounded">
          {modalMode === 'create' ? '请先查询原零售单' : '暂无数据'}
        </div>
      )}

      {originalOrder && (
        <>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">退货明细</span>
            <span className="text-sm text-gray-500">
              可退货数量不超过原单数量
            </span>
          </div>

          {returnBlocks.length > 0 && (
            <div className="space-y-3 mb-4">
              {returnBlocks.map((block: StyleBlockData) => (
                <StyleMatrixBlock
                  key={block.styleId}
                  block={block}
                  onChange={handleBlockChange}
                  onToggleCollapse={handleToggleCollapse}
                  readOnly={viewOnly}
                  showPrice={true}
                  priceLabel="成交价"
                  qtyStep={1}
                  maxQtyMap={maxQtyMaps[block.styleId]}
                />
              ))}
            </div>
          )}
          {returnBlocks.length === 0 && returnItems.length > 0 && (
            <div className="border border-gray-200 rounded p-6 mb-4 text-center text-gray-400 text-sm">
              矩阵加载中...
            </div>
          )}
          {returnBlocks.length === 0 && returnItems.length === 0 && (
            <div className="border border-gray-200 rounded p-6 mb-4 text-center text-gray-400 text-sm">
              暂无明细
            </div>
          )}

          <div className="flex justify-end text-sm mb-4">
            <div className="text-right">
              <span className="text-gray-500">总退货数量：</span>
              <span className="font-semibold mr-4">{totals.totalQty} 件</span>
              <span className="text-gray-500">预计退款金额：</span>
              <span className="text-red-600 font-semibold text-lg">-¥{totals.totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <DocPage
        title={modalMode === 'create' ? '新增退货单' : '查看退货单'}
        docNo={returnNo}
        status={status}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={modalMode === 'create' && originalOrder ? handleCreate : undefined}
        onPrint={!isNew ? openPrint : undefined}
        saving={saving}
        header={loading ? <div className="text-center py-8 text-gray-400">加载中...</div> : headerForm}
      >
        {loading ? (
          <div className="text-center py-12 text-gray-400">加载中...</div>
        ) : (
          detailContent
        )}
      </DocPage>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="零售退货单"
        landscape={showAllSizes || true}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="零售退货单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="门店"
          partnerName={printPartnerName}
          totalAmount={printTotalAmount}
          remark={printRemark}
          items={printItems}
          showAllSizes={showAllSizes}
          allSizesByStyle={allSizesByStyle}
        />
      </PrintDialog>
    </>
  );
}
