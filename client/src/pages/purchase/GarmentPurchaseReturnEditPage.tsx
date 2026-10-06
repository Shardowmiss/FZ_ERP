import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseReturn, ReturnContext, PurchaseReturnReceiver, Sku } from '@shared/api.interface';
import SkuMatrixTable, { type SkuMatrix } from '../trade-show/SkuMatrixTable';
import DocPage from '@client/src/components/DocPage/DocPage';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

interface StyleOption {
  id: string;
  styleNo: string;
  name: string;
}

interface StyleBlock {
  styleId: string;
  styleNo: string;
  styleName: string;
  skuList: Sku[];
  qtyMatrix: SkuMatrix;
  priceMap: Record<string, Record<string, number>>;
}

interface OptionItem {
  id: string;
  code: string;
  name: string;
  type?: string;
}

const BACK_PATH = '/purchase/garment-return';

const GarmentPurchaseReturnEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [ctx, setCtx] = useState<ReturnContext | null>(null);
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<OptionItem[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<OptionItem[]>([]);
  const [addedStyleId, setAddedStyleId] = useState<string>('');

  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formReceiverId, setFormReceiverId] = useState<string>('');
  const [formReceiverName, setFormReceiverName] = useState<string>('');
  const [formReturnDate, setFormReturnDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [styleBlocks, setStyleBlocks] = useState<StyleBlock[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const [returnNo, setReturnNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [viewItem, setViewItem] = useState<GarmentPurchaseReturn | null>(null);

  const isHq = ctx?.accountType === 'hq';

  // 加载退货上下文 + 选项（新增态）
  useEffect(() => {
    if (!isNew) return;
    setFormReturnDate(new Date().toISOString().slice(0, 10));
    const init = async (): Promise<void> => {
      try {
        const ctxRes = await axiosForBackend.get<ReturnContext>('/api/purchase/garment-return/return-context');
        setCtx(ctxRes.data);
        const styleRes = await baseApi.style.options();
        setStyleOptions(styleRes);
        if (ctxRes.data.accountType === 'hq') {
          const [whRes, supRes] = await Promise.all([
            baseApi.warehouse.options(),
            baseApi.supplier.options(),
          ]);
          setWarehouseOptions(whRes);
          setSupplierOptions(supRes);
        }
      } catch (e) {
        toast(errMsg(e, '加载退货上下文失败'));
      }
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew]);

  // 加载详情（查看/编辑态）
  useEffect(() => {
    if (isNew) return;
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const ret: GarmentPurchaseReturn = await garmentPurchaseApi.return.get(id);
        setViewItem(ret);
        setReturnNo(ret.returnNo);
        setStatus(ret.status);
        setFormReturnDate(ret.returnDate.slice(0, 10));
        setFormRemark(ret.remark ?? '');
        const blocks = await buildStyleBlocksFromSkus(ret.skus ?? []);
        setStyleBlocks(blocks);
      } catch (e) {
        toast(errMsg(e, '加载详情失败'));
      } finally {
        setLoading(false);
      }
    };
    void loadDetail();
  }, [id, isNew]);

  const buildStyleBlocksFromSkus = async (
    skus: {
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
    }[],
  ): Promise<StyleBlock[]> => {
    const styleIds: string[] = Array.from(new Set(skus.map((s) => s.styleId)));
    const blocks: StyleBlock[] = [];
    for (const styleId of styleIds) {
      try {
        const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
        const styleSkusFromDoc = skus.filter((s) => s.styleId === styleId);
        const qtyMatrix: SkuMatrix = {};
        const priceMap: Record<string, Record<string, number>> = {};
        for (const sku of styleSkus) {
          if (!qtyMatrix[sku.color]) qtyMatrix[sku.color] = {};
          if (!priceMap[sku.color]) priceMap[sku.color] = {};
          const existing = styleSkusFromDoc.find((s) => s.skuId === sku.id);
          qtyMatrix[sku.color][sku.size] = existing?.quantity || 0;
          priceMap[sku.color][sku.size] = existing?.price || 0;
        }
        blocks.push({
          styleId,
          styleNo: styleSkusFromDoc[0]?.styleNo || '',
          styleName: '',
          skuList: styleSkus,
          qtyMatrix,
          priceMap,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const addStyle = async (styleId: string): Promise<void> => {
    if (!styleId) return;
    if (styleBlocks.some((b) => b.styleId === styleId)) {
      toast('该款号已添加');
      setAddedStyleId('');
      return;
    }
    const opt = styleOptions.find((s) => s.id === styleId);
    try {
      const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
      const qtyMatrix: SkuMatrix = {};
      const priceMap: Record<string, Record<string, number>> = {};
      for (const sku of styleSkus) {
        if (!qtyMatrix[sku.color]) qtyMatrix[sku.color] = {};
        if (!priceMap[sku.color]) priceMap[sku.color] = {};
        qtyMatrix[sku.color][sku.size] = 0;
        priceMap[sku.color][sku.size] = 0;
      }
      setStyleBlocks((prev) => [
        ...prev,
        {
          styleId,
          styleNo: opt?.styleNo ?? '',
          styleName: opt?.name ?? '',
          skuList: styleSkus,
          qtyMatrix,
          priceMap,
        },
      ]);
    } catch (e) {
      toast(errMsg(e, '加载款号SKU失败'));
    } finally {
      setAddedStyleId('');
    }
  };

  const removeStyle = (styleId: string): void => {
    setStyleBlocks((prev) => prev.filter((b) => b.styleId !== styleId));
  };

  const handleQtyChange = (styleId: string, color: string, size: string, value: number): void => {
    setStyleBlocks((prev) =>
      prev.map((b) => {
        if (b.styleId !== styleId) return b;
        return {
          ...b,
          qtyMatrix: { ...b.qtyMatrix, [color]: { ...b.qtyMatrix[color], [size]: value || 0 } },
        };
      }),
    );
  };

  const handlePriceChange = (styleId: string, color: string, size: string, value: number): void => {
    setStyleBlocks((prev) =>
      prev.map((b) => {
        if (b.styleId !== styleId) return b;
        return {
          ...b,
          priceMap: { ...b.priceMap, [color]: { ...b.priceMap[color], [size]: value || 0 } },
        };
      }),
    );
  };

  const buildSkus = () => {
    const result: {
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
    }[] = [];
    for (const block of styleBlocks) {
      for (const sku of block.skuList) {
        const qty = block.qtyMatrix[sku.color]?.[sku.size] || 0;
        const price = block.priceMap[sku.color]?.[sku.size] || 0;
        if (qty > 0) {
          result.push({
            styleId: block.styleId,
            styleNo: block.styleNo,
            skuId: sku.id,
            color: sku.color,
            size: sku.size,
            quantity: qty,
            price,
          });
        }
      }
    }
    return result;
  };

  const buildReceiver = (): PurchaseReturnReceiver | undefined => {
    if (isHq) {
      if (!formReceiverId) return undefined;
      return { type: 'supplier', id: formReceiverId, name: formReceiverName };
    }
    const store = ctx?.receiver?.store;
    if (!store) return undefined;
    return { type: 'store', id: store.id, name: store.name };
  };

  const validateForm = (): boolean => {
    if (isHq) {
      if (!formWarehouseId) {
        toast('请选择退货店仓');
        return false;
      }
      if (!formReceiverId) {
        toast('请选择收货供应商');
        return false;
      }
    }
    if (!formReturnDate) {
      toast('请选择退货日期');
      return false;
    }
    const skus = buildSkus();
    if (skus.length === 0) {
      toast('请填写至少一行退货数量');
      return false;
    }
    return true;
  };

  const handleSave = async (): Promise<void> => {
    if (!validateForm()) return;
    const skus = buildSkus();
    const payload: Record<string, unknown> = {
      returnDate: formReturnDate,
      remark: formRemark || undefined,
      skus,
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
      await garmentPurchaseApi.return.create(payload);
      toast('保存成功');
      navigate(BACK_PATH);
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalAmount = 0;
    for (const block of styleBlocks) {
      for (const color of Object.keys(block.qtyMatrix)) {
        for (const size of Object.keys(block.qtyMatrix[color])) {
          const qty = block.qtyMatrix[color]?.[size] || 0;
          const price = block.priceMap[color]?.[size] || 0;
          totalQty += qty;
          totalAmount += qty * price;
        }
      }
    }
    return { totalQty, totalAmount };
  }, [styleBlocks]);

  const receiverLabel = (item: GarmentPurchaseReturn | null): string => {
    if (!item) return '-';
    if (item.receiverType === 'supplier') return `供应商：${item.receiverName || '-'}`;
    return `上级店仓：${item.receiverName || '-'}`;
  };

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

  const editHeaderContent = (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-4 gap-4">
        {isHq ? (
          <>
            <div>
              <label className="block text-gray-700 mb-1">退货店仓<span className="text-red-500">*</span></label>
              <select
                value={formWarehouseId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormWarehouseId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
              >
                <option value="">请选择退货店仓</option>
                {warehouseOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-gray-700 mb-1">收货供应商<span className="text-red-500">*</span></label>
              <select
                value={formReceiverId}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const sup = supplierOptions.find((o) => o.id === e.target.value);
                  setFormReceiverId(e.target.value);
                  setFormReceiverName(sup?.name ?? '');
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
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
              <label className="block text-gray-700 mb-1">退货店仓（本店仓）</label>
              <input value={ctx?.returnWarehouse?.name || '-'} readOnly className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-600" />
            </div>
            <div>
              <label className="block text-gray-700 mb-1">收货方（上级经销商店仓）</label>
              <input value={ctx?.receiver?.store?.name || '-'} readOnly className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-600" />
            </div>
          </>
        )}
        <div>
          <label className="block text-gray-700 mb-1">退货日期<span className="text-red-500">*</span></label>
          <input
            type="date"
            value={formReturnDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormReturnDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="block text-gray-700 mb-1">备注</label>
          <input
            type="text"
            value={formRemark}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormRemark(e.target.value)}
            placeholder="请输入备注"
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
      </div>
    </div>
  );

  const headerContent = viewOnly ? viewHeaderContent : editHeaderContent;

  const detailContent = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-700">明细</h2>
        {!viewOnly && (
          <div className="flex items-center gap-2">
            <select
              value={addedStyleId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAddedStyleId(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="">选择款号添加</option>
              {styleOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void addStyle(addedStyleId)}
              className="px-3 py-1.5 text-sm border border-primary text-primary rounded hover:bg-primary/5"
            >
              + 添加款号
            </button>
          </div>
        )}
      </div>

      {styleBlocks.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-300 rounded">
          {viewOnly ? '暂无款号数据' : '请选择款号添加退货明细'}
        </div>
      )}

      {styleBlocks.map((block) => (
        <div key={block.styleId} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800">{block.styleNo}</span>
              <span className="text-gray-500 text-sm">{block.styleName}</span>
              {!viewOnly && (
                <button
                  type="button"
                  onClick={() => removeStyle(block.styleId)}
                  className="ml-auto text-red-500 hover:underline text-xs"
                >
                  移除款号
                </button>
              )}
            </div>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">退货数量</div>
              <SkuMatrixTable
                skuList={block.skuList}
                matrix={block.qtyMatrix}
                onChange={(color, size, value) => handleQtyChange(block.styleId, color, size, value)}
                readOnly={viewOnly}
              />
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">单价（元）</div>
              <SkuMatrixTable
                skuList={block.skuList}
                matrix={block.priceMap}
                onChange={(color, size, value) => handlePriceChange(block.styleId, color, size, value)}
                readOnly={viewOnly}
              />
            </div>
          </div>
        </div>
      ))}

      {styleBlocks.length > 0 && (
        <div className="flex items-center justify-end gap-6 pt-2 text-sm">
          <div className="text-gray-600">
            总数量：<span className="font-medium text-gray-800 ml-1">{totals.totalQty}</span>
          </div>
          <div className="text-gray-600">
            总金额：<span className="font-medium text-primary ml-1 text-base">¥ {totals.totalAmount.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <DocPage
      title={viewOnly ? '查看成衣采购退货' : '新增成衣采购退货'}
      docNo={returnNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={!viewOnly && isNew ? handleSave : undefined}
      saving={saving}
      header={loading ? <div className="text-center py-8 text-gray-400">加载中...</div> : headerContent}
    >
      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        detailContent
      )}
    </DocPage>
  );
};

export default GarmentPurchaseReturnEditPage;
