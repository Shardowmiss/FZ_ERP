import React, { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseInbound, GarmentPurchaseOrder, Sku } from '@shared/api.interface';
import GarmentSkuMatrixTable, { type SkuQtyPriceMatrix } from './GarmentSkuMatrixTable';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

interface StyleBlock {
  styleId: string;
  styleNo: string;
  styleName: string;
  skuList: Sku[];
  qtyPriceMatrix: SkuQtyPriceMatrix;
  orderSkuIdMap: Record<string, Record<string, string>>;
}

interface GarmentPurchaseInboundDialogProps {
  open: boolean;
  viewOnly: boolean;
  initialData?: GarmentPurchaseInbound;
  warehouseOptions: { id: string; code: string; name: string }[];
  approvedOrders: GarmentPurchaseOrder[];
  loadingOrders: boolean;
  onClose: () => void;
  onSave: (data: {
    orderId: string;
    warehouseId: string;
    warehouseName: string;
    inboundDate: string;
    remark?: string;
    skus: {
      orderSkuId: string;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
    }[];
  }) => Promise<void>;
  onOrderChange?: (orderId: string) => void;
}

const GarmentPurchaseInboundDialog: React.FC<GarmentPurchaseInboundDialogProps> = ({
  open,
  viewOnly,
  initialData,
  warehouseOptions,
  approvedOrders,
  loadingOrders,
  onClose,
  onSave,
  onOrderChange,
}) => {
  const [formOrderId, setFormOrderId] = useState<string>('');
  const [formWarehouseId, setFormWarehouseId] = useState<string>('');
  const [formInboundDate, setFormInboundDate] = useState<string>('');
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
    setFormOrderId('');
    setFormWarehouseId('');
    setFormInboundDate(new Date().toISOString().slice(0, 10));
    setFormRemark('');
    setStyleBlocks([]);
  };

  const initFromData = async (inbound: GarmentPurchaseInbound): Promise<void> => {
    setFormOrderId(inbound.orderId);
    setFormWarehouseId(inbound.warehouseId);
    setFormInboundDate(inbound.inboundDate.slice(0, 10));
    setFormRemark(inbound.remark ?? '');
    const blocks = await buildStyleBlocksFromSkus(inbound.skus ?? []);
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
      id?: string;
    }[],
  ): Promise<StyleBlock[]> => {
    const styleIds: string[] = Array.from(new Set(skus.map((s) => s.styleId)));
    const blocks: StyleBlock[] = [];
    for (const styleId of styleIds) {
      try {
        const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
        const styleSkusFromDoc = skus.filter((s) => s.styleId === styleId);
        const matrix: SkuQtyPriceMatrix = {};
        const orderSkuIdMap: Record<string, Record<string, string>> = {};
        for (const sku of styleSkus) {
          if (!matrix[sku.color]) matrix[sku.color] = {};
          if (!orderSkuIdMap[sku.color]) orderSkuIdMap[sku.color] = {};
          const existing = styleSkusFromDoc.find((s) => s.skuId === sku.id);
          matrix[sku.color][sku.size] = {
            qty: existing?.quantity || 0,
            price: existing?.price || 0,
          };
          orderSkuIdMap[sku.color][sku.size] = existing?.id || '';
        }
        blocks.push({
          styleId,
          styleNo: styleSkusFromDoc[0]?.styleNo || '',
          styleName: '',
          skuList: styleSkus,
          qtyPriceMatrix: matrix,
          orderSkuIdMap,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const handleOrderChange = async (orderId: string): Promise<void> => {
    setFormOrderId(orderId);
    onOrderChange?.(orderId);
    if (!orderId) {
      setStyleBlocks([]);
      return;
    }
    try {
      const order = await garmentPurchaseApi.order.get(orderId);
      const blocks = await buildFromOrderSkus(order.skus ?? []);
      setStyleBlocks(blocks);
    } catch (e) {
      toast(errMsg(e, '加载订单明细失败'));
    }
  };

  const buildFromOrderSkus = async (
    skus: {
      id: string;
      styleId: string;
      styleNo: string;
      skuId: string;
      color: string;
      size: string;
      quantity: number;
      price: number;
      receivedQty: number;
    }[],
  ): Promise<StyleBlock[]> => {
    const styleIds: string[] = Array.from(new Set(skus.map((s) => s.styleId)));
    const blocks: StyleBlock[] = [];
    for (const styleId of styleIds) {
      try {
        const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
        const orderStyleSkus = skus.filter((s) => s.styleId === styleId);
        const matrix: SkuQtyPriceMatrix = {};
        const orderSkuIdMap: Record<string, Record<string, string>> = {};
        for (const sku of styleSkus) {
          if (!matrix[sku.color]) matrix[sku.color] = {};
          if (!orderSkuIdMap[sku.color]) orderSkuIdMap[sku.color] = {};
          const existing = orderStyleSkus.find((s) => s.skuId === sku.id);
          const remaining = existing
            ? Math.max(0, existing.quantity - existing.receivedQty)
            : 0;
          matrix[sku.color][sku.size] = {
            qty: remaining,
            price: existing?.price || 0,
          };
          orderSkuIdMap[sku.color][sku.size] = existing?.id || '';
        }
        blocks.push({
          styleId,
          styleNo: orderStyleSkus[0]?.styleNo || '',
          styleName: '',
          skuList: styleSkus,
          qtyPriceMatrix: matrix,
          orderSkuIdMap,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const handleMatrixChange = (
    styleId: string,
    color: string,
    size: string,
    field: 'qty' | 'price',
    value: number,
  ): void => {
    if (field === 'price') return;
    setStyleBlocks((prev) =>
      prev.map((b: StyleBlock) => {
        if (b.styleId !== styleId) return b;
        const colorObj = b.qtyPriceMatrix[color] || {};
        const existing = colorObj[size] || { qty: 0, price: 0 };
        return {
          ...b,
          qtyPriceMatrix: {
            ...b.qtyPriceMatrix,
            [color]: { ...colorObj, [size]: { ...existing, qty: value } },
          },
        };
      }),
    );
  };

  const buildSkus = (): {
    orderSkuId: string;
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
  }[] => {
    const result: {
      orderSkuId: string;
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
        const cell = block.qtyPriceMatrix[sku.color]?.[sku.size];
        const qty = cell?.qty || 0;
        const price = cell?.price || 0;
        const orderSkuId = block.orderSkuIdMap[sku.color]?.[sku.size] || '';
        if (qty > 0) {
          result.push({
            orderSkuId,
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
    if (!formOrderId) {
      toast('请选择采购订单');
      return;
    }
    if (!formWarehouseId) {
      toast('请选择仓库');
      return;
    }
    if (!formInboundDate) {
      toast('请选择入库日期');
      return;
    }
    const skus = buildSkus();
    if (skus.length === 0) {
      toast('请填写入库数量');
      return;
    }
    const warehouse = warehouseOptions.find((w) => w.id === formWarehouseId);
    const data = {
      orderId: formOrderId,
      warehouseId: formWarehouseId,
      warehouseName: warehouse?.name || '',
      inboundDate: formInboundDate,
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
      for (const color of Object.keys(block.qtyPriceMatrix)) {
        for (const size of Object.keys(block.qtyPriceMatrix[color])) {
          const cell = block.qtyPriceMatrix[color][size];
          totalQty += cell?.qty || 0;
          totalAmount += (cell?.qty || 0) * (cell?.price || 0);
        }
      }
    }
    return { totalQty, totalAmount };
  }, [styleBlocks]);

  if (!open) return null;

  const isLoading = loadingOrders && !viewOnly;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="text-lg font-medium">
            {viewOnly ? '款号入库单详情' : '新增款号入库'}
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
                    采购订单<span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formOrderId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                      void handleOrderChange(e.target.value);
                    }}
                    disabled={viewOnly}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    <option value="">请选择</option>
                    {approvedOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.orderNo} - {o.supplierName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    仓库<span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formWarehouseId}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                      setFormWarehouseId(e.target.value)
                    }
                    disabled={viewOnly}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    <option value="">请选择</option>
                    {warehouseOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} - {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    入库日期<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={formInboundDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setFormInboundDate(e.target.value)
                    }
                    disabled={viewOnly}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
                <div>
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
                  {viewOnly ? '暂无款号数据' : '请选择采购订单'}
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
                        单价从采购单带入，不可修改
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <GarmentSkuMatrixTable
                      skuList={block.skuList}
                      matrix={block.qtyPriceMatrix}
                      onChange={(color, size, field, value) =>
                        handleMatrixChange(block.styleId, color, size, field, value)
                      }
                      readOnly={viewOnly}
                      showPrice={true}
                    />
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

export default GarmentPurchaseInboundDialog;
