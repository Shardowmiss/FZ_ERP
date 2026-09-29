import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { retailApi } from '@client/src/api/retail';
import { baseApi } from '@client/src/api/base';
import type {
  RetailOrder,
  RetailOrderItem,
  Style,
  Sku,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import {
  Plus, Grid3X3, Eraser, Printer,
} from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import StyleMatrixBlock from '@client/src/components/StyleMatrixBlock';
import type { StyleBlockData, StyleMatrix } from '@client/src/components/StyleMatrixBlock';
import {
  buildStyleBlock,
  flattenToSkus,
  calcBlocksTotal,
} from '@client/src/components/styleMatrixUtils';
import DocPage from '@client/src/components/DocPage/DocPage';

const STATUS_MAP: Record<string, { label: string; variant: string }> = {
  draft: { label: '草稿', variant: 'bg-gray-100 text-gray-600' },
  settled: { label: '已结算', variant: 'bg-green-100 text-green-700' },
  returned: { label: '已退货', variant: 'bg-red-100 text-red-700' },
};

const SOURCE_MAP: Record<string, string> = {
  store_pos: '门店POS',
  hq_manual: '总部代开',
  mini_program: '小程序商城',
};

const PAY_METHODS = [
  { key: 'cash', label: '现金' },
  { key: 'wechat', label: '微信' },
  { key: 'alipay', label: '支付宝' },
  { key: 'bank_card', label: '银行卡' },
  { key: 'member_balance', label: '会员余额' },
];

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

interface StyleOption {
  id: string;
  styleNo: string;
  name: string;
  brand?: string;
}

const BACK_PATH = '/retail/order';

export default function RetailOrderEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const mode = searchParams.get('mode') || (isNew ? 'create' : 'view');
  const posMode = mode as 'create' | 'view' | 'settle';
  const viewOnly = posMode === 'view';

  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [posStoreId, setPosStoreId] = useState('');
  const [posSource, setPosSource] = useState('store_pos');
  const [posRemark, setPosRemark] = useState('');
  const [blocks, setBlocks] = useState<StyleBlockData[]>([]);
  const [payMethods, setPayMethods] = useState<Record<string, number>>({ wechat: 0 });

  // 款号选项
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([]);
  const [styleOptionsLoading, setStyleOptionsLoading] = useState(false);
  const [selectedStyleId, setSelectedStyleId] = useState('');

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

  const [retailNo, setRetailNo] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchStyleOptions = async (): Promise<void> => {
    setStyleOptionsLoading(true);
    try {
      const res = await baseApi.style.list({ page: 1, pageSize: 500 });
      setStyleOptions(
        res.items.map((s: Style) => ({
          id: s.id,
          styleNo: s.styleNo,
          name: s.name,
          brand: s.brand,
        })),
      );
    } catch (e) {
      logger.error('加载款号列表失败', e);
    } finally {
      setStyleOptionsLoading(false);
    }
  };

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
    fetchStyleOptions();
  }, []);

  // Load detail for edit/view/settle
  useEffect(() => {
    if (isNew) {
      setPosStoreId(storeOptions[0]?.id || '');
      setPosSource('store_pos');
      setPosRemark('');
      setBlocks([]);
      setPayMethods({ wechat: 0 });
      setSelectedStyleId('');
      return;
    }
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const detail: RetailOrder = await retailApi.get(id);
        setRetailNo(detail.retailNo);
        setStatus(detail.status);
        setPosStoreId(detail.storeId);
        setPosSource(detail.source);
        setPosRemark(detail.remark || '');
        const pm: Record<string, number> = {};
        (detail.payMethods || []).forEach((p) => {
          pm[p.method] = Number(p.amount);
        });
        if (posMode === 'settle') {
          setPayMethods({ wechat: Number(detail.receivableAmount.toFixed(2)) });
        } else {
          setPayMethods(pm);
        }

        const styleNoToId = new Map<string, string>();
        styleOptions.forEach((s: StyleOption) => {
          styleNoToId.set(s.styleNo, s.id);
        });

        const items = detail.items || [];
        const styleNoMap = new Map<string, RetailOrderItem[]>();
        for (const it of items) {
          if (!styleNoMap.has(it.styleNo)) styleNoMap.set(it.styleNo, []);
          styleNoMap.get(it.styleNo)!.push(it);
        }
        const rebuiltBlocks: StyleBlockData[] = [];
        for (const [styleNo, its] of styleNoMap.entries()) {
          const sid = styleNoToId.get(styleNo);
          if (!sid) continue;
          try {
            const skus = await baseApi.sku.byStyle(sid);
            const opt = styleOptions.find((s: StyleOption) => s.id === sid);
            const block = buildStyleBlock(
              sid,
              styleNo,
              opt?.name || styleNo,
              skus,
              'tagPrice',
              opt?.brand,
            );
            for (const it of its) {
              const color = it.color || '';
              const size = it.size || '';
              if (block.matrix[color] && block.matrix[color][size]) {
                block.matrix[color][size] = {
                  qty: it.quantity,
                  price: it.dealPrice,
                };
              }
            }
            rebuiltBlocks.push(block);
          } catch {
            // skip
          }
        }
        setBlocks(rebuiltBlocks);
      } catch (e) {
        logger.error('加载详情失败', e);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    loadDetail();
  }, [id, isNew, posMode]);

  const blockTotals = useMemo(() => calcBlocksTotal(blocks), [blocks]);

  const totals = useMemo(() => {
    const totalAmount = blockTotals.totalAmount;
    const received = Object.values(payMethods).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
    const change = Math.max(0, received - totalAmount);
    return { totalAmount: Number(totalAmount.toFixed(2)), received: Number(received.toFixed(2)), change: Number(change.toFixed(2)) };
  }, [blockTotals, payMethods]);

  const addStyleBlock = async (): Promise<void> => {
    if (!selectedStyleId) {
      toast('请选择款号');
      return;
    }
    if (blocks.some((b: StyleBlockData) => b.styleId === selectedStyleId)) {
      toast('该款号已添加');
      return;
    }
    const styleOpt = styleOptions.find((s: StyleOption) => s.id === selectedStyleId);
    if (!styleOpt) return;
    try {
      const skus: Sku[] = await baseApi.sku.byStyle(selectedStyleId);
      const block = buildStyleBlock(
        styleOpt.id,
        styleOpt.styleNo,
        styleOpt.name,
        skus,
        'tagPrice',
        styleOpt.brand,
      );
      setBlocks([...blocks, block]);
      setSelectedStyleId('');
    } catch (e) {
      logger.error('加载款号SKU失败', e);
      toast('加载款号SKU失败');
    }
  };

  const handleMatrixChange = (styleId: string, matrix: StyleMatrix): void => {
    setBlocks(blocks.map((b: StyleBlockData) =>
      b.styleId === styleId ? { ...b, matrix } : b,
    ));
  };

  const handleRemoveBlock = (styleId: string): void => {
    setBlocks(blocks.filter((b: StyleBlockData) => b.styleId !== styleId));
  };

  const handleToggleCollapse = (styleId: string): void => {
    setBlocks(blocks.map((b: StyleBlockData) =>
      b.styleId === styleId ? { ...b, collapsed: !b.collapsed } : b,
    ));
  };

  const handleClearAllBlocks = (): void => {
    const newBlocks = blocks.map((b: StyleBlockData) => {
      const newMatrix: StyleMatrix = {};
      for (const color of Object.keys(b.matrix)) {
        newMatrix[color] = {};
        for (const size of Object.keys(b.matrix[color])) {
          const cell = b.matrix[color][size];
          newMatrix[color][size] = { ...cell, qty: 0 };
        }
      }
      return { ...b, matrix: newMatrix };
    });
    setBlocks(newBlocks);
    toast('已清空所有数量');
  };

  const buildFlatItems = () => {
    const flat = flattenToSkus(blocks);
    return flat.map((f) => {
      const sku = blocks
        .find((b: StyleBlockData) => b.styleId === f.styleId)
        ?.skuList.find((s: Sku) => s.id === f.skuId);
      const tagPrice = sku?.tagPrice || 0;
      const dealPrice = f.price;
      const discountRate = tagPrice > 0 ? dealPrice / tagPrice : 1;
      return {
        skuId: f.skuId,
        skuCode: f.skuCode,
        styleNo: f.styleNo,
        color: f.color,
        size: f.size,
        quantity: f.quantity,
        tagPrice,
        dealPrice,
        discountRate: Number(discountRate.toFixed(4)),
        lineAmount: f.amount,
      };
    });
  };

  const handleSettle = async (): Promise<void> => {
    if (!posStoreId) { toast('请选择门店'); return; }
    if (blockTotals.totalQty === 0) { toast('请添加商品数量'); return; }
    const pmList = Object.entries(payMethods)
      .filter(([, v]) => Number(v) > 0)
      .map(([method, amount]) => ({ method, amount: Number(amount).toFixed(2) }));
    if (pmList.length === 0) { toast('请填写支付方式及金额'); return; }
    const totalPaid = pmList.reduce((s: number, p) => s + Number(p.amount), 0);
    if (totalPaid < totals.totalAmount) {
      toast('实收金额不能小于应收金额');
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, any> = {
        payMethods: pmList,
        receivedAmount: totals.received.toFixed(2),
        changeAmount: totals.change.toFixed(2),
      };
      await retailApi.settle(id, payload);
      toast('结算成功');
      navigate(BACK_PATH);
    } catch (e) {
      logger.error('结算失败', e);
      toast('结算失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!posStoreId) { toast('请选择门店'); return; }
    if (blockTotals.totalQty === 0) { toast('请添加商品数量'); return; }
    setSaving(true);
    try {
      const flatItems = buildFlatItems();
      const payload: Record<string, any> = {
        storeId: posStoreId,
        source: posSource,
        remark: posRemark,
        items: flatItems.map((it) => ({
          skuId: it.skuId,
          quantity: it.quantity,
          dealPrice: it.dealPrice,
        })),
      };
      await retailApi.create(payload);
      toast('创建成功');
      navigate(BACK_PATH);
    } catch (e) {
      logger.error('创建失败', e);
      toast('创建失败');
    } finally {
      setSaving(false);
    }
  };

  const openPrint = async (): Promise<void> => {
    try {
      const detail: RetailOrder = await retailApi.get(id);
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: RetailOrderItem) => ({
        styleNo: it.styleNo,
        color: it.color || '',
        size: it.size || '',
        quantity: it.quantity,
      }));
      setPrintItems(skuItems);
      setPrintDocNo(detail.retailNo);
      setPrintDocDate(detail.saleDate?.slice(0, 10) || '');
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
    <div className="flex flex-wrap gap-4 items-center">
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">门店</label>
        <select
          value={posStoreId}
          onChange={(e) => setPosStoreId(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40 disabled:bg-gray-100"
        >
          <option value="">请选择</option>
          {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">来源</label>
        <select
          value={posSource}
          onChange={(e) => setPosSource(e.target.value)}
          disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-36 disabled:bg-gray-100"
        >
          {Object.entries(SOURCE_MAP).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">收银员</label>
        <div className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32 bg-gray-50 text-gray-600">
          当前用户
        </div>
      </div>
      <div className="flex flex-col flex-1">
        <label className="text-xs text-gray-500 mb-1">备注</label>
        <input
          type="text"
          value={posRemark}
          onChange={(e) => setPosRemark(e.target.value)}
          disabled={viewOnly}
          placeholder="请输入备注"
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* 左侧款号矩阵区 */}
      <div className="flex-1 border border-gray-200 rounded-lg flex flex-col">
        <div className="p-3 border-b border-gray-200 flex items-center gap-2">
          <Grid3X3 size={16} className="text-blue-500" />
          <span className="text-sm font-medium text-gray-700">款号矩阵</span>
          {!viewOnly && blocks.length > 0 && (
            <button
              onClick={handleClearAllBlocks}
              className="ml-2 text-gray-500 hover:text-orange-600 text-xs inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-orange-50"
            >
              <Eraser size={12} /> 全部清空
            </button>
          )}
          <div className="ml-auto flex items-center gap-2 flex-1 max-w-md justify-end">
            {!viewOnly && (
              <>
                <select
                  value={selectedStyleId}
                  onChange={(e) => setSelectedStyleId(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm flex-1 max-w-xs disabled:bg-gray-100"
                  disabled={styleOptionsLoading}
                >
                  <option value="">{styleOptionsLoading ? '加载中...' : '选择款号...'}</option>
                  {styleOptions.map((s: StyleOption) => (
                    <option key={s.id} value={s.id}>
                      {s.styleNo} - {s.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={addStyleBlock}
                  className="bg-blue-500 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-600 inline-flex items-center gap-1"
                >
                  <Plus size={14} /> 添加
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[400px]">
          {blocks.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              {viewOnly ? '暂无商品明细' : '请选择款号并添加，录入商品数量'}
            </div>
          ) : (
            blocks.map((block: StyleBlockData) => (
              <StyleMatrixBlock
                key={block.styleId}
                block={block}
                onChange={handleMatrixChange}
                onRemove={viewOnly ? undefined : handleRemoveBlock}
                onToggleCollapse={handleToggleCollapse}
                readOnly={viewOnly}
                showPrice={true}
                priceLabel="零售价"
              />
            ))
          )}
        </div>
        {/* 底部合计 */}
        <div className="px-4 py-2 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-sm">
          <span className="text-gray-500">合计：</span>
          <div className="flex items-center gap-4">
            <span>共 <span className="font-semibold text-blue-600">{blockTotals.totalQty}</span> 件</span>
            <span className="font-semibold text-blue-600 text-base">
              ¥{blockTotals.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 右侧结算区 */}
      <div className="w-full lg:w-72 flex flex-col bg-gray-50 border border-gray-200 rounded-lg">
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="text-sm font-medium mb-3">支付方式</div>
          <div className="space-y-2">
            {PAY_METHODS.map((pm) => {
              const val = payMethods[pm.key] || 0;
              return (
                <div key={pm.key} className="flex items-center gap-2">
                  <label className="flex items-center gap-2 w-24 text-sm">
                    <input
                      type="checkbox"
                      checked={val > 0}
                      onChange={(e) => {
                        if (viewOnly) return;
                        const next = { ...payMethods };
                        if (e.target.checked) {
                          next[pm.key] = next[pm.key] || 0;
                        } else {
                          delete next[pm.key];
                        }
                        setPayMethods(next);
                      }}
                      disabled={viewOnly}
                      className="rounded"
                    />
                    {pm.label}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={val}
                    onChange={(e) => {
                      if (viewOnly) return;
                      setPayMethods({ ...payMethods, [pm.key]: Number(e.target.value) || 0 });
                    }}
                    disabled={viewOnly || !(val > 0)}
                    placeholder="0.00"
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm text-right disabled:bg-gray-100"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* 金额汇总 */}
        <div className="p-4 border-t border-gray-200 bg-white space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">商品总数：</span>
            <span>{blockTotals.totalQty} 件</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">应收金额：</span>
            <span className="font-semibold text-lg text-blue-600">¥{totals.totalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">实收金额：</span>
            <span>¥{totals.received.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">找零：</span>
            <span className="text-green-600">¥{totals.change.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Determine which actions to show
  let onSave: (() => void) | undefined;
  let onSubmit: (() => void) | undefined;
  let onPrint: (() => void) | undefined;
  if (!viewOnly && posMode === 'create') {
    onSave = handleSave;
  }
  if (posMode === 'settle') {
    onSubmit = handleSettle;
  }
  if (!isNew) {
    onPrint = openPrint;
  }

  return (
    <>
      <DocPage
        title={posMode === 'create' ? 'POS 开单' : posMode === 'settle' ? '零售单结算' : '零售单详情'}
        docNo={retailNo}
        status={status}
        backPath={BACK_PATH}
        viewOnly={viewOnly}
        onSave={onSave}
        onSubmit={onSubmit}
        onPrint={onPrint}
        saving={saving}
        submitting={submitting}
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
        title="零售单"
        landscape={showAllSizes || true}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="零售单"
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
