import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Trash2, Plus } from 'lucide-react';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseOrder, Sku } from '@shared/api.interface';
import GarmentSkuMatrixTable, { type SkuQtyPriceMatrix } from './GarmentSkuMatrixTable';
import DocPage from '@client/src/components/DocPage/DocPage';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

interface StyleBlock {
  styleId: string;
  styleNo: string;
  styleName: string;
  skuList: Sku[];
  qtyPriceMatrix: SkuQtyPriceMatrix;
}

const BACK_PATH = '/purchase/garment-order';

const GarmentPurchaseOrderEditPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !id || id === 'new';
  const viewOnly = searchParams.get('view') === '1';

  const [formSupplierId, setFormSupplierId] = useState<string>('');
  const [formSupplierName, setFormSupplierName] = useState<string>('');
  const [formOrderDate, setFormOrderDate] = useState<string>('');
  const [formExpectDate, setFormExpectDate] = useState<string>('');
  const [formBrand, setFormBrand] = useState<string>('');
  const [formBuyer, setFormBuyer] = useState<string>('');
  const [formRemark, setFormRemark] = useState<string>('');
  const [styleBlocks, setStyleBlocks] = useState<StyleBlock[]>([]);
  const [addStyleId, setAddStyleId] = useState<string>('');
  const [loadingStyleId, setLoadingStyleId] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const [supplierOptions, setSupplierOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [styleOptions, setStyleOptions] = useState<
    { id: string; styleNo: string; name: string }[]
  >([]);

  const [orderNo, setOrderNo] = useState<string>('');
  const [status, setStatus] = useState<string>('');

  // Load options
  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [s, st] = await Promise.all([
          baseApi.supplier.options(),
          baseApi.style.options(),
        ]);
        setSupplierOptions(s);
        setStyleOptions(st);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  // Init new form
  useEffect(() => {
    if (isNew) {
      setFormOrderDate(new Date().toISOString().slice(0, 10));
      return;
    }
    // Load detail
    const loadDetail = async (): Promise<void> => {
      setLoading(true);
      try {
        const order: GarmentPurchaseOrder = await garmentPurchaseApi.order.get(id);
        setOrderNo(order.orderNo);
        setStatus(order.status);
        setFormSupplierId(order.supplierId);
        setFormSupplierName(order.supplierName);
        setFormOrderDate(order.orderDate.slice(0, 10));
        setFormExpectDate(order.expectDate ? order.expectDate.slice(0, 10) : '');
        setFormBrand(order.brand ?? '');
        setFormBuyer(order.buyer ?? '');
        setFormRemark(order.remark ?? '');
        const skus = order.skus ?? [];
        const blocks = await buildStyleBlocksFromSkus(skus);
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
    }[],
  ): Promise<StyleBlock[]> => {
    const styleIds: string[] = Array.from(new Set(skus.map((s) => s.styleId)));
    const blocks: StyleBlock[] = [];
    for (const styleId of styleIds) {
      try {
        const styleSkus: Sku[] = await baseApi.sku.byStyle(styleId);
        const styleOpt = styleOptions.find((s) => s.id === styleId);
        const styleSkusFromOrder = skus.filter((s) => s.styleId === styleId);
        const matrix: SkuQtyPriceMatrix = {};
        for (const sku of styleSkus) {
          if (!matrix[sku.color]) matrix[sku.color] = {};
          const existing = styleSkusFromOrder.find((s) => s.skuId === sku.id);
          matrix[sku.color][sku.size] = {
            qty: existing?.quantity || 0,
            price: existing?.price || 0,
          };
        }
        blocks.push({
          styleId,
          styleNo: styleSkusFromOrder[0]?.styleNo || styleOpt?.styleNo || '',
          styleName: styleOpt?.name || '',
          skuList: styleSkus,
          qtyPriceMatrix: matrix,
        });
      } catch {
        // skip
      }
    }
    return blocks;
  };

  const handleAddStyle = async (): Promise<void> => {
    if (!addStyleId) {
      toast('请选择款号');
      return;
    }
    if (styleBlocks.some((b: StyleBlock) => b.styleId === addStyleId)) {
      toast('该款号已添加');
      return;
    }
    const styleOpt = styleOptions.find((s) => s.id === addStyleId);
    if (!styleOpt) return;
    setLoadingStyleId(addStyleId);
    try {
      const skus: Sku[] = await baseApi.sku.byStyle(addStyleId);
      const matrix: SkuQtyPriceMatrix = {};
      for (const sku of skus) {
        if (!matrix[sku.color]) matrix[sku.color] = {};
        matrix[sku.color][sku.size] = { qty: 0, price: 0 };
      }
      setStyleBlocks((prev) => [
        ...prev,
        {
          styleId: addStyleId,
          styleNo: styleOpt.styleNo,
          styleName: styleOpt.name,
          skuList: skus,
          qtyPriceMatrix: matrix,
        },
      ]);
      setAddStyleId('');
    } catch (e) {
      toast(errMsg(e, '加载SKU失败'));
    } finally {
      setLoadingStyleId('');
    }
  };

  const handleRemoveStyle = (styleId: string): void => {
    setStyleBlocks((prev) => prev.filter((b: StyleBlock) => b.styleId !== styleId));
  };

  const handleMatrixChange = (
    styleId: string,
    color: string,
    size: string,
    field: 'qty' | 'price',
    value: number,
  ): void => {
    setStyleBlocks((prev) =>
      prev.map((b: StyleBlock) => {
        if (b.styleId !== styleId) return b;
        const colorObj = b.qtyPriceMatrix[color] || {};
        const existing = colorObj[size] || { qty: 0, price: 0 };
        return {
          ...b,
          qtyPriceMatrix: {
            ...b.qtyPriceMatrix,
            [color]: { ...colorObj, [size]: { ...existing, [field]: value } },
          },
        };
      }),
    );
  };

  const buildSkus = (): {
    styleId: string;
    styleNo: string;
    skuId: string;
    color: string;
    size: string;
    quantity: number;
    price: number;
  }[] => {
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
        const cell = block.qtyPriceMatrix[sku.color]?.[sku.size];
        const qty = cell?.qty || 0;
        const price = cell?.price || 0;
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

  const validateForm = (): boolean => {
    if (!formSupplierId) {
      toast('请选择供应商');
      return false;
    }
    if (!formOrderDate) {
      toast('请选择采购日期');
      return false;
    }
    const skus = buildSkus();
    if (skus.length === 0) {
      toast('请至少录入一条SKU数量');
      return false;
    }
    return true;
  };

  const buildData = () => {
    const skus = buildSkus();
    const supplier = supplierOptions.find((s) => s.id === formSupplierId);
    return {
      supplierId: formSupplierId,
      supplierName: supplier?.name || formSupplierName,
      orderDate: formOrderDate,
      expectDate: formExpectDate || undefined,
      brand: formBrand || undefined,
      buyer: formBuyer || undefined,
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
        await garmentPurchaseApi.order.create(data);
      } else {
        await garmentPurchaseApi.order.update(id, data);
      }
      toast('保存成功');
      navigate(BACK_PATH);
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    if (!validateForm()) return;
    const data = buildData();
    setSubmitting(true);
    try {
      if (isNew) {
        const res = await garmentPurchaseApi.order.create(data);
        await garmentPurchaseApi.order.submit(res.id);
      } else {
        await garmentPurchaseApi.order.update(id, data);
        await garmentPurchaseApi.order.submit(id);
      }
      toast('提交成功');
      navigate(BACK_PATH);
    } catch (e) {
      toast(errMsg(e, '提交失败'));
    } finally {
      setSubmitting(false);
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

  const headerForm = (
    <div className="grid grid-cols-4 gap-4">
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          供应商<span className="text-red-500">*</span>
        </label>
        <select
          value={formSupplierId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            setFormSupplierId(e.target.value);
            const s = supplierOptions.find(
              (opt) => opt.id === e.target.value,
            );
            setFormSupplierName(s?.name || '');
          }}
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        >
          <option value="">请选择</option>
          {supplierOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} - {s.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          采购日期<span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          value={formOrderDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormOrderDate(e.target.value)
          }
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          预计到货日期
        </label>
        <input
          type="date"
          value={formExpectDate}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormExpectDate(e.target.value)
          }
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">品牌</label>
        <input
          type="text"
          value={formBrand}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormBrand(e.target.value)
          }
          disabled={viewOnly}
          placeholder="请输入品牌"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">采购员</label>
        <input
          type="text"
          value={formBuyer}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFormBuyer(e.target.value)
          }
          disabled={viewOnly}
          placeholder="请输入采购员"
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
        />
      </div>
      <div className="col-span-3">
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

      {!viewOnly && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-sm text-gray-700 mb-1">
              添加款号
            </label>
            <select
              value={addStyleId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setAddStyleId(e.target.value)
              }
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="">请选择款号</option>
              {styleOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.styleNo} - {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleAddStyle}
            disabled={loadingStyleId !== ''}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
          >
            <Plus size={16} /> 添加
          </button>
        </div>
      )}

      {styleBlocks.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm border border-dashed border-gray-300 rounded">
          {viewOnly ? '暂无款号数据' : '请添加款号'}
        </div>
      )}

      {styleBlocks.map((block: StyleBlock) => (
        <div
          key={block.styleId}
          className="border border-gray-200 rounded-lg overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800">
                {block.styleNo}
              </span>
              <span className="text-gray-500 text-sm">{block.styleName}</span>
            </div>
            {!viewOnly && (
              <button
                onClick={() => handleRemoveStyle(block.styleId)}
                className="text-red-500 hover:text-red-600 text-sm flex items-center gap-1"
              >
                <Trash2 size={14} /> 移除
              </button>
            )}
          </div>
          <div className="p-3">
            <GarmentSkuMatrixTable
              skuList={block.skuList}
              matrix={block.qtyPriceMatrix}
              onChange={(color, size, field, value) =>
                handleMatrixChange(block.styleId, color, size, field, value)
              }
              readOnly={viewOnly}
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
    </div>
  );

  return (
    <DocPage
      title="采购订单"
      docNo={orderNo}
      status={status}
      backPath={BACK_PATH}
      viewOnly={viewOnly}
      onSave={!viewOnly ? handleSave : undefined}
      onSubmit={!viewOnly ? handleSubmit : undefined}
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
  );
};

export default GarmentPurchaseOrderEditPage;
