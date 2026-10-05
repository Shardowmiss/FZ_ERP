import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Download } from 'lucide-react';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type {
  ProductionFinishReceipt,
  PaginationResult,
  Warehouse,
  Sku,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { validateDateRange } from '@client/src/utils/date-utils';
import { errMsg } from '@/utils/errMsg';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  pending: { label: '待审', tone: 'warn' },
  approved: { label: '已审', tone: 'ok' },
};

export default function FinishReceiptPage() {
  const [list, setList] = useState<ProductionFinishReceipt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [filterStartDate, setFilterStartDate] = useState(defaultDocStart);
  const [filterEndDate, setFilterEndDate] = useState(defaultDocEnd);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [skus, setSkus] = useState<Sku[]>([]);
  const [workOrderOptions, setWorkOrderOptions] = useState<{ id: string; orderNo: string }[]>([]);

  const navigate = useNavigate();

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        status?: string;
        keyword?: string;
        startDate?: string;
        endDate?: string;
      } = { page, pageSize };
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.keyword = keyword;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      const res: PaginationResult<ProductionFinishReceipt> =
        await productionApi.finishReceipt.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载完工入库单失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, pageSize, filterStatus, keyword, filterStartDate, filterEndDate]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [wh, skuList, wo] = await Promise.all([
          baseApi.warehouse.list({ page: 1, pageSize: 1000, status: 'active' }),
          baseApi.sku.list({ page: 1, pageSize: 1000 }),
          productionApi.workOrder.list({ page: 1, pageSize: 1000, status: 'producing' }),
        ]);
        setWarehouses(wh.items);
        setSkus(skuList.items);
        setWorkOrderOptions(wo.items.map((it) => ({ id: it.id, orderNo: it.orderNo })));
      } catch (e) {
        logger.error('加载选项失败', e);
      }
    };
    loadOpts();
  }, []);

  const openCreate = (): void => {
    navigate('/production/finish-receipt/new');
  };

  const openEdit = (id: string): void => {
    navigate(`/production/finish-receipt/${id}/edit`);
  };

  const openView = (id: string): void => {
    navigate(`/production/finish-receipt/${id}/edit?view=1`);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该完工入库单吗？')) return;
    try {
      await productionApi.finishReceipt.remove(id);
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
      await productionApi.finishReceipt.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleApprove = async (id: string): Promise<void> => {
    if (!await showConfirm('确定审核通过？审核后将增加库存')) return;
    try {
      await productionApi.finishReceipt.approve(id);
      toast('审核成功');
      fetchList();
    } catch (e) {
      logger.error('审核失败', e);
      toast(errMsg(e, '审核失败'));
    }
  };

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleSearch = (): void => {
    const error = validateDateRange(filterStartDate, filterEndDate);
    if (error) { toast.error(error); return; }
    setPage(1);
    fetchList();
  };

  const handleExport = async (): Promise<void> => {
    try {
      const params: {
        page: number;
        pageSize: number;
        status?: string;
        keyword?: string;
        startDate?: string;
        endDate?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.keyword = keyword;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      const res: PaginationResult<ProductionFinishReceipt> =
        await productionApi.finishReceipt.list(params);
      const data = res.items.map((it: ProductionFinishReceipt) => ({
        receiptNo: it.receiptNo,
        workOrderNo: it.workOrderNo,
        warehouseId: it.warehouseId,
        receiptDate: it.receiptDate.slice(0, 10),
        finishedQty: it.finishedQty,
        defectiveQty: it.defectiveQty,
        status: STATUS_MAP[it.status]?.label || it.status,
      }));
      exportTableToCSV('完工入库单', data as unknown as Record<string, unknown>[], {
        receiptNo: '完工单号',
        workOrderNo: '生产工单号',
        warehouseId: '入库仓库',
        receiptDate: '入库日期',
        finishedQty: '完工数量',
        defectiveQty: '次品数量',
        status: '状态',
      });
    } catch (e) {
      logger.error('导出失败', e);
      toast(errMsg(e, '导出失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">完工入库单</h1>
          <button
            onClick={openCreate}
            className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-primary flex items-center gap-1"
          >
            <Plus size={16} /> 新增完工单
          </button>
        </div>

        <div className="bg-white rounded p-4 mb-4 border border-gray-100 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">关键词</label>
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="完工单号/工单号"
                className="border border-gray-300 rounded pl-7 pr-2 py-1.5 text-sm w-48 focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">状态</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
            >
              <option value="">全部</option>
              {Object.entries(STATUS_MAP).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
                        <option value="cancelled">已作废</option>
</select>
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">入库日期</label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
              <span className="text-gray-400">~</span>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary flex items-center gap-1"
          >
            <Search size={14} /> 查询
          </button>
          <button
            onClick={handleExport}
            className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-sm hover:bg-gray-50 flex items-center gap-1"
          >
            <Download size={14} /> 导出
          </button>
        </div>

        <TableContainer>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">完工单号</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">生产工单号</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">入库仓库</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">入库日期</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">完工数量</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">次品数量</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">加载中...</td></tr>
              )}
              {!loading && list.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">暂无数据</td></tr>
              )}
              {!loading && list.map((item: ProductionFinishReceipt) => {
                const st = STATUS_MAP[item.status] || { label: item.status, tone: 'neutral' };
                const wh = warehouses.find((w) => w.id === item.warehouseId);
                return (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                    <td className="px-4 font-medium text-gray-800">{item.receiptNo}</td>
                    <td className="px-4">{item.workOrderNo}</td>
                    <td className="px-4">{wh?.name ?? item.warehouseId}</td>
                    <td className="px-4 text-gray-500">{item.receiptDate.slice(0, 10)}</td>
                    <td className="px-4 text-right">{item.finishedQty}</td>
                    <td className="px-4 text-right">{item.defectiveQty}</td>
                    <td className="px-4">
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                    </td>
                    <td className="px-4 space-x-2">
                      <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                      {item.status === 'draft' && (
                        <>
                          <button onClick={() => openEdit(item.id)} className="text-primary hover:underline">编辑</button>
                          <button onClick={() => handleApprove(item.id)} className="text-green-500 hover:underline">审核</button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">删除</button>
                                                <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
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
