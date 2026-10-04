import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { inventoryApi } from '@client/src/api/inventory';
import { baseApi } from '@client/src/api/base';
import type {
  InventoryTransfer,
  PaginationResult,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { Printer } from 'lucide-react';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  in_transit: { label: '在途', tone: 'warn' },
  completed: { label: '已完成', tone: 'ok' },
  accepted: { label: '已验收', tone: 'info' },
  cancelled: { label: '已作废', tone: 'danger' },
};

export default function InventoryTransferPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<InventoryTransfer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [filterFromWhId, setFilterFromWhId] = useState('');
  const [filterToWhId, setFilterToWhId] = useState('');

  const [warehouseOptions, setWarehouseOptions] = useState<any[]>([]);
  const [storeOptions, setStoreOptions] = useState<any[]>([]);
  const [dealerOptions, setDealerOptions] = useState<any[]>([]);

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (status) params.status = status;
      if (filterFromWhId) params.fromWarehouseId = filterFromWhId;
      if (filterToWhId) params.toWarehouseId = filterToWhId;
      const res: PaginationResult<InventoryTransfer> = await inventoryApi.transfer.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载调拨单失败', e);
      toast(errMsg(e, '加载失败'));
    } finally { setLoading(false); }
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

  useEffect(() => { fetchList(); fetchOptions(); }, [page, pageSize, status, filterFromWhId, filterToWhId]);

  const getWarehouseTypeLabel = (id: string): string => {
    const w = warehouseOptions.find((wh: any) => wh.id === id);
    if (!w) return '';
    if (w.type === 'finished') return '总部成品仓';
    if (w.type === 'material') return '原料仓';
    if (w.type === 'semi') return '半成品仓';
    return w.type;
  };

  const getStoreInfo = (id: string): any => {
    return storeOptions.find((s: any) => s.id === id);
  };

  const getDealerName = (dealerId?: string): string => {
    if (!dealerId) return '';
    return dealerOptions.find((d: any) => d.id === dealerId)?.name || '';
  };

  /**
   * 构造"调出方/调入方"显示单元格内容
   */
  const renderPartyCell = (item: InventoryTransfer, side: 'from' | 'to') => {
    const storeId = side === 'from' ? item.fromStoreId : item.toStoreId;
    const storeName = side === 'from' ? item.fromStoreName : item.toStoreName;
    const whId = side === 'from' ? item.fromWarehouseId : item.toWarehouseId;
    const whName = side === 'from' ? item.fromWarehouseName : item.toWarehouseName;

    if (storeId && storeName) {
      const store = getStoreInfo(storeId);
      let belongTo = '';
      if (store) {
        if (store.storeType === 'direct') belongTo = '直营店';
        else if (store.storeType === 'dealer') belongTo = getDealerName(store.dealerId) || '经销商';
        else belongTo = store.storeType;
      }
      return (
        <div>
          <div className="text-gray-800">门店：{storeName}</div>
          <div className="text-xs text-gray-500 mt-0.5">归属：{belongTo}</div>
        </div>
      );
    }
    const belongTo = getWarehouseTypeLabel(whId);
    return (
      <div>
        <div className="text-gray-800">仓库：{whName}</div>
        <div className="text-xs text-gray-500 mt-0.5">归属：{belongTo}</div>
      </div>
    );
  };

  const openCreate = () => {
    navigate('/inventory/transfer/new');
  };

  const openView = (id: string) => {
    navigate(`/inventory/transfer/${id}/edit?view=true`);
  };

  const handleBook = async (id: string) => {
    if (!await showConfirm('确定记账(发货)？记账后扣减调出库存并生成在途。')) return;
    try {
      await inventoryApi.transfer.approve(id);
      toast('记账成功');
      fetchList();
    } catch (e) {
      logger.error('记账失败', e);
      toast(errMsg(e, '记账失败'));
    }
  };

  const handleAccept = async (id: string) => {
    if (!await showConfirm('确定验收？验收后调拨单置为终态。')) return;
    try {
      await inventoryApi.transfer.accept(id);
      toast('验收成功');
      fetchList();
    } catch (e) {
      logger.error('验收失败', e);
      toast(errMsg(e, '验收失败'));
    }
  };

  const handleVoid = async (id: string) => {
    if (!await showConfirm('确定作废？作废后单据不可恢复。')) return;
    try {
      await inventoryApi.transfer.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      logger.error('作废失败', e);
      toast(errMsg(e, '作废失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定删除？')) return;
    try {
      await inventoryApi.transfer.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      logger.error('删除失败', e);
      toast(errMsg(e, '删除失败'));
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (status) params.status = status;
      if (filterFromWhId) params.fromWarehouseId = filterFromWhId;
      if (filterToWhId) params.toWarehouseId = filterToWhId;
      const res: PaginationResult<InventoryTransfer> = await inventoryApi.transfer.list(params);
      const data = res.items.map((it: InventoryTransfer) => ({
        transferNo: it.transferNo,
        fromWarehouseName: it.fromWarehouseName || it.fromStoreName || '',
        toWarehouseName: it.toWarehouseName || it.toStoreName || '',
        transferDate: it.transferDate?.slice(0, 10) || '',
        itemCount: it.items?.length ?? 0,
        status: STATUS_MAP[it.status]?.label || it.status,
      }));
      exportTableToCSV('调拨单', data as unknown as Record<string, unknown>[], {
        transferNo: '调拨单号',
        fromWarehouseName: '调出方',
        toWarehouseName: '调入方',
        transferDate: '调拨日期',
        itemCount: '明细数',
        status: '状态',
      });
    } catch (e) {
      logger.error('导出调拨单失败', e);
      toast(errMsg(e, '导出失败'));
    }
  };

  // 归属校验结果（实时）
  const handleSearch = () => {
    setPage(1);
    fetchList();
  };

  const handleReset = () => {
    setStatus('');
    setFilterFromWhId('');
    setFilterToWhId('');
    setPage(1);
    fetchList();
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">调拨单</h1>
          <button onClick={openCreate} className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-blue-600">
            + 新增调拨单
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
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">调出方仓库</label>
          <select value={filterFromWhId} onChange={(e) => setFilterFromWhId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-44">
            <option value="">全部</option>
            {warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">调入方仓库</label>
          <select value={filterToWhId} onChange={(e) => setFilterToWhId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-44">
            <option value="">全部</option>
            {warehouseOptions.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <button onClick={handleSearch}
          className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600">查询</button>
        <button onClick={handleExport}
          className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-sm hover:bg-gray-50">导出</button>
        <button onClick={handleReset}
          className="bg-gray-100 text-gray-600 px-4 py-1.5 rounded text-sm hover:bg-gray-200">重置</button>
      </div>

      <TableContainer>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">调拨单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">调出方</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">调入方</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">调拨日期</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">明细数</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: InventoryTransfer) => {
              const st = STATUS_MAP[item.status] || { label: item.status, tone: 'neutral' };
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4">{item.transferNo}</td>
                  <td className="px-4 py-2">{renderPartyCell(item, 'from')}</td>
                  <td className="px-4 py-2">{renderPartyCell(item, 'to')}</td>
                  <td className="px-4">{item.transferDate.slice(0, 10)}</td>
                  <td className="px-4">{item.items?.length ?? 0}</td>
                  <td className="px-4"><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td className="px-4 space-x-2">
                    <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                    {item.status === 'draft' && (
                      <>
                        <button onClick={() => handleBook(item.id)} className="text-green-500 hover:underline">记账</button>
                        <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">删除</button>
                        <button onClick={() => handleVoid(item.id)} className="text-gray-500 hover:underline">作废</button>
                      </>
                    )}
                    {item.status === 'completed' && (
                      <button onClick={() => handleAccept(item.id)} className="text-teal-500 hover:underline">验收</button>
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
