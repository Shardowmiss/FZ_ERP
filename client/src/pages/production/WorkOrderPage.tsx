import { useState, useEffect } from 'react';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Download } from 'lucide-react';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type {
  ProductionWorkOrder,
  PaginationResult,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { validateDateRange } from '@client/src/utils/date-utils';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-600' },
  pending: { label: '待下发', color: 'bg-amber-100 text-amber-600' },
  producing: { label: '生产中', color: 'bg-blue-100 text-blue-600' },
  finished: { label: '已完工', color: 'bg-green-100 text-green-600' },
  closed: { label: '已关闭', color: 'bg-slate-100 text-slate-600' },
};

export default function WorkOrderPage() {
  const [list, setList] = useState<ProductionWorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const def = useDefaultDocDate();
  const [filterStartDate, setFilterStartDate] = useState(def.startDate);
  const [filterEndDate, setFilterEndDate] = useState(def.endDate);

  const [styleOptions, setStyleOptions] = useState<{ id: string; styleNo: string; name: string }[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const navigate = useNavigate();

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        status?: string;
        startDate?: string;
        endDate?: string;
        keyword?: string;
      } = { page, pageSize };
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<ProductionWorkOrder> =
        await productionApi.workOrder.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载生产工单失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, pageSize, filterStatus, filterStartDate, filterEndDate, keyword]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [styles, suppliers] = await Promise.all([
          baseApi.style.options(),
          baseApi.supplier.options(),
        ]);
        setStyleOptions(styles);
        setSupplierOptions(suppliers);
      } catch (e) {
        logger.error('加载选项失败', e);
      }
    };
    loadOpts();
  }, []);

  const openCreate = (): void => {
    navigate('/production/work-order/new');
  };

  const openEdit = (id: string): void => {
    navigate(`/production/work-order/${id}/edit`);
  };

  const openView = (id: string): void => {
    navigate(`/production/work-order/${id}/edit?view=1`);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该生产工单吗？')) return;
    try {
      await productionApi.workOrder.remove(id);
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
      await productionApi.workOrder.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleApprove = async (id: string): Promise<void> => {
    if (!await showConfirm('确定审核下发？下发后状态将变为生产中')) return;
    try {
      await productionApi.workOrder.approve(id);
      toast('审核下发成功');
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
        startDate?: string;
        endDate?: string;
        keyword?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<ProductionWorkOrder> =
        await productionApi.workOrder.list(params);
      const data = res.items.map((it: ProductionWorkOrder) => ({
        orderNo: it.orderNo,
        styleNo: it.styleNo,
        quantity: it.quantity,
        factoryName: it.factoryName ?? '',
        planStartDate: it.planStartDate?.slice(0, 10) ?? '',
        planFinishDate: it.planFinishDate?.slice(0, 10) ?? '',
        status: STATUS_MAP[it.status]?.label || it.status,
      }));
      exportTableToCSV('生产工单', data as unknown as Record<string, unknown>[], {
        orderNo: '工单号',
        styleNo: '款号',
        quantity: '生产数量',
        factoryName: '供应商/工厂',
        planStartDate: '预计开工',
        planFinishDate: '预计完工',
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
          <h1 className="text-xl font-semibold">生产工单</h1>
          <button
            onClick={openCreate}
            className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-blue-600 flex items-center gap-1"
          >
            <Plus size={16} /> 新增工单
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
                placeholder="工单号/款号"
                className="border border-gray-300 rounded pl-7 pr-2 py-1.5 text-sm w-44 focus:outline-none focus:border-primary"
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
            <label className="text-xs text-gray-500 mb-1">预计开工日期</label>
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
            className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600 flex items-center gap-1"
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
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">工单号</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">款号</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">生产数量</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">供应商/工厂</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">预计开工</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">预计完工</th>
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
              {!loading && list.map((item: ProductionWorkOrder) => {
                const st = STATUS_MAP[item.status] || { label: item.status, color: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                    <td className="px-4 font-medium text-gray-800">{item.orderNo}</td>
                    <td className="px-4">{item.styleNo}</td>
                    <td className="px-4 text-right">{item.quantity}</td>
                    <td className="px-4">{item.factoryName || '-'}</td>
                    <td className="px-4 text-gray-500">{item.planStartDate?.slice(0, 10) || '-'}</td>
                    <td className="px-4 text-gray-500">{item.planFinishDate?.slice(0, 10) || '-'}</td>
                    <td className="px-4">
                      <span className={`px-2 py-0.5 rounded text-xs ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="px-4 space-x-2">
                      <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                      {item.status === 'draft' && (
                        <>
                          <button onClick={() => openEdit(item.id)} className="text-primary hover:underline">编辑</button>
                          <button onClick={() => handleApprove(item.id)} className="text-green-500 hover:underline">审核下发</button>
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
