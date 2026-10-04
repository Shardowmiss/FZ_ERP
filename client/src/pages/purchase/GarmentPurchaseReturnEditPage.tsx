import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseReturn, GarmentPurchaseInbound, Sku } from '@shared/api.interface';
import SkuMatrixTable, { type SkuMatrix } from '../trade-show/SkuMatrixTable';
import DocPage from '@client/src/components/DocPage/DocPage';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

interface StyleBlock {
  styleId: string;
  styleNo: string;
  styleName: string;
  skuList: Sku[];
  qtyMatrix: SkuMatrix;
  priceMap: Record<string, Record<string, number>>;
  inboundSkuIdMap: Record<string, Record<string, string>>;
}

const BACK_PATH = '/purchase/garment-return';

const GarmentPurchaseReturnEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [formInboundId, setFormInboundId] = useState<string>('');
  const [formReturnDate, setFormReturnDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [styleBlocks, setStyleBlocks] = useState<StyleBlock[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const [approvedInbounds, setApprovedInbounds] = useState<GarmentPurchaseInbound[]>([]);
  const [loadingInbounds, setLoadingInbounds] = useState<boolean>(false);

  const [returnNo, setReturnNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // Load approved inbounds for new mode
  useEffect(() => {
    if (isNew) {
      const loadInbounds = async (): Promise<void> => {
        setLoadingInbounds(true);
        try {
          const res = await garmentPurchaseApi.inbound.list({
            page: 1,
            pageSize: 100,
            status: 'approved',
          });
          setApprovedInbounds(res.items);
        } catch (e) {
          toast(errMsg(e, '加载入库单失败'));
        } finally {
          setLoadingInbounds(false);
        }
      };
      setFormReturnDate(new Date().toISOString().slice(0, 10));
      loadInbounds();
      return;
    }
    // Load detail
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const ret: GarmentPurchaseReturn = await garmentPurchaseApi.return.get(id);
        setReturnNo(ret.returnNo);
        setStatus(ret.status);
        setFormInboundId(ret.inboundId);
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
    loadDetail();
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
      inboundSkuId?: string;
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
        const inboundSkuIdMap: Record<string, Record<string, string>> = {};
        for (const sku of styleSkus) {
          if (!qtyMatrix[sku.color]) qtyMatrix[sku.color] = {};
          if (!priceMap[sku.color]) priceMap[sku.color] = {};
          if (!inboundSkuIdMap[sku.color]) inboundSkuIdMap[sku.color] = {};
          const existing = styleSkusFromDoc.find((s) => s.skuId === sku.id);
          qtyMatrix[sku.color][sku.size] = existing?.quantity || 0;
          priceMap[sku.color][sku.size] = existing?.price || 0;
          inboundSkuIdMap[sku.color][sku.size] = existing?.inboundSkuId || '';
        }
        blocks.push({
          styleId,
          styleNo: styleSkusFromDoc[0]?.styleNo || '',
          styleName: '',
          skuList: styleSkus,
          qtyMatrix,
          priceMap,
          inboundSkuIdMap,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const handleInboundChange = async (inboundId: string): Promise<void> => {
    setFormInboundId(inboundId);
    if (!inboundId) {
      setStyleBlocks([]);
      return;
    }
    try {
      const inbound = await garmentPurchaseApi.inbound.get(inboundId);
      const skusWithIds = (inbound.skus ?? []).map((s) => ({
        styleId: s.styleId,
        styleNo: s.styleNo,
        skuId: s.skuId,
        color: s.color,
        size: s.size,
        quantity: s.quantity,
        price: s.price,
        inboundSkuId: s.id,
      }));
      const blocks = await buildStyleBlocksFromSkus(skusWithIds);
      setStyleBlocks(blocks);
    } catch (e) {
      toast(errMsg(e, '加载入库单明细失败'));
    }
  };

  const handleMatrixChange = (
    styleId: string,
    color: string,
    size: string,
    value: number,
  ): void => {
    setStyleBlocks((prev) =>
      prev.map((b: StyleBlock) => {
        if (b.styleId !== styleId) return b;
        return {
          ...b,
          qtyMatrix: {
            ...b.qtyMatrix,
            [color]: { ...b.qtyMatrix[color], [size]: value || 0 },
          },
        };
      }),
    );
  };

  const buildSkus = (): {
    inboundSkuId: string;
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
  }[] => {
    const result: {
      inboundSkuId: string;
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
        const inboundSkuId = block.inboundSkuIdMap[sku.color]?.[sku.size] || '';
        if (qty > 0) {
          result.push({
            inboundSkuId,
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

  const validateForm = (): boolean => {
    if (!formInboundId) {
      toast('请选择入库单');
      return false;
    }
    if (!formReturnDate) {
      toast('请选择退货日期');
      return false;
    }
    const skus = buildSkus();
    if (skus.length === 0) {
      toast('请填写退货数量');
      return false;
    }
    return true;
  };

  const buildData = () => {
    const skus = buildSkus();
    return {
      inboundId: formInboundId,
      returnDate: formReturnDate,
      remark: formRemark || undefined,
      skus,
    };
  };

  const handleSave = async (): Promise<void> => {
    if (!validateForm()) return;
    const data = buildData();
    setSaving(true);
    try {
      if (isNew) {
        await garmentPurchaseApi.return.create(data);
      } else {
        await garmentPurchaseApi.return.create(data);
      }
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

  const isLoading = isNew && loadingInbounds;

  const headerForm = (
    <div className="grid grid-cols-4 gap-4">
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          入库单<span className="text-red-500">*</span>
        </label>
        <select
          value={formInboundId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            void handleInboundChange(e.target.value);
          }}
          disabled={viewOnly || !isNew}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">请选择</option>
          {approvedInbounds.map((i) => (
            <option key={i.id} value={i.id}>
              {i.inboundNo} - {i.supplierName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          退货日期<span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={formReturnDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormReturnDate(e.target.value)
          }
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
      <div className="col-span-2">
        <label className="block text-sm text-gray-700 mb-1">备注</label>
        <input
          type="text"
          value={formRemark}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormRemark(e.target.value)
          }
          disabled={viewOnly}
          placeholder="请输入备注"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
    </div>
  );

  const detailContent = (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-700">明细</h2>

      {styleBlocks.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-300 rounded">
          {viewOnly ? '暂无款号数据' : '请选择入库单'}
        </div>
      )}

      {styleBlocks.map((block: StyleBlock) => (
        <div
          key={block.styleId}
          className="border border-gray-200 rounded-lg overflow-hidden"
        >
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800">
                {block.styleNo}
              </span>
              <span className="text-gray-500 text-sm">{block.styleName}</span>
              <span className="text-xs text-gray-500 ml-auto">
                单价从入库单带入，不可修改
              </span>
            </div>
          </div>
          <div className="p-3">
            <SkuMatrixTable
              skuList={block.skuList}
              matrix={block.qtyMatrix}
              onChange={(color, size, value) =>
                handleMatrixChange(block.styleId, color, size, value)
              }
              readOnly={viewOnly}
            />
            <div className="mt-2 text-xs text-gray-500">
              单价参考：
              {block.skuList.slice(0, 3).map((sku: Sku) => (
                <span key={sku.id} className="mr-3">
                  {sku.color}/{sku.size}: ¥{(block.priceMap[sku.color]?.[sku.size] || 0).toFixed(2)}
                </span>
              ))}
            </div>
          </div>
        </div>
      ))}

      {styleBlocks.length > 0 && (
        <div className="flex items-center justify-end gap-6 pt-2 text-sm">
          <div className="text-gray-600">
            总数量：
            <span className="font-medium text-gray-800 ml-1">
              {totals.totalQty}
            </span>
          </div>
          <div className="text-gray-600">
            总金额：
            <span className="font-medium text-blue-600 ml-1 text-base">
              ¥ {totals.totalAmount.toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <DocPage
      title="采购退货"
      docNo={returnNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={!viewOnly && isNew ? handleSave : undefined}
      saving={saving}
      header={loading || isLoading ? <div className="text-center py-8 text-gray-400">加载中...</div> : headerForm}
    >
      {loading || isLoading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : (
        detailContent
      )}
    </DocPage>
  );
};

export default GarmentPurchaseReturnEditPage;
