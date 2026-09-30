import { useState, useEffect } from 'react';
import { inventoryApi } from '@client/src/api/inventory';
import { baseApi } from '@client/src/api/base';
import type {
  InventoryStock, MaterialStock, Style, Warehouse, Material,
  PaginationResult,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

export default function InventoryQueryPage() {
  const [tab, setTab] = useState<'sku' | 'material'>('sku');

  const [skuList, setSkuList] = useState<InventoryStock[]>([]);
  const [skuTotal, setSkuTotal] = useState(0);
  const [skuPage, setSkuPage] = useState(1);
  const [skuStyleId, setSkuStyleId] = useState('');
  const [skuBrand, setSkuBrand] = useState('');
  const [skuColor, setSkuColor] = useState('');
  const [skuSize, setSkuSize] = useState('');
  const [skuWarehouseId, setSkuWarehouseId] = useState('');
  const [skuKeyword, setSkuKeyword] = useState('');
  const [skuLoading, setSkuLoading] = useState(false);

  const [matList, setMatList] = useState<MaterialStock[]>([]);
  const [matTotal, setMatTotal] = useState(0);
  const [matPage, setMatPage] = useState(1);
  const [matMaterialId, setMatMaterialId] = useState('');
  const [matWarehouseId, setMatWarehouseId] = useState('');
  const [matKeyword, setMatKeyword] = useState('');
  const [matLoading, setMatLoading] = useState(false);

  const [styles, setStyles] = useState<Style[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [brandOptions, setBrandOptions] = useState<{ attrCode: string; attrName: string }[]>([]);
  const [skuPageSize, setSkuPageSize] = useState(20);
  const [matPageSize, setMatPageSize] = useState(20);

  const fetchStyles = async () => {
    try {
      const res = await baseApi.style.list({ page: 1, pageSize: 1000 });
      setStyles(res.items);
    } catch (e) { logger.error('加载款号失败', e); }
  };
  const fetchBrands = async () => {
    try {
      const res = await baseApi.styleAttribute.getAll('brand', true);
      setBrandOptions(res.map((b: any) => ({ attrCode: b.attrCode, attrName: b.attrName })));
    } catch (e) { logger.error('加载品牌失败', e); }
  };
  const fetchWarehouses = async () => {
    try {
      const res = await baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' });
      setWarehouses(res.items);
    } catch (e) { logger.error('加载仓库失败', e); }
  };
  const fetchMaterials = async () => {
    try {
      const res = await baseApi.material.list({ page: 1, pageSize: 1000, status: 'active' });
      setMaterials(res.items);
    } catch (e) { logger.error('加载物料失败', e); }
  };

  const fetchSkuList = async () => {
    setSkuLoading(true);
    try {
      const params: any = { page: skuPage, pageSize: skuPageSize };
       if (skuStyleId) params.styleId = skuStyleId;
       if (skuBrand) params.brand = skuBrand;
       if (skuColor) params.color = skuColor;
      if (skuSize) params.size = skuSize;
      if (skuWarehouseId) params.warehouseId = skuWarehouseId;
      if (skuKeyword) params.keyword = skuKeyword;
      const res: PaginationResult<InventoryStock> = await inventoryApi.query.sku(params);
      setSkuList(res.items);
      setSkuTotal(res.total);
    } catch (e) {
      logger.error('加载成品库存失败', e);
      toast(errMsg(e, '加载失败'));
    } finally { setSkuLoading(false); }
  };

  const fetchMatList = async () => {
    setMatLoading(true);
    try {
      const params: any = { page: matPage, pageSize: matPageSize };
      if (matMaterialId) params.materialId = matMaterialId;
      if (matWarehouseId) params.warehouseId = matWarehouseId;
      if (matKeyword) params.keyword = matKeyword;
      const res: PaginationResult<MaterialStock> = await inventoryApi.query.material(params);
      setMatList(res.items);
      setMatTotal(res.total);
    } catch (e) {
      logger.error('加载面辅料库存失败', e);
      toast(errMsg(e, '加载失败'));
    } finally { setMatLoading(false); }
  };

  useEffect(() => { fetchStyles(); fetchBrands(); fetchWarehouses(); fetchMaterials(); }, []);
  useEffect(() => { if (tab === 'sku') fetchSkuList(); }, [tab, skuPage, skuPageSize]);
  useEffect(() => { if (tab === 'material') fetchMatList(); }, [tab, matPage, matPageSize]);

  const handleSkuPageSizeChange = (size: number) => {
    setSkuPageSize(size);
    setSkuPage(1);
  };

  const handleMatPageSizeChange = (size: number) => {
    setMatPageSize(size);
    setMatPage(1);
  };

  const handleExportSku = async () => {
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (skuStyleId) params.styleId = skuStyleId;
      if (skuBrand) params.brand = skuBrand;
      if (skuColor) params.color = skuColor;
      if (skuSize) params.size = skuSize;
      if (skuWarehouseId) params.warehouseId = skuWarehouseId;
      if (skuKeyword) params.keyword = skuKeyword;
      const res: PaginationResult<InventoryStock> = await inventoryApi.query.sku(params);
      exportTableToCSV('成品库存', res.items as unknown as Record<string, unknown>[], {
        skuCode: 'SKU编码',
        styleNo: '款号',
        brand: '品牌',
        color: '颜色',
        size: '尺码',
        warehouseName: '仓库',
        quantity: '现存量',
      });
    } catch (e) {
      logger.error('导出版成品库存失败', e);
      toast(errMsg(e, '导出失败'));
    }
  };

  const handleExportMaterial = async () => {
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (matMaterialId) params.materialId = matMaterialId;
      if (matWarehouseId) params.warehouseId = matWarehouseId;
      if (matKeyword) params.keyword = matKeyword;
      const res: PaginationResult<MaterialStock> = await inventoryApi.query.material(params);
      exportTableToCSV('面辅料库存', res.items as unknown as Record<string, unknown>[], {
        materialCode: '物料编码',
        materialName: '物料名称',
        warehouseName: '仓库',
        quantity: '现存量',
      });
    } catch (e) {
      logger.error('导出版面辅料库存失败', e);
      toast(errMsg(e, '导出失败'));
    }
  };

  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold mb-4">库存查询</h1>

      <div className="bg-white rounded mb-4">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('sku')}
            className={`px-5 py-2.5 text-sm font-medium ${
              tab === 'sku' ? 'text-primary border-b-2 border-primary' : 'text-gray-600 hover:text-gray-800'
            }`}
          >成品库存</button>
          <button
            onClick={() => setTab('material')}
            className={`px-5 py-2.5 text-sm font-medium ${
              tab === 'material' ? 'text-primary border-b-2 border-primary' : 'text-gray-600 hover:text-gray-800'
            }`}
          >面辅料库存</button>
        </div>
      </div>

      {tab === 'sku' && (
        <>
          <div className="bg-white rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
             <div className="flex flex-col">
               <label className="text-xs text-gray-500 mb-1">款号</label>
               <select value={skuStyleId} onChange={(e) => setSkuStyleId(e.target.value)}
                 className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40">
                 <option value="">全部</option>
                 {styles.map((s: Style) => <option key={s.id} value={s.id}>{s.styleNo}</option>)}
               </select>
             </div>
             <div className="flex flex-col">
               <label className="text-xs text-gray-500 mb-1">品牌</label>
               <select value={skuBrand} onChange={(e) => setSkuBrand(e.target.value)}
                 className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32">
                 <option value="">全部</option>
                 {brandOptions.map((b: { attrCode: string; attrName: string }) => (
                   <option key={b.attrCode} value={b.attrName}>{b.attrName}</option>
                 ))}
               </select>
             </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">颜色</label>
              <input type="text" value={skuColor} onChange={(e) => setSkuColor(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-28" />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">尺码</label>
              <input type="text" value={skuSize} onChange={(e) => setSkuSize(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24" />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">仓库</label>
              <select value={skuWarehouseId} onChange={(e) => setSkuWarehouseId(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-36">
                <option value="">全部</option>
                {warehouses.map((w: Warehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">SKU编码</label>
              <input type="text" value={skuKeyword} onChange={(e) => setSkuKeyword(e.target.value)}
                placeholder="搜索SKU" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" />
            </div>
             <button onClick={() => { setSkuPage(1); fetchSkuList(); }}
               className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600">查询</button>
             <button onClick={handleExportSku}
               className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-sm hover:bg-gray-50">导出</button>
           </div>

           <TableContainer>
             <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                   <th className="text-left px-4 py-2.5 font-medium text-gray-600">SKU编码</th>
                   <th className="text-left px-4 py-2.5 font-medium text-gray-600">款号</th>
                   <th className="text-left px-4 py-2.5 font-medium text-gray-600">品牌</th>
                   <th className="text-left px-4 py-2.5 font-medium text-gray-600">颜色</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">尺码</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">仓库</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">现存量</th>
                </tr>
              </thead>
              <tbody>
                 {skuLoading && <tr><td colSpan={7} className="text-center py-8 text-gray-400">加载中...</td></tr>}
                 {!skuLoading && skuList.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
                {!skuLoading && skuList.map((item: InventoryStock) => (
                  <tr key={item.id} className={`border-b border-gray-100 h-10 ${
                    item.quantity === 0 ? 'text-gray-400' : ''
                  }`}>
                     <td className="px-4">{item.skuCode}</td>
                     <td className="px-4">{item.styleNo}</td>
                     <td className="px-4">{item.brand || '-'}</td>
                     <td className="px-4">{item.color}</td>
                    <td className="px-4">{item.size}</td>
                    <td className="px-4">{item.warehouseName}</td>
                    <td className="px-4 text-right">{item.quantity.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
             </table>
           </TableContainer>
           <DataPagination
             page={skuPage}
             pageSize={skuPageSize}
             total={skuTotal}
             onPageChange={setSkuPage}
             onPageSizeChange={handleSkuPageSizeChange}
           />
         </>
       )}

       {tab === 'material' && (
        <>
          <div className="bg-white rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">物料</label>
              <select value={matMaterialId} onChange={(e) => setMatMaterialId(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48">
                <option value="">全部</option>
                {materials.map((m: Material) => <option key={m.id} value={m.id}>{m.code} - {m.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">仓库</label>
              <select value={matWarehouseId} onChange={(e) => setMatWarehouseId(e.target.value)}
                className="border border-gray-300 rounded px-3 py-1.5 text-sm w-36">
                <option value="">全部</option>
                {warehouses.map((w: Warehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">编码/名称</label>
              <input type="text" value={matKeyword} onChange={(e) => setMatKeyword(e.target.value)}
                placeholder="搜索" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" />
            </div>
             <button onClick={() => { setMatPage(1); fetchMatList(); }}
               className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600">查询</button>
             <button onClick={handleExportMaterial}
               className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-sm hover:bg-gray-50">导出</button>
           </div>

           <TableContainer>
             <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">物料编码</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">物料名称</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">单位</th>
                  <th className="text-left px-4 py-2.5 font-medium text-gray-600">仓库</th>
                  <th className="text-right px-4 py-2.5 font-medium text-gray-600">现存量</th>
                </tr>
              </thead>
              <tbody>
                {matLoading && <tr><td colSpan={5} className="text-center py-8 text-gray-400">加载中...</td></tr>}
                {!matLoading && matList.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
                {!matLoading && matList.map((item: MaterialStock) => (
                  <tr key={item.id} className={`border-b border-gray-100 h-10 ${
                    item.quantity === 0 ? 'text-gray-400' : ''
                  }`}>
                    <td className="px-4">{item.materialCode}</td>
                    <td className="px-4">{item.materialName}</td>
                    <td className="px-4">{/* unit not in MaterialStock type */}</td>
                    <td className="px-4">{item.warehouseName}</td>
                    <td className="px-4 text-right">{item.quantity.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
             </table>
           </TableContainer>
           <DataPagination
             page={matPage}
             pageSize={matPageSize}
             total={matTotal}
             onPageChange={setMatPage}
             onPageSizeChange={handleMatPageSizeChange}
           />
         </>
       )}
     </div>
   );
 }
