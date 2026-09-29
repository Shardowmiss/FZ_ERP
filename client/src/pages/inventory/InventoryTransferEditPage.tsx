import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { inventoryApi } from '@client/src/api/inventory';
import { baseApi } from '@client/src/api/base';
import type {
  InventoryTransfer, Sku, Material,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent, MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import DocPage from '@/components/DocPage/DocPage';

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
  dealerId?: string;
  warehouseId?: string;
}

interface DealerOption {
  id: string;
  code: string;
  name: string;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

type PartyType = 'warehouse' | 'store';

interface TransferItemForm {
  skuId?: string;
  materialId?: string;
  itemCode: string;
  itemName: string;
  color?: string;
  size?: string;
  quantity: number;
}

function validateTransfer(
  fromType: PartyType,
  fromId: string,
  toType: PartyType,
  toId: string,
  stores: StoreOption[],
  warehouses: WarehouseOption[],
  dealers: DealerOption[],
): string | null {
  if (!fromId || !toId) return null;
  if (fromType === toType && fromId === toId) return '调出方和调入方不能相同';

  const fromWh = fromType === 'warehouse'
    ? warehouses.find((w) => w.id === fromId)
    : null;
  const toWh = toType === 'warehouse'
    ? warehouses.find((w) => w.id === toId)
    : null;
  const fromStore = fromType === 'store'
    ? stores.find((s) => s.id === fromId)
    : null;
  const toStore = toType === 'store'
    ? stores.find((s) => s.id === toId)
    : null;

  if (fromWh && fromWh.type === 'finished') return null;
  if (toWh && toWh.type === 'finished') return null;

  if (fromStore && toStore) {
    const fromIsDealer = fromStore.storeType === 'dealer';
    const toIsDealer = toStore.storeType === 'dealer';
    if (fromIsDealer && toIsDealer) {
      if (fromStore.dealerId !== toStore.dealerId) {
        const fromDealer = dealers.find((d) => d.id === fromStore.dealerId)?.name || '';
        const toDealer = dealers.find((d) => d.id === toStore.dealerId)?.name || '';
        return `跨经销商不允许调拨（${fromDealer} → ${toDealer}）`;
      }
      return null;
    }
    if (!fromIsDealer && !toIsDealer) {
      return null;
    }
    return '直营店与经销商门店不能直接调拨';
  }

  if ((fromStore && toWh) || (fromWh && toStore)) {
    return '非成品仓只能内部调拨，门店与非成品仓之间不能直接调拨';
  }

  return null;
}

export default function InventoryTransferEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const viewOnly = searchParams.get('view') === 'true' || !!id;
  const isNew = !id;

  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [dealerOptions, setDealerOptions] = useState<DealerOption[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [formFromType, setFormFromType] = useState<PartyType>('warehouse');
  const [formFromId, setFormFromId] = useState('');
  const [formToType, setFormToType] = useState<PartyType>('warehouse');
  const [formToId, setFormToId] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formItemType, setFormItemType] = useState<'sku' | 'material'>('sku');
  const [formRemark, setFormRemark] = useState('');
  const [formItems, setFormItems] = useState<TransferItemForm[]>([]);

  const [detail, setDetail] = useState<InventoryTransfer | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 打印状态
  const [printOpen, setPrintOpen] = useState(false);
  const [printItemType, setPrintItemType] = useState<'sku' | 'material'>('sku');
  const [printSkuItems, setPrintSkuItems] = useState<SkuMatrixItem[]>([]);
  const [printMaterialItems, setPrintMaterialItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printRemark, setPrintRemark] = useState('');
  const [printFromName, setPrintFromName] = useState('');
  const [printToName, setPrintToName] = useState('');
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

  const backPath = '/inventory/transfer';

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
      const styleNos = Array.from(new Set(printSkuItems.map((it: SkuMatrixItem) => it.styleNo)));
      const sizes = await loadAllSizesByStyle(styleNos);
      setAllSizesByStyle(sizes);
    } else {
      setAllSizesByStyle({});
    }
  };

  const fetchOptions = async () => {
    try {
      const [wh, st, dl] = await Promise.all([
        baseApi.warehouse.options(),
        baseApi.store.options(),
        baseApi.dealer.options(),
      ]);
      setWarehouseOptions(wh);
      setStoreOptions(st);
      setDealerOptions(dl);
    } catch (e) { logger.error('加载选项失败', e); }
  };

  const fetchSkus = async () => {
    try {
      const res = await baseApi.sku.list({ page: 1, pageSize: 1000 });
      setSkus(res.items);
    } catch (e) { logger.error('加载SKU失败', e); }
  };

  const fetchMaterials = async () => {
    try {
      const res = await baseApi.material.list({ page: 1, pageSize: 1000, status: 'active' });
      setMaterials(res.items);
    } catch (e) { logger.error('加载物料失败', e); }
  };

  useEffect(() => {
    fetchOptions();
    fetchSkus();
    fetchMaterials();
  }, []);

  useEffect(() => {
    if (isNew) {
      // 新建模式：初始化默认值
      setFormFromType('warehouse');
      setFormToType('warehouse');
      setFormDate(new Date().toISOString().slice(0, 10));
      setFormItemType('sku');
      setFormRemark('');
      setFormItems([]);
    } else if (id) {
      // 查看模式：加载详情
      loadDetail(id);
    }
  }, [id, isNew]);

  useEffect(() => {
    // 等仓库选项加载完后设置默认值
    if (isNew && warehouseOptions.length > 0 && formFromId === '') {
      setFormFromId(warehouseOptions[0]?.id || '');
      setFormToId(warehouseOptions[1]?.id || warehouseOptions[0]?.id || '');
    }
  }, [warehouseOptions, isNew, formFromId]);

  const loadDetail = async (transferId: string) => {
    setLoading(true);
    try {
      const d = await inventoryApi.transfer.get(transferId);
      setDetail(d);
      const hasFromStore = !!d.fromStoreId;
      const hasToStore = !!d.toStoreId;
      setFormFromType(hasFromStore ? 'store' : 'warehouse');
      setFormToType(hasToStore ? 'store' : 'warehouse');
      setFormFromId(hasFromStore ? d.fromStoreId! : d.fromWarehouseId);
      setFormToId(hasToStore ? d.toStoreId! : d.toWarehouseId);
      setFormDate(d.transferDate.slice(0, 10));
      setFormItemType(d.itemType as 'sku' | 'material');
      setFormRemark(d.remark || '');
      setFormItems((d.items || []).map((it: any) => ({
        skuId: it.skuId,
        materialId: it.materialId,
        itemCode: it.itemCode,
        itemName: it.itemName,
        color: it.color,
        size: it.size,
        quantity: it.quantity,
      })));
    } catch (e) {
      logger.error('加载详情失败', e);
      toast('加载失败');
    } finally { setLoading(false); }
  };

  const resolveWarehouseId = (type: PartyType, pid: string): string => {
    if (type === 'warehouse') return pid;
    const store = storeOptions.find((s) => s.id === pid);
    return store?.warehouseId || '';
  };

  const addItem = () => {
    if (formItemType === 'sku') {
      const first = skus[0];
      if (!first) { toast('暂无SKU'); return; }
      setFormItems([...formItems, {
        skuId: first.id,
        itemCode: first.skuCode,
        itemName: first.styleNo,
        color: first.color,
        size: first.size,
        quantity: 1,
      }]);
    } else {
      const first = materials[0];
      if (!first) { toast('暂无物料'); return; }
      setFormItems([...formItems, {
        materialId: first.id,
        itemCode: first.code,
        itemName: first.name,
        quantity: 1,
      }]);
    }
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    const newItems = [...formItems];
    const item = { ...newItems[index] };
    if (field === 'skuId' && formItemType === 'sku') {
      const sku = skus.find((s: Sku) => s.id === value);
      if (sku) {
        item.skuId = sku.id;
        item.itemCode = sku.skuCode;
        item.itemName = sku.styleNo;
        item.color = sku.color;
        item.size = sku.size;
      }
    } else if (field === 'materialId' && formItemType === 'material') {
      const m = materials.find((mm: Material) => mm.id === value);
      if (m) {
        item.materialId = m.id;
        item.itemCode = m.code;
        item.itemName = m.name;
      }
    } else {
      (item as any)[field] = Number(value) || value;
    }
    newItems[index] = item;
    setFormItems(newItems);
  };

  const removeItem = (index: number) => {
    setFormItems(formItems.filter((_, i: number) => i !== index));
  };

  const handleItemTypeChange = (type: 'sku' | 'material') => {
    setFormItemType(type);
    setFormItems([]);
  };

  const transferError = viewOnly
    ? null
    : validateTransfer(
        formFromType, formFromId, formToType, formToId,
        storeOptions, warehouseOptions, dealerOptions,
      );

  const handleSave = async () => {
    if (submitting) return;
    if (!formFromId) { toast(`请选择调出${formFromType === 'warehouse' ? '仓库' : '门店'}`); return; }
    if (!formToId) { toast(`请选择调入${formToType === 'warehouse' ? '仓库' : '门店'}`); return; }
    if (transferError) { toast(transferError); return; }
    if (!formDate) { toast('请选择调拨日期'); return; }
    if (formItems.length === 0) { toast('请添加明细'); return; }
    setSubmitting(true);
    try {
      const fromWarehouseId = resolveWarehouseId(formFromType, formFromId);
      const toWarehouseId = resolveWarehouseId(formToType, formToId);
      if (!fromWarehouseId || !toWarehouseId) {
        toast('门店对应的仓库未配置');
        return;
      }
      const payload: any = {
        fromWarehouseId,
        toWarehouseId,
        transferDate: formDate,
        itemType: formItemType,
        remark: formRemark,
        items: formItems.map((it: TransferItemForm) => ({
          skuId: it.skuId,
          materialId: it.materialId,
          quantity: Number(it.quantity.toFixed(3)),
        })),
      };
      if (formFromType === 'store') payload.fromStoreId = formFromId;
      if (formToType === 'store') payload.toStoreId = formToId;
      await inventoryApi.transfer.create(payload);
      toast('创建成功');
      navigate(backPath);
    } catch (e) {
      logger.error('创建失败', e);
      toast('创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceive = async () => {
    if (!id) return;
    if (!await showConfirm('确定签收？签收后调拨单完成。')) return;
    try {
      await inventoryApi.transfer.receive(id);
      toast('签收成功');
      loadDetail(id);
    } catch (e) {
      logger.error('签收失败', e);
      toast('签收失败');
    }
  };

  const handlePrint = () => {
    if (!detail) return;
    const itemType = detail.itemType as 'sku' | 'material';
    setPrintItemType(itemType);
    setPrintDocNo(detail.transferNo);
    setPrintDocDate(detail.transferDate?.slice(0, 10) || '');
    setPrintRemark(detail.remark || '');

    const fromName = detail.fromStoreName
      ? `门店：${detail.fromStoreName}`
      : `仓库：${detail.fromWarehouseName}`;
    const toName = detail.toStoreName
      ? `门店：${detail.toStoreName}`
      : `仓库：${detail.toWarehouseName}`;
    setPrintFromName(fromName);
    setPrintToName(toName);

    if (itemType === 'sku') {
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: any) => ({
        styleNo: it.itemCode,
        styleName: it.itemName,
        color: it.color || '',
        size: it.size || '',
        quantity: it.quantity || 0,
      }));
      setPrintSkuItems(skuItems);
      setPrintMaterialItems([]);
    } else {
      const matItems: MaterialListItem[] = (detail.items || []).map((it: any) => ({
        code: it.itemCode,
        name: it.itemName,
        unit: '件',
        quantity: it.quantity || 0,
      }));
      setPrintMaterialItems(matItems);
      setPrintSkuItems([]);
    }
    setPrintOpen(true);
  };

  const statusText = detail?.status || (isNew ? 'draft' : '');

  const extraActions = viewOnly && detail?.status === 'in_transit' ? (
    <button
      onClick={handleReceive}
      className="px-3 py-1.5 bg-amber-500 text-white rounded text-sm hover:bg-amber-600 inline-flex items-center gap-1"
    >
      签收
    </button>
  ) : undefined;

  if (loading) {
    return <div className="p-5 text-center text-gray-400">加载中...</div>;
  }

  const headerContent = (
    <div>
      {/* 调出方 / 调入方 类型切换 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">调出方类型 <span className="text-red-500">*</span></label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                checked={formFromType === 'warehouse'}
                onChange={() => {
                  if (viewOnly) return;
                  setFormFromType('warehouse');
                  setFormFromId(warehouseOptions[0]?.id || '');
                }}
                disabled={viewOnly}
              />
              仓库
            </label>
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                checked={formFromType === 'store'}
                onChange={() => {
                  if (viewOnly) return;
                  setFormFromType('store');
                  setFormFromId(storeOptions[0]?.id || '');
                }}
                disabled={viewOnly}
              />
              门店
            </label>
          </div>
          <select
            value={formFromId}
            onChange={(e) => setFormFromId(e.target.value)}
            disabled={viewOnly}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
          >
            <option value="">请选择{formFromType === 'warehouse' ? '仓库' : '门店'}</option>
            {formFromType === 'warehouse'
              ? warehouseOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))
              : storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}（{s.storeType === 'direct' ? '直营' : s.storeType === 'dealer' ? '经销' : s.storeType}）</option>
                ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500">调入方类型 <span className="text-red-500">*</span></label>
          <div className="flex gap-4">
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                checked={formToType === 'warehouse'}
                onChange={() => {
                  if (viewOnly) return;
                  setFormToType('warehouse');
                  setFormToId(warehouseOptions[0]?.id || '');
                }}
                disabled={viewOnly}
              />
              仓库
            </label>
            <label className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="radio"
                checked={formToType === 'store'}
                onChange={() => {
                  if (viewOnly) return;
                  setFormToType('store');
                  setFormToId(storeOptions[0]?.id || '');
                }}
                disabled={viewOnly}
              />
              门店
            </label>
          </div>
          <select
            value={formToId}
            onChange={(e) => setFormToId(e.target.value)}
            disabled={viewOnly}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100"
          >
            <option value="">请选择{formToType === 'warehouse' ? '仓库' : '门店'}</option>
            {formToType === 'warehouse'
              ? warehouseOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))
              : storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}（{s.storeType === 'direct' ? '直营' : s.storeType === 'dealer' ? '经销' : s.storeType}）</option>
                ))}
          </select>
        </div>
      </div>

      {/* 归属校验提示 */}
      {transferError && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          {transferError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">调拨日期 <span className="text-red-500">*</span></label>
          <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} disabled={viewOnly}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">类型</label>
          <select value={formItemType} onChange={(e) => handleItemTypeChange(e.target.value as 'sku' | 'material')} disabled={viewOnly}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100">
            <option value="sku">成品</option>
            <option value="material">面辅料</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col">
        <label className="text-xs text-gray-500 mb-1">备注</label>
        <input type="text" value={formRemark} onChange={(e) => setFormRemark(e.target.value)} disabled={viewOnly}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100" />
      </div>
    </div>
  );

  const detailContent = (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">明细</span>
        {!viewOnly && (
          <button onClick={addItem} className="text-blue-500 text-sm hover:underline">+ 添加行</button>
        )}
      </div>
      <div className="border border-gray-200 rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">
                {formItemType === 'sku' ? 'SKU' : '物料'}
              </th>
              {formItemType === 'sku' && (
                <>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">颜色</th>
                  <th className="text-left px-3 py-2 font-medium text-gray-600">尺码</th>
                </>
              )}
              <th className="text-right px-3 py-2 font-medium text-gray-600">数量</th>
              {!viewOnly && <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">操作</th>}
            </tr>
          </thead>
          <tbody>
            {formItems.length === 0 && (
              <tr><td colSpan={viewOnly ? (formItemType === 'sku' ? 4 : 2) : (formItemType === 'sku' ? 5 : 3)}
                className="text-center py-4 text-gray-400">暂无明细</td></tr>
            )}
            {formItems.map((it: TransferItemForm, i: number) => (
              <tr key={it.skuId || it.materialId || i} className="border-t border-gray-100">
                <td className="px-3 py-2">
                  {viewOnly ? (
                    it.itemCode
                  ) : formItemType === 'sku' ? (
                    <select value={it.skuId || ''} onChange={(e) => updateItem(i, 'skuId', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-full">
                      {skus.map((s: Sku) => <option key={s.id} value={s.id}>{s.skuCode}</option>)}
                    </select>
                  ) : (
                    <select value={it.materialId || ''} onChange={(e) => updateItem(i, 'materialId', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-full">
                      {materials.map((m: Material) => <option key={m.id} value={m.id}>{m.code} - {m.name}</option>)}
                    </select>
                  )}
                </td>
                {formItemType === 'sku' && (
                  <>
                    <td className="px-3 py-2">{it.color}</td>
                    <td className="px-3 py-2">{it.size}</td>
                  </>
                )}
                <td className="px-3 py-2 text-right">
                  {viewOnly ? it.quantity.toFixed(3) : (
                    <input type="number" step="0.001" value={it.quantity}
                      onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right" />
                  )}
                </td>
                {!viewOnly && (
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => removeItem(i)} className="text-red-500 text-xs hover:underline">删除</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="调拨单"
        landscape={showAllSizes || printItemType === 'sku'}
        showAllSizesToggle={printItemType === 'sku'}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        {printItemType === 'sku' ? (
          <SkuDocPrintContent
            docType="调拨单"
            docNo={printDocNo}
            docDate={printDocDate}
            remark={printRemark}
            items={printSkuItems}
            extraFields={[
              { label: '调出方', value: printFromName },
              { label: '调入方', value: printToName },
            ]}
            showAllSizes={showAllSizes}
            allSizesByStyle={allSizesByStyle}
          />
        ) : (
          <MaterialDocPrintContent
            docType="调拨单"
            docNo={printDocNo}
            docDate={printDocDate}
            remark={printRemark}
            items={printMaterialItems}
            extraFields={[
              { label: '调出方', value: printFromName },
              { label: '调入方', value: printToName },
            ]}
          />
        )}
      </PrintDialog>
    </div>
  );

  return (
    <DocPage
      title="调拨单"
      docNo={detail?.transferNo}
      status={statusText}
      backPath={backPath}
      viewOnly={viewOnly}
      onSave={viewOnly ? undefined : handleSave}
      onSubmit={viewOnly ? undefined : handleSave}
      saving={submitting}
      submitting={submitting}
      onPrint={viewOnly && detail ? handlePrint : undefined}
      extraActions={extraActions}
      header={headerContent}
    >
      {detailContent}
    </DocPage>
  );
}
