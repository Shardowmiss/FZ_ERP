import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { garmentPurchaseApi, baseApi } from '@client/src/api';
import type { GarmentPurchaseInbound, GarmentPurchaseOrder, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  approved: '已审',
  completed: '已完成',
  cancelled: '已作废',
};

const statusColor: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-600',
  completed: 'bg-blue-100 text-blue-600',
};

const GarmentPurchaseInboundPage: React.FC = () => {
  const navigate = useNavigate();
  const [list, setList] = useState<GarmentPurchaseInbound[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');

  const [supplierOptions, setSupplierOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);
  const [warehouseOptions, setWarehouseOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        supplierId?: string;
        status?: string;
        orderNo?: string;
      } = { page, pageSize };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.orderNo = keyword;
      const res = await garmentPurchaseApi.inbound.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch {
      toast('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, filterSupplier, filterStatus, keyword]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [s, w] = await Promise.all([
          baseApi.supplier.options(),
          baseApi.warehouse.options(),
        ]);
        setSupplierOptions(s);
        setWarehouseOptions(w);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  const openAdd = (): void => {
    navigate('/purchase/garment-inbound/new');
  };

  const openView = (id: string): void => {
    navigate(`/purchase/garment-inbound/${id}/edit?view=1`);
  };

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async (): Promise<void> => {
    try {
      const params: {
        page: number;
        pageSize: number;
        supplierId?: string;
        status?: string;
        orderNo?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.orderNo = keyword;
      const res: PaginationResult<GarmentPurchaseInbound> = await garmentPurchaseApi.inbound.list(params);
      exportTableToCSV('款号采购入库单', res.items as unknown as Record<string, unknown>[], {
        inboundNo: '入库单号',
        orderNo: '采购单号',
        supplierName: '供应商',
        warehouseName: '仓库',
        inboundDate: '入库日期',
        totalQty: '总数量',
        totalAmount: '总金额',
        status: '状态',
      });
    } catch (e) {
      toast.error(errMsg(e, '导出失败'));
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该入库单吗？')) return;
    try {
      await garmentPurchaseApi.inbound.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await garmentPurchaseApi.inbound.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleApprove = async (id: string): Promise<void> => {
    if (!await showConfirm('确定审核通过吗？')) return;
    try {
      await garmentPurchaseApi.inbound.approve(id);
      toast('审核成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '审核失败'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-800">款号采购入库</h1>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
             <Plus size={16} /> 新增款号采购入库
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">供应商：</span>
            <select
              value={filterSupplier}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterSupplier(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">全部</option>
              {supplierOptions.map((s: { id: string; code: string; name: string }) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
                        <option value="cancelled">已作废</option>
</select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">状态：</span>
            <select
              value={filterStatus}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">全部</option>
              <option value="draft">草稿</option>
              <option value="approved">已审</option>
              <option value="completed">已完成</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
                placeholder="搜索采购单号"
                className="border border-gray-300 rounded pl-7 pr-2 py-1 text-sm focus:outline-none focus:border-blue-500 w-44"
              />
            </div>
          </div>
          <button
            onClick={() => { setPage(1); fetchList(); }}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
            <Search size={14} /> 查询
          </button>
          <button
            onClick={() => { void handleExport(); }}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            导出
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5">
        <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
              <th className="text-left py-2.5 px-4 font-medium">入库单号</th>
              <th className="text-left py-2.5 px-4 font-medium">采购单号</th>
              <th className="text-left py-2.5 px-4 font-medium">供应商</th>
              <th className="text-left py-2.5 px-4 font-medium">仓库</th>
              <th className="text-left py-2.5 px-4 font-medium">入库日期</th>
              <th className="text-right py-2.5 px-4 font-medium">总数量</th>
              <th className="text-right py-2.5 px-4 font-medium">总金额</th>
              <th className="text-left py-2.5 px-4 font-medium">状态</th>
              <th className="text-left py-2.5 px-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="text-center py-12 text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-12 text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item: GarmentPurchaseInbound) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-100 h-10 hover:bg-gray-50"
                >
                  <td className="py-2 px-4 font-medium text-gray-800">{item.inboundNo}</td>
                  <td className="py-2 px-4">{item.orderNo}</td>
                  <td className="py-2 px-4">{item.supplierName}</td>
                  <td className="py-2 px-4">{item.warehouseName}</td>
                  <td className="py-2 px-4 text-gray-500">{item.inboundDate.slice(0, 10)}</td>
                  <td className="py-2 px-4 text-right">{item.totalQty}</td>
                  <td className="py-2 px-4 text-right font-medium text-gray-800">
                    ¥ {item.totalAmount.toFixed(2)}
                  </td>
                  <td className="py-2 px-4">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${statusColor[item.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {statusLabel[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="py-2 px-4 space-x-2">
                    {item.status === 'draft' && (
                      <>
                        <button
                          onClick={() => { void handleApprove(item.id); }}
                          className="text-green-500 hover:text-green-600"
                        >审核</button>
                        <button
                          onClick={() => { void handleDelete(item.id); }}
                          className="text-red-500 hover:text-red-600"
                        >删除</button>
                                            <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                    )}
                    {(item.status === 'approved' || item.status === 'completed') && (
                       <button
                         onClick={() => openView(item.id)}
                         className="text-blue-500 hover:text-blue-600"
                       >查看</button>
                    )}
                  </td>
                </tr>
              ))
            )}
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
};

export default GarmentPurchaseInboundPage;
