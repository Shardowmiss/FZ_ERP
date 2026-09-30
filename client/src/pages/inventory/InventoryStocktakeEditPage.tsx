import { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { inventoryApi } from '@client/src/api/inventory';
import { baseApi } from '@client/src/api/base';
import type {
  InventoryStocktake, Warehouse, Sku, Material,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent, MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import DocPage from '@/components/DocPage/DocPage';
import { errMsg } from '@/utils/errMsg';

interface StocktakeItemForm {
  skuId?: string;
  materialId?: string;
  itemCode: string;
  itemName: string;
  color?: string;
  size?: string;
  bookQty: number;
  actualQty: number;
  diffQty: number;
}

export default function InventoryStocktakeEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const viewOnly = searchParams.get('view') === 'true' || !!id;
  const isNew = !id;

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);

  const [formWh, setFormWh] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formItemType, setFormItemType] = useState<'sku' | 'material'>('sku');
  const [formRemark, setFormRemark] = useState('');
  const [formItems, setFormItems] = useState<StocktakeItemForm[]>([]);

  const [detail, setDetail] = useState<InventoryStocktake | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 打印状态
  const [printOpen, setPrintOpen] = useState(false);
  const [printItemType, setPrintItemType] = useState<'sku' | 'material'>('sku');
  const [printSkuItems, setPrintSkuItems] = useState<SkuMatrixItem[]>([]);
  const [printMaterialItems, setPrintMaterialItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printWarehouseName, setPrintWarehouseName] = useState('');
  const [printRemark, setPrintRemark] = useState('');
  const [printBookQty, setPrintBookQty] = useState(0);
  const [printDiffQty, setPrintDiffQty] = useState(0);
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

  const backPath = '/inventory/stocktake';

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

  const fetchWarehouses = async () => {
    try {
      const res = await baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' });
      setWarehouses(res.items);
    } catch (e) { logger.error('加载仓库失败', e); }
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
    fetchWarehouses();
    fetchSkus();
    fetchMaterials();
  }, []);

  useEffect(() => {
    if (isNew) {
      setFormDate(new Date().toISOString().slice(0, 10));
      setFormItemType('sku');
      setFormRemark('');
      setFormItems([]);
    } else if (id) {
      loadDetail(id);
    }
  }, [id, isNew]);

  useEffect(() => {
    if (isNew && warehouses.length > 0 && formWh === '') {
      setFormWh(warehouses[0]?.id || '');
    }
  }, [warehouses, isNew, formWh]);

  const loadDetail = async (stocktakeId: string) => {
    setLoading(true);
    try {
      const d = await inventoryApi.stocktake.get(stocktakeId);
      setDetail(d);
      setFormWh(d.warehouseId);
      setFormDate(d.stocktakeDate.slice(0, 10));
      setFormItemType(d.itemType as 'sku' | 'material');
      setFormRemark(d.remark || '');
      setFormItems((d.items || []).map((it: any) => ({
        skuId: it.skuId,
        materialId: it.materialId,
        itemCode: it.itemCode,
        itemName: it.itemName,
        color: it.color,
        size: it.size,
        bookQty: it.bookQty,
        actualQty: it.actualQty,
        diffQty: it.diffQty,
      })));
    } catch (e) {
      logger.error('加载详情失败', e);
      toast(errMsg(e, '加载失败'));
    } finally { setLoading(false); }
  };

  const calcDiff = (bookQty: number, actualQty: number): number => {
    return Number((actualQty - bookQty).toFixed(3));
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
        bookQty: 0,
        actualQty: 0,
        diffQty: 0,
      }]);
    } else {
      const first = materials[0];
      if (!first) { toast('暂无物料'); return; }
      setFormItems([...formItems, {
        materialId: first.id,
        itemCode: first.code,
        itemName: first.name,
        bookQty: 0,
        actualQty: 0,
        diffQty: 0,
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
    } else if (field === 'bookQty' || field === 'actualQty') {
      const numVal = Number(value) || 0;
      (item as any)[field] = numVal;
      item.diffQty = calcDiff(item.bookQty, item.actualQty);
    } else {
      (item as any)[field] = value;
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

  const handleSave = async () => {
    if (submitting) return;
    if (!formWh) { toast('请选择仓库'); return; }
    if (!formDate) { toast('请选择盘点日期'); return; }
    if (formItems.length === 0) { toast('请添加明细'); return; }
    setSubmitting(true);
    try {
      await inventoryApi.stocktake.create({
        warehouseId: formWh,
        stocktakeDate: formDate,
        itemType: formItemType,
        remark: formRemark,
        items: formItems.map((it: StocktakeItemForm) => ({
          skuId: it.skuId,
          materialId: it.materialId,
          bookQty: Number(it.bookQty.toFixed(3)),
          actualQty: Number(it.actualQty.toFixed(3)),
        })),
      });
      toast('创建成功');
      navigate(backPath);
    } catch (e) {
      logger.error('创建失败', e);
      toast(errMsg(e, '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = () => {
    if (!detail) return;
    const itemType = detail.itemType as 'sku' | 'material';
    setPrintItemType(itemType);
    setPrintDocNo(detail.stocktakeNo);
    setPrintDocDate(detail.stocktakeDate?.slice(0, 10) || '');
    setPrintWarehouseName(detail.warehouseName);
    setPrintRemark(detail.remark || '');

    let totalBook = 0;
    let totalDiff = 0;
    const items = detail.items || [];
    for (const it of items as any[]) {
      totalBook += it.bookQty || 0;
      totalDiff += (it.diffQty !== undefined ? it.diffQty : (it.actualQty || 0) - (it.bookQty || 0));
    }
    setPrintBookQty(totalBook);
    setPrintDiffQty(totalDiff);

    if (itemType === 'sku') {
      const skuItems: SkuMatrixItem[] = (items as any[]).map((it: any) => ({
        styleNo: it.itemCode,
        styleName: it.itemName,
        color: it.color || '',
        size: it.size || '',
        quantity: it.actualQty || 0,
      }));
      setPrintSkuItems(skuItems);
      setPrintMaterialItems([]);
    } else {
      const matItems: MaterialListItem[] = (items as any[]).map((it: any) => ({
        code: it.itemCode,
        name: it.itemName,
        unit: '件',
        quantity: it.actualQty || 0,
      }));
      setPrintMaterialItems(matItems);
      setPrintSkuItems([]);
    }
    setPrintOpen(true);
  };

  const statusText = detail?.status || (isNew ? 'draft' : '');

  const extraActions = undefined;

  if (loading) {
    return <div className="p-5 text-center text-gray-400">加载中...</div>;
  }

  const headerContent = (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">仓库 <span className="text-red-500">*</span></label>
          <select value={formWh} onChange={(e) => setFormWh(e.target.value)} disabled={viewOnly}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm disabled:bg-gray-100">
            <option value="">请选择</option>
            {warehouses.map((w: Warehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">盘点日期 <span className="text-red-500">*</span></label>
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
      <div className="flex flex-col mb-2">
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
          <button onClick={addItem} className="text-primary text-sm hover:underline">+ 添加行</button>
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
              <th className="text-right px-3 py-2 font-medium text-gray-600">账面数量</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">实盘数量</th>
              <th className="text-right px-3 py-2 font-medium text-gray-600">差异数量</th>
              {!viewOnly && <th className="text-center px-3 py-2 font-medium text-gray-600 w-16">操作</th>}
            </tr>
          </thead>
          <tbody>
            {formItems.length === 0 && (
              <tr><td colSpan={viewOnly ? (formItemType === 'sku' ? 6 : 4) : (formItemType === 'sku' ? 7 : 5)}
                className="text-center py-4 text-gray-400">暂无明细</td></tr>
            )}
            {formItems.map((it: StocktakeItemForm, i: number) => (
              <tr key={it.itemCode} className="border-t border-gray-100">
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
                  {viewOnly ? it.bookQty.toFixed(3) : (
                    <input type="number" step="0.001" value={it.bookQty}
                      onChange={(e) => updateItem(i, 'bookQty', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right" />
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {viewOnly ? it.actualQty.toFixed(3) : (
                    <input type="number" step="0.001" value={it.actualQty}
                      onChange={(e) => updateItem(i, 'actualQty', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-xs w-24 text-right" />
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-medium ${
                  it.diffQty > 0 ? 'text-green-600' : it.diffQty < 0 ? 'text-red-600' : ''
                }`}>
                  {it.diffQty > 0 ? '+' : ''}{it.diffQty.toFixed(3)}
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
        title="盘点单"
        landscape={showAllSizes || printItemType === 'sku'}
        showAllSizesToggle={printItemType === 'sku'}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        {printItemType === 'sku' ? (
          <SkuDocPrintContent
            docType="盘点单"
            docNo={printDocNo}
            docDate={printDocDate}
            warehouseName={printWarehouseName}
            remark={printRemark}
            items={printSkuItems}
            showAmount={false}
            signLabels={['制单人', '复盘人', '监盘人']}
            extraSummary={[
              { label: '盘点类型', value: 'SKU盘点' },
              { label: '账面总数量', value: String(printBookQty) },
              { label: '差异总数量', value: String(printDiffQty) },
            ]}
            showAllSizes={showAllSizes}
            allSizesByStyle={allSizesByStyle}
          />
        ) : (
          <MaterialDocPrintContent
            docType="盘点单"
            docNo={printDocNo}
            docDate={printDocDate}
            warehouseName={printWarehouseName}
            remark={printRemark}
            items={printMaterialItems}
            signLabels={['制单人', '复盘人', '监盘人']}
            extraSummary={[
              { label: '盘点类型', value: '物料盘点' },
              { label: '账面总数量', value: String(printBookQty) },
              { label: '差异总数量', value: String(printDiffQty) },
            ]}
          />
        )}
      </PrintDialog>
    </div>
  );

  return (
    <DocPage
      title="盘点单"
      docNo={detail?.stocktakeNo}
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
