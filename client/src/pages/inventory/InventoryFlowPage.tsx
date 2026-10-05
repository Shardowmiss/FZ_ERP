import { StatusBadge } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';
import { inventoryApi } from '@client/src/api/inventory';
import { baseApi } from '@client/src/api/base';
import type { InventoryFlow, Warehouse, PaginationResult } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { validateDateRange } from '@client/src/utils/date-utils';
import { errMsg } from '@/utils/errMsg';

const FLOW_TYPES = [
  { value: '', label: '全部' },
  { value: 'purchase_inbound', label: '采购入库' },
  { value: 'sales_outbound', label: '销售出库' },
  { value: 'transfer_in', label: '调拨入库' },
  { value: 'transfer_out', label: '调拨出库' },
  { value: 'stocktake_adjust', label: '盘点调整' },
  { value: 'production_inbound', label: '生产入库' },
  { value: 'production_issue', label: '生产领料' },
  { value: 'sales_return', label: '销售退货' },
  { value: 'purchase_return', label: '采购退货' },
];

const FLOW_TYPE_LABELS: Record<string, string> = FLOW_TYPES.reduce((acc, t) => {
  if (t.value) acc[t.value] = t.label;
  return acc;
}, {} as Record<string, string>);

export default function InventoryFlowPage() {
  const [list, setList] = useState<InventoryFlow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [itemType, setItemType] = useState('');
  const [flowType, setFlowType] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const def = useDefaultDocDate();
  const [startDate, setStartDate] = useState(def.startDate);
  const [endDate, setEndDate] = useState(def.endDate);
  const [keyword, setKeyword] = useState('');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (itemType) params.itemType = itemType;
      if (flowType) params.flowType = flowType;
      if (warehouseId) params.warehouseId = warehouseId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<InventoryFlow> = await inventoryApi.flow.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载库存流水失败', e);
      toast(errMsg(e, '加载失败'));
    } finally { setLoading(false); }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' });
      setWarehouses(res.items);
    } catch (e) { logger.error('加载仓库失败', e); }
  };

  useEffect(() => { fetchWarehouses(); }, []);
  useEffect(() => { fetchList(); }, [page]);

  const handleSearch = () => {
    const err = validateDateRange(startDate, endDate);
    if (err) { toast.error(err); return; }
    setPage(1);
    fetchList();
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    const err = validateDateRange(startDate, endDate);
    if (err) { toast.error(err); return; }
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (itemType) params.itemType = itemType;
      if (flowType) params.flowType = flowType;
      if (warehouseId) params.warehouseId = warehouseId;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<InventoryFlow> = await inventoryApi.flow.list(params);
      exportTableToCSV('库存流水', res.items as unknown as Record<string, unknown>[], {
        flowType: '流水类型',
        bizNo: '业务单号',
        direction: '方向',
        itemCode: 'SKU/物料编码',
        styleNo: '款号',
        materialName: '物料名称',
        color: '颜色',
        size: '尺码',
        warehouseName: '仓库',
        quantity: '数量',
        batchNo: '批次',
        createdAt: '操作时间',
      });
    } catch (e) {
      logger.error('导出库存流水失败', e);
      toast(errMsg(e, '导出失败'));
    }
  };

  const isIn = (direction: string) => direction === 'in';

  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold mb-4">库存流水</h1>

      <div className="bg-white rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">类型</label>
          <select value={itemType} onChange={(e) => setItemType(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32">
            <option value="">全部</option>
            <option value="sku">成品</option>
            <option value="material">面辅料</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">流水类型</label>
          <select value={flowType} onChange={(e) => setFlowType(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-36">
            {FLOW_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">仓库</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-36">
            <option value="">全部</option>
            {warehouses.map((w: Warehouse) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">开始日期</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">结束日期</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">编码搜索</label>
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="SKU/物料编码" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40" />
        </div>
        <button onClick={handleSearch}
          className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary">查询</button>
        <button onClick={handleExport}
          className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-sm hover:bg-gray-50">导出</button>
      </div>

      <TableContainer>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">流水类型</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">业务单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">方向</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">SKU/物料</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">颜色</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">尺码</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">仓库</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">数量</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">批次</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作时间</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: InventoryFlow) => {
              const inFlag = isIn(item.direction);
              const itemName = item.itemType === 'sku' ? item.styleNo || '' : (item.materialName || '');
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4">{FLOW_TYPE_LABELS[item.flowType] || item.flowType}</td>
                  <td className="px-4">{item.bizNo}</td>
                  <td className="px-4">
                    <StatusBadge tone={inFlag ? 'ok' : 'danger'}>{inFlag ? '入库' : '出库'}</StatusBadge>
                  </td>
                  <td className="px-4">{itemName}</td>
                  <td className="px-4">{item.color || '-'}</td>
                  <td className="px-4">{item.size || '-'}</td>
                  <td className="px-4">{item.warehouseName}</td>
                  <td className={`px-4 text-right font-medium ${inFlag ? 'text-green-600' : 'text-red-600'}`}>
                    {inFlag ? '+' : '-'}{item.quantity.toFixed(3)}
                  </td>
                  <td className="px-4">{item.batchNo || '-'}</td>
                  <td className="px-4 text-gray-500">{item.createdAt?.slice(0, 19).replace('T', ' ') || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableContainer>
      <DataPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={handlePageSizeChange}
      />
    </div>
  );
}
