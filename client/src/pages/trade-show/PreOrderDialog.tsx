import React, { useState, useEffect, useMemo } from 'react';
import { baseApi } from '@client/src/api';
import type { PreOrder, PreOrderItem, Sku } from '@shared/api.interface';
import { toast } from 'sonner';
import { Printer } from 'lucide-react';
import SkuMatrixTable, { type SkuMatrix } from './SkuMatrixTable';
import { errMsg } from '@/utils/errMsg';

interface PreOrderDialogProps {
  open: boolean;
  viewMode: boolean;
  editingId: string | null;
  tradeShowOptions: { id: string; showNo: string; name: string; status: string }[];
  styleOptions: { id: string; styleNo: string; name: string }[];
  initialData?: PreOrder;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
  onPrint?: () => void;
}

const PreOrderDialog: React.FC<PreOrderDialogProps> = ({
  open,
  viewMode,
  editingId,
  tradeShowOptions,
  styleOptions,
  initialData,
  onClose,
  onSave,
  onPrint,
}) => {
  const [formTradeShowId, setFormTradeShowId] = useState('');
  const [formSubmitterType, setFormSubmitterType] = useState<
    'dealer' | 'store'
  >('dealer');
  const [formSubmitterId, setFormSubmitterId] = useState('');
  const [formStyleId, setFormStyleId] = useState('');
  const [formRemark, setFormRemark] = useState('');
  const [skuList, setSkuList] = useState<Sku[]>([]);
  const [matrix, setMatrix] = useState<SkuMatrix>({});
  const [dealerOptions, setDealerOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [storeOptions, setStoreOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [loadingSkus, setLoadingSkus] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setFormTradeShowId(initialData.tradeShowId);
      const type = (initialData.submitterType as 'dealer' | 'store') || 'dealer';
      setFormSubmitterType(type);
      setFormSubmitterId(
        type === 'dealer'
          ? initialData.dealerId || ''
          : initialData.storeId || '',
      );
      setFormStyleId(initialData.styleId || '');
      setFormRemark(initialData.remark || '');
      loadSubmitterOptions(type);
      if (initialData.styleId) {
        loadSkusWithItems(initialData.styleId, initialData.items);
      } else {
        setSkuList([]);
        setMatrix({});
      }
    } else {
      setFormTradeShowId('');
      setFormSubmitterType('dealer');
      setFormSubmitterId('');
      setFormStyleId('');
      setFormRemark('');
      setSkuList([]);
      setMatrix({});
      loadSubmitterOptions('dealer');
    }
  }, [open, initialData]);

  const loadSubmitterOptions = async (type: 'dealer' | 'store') => {
    try {
      if (type === 'dealer' && dealerOptions.length === 0) {
        const res = await baseApi.dealer.options();
        setDealerOptions(res);
      }
      if (type === 'store' && storeOptions.length === 0) {
        const res = await baseApi.store.options();
        setStoreOptions(res);
      }
    } catch (e) {
      toast(errMsg(e, '加载提交方选项失败'));
    }
  };

  const loadSkusWithItems = async (
    styleId: string,
    items?: PreOrderItem[],
  ) => {
    setLoadingSkus(true);
    try {
      const skus = await baseApi.sku.byStyle(styleId);
      setSkuList(skus);
      const m: SkuMatrix = {};
      for (const sku of skus) {
        if (!m[sku.color]) m[sku.color] = {};
        const existing = items?.find((it) => it.skuId === sku.id);
        m[sku.color][sku.size] = existing?.qty || 0;
      }
      setMatrix(m);
    } catch (e) {
      toast(errMsg(e, '加载SKU失败'));
    } finally {
      setLoadingSkus(false);
    }
  };

  const handleStyleChange = async (styleId: string) => {
    setFormStyleId(styleId);
    if (!styleId) {
      setSkuList([]);
      setMatrix({});
      return;
    }
    setLoadingSkus(true);
    try {
      const skus = await baseApi.sku.byStyle(styleId);
      setSkuList(skus);
      const m: SkuMatrix = {};
      for (const sku of skus) {
        if (!m[sku.color]) m[sku.color] = {};
        m[sku.color][sku.size] = 0;
      }
      setMatrix(m);
    } catch (e) {
      toast(errMsg(e, '加载SKU失败'));
    } finally {
      setLoadingSkus(false);
    }
  };

  const handleSubmitterTypeChange = (type: 'dealer' | 'store') => {
    setFormSubmitterType(type);
    setFormSubmitterId('');
    loadSubmitterOptions(type);
  };

  const handleMatrixChange = (color: string, size: string, value: number) => {
    setMatrix((prev) => ({
      ...prev,
      [color]: { ...prev[color], [size]: value || 0 },
    }));
  };

  const totalQty = useMemo(() => {
    let sum = 0;
    for (const color of Object.keys(matrix)) {
      for (const size of Object.keys(matrix[color])) {
        sum += matrix[color][size] || 0;
      }
    }
    return sum;
  }, [matrix]);

  const buildItems = (): { skuId: string; qty: number }[] => {
    const items: { skuId: string; qty: number }[] = [];
    for (const sku of skuList) {
      const qty = matrix[sku.color]?.[sku.size] || 0;
      if (qty > 0) items.push({ skuId: sku.id, qty });
    }
    return items;
  };

  const handleSave = async () => {
    if (!formTradeShowId) {
      toast('请选择订货会');
      return;
    }
    if (!formSubmitterId) {
      toast('请选择提交方');
      return;
    }
    if (!formStyleId) {
      toast('请选择款号');
      return;
    }
    const items = buildItems();
    const data: any = {
      tradeShowId: formTradeShowId,
      submitterType: formSubmitterType,
      styleId: formStyleId,
      remark: formRemark,
      items,
    };
    if (formSubmitterType === 'dealer') {
      data.dealerId = formSubmitterId;
    } else {
      data.storeId = formSubmitterId;
    }
    setSaving(true);
    try {
      await onSave(data);
    } finally {
      setSaving(false);
    }
  };

  const submitterOptions =
    formSubmitterType === 'dealer' ? dealerOptions : storeOptions;

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-medium">
              {viewMode
                ? '预订单明细'
                : editingId
                  ? '编辑预订单'
                  : '新增预订单'}
            </h3>
            {viewMode && onPrint && (
              <button
                className="text-primary hover:text-blue-600 text-sm flex items-center gap-1"
                onClick={onPrint}
              >
                <Printer size={14} />
                打印
              </button>
            )}
          </div>
          <button
            className="text-gray-400 hover:text-gray-600 text-xl"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-700 mb-1">
                订货会<span className="text-red-500">*</span>
              </label>
              <select
                value={formTradeShowId}
                onChange={(e) => setFormTradeShowId(e.target.value)}
                disabled={viewMode}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="">请选择</option>
                {tradeShowOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.showNo} - {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">
                提交方类型<span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={formSubmitterType === 'dealer'}
                    onChange={() => handleSubmitterTypeChange('dealer')}
                    disabled={viewMode}
                    className="mr-1"
                  />
                  经销商
                </label>
                <label className="flex items-center text-sm cursor-pointer">
                  <input
                    type="radio"
                    checked={formSubmitterType === 'store'}
                    onChange={() => handleSubmitterTypeChange('store')}
                    disabled={viewMode}
                    className="mr-1"
                  />
                  直营店
                </label>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">
                提交方<span className="text-red-500">*</span>
              </label>
              <select
                value={formSubmitterId}
                onChange={(e) => setFormSubmitterId(e.target.value)}
                disabled={viewMode}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="">请选择</option>
                {submitterOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} - {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">
                款号<span className="text-red-500">*</span>
              </label>
              <select
                value={formStyleId}
                onChange={(e) => handleStyleChange(e.target.value)}
                disabled={viewMode}
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-50 disabled:text-gray-500"
              >
                <option value="">请选择</option>
                {styleOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.styleNo} - {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-700 font-medium">
                SKU 预订矩阵
              </label>
              <span className="text-sm text-blue-600 font-medium">
                合计：{totalQty} 件
              </span>
            </div>
            <SkuMatrixTable
              skuList={skuList}
              matrix={matrix}
              onChange={handleMatrixChange}
              readOnly={viewMode}
              loading={loadingSkus}
              emptyText={
                formStyleId ? '该款号暂无SKU' : '请先选择款号以加载SKU矩阵'
              }
            />
          </div>

          <div>
            <label className="block text-sm text-gray-700 mb-1">备注</label>
            <textarea
              value={formRemark}
              onChange={(e) => setFormRemark(e.target.value)}
              rows={2}
              disabled={viewMode}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary resize-none disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
          <button
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
            onClick={onClose}
          >
            {viewMode ? '关闭' : '取消'}
          </button>
          {!viewMode && (
            <button
              className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreOrderDialog;
