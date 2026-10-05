import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '@client/src/api/inventory';
import { baseApi } from '@client/src/api/base';
import type {
  InventoryStocktake, Warehouse,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

export default function InventoryStocktakePage() {
  const navigate = useNavigate();
  const [list, setList] = useState<InventoryStocktake[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [stocktakeDateStart, setStocktakeDateStart] = useState(defaultDocStart);
  const [stocktakeDateEnd, setStocktakeDateEnd] = useState(defaultDocEnd);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
    draft: { label: '草稿', tone: 'neutral' },
    approved: { label: '已审核', tone: 'ok' },
    posted: { label: '已记账', tone: 'info' },
  };

  const fetchWarehouses = async () => {
    try {
      const res = await baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' });
      setWarehouses(res.items);
    } catch (e) { logger.error('加载仓库失败', e); }
  };

  useEffect(() => {
    fetchList();
    fetchWarehouses();
  }, [page, pageSize, status, warehouseName, stocktakeDateStart, stocktakeDateEnd]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (status) params.status = status;
      if (warehouseName) params.warehouseName = warehouseName;
      if (stocktakeDateStart) params.stocktakeDateStart = stocktakeDateStart;
      if (stocktakeDateEnd) params.stocktakeDateEnd = stocktakeDateEnd;
      const res = await inventoryApi.stocktake.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载盘点单失败', e);
      setList([]);
    }
    setLoading(false);
  };

  const openCreate = () => {
    navigate('/inventory/stocktake/new');
  };

  const openView = (id: string) => {
    navigate(`/inventory/stocktake/${id}/edit?view=true`);
  };

  const handleApprove = async (id: string) => {
    if (!await showConfirm('确定审核？审核后单据锁定不可编辑，不改变库存。')) return;
    try {
      await inventoryApi.stocktake.approve(id);
      toast('审核成功');
      fetchList();
    } catch (e) {
      logger.error('审核失败', e);
      toast(errMsg(e, '审核失败'));
    }
  };

  const handlePost = async (id: string) => {
    if (!await showConfirm('确定记账？记账后将按盘点差异调整库存数量与金额，产生盘盈/盘亏。')) return;
    try {
      await inventoryApi.stocktake.post(id);
      toast('记账成功');
      fetchList();
    } catch (e) {
      logger.error('记账失败', e);
      toast(errMsg(e, '记账失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定删除？')) return;
    try {
      await inventoryApi.stocktake.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      logger.error('删除失败', e);
      toast(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await inventoryApi.stocktake.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (status) params.status = status;
      if (warehouseName) params.warehouseName = warehouseName;
      if (stocktakeDateStart) params.stocktakeDateStart = stocktakeDateStart;
      if (stocktakeDateEnd) params.stocktakeDateEnd = stocktakeDateEnd;
      const res = await inventoryApi.stocktake.list(params);
      const data = res.items.map((it: InventoryStocktake) => ({
        stocktakeNo: it.stocktakeNo,
        warehouseName: it.warehouseName,
        stocktakeDate: it.stocktakeDate?.slice(0, 10) || '',
        itemType: it.itemType === 'sku' ? '成品' : '面辅料',
        status: STATUS_MAP[it.status]?.label || it.status,
      }));
      exportTableToCSV('盘点单', data as unknown as Record<string, unknown>[], {
        stocktakeNo: '盘点单号',
        warehouseName: '仓库',
        stocktakeDate: '盘点日期',
        itemType: '类型',
        status: '状态',
      });
    } catch (e) {
      logger.error('导出盘点单失败', e);
      toast(errMsg(e, '导出失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">盘点单</h1>
          <button onClick={openCreate} className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-primary">
            + 新增盘点单
          </button>
        </div>

      <div className="bg-white rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">状态</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32">
            <option value="">全部</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
                      <option value="cancelled">已作废</option>
                      <option value="posted">已记账</option>
</select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">店铺名称</label>
          <input type="text" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)}
            placeholder="店铺/仓库名称"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-36" />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">单据日期</label>
          <div className="flex items-center gap-1">
            <input type="date" value={stocktakeDateStart} onChange={(e) => setStocktakeDateStart(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            <span className="text-gray-400">~</span>
            <input type="date" value={stocktakeDateEnd} onChange={(e) => setStocktakeDateEnd(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <button onClick={() => { setPage(1); fetchList(); }}
          className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary">查询</button>
        <button onClick={() => {
          setStatus(''); setWarehouseName(''); setStocktakeDateStart(''); setStocktakeDateEnd(''); setPage(1); fetchList();
        }}
          className="bg-gray-100 text-gray-600 px-4 py-1.5 rounded text-sm hover:bg-gray-200">重置</button>
        <button onClick={handleExport}
          className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-sm hover:bg-gray-50">导出</button>
      </div>

      <TableContainer>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">盘点单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">仓库</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">盘点日期</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">类型</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: InventoryStocktake) => {
              const st = STATUS_MAP[item.status] || { label: item.status, tone: 'neutral' };
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4">{item.stocktakeNo}</td>
                  <td className="px-4">{item.warehouseName}</td>
                  <td className="px-4">{item.stocktakeDate.slice(0, 10)}</td>
                  <td className="px-4">{item.itemType === 'sku' ? '成品' : '面辅料'}</td>
                  <td className="px-4"><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td className="px-4 space-x-2">
                    <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                    {item.status === 'draft' && (
                      <>
                        <button onClick={() => handleApprove(item.id)} className="text-green-500 hover:underline">审核</button>
                        <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">删除</button>
                                            <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                    )}
                    {item.status === 'approved' && (
                      <button onClick={() => handlePost(item.id)} className="text-blue-500 hover:underline">记账</button>
                    )}
                  </td>
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
    </div>
  );
}
