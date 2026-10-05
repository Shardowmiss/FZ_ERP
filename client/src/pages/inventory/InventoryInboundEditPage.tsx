import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import DocPage from '@/components/DocPage/DocPage';
import { errMsg } from '@/utils/errMsg';

const InventoryInboundEditPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const viewOnly = searchParams.get('view') === 'true' || !!id;

  const [formData, setFormData] = useState({
    warehouseId: '',
    inboundType: 'production_finished',
    inboundDate: new Date().toISOString().split('T')[0],
    remark: '',
    itemType: 'finished',
    items: [] as any[],
  });
  const [warehouseOptions, setWarehouseOptions] = useState<any[]>([]);
  const [skuOptions, setSkuOptions] = useState<any[]>([]);
  const [materialOptions, setMaterialOptions] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const backPath = '/inventory/inbound';

  useEffect(() => {
    loadWarehouses();
  }, []);

  useEffect(() => {
    if (formData.itemType === 'finished') {
      loadSkus();
    } else {
      loadMaterials();
    }
  }, [formData.itemType]);

  const loadWarehouses = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/warehouse/options');
      setWarehouseOptions(res.data || []);
      if (!id) {
        setFormData((prev) => ({
          ...prev,
          warehouseId: res.data?.[0]?.id || '',
        }));
      }
    } catch (error) {
      logger.error('加载仓库失败', error);
    }
  };

  const loadSkus = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/sku?pageSize=100');
      setSkuOptions(res.data.items || []);
    } catch (error) {
      logger.error('加载SKU失败', error);
    }
  };

  const loadMaterials = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/material/options');
      setMaterialOptions(res.data || []);
    } catch (error) {
      logger.error('加载物料失败', error);
    }
  };

  const toggleItemType = (type: string) => {
    setFormData({ ...formData, itemType: type, items: [] });
  };

  const addItem = () => {
    const newItem = formData.itemType === 'finished'
      ? { skuId: '', skuCode: '', quantity: 0, unitCost: 0, batchNo: '' }
      : { materialId: '', materialCode: '', materialName: '', quantity: 0, unitCost: 0, batchNo: '' };
    setFormData({ ...formData, items: [...formData.items, newItem] });
  };

  const removeItem = (index: number) => {
    const items = [...formData.items];
    items.splice(index, 1);
    setFormData({ ...formData, items });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const items = [...formData.items];
    items[index] = { ...items[index], [field]: value };
    setFormData({ ...formData, items });
  };

  const handleSkuChange = (index: number, skuId: string) => {
    const sku = skuOptions.find((s: any) => s.id === skuId);
    if (sku) {
      updateItem(index, 'skuId', skuId);
      updateItem(index, 'skuCode', sku.skuCode);
      updateItem(index, 'unitCost', sku.costPrice || 0);
    }
  };

  const handleMaterialChange = (index: number, materialId: string) => {
    const m = materialOptions.find((m: any) => m.id === materialId);
    if (m) {
      updateItem(index, 'materialId', materialId);
      updateItem(index, 'materialCode', m.code);
      updateItem(index, 'materialName', m.name);
      updateItem(index, 'unitCost', m.standardPrice || 0);
    }
  };

  const validateForm = (): boolean => {
    if (!formData.warehouseId) { toast('请选择仓库'); return false; }
    if (formData.items.length === 0) { toast('请添加至少一行明细'); return false; }
    const validItems = formData.items.filter((it: any) =>
      (formData.itemType === 'finished' ? it.skuId : it.materialId) && it.quantity > 0
    );
    if (validItems.length === 0) { toast('请填写完整的明细数据'); return false; }
    return true;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const validItems = formData.items.filter((it: any) =>
        (formData.itemType === 'finished' ? it.skuId : it.materialId) && it.quantity > 0
      );
      await axiosForBackend.post('/api/inventory/inbound', {
        warehouseId: formData.warehouseId,
        inboundType: formData.inboundType,
        inboundDate: formData.inboundDate,
        remark: formData.remark,
        itemType: formData.itemType,
        items: validItems,
      });
      toast('入库成功');
      navigate(backPath);
    } catch (error) {
      logger.error('创建入库单失败', error);
      toast(errMsg(error, '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    await handleSave();
  };

  const headerContent = (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-sm text-gray-700 mb-1">仓库 *</label>
        <select
          value={formData.warehouseId}
          onChange={(e) => setFormData({ ...formData, warehouseId: e.target.value })}
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
        >
          <option value="">请选择仓库</option>
          {warehouseOptions.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.type === 'fabric' ? '面辅料仓' : '成品仓'})</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">入库类型</label>
        <select
          value={formData.inboundType}
          onChange={(e) => setFormData({ ...formData, inboundType: e.target.value })}
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
        >
          <option value="production_finished">生产完工入库</option>
          <option value="other_in">其他入库</option>
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">入库日期 *</label>
        <input
          type="date"
          value={formData.inboundDate}
          onChange={(e) => setFormData({ ...formData, inboundDate: e.target.value })}
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">物品类型</label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center">
            <input
              type="radio"
              checked={formData.itemType === 'finished'}
              onChange={() => toggleItemType('finished')}
              disabled={viewOnly}
              className="mr-1"
            />
            成品（SKU）
          </label>
          <label className="flex items-center">
            <input
              type="radio"
              checked={formData.itemType === 'material'}
              onChange={() => toggleItemType('material')}
              disabled={viewOnly}
              className="mr-1"
            />
            面辅料
          </label>
        </div>
      </div>
      <div className="col-span-2">
        <label className="block text-sm text-gray-700 mb-1">备注</label>
        <textarea
          value={formData.remark}
          onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
          disabled={viewOnly}
          className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary disabled:bg-gray-100"
          rows={2}
        />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">入库明细</h3>
        {!viewOnly && (
          <button onClick={addItem} className="text-sm text-primary hover:text-primary">+ 添加行</button>
        )}
      </div>
      <table className="w-full text-sm border border-gray-200">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left text-gray-600 font-medium w-1/3">
              {formData.itemType === 'finished' ? 'SKU' : '物料'}
            </th>
            <th className="px-3 py-2 text-right text-gray-600 font-medium w-24">数量</th>
            <th className="px-3 py-2 text-right text-gray-600 font-medium w-28">单位成本</th>
            <th className="px-3 py-2 text-left text-gray-600 font-medium w-28">批次号</th>
            {!viewOnly && <th className="px-3 py-2 text-center text-gray-600 font-medium w-16">操作</th>}
          </tr>
        </thead>
        <tbody>
          {formData.items.length === 0 ? (
            <tr><td colSpan={viewOnly ? 4 : 5} className="py-6 text-center text-gray-400">点击"添加行"添加明细</td></tr>
          ) : (
            formData.items.map((it: any, idx: number) => (
              <tr key={it.skuId || it.materialId || idx} className="border-t border-gray-200">
                <td className="px-3 py-2">
                  {viewOnly ? (
                    formData.itemType === 'finished' ? it.skuCode : `${it.materialCode} - ${it.materialName}`
                  ) : (
                    <select
                      value={formData.itemType === 'finished' ? it.skuId : it.materialId}
                      onChange={(e) => formData.itemType === 'finished'
                        ? handleSkuChange(idx, e.target.value)
                        : handleMaterialChange(idx, e.target.value)
                      }
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="">请选择</option>
                      {(formData.itemType === 'finished' ? skuOptions : materialOptions).map((opt: any) => (
                        <option key={opt.id} value={opt.id}>
                          {formData.itemType === 'finished' ? opt.skuCode : `${opt.code} - ${opt.name}`}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="px-3 py-2">
                  {viewOnly ? it.quantity.toFixed(3) : (
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={it.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', Number(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-primary"
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  {viewOnly ? it.unitCost.toFixed(4) : (
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={it.unitCost}
                      onChange={(e) => updateItem(idx, 'unitCost', Number(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-primary"
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  {viewOnly ? it.batchNo || '-' : (
                    <input
                      type="text"
                      value={it.batchNo || ''}
                      onChange={(e) => updateItem(idx, 'batchNo', e.target.value)}
                      placeholder="批次号"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  )}
                </td>
                {!viewOnly && (
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-600 text-sm">删除</button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  if (loading) {
    return <div className="p-5 text-center text-gray-400">加载中...</div>;
  }

  return (
    <DocPage
      title="入库单"
      docNo={id ? '' : undefined}
      status={viewOnly ? 'completed' : 'draft'}
      backPath={backPath}
      viewOnly={viewOnly}
      onSave={viewOnly ? undefined : handleSave}
      onSubmit={viewOnly ? undefined : handleSubmit}
      saving={submitting}
      submitting={submitting}
      header={headerContent}
    >
      {detailContent}
    </DocPage>
  );
};

export default InventoryInboundEditPage;
