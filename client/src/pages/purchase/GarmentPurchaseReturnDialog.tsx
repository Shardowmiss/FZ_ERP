import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseReturn, GarmentPurchaseInbound, Sku } from '@shared/api.interface';
import SkuMatrixTable, { type SkuMatrix } from '../trade-show/SkuMatrixTable';
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

interface GarmentPurchaseReturnDialogProps {
  open: boolean;
  viewOnly: boolean;
  initialData?: GarmentPurchaseReturn;
  approvedInbounds: GarmentPurchaseInbound[];
  loadingInbounds: boolean;
  onClose: () => void;
  onSave: (data: {
    inboundId: string;
    returnDate: string;
    remark?: string;
    skus: {
      inboundSkuId: string;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
    }[];
  }) => Promise<void>;
}

const GarmentPurchaseReturnDialog: React.FC<GarmentPurchaseReturnDialogProps> = ({
  open,
  viewOnly,
  initialData,
  approvedInbounds,
  loadingInbounds,
  onClose,
  onSave,
}) => {
  const [formInboundId, setFormInboundId] = useState<string>('');
  const [formReturnDate, setFormReturnDate] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [styleBlocks, setStyleBlocks] = useState<StyleBlock[]>([]);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      void initFromData(initialData);
    } else {
      resetForm();
    }
  }, [open, initialData]);

  const resetForm = (): void => {
    setFormInboundId('');
    setFormReturnDate(new Date().toISOString().slice(0, 10));
    setFormRemark('');
    setStyleBlocks([]);
  };

  const initFromData = async (ret: GarmentPurchaseReturn): Promise<void> => {
    setFormInboundId(ret.inboundId);
    setFormReturnDate(ret.returnDate.slice(0, 10));
    setFormRemark(ret.remark ?? '');
    const blocks = await buildStyleBlocksFromSkus(ret.skus ?? []);
    setStyleBlocks(blocks);
  };

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

  const handleSave = async (): Promise<void> => {
    if (!formInboundId) {
      toast('请选择入库单');
      return;
    }
    if (!formReturnDate) {
      toast('请选择退货日期');
      return;
    }
    const skus = buildSkus();
    if (skus.length === 0) {
      toast('请填写退货数量');
      return;
    }
    const data = {
      inboundId: formInboundId,
      returnDate: formReturnDate,
      remark: formRemark || undefined,
      skus,
    };
    setSaving(true);
    try {
      await onSave(data);
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

  if (!open) return null;

  const isLoading = loadingInbounds && !viewOnly;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-lg font-medium">
            {viewOnly ? '款号退货单详情' : '新增款号退货'}
          </h3>
          <button
            className="text-gray-400 hover:text-gray-600 text-xl"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {isLoading ? (
            <div className="text-center py-12 text-gray-400">加载中...</div>
          ) : (
            <>
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
                    disabled={viewOnly}
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
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
          >取消</button>
          {!viewOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
            >保存</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GarmentPurchaseReturnDialog;
