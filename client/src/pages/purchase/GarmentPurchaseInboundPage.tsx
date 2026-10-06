import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { PurchaseFilterBar } from '@client/src/components/PurchaseFilterBar';
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
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

const statusLabel: Record<string, string> = {
  draft: '待审核',
  approved: '已审核',
  completed: '已完成',
  cancelled: '已作废',
};

const statusColor: Record<string, StatusTone> = {
  draft: 'neutral',
  approved: 'ok',
  completed: 'info',
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

  // 单据默认查询窗口（近 N 天，来自系统参数 defaultDocQueryDays）
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [filterDocStart, setFilterDocStart] = useState(defaultDocStart);
  const [filterDocEnd, setFilterDocEnd] = useState(defaultDocEnd);
  const [filterInboundStart, setFilterInboundStart] = useState('');
  const [filterInboundEnd, setFilterInboundEnd] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        supplierId?: string;
        status?: string;
        orderNo?: string;
        warehouseId?: string;
        docStartDate?: string;
        docEndDate?: string;
        startDate?: string;
        endDate?: string;
      } = { page, pageSize };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.orderNo = keyword;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterInboundStart) params.startDate = filterInboundStart;
      if (filterInboundEnd) params.endDate = filterInboundEnd;
      const res = await garmentPurchaseApi.inbound.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, filterSupplier, filterStatus, keyword, filterWarehouse, filterDocStart, filterDocEnd, filterInboundStart, filterInboundEnd]);

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

  const openEdit = (id: string): void => {
    navigate(`/purchase/garment-inbound/${id}/edit`);
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
        warehouseId?: string;
        docStartDate?: string;
        docEndDate?: string;
        startDate?: string;
        endDate?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.orderNo = keyword;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterInboundStart) params.startDate = filterInboundStart;
      if (filterInboundEnd) params.endDate = filterInboundEnd;
      const res: PaginationResult<GarmentPurchaseInbound> = await garmentPurchaseApi.inbound.list(params);
      exportTableToCSV('采购入库单', res.items as unknown as Record<string, unknown>[], {
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
          <h1 className="text-xl font-semibold text-gray-800">采购入库</h1>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary flex items-center gap-1"
          >
             <Plus size={16} /> 新增采购入库
          </button>
        </div>
        <PurchaseFilterBar
          onSearch={() => { setPage(1); fetchList(); }}
          onReset={() => {
            setFilterSupplier('');
            setFilterStatus('');
            setKeyword('');
            setFilterWarehouse('');
            setFilterDocStart(defaultDocStart);
            setFilterDocEnd(defaultDocEnd);
            setFilterInboundStart('');
            setFilterInboundEnd('');
            setPage(1);
            fetchList();
          }}
          dateLabel="单据日期"
          dateStart={filterDocStart}
          dateEnd={filterDocEnd}
          onDateStartChange={setFilterDocStart}
          onDateEndChange={setFilterDocEnd}
          showSecondaryDate
          secondaryDateLabel="入库日期"
          secondaryDateStart={filterInboundStart}
          secondaryDateEnd={filterInboundEnd}
          onSecondaryDateStartChange={setFilterInboundStart}
          onSecondaryDateEndChange={setFilterInboundEnd}
          showSupplier
          supplierId={filterSupplier}
          onSupplierChange={setFilterSupplier}
          supplierOptions={supplierOptions}
          showStatus
          status={filterStatus}
          onStatusChange={setFilterStatus}
          statusOptions={[
            { value: 'draft', label: '待审核' },
            { value: 'approved', label: '已审核' },
            { value: 'completed', label: '已完成' },
          ]}
          showWarehouse
          warehouseId={filterWarehouse}
          onWarehouseChange={setFilterWarehouse}
          warehouseOptions={warehouseOptions}
          showKeyword
          keyword={keyword}
          onKeywordChange={setKeyword}
          keywordPlaceholder="搜索采购单号"
          extraButtons={
            <button
              type="button"
              onClick={() => { void handleExport(); }}
              className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              导出
            </button>
          }
        />
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
                    <StatusBadge tone={statusColor[item.status] ?? 'neutral'}>{statusLabel[item.status] ?? item.status}</StatusBadge>
                  </td>
                  <td className="py-2 px-4 space-x-2">
                    {item.status === 'draft' && (
                      <>
                        <button
                          onClick={() => openEdit(item.id)}
                          className="text-primary hover:text-primary"
                        >编辑</button>
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
                    {item.status === 'approved' && (
                      <button
                        onClick={() => openEdit(item.id)}
                        className="text-primary hover:text-primary"
                      >验收</button>
                    )}
                    {item.status === 'completed' && (
                      <button
                        onClick={() => openView(item.id)}
                        className="text-primary hover:text-primary"
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
