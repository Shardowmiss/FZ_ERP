import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { Printer, Plus } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';
import { purchaseApi } from '@client/src/api/purchase';
import { baseApi } from '@client/src/api/base';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

interface PurchaseReturn {
  id: string;
  returnNo: string;
  inboundId: string;
  inboundNo: string;
  orderId: string;
  orderNo: string;
  supplierId: string;
  supplierName?: string;
  warehouseId: string;
  warehouseName?: string;
  returnDate: string;
  totalAmount: number;
  status: string;
  remark?: string;
  items?: Array<{
    id: string;
    materialId: string;
    materialCode: string;
    materialName: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    batchNo?: string;
  }>;
}

const PurchaseReturnPage: React.FC = () => {
  const [list, setList] = useState<PurchaseReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('draft'); // 默认查「未出库」= 草稿（审核即出库）
  const [keyword, setKeyword] = useState('');

  // 单据日期（createdAt/_created_at）：默认近 90 天
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [filterDocStart, setFilterDocStart] = useState(defaultDocStart);
  const [filterDocEnd, setFilterDocEnd] = useState(defaultDocEnd);
  // 退货日期（出库日期，returnDate）：默认不限制
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const navigate = useNavigate();

  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printWarehouseName, setPrintWarehouseName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState(0);
  const [printRemark, setPrintRemark] = useState('');

  useEffect(() => {
    loadList();
  }, [page, pageSize, statusFilter, filterDocStart, filterDocEnd, filterStartDate, filterEndDate, filterSupplier, filterWarehouse, keyword]);

  useEffect(() => {
    const loadOpts = async () => {
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

  const loadList = async () => {
    setLoading(true);
    try {
      const params: {
        page: number; pageSize: number;
        status?: string; startDate?: string; endDate?: string;
        docStartDate?: string; docEndDate?: string;
        supplierId?: string; warehouseId?: string; keyword?: string;
      } = { page, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (keyword) params.keyword = keyword;
      const res = await purchaseApi.return.list(params);
      setList((res.items || []) as unknown as PurchaseReturn[]);
      setTotal(res.total || 0);
    } catch (error) {
      logger.error('加载采购退货列表失败', error);
      toast(errMsg(error, '加载失败'));
    }
    setLoading(false);
  };

  const handleAdd = (): void => {
    navigate('/purchase/return/new');
  };

  const handleView = (item: PurchaseReturn): void => {
    navigate(`/purchase/return/${item.id}/edit?view=1`);
  };

  const openPrintDialog = (item: PurchaseReturn) => {
    const items: MaterialListItem[] = (item.items ?? []).map((it) => ({
      code: it.materialCode,
      name: it.materialName,
      unit: it.unit,
      quantity: it.quantity,
      price: it.unitPrice,
      amount: it.amount,
    }));
    setPrintItems(items);
    setPrintDocNo(item.returnNo);
    setPrintDocDate(item.returnDate);
    setPrintPartnerName(item.supplierName || '');
    setPrintWarehouseName(item.warehouseName || '');
    setPrintTotalAmount(item.totalAmount);
    setPrintRemark(item.remark || '');
    setPrintOpen(true);
  };

  const handleListPrint = async (item: PurchaseReturn) => {
    try {
      const res = await axiosForBackend.get(`/api/purchase/return/${item.id}`);
      openPrintDialog(res.data);
    } catch {
      openPrintDialog(item);
    }
  };

  const handleApprove = async (id: string) => {
    if (!await showConfirm('确认审核该退货单？审核后库存将减少，应付将调整。')) return;
    try {
      await axiosForBackend.post(`/api/purchase/return/${id}/approve`);
      toast('审核成功');
      loadList();
    } catch (error) {
      logger.error('审核失败', error);
      toast(errMsg(error, '审核失败'));
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: {
        page: number; pageSize: number;
        status?: string; startDate?: string; endDate?: string;
        docStartDate?: string; docEndDate?: string;
        supplierId?: string; warehouseId?: string; keyword?: string;
      } = { page: 1, pageSize: 10000 };
      if (statusFilter) params.status = statusFilter;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (keyword) params.keyword = keyword;
      const res = await purchaseApi.return.list(params);
      exportTableToCSV('采购退货单', (res.items || []) as unknown as Record<string, unknown>[], {
        returnNo: '退货单号',
        inboundNo: '入库单号',
        supplierName: '供应商',
        warehouseName: '仓库',
        returnDate: '退货日期',
        totalAmount: '退货金额',
        status: '状态',
      });
    } catch (error) {
      logger.error('导出失败', error);
      toast.error(errMsg(error, '导出失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确认删除该退货单？')) return;
    try {
      await axiosForBackend.delete(`/api/purchase/return/${id}`);
      toast('删除成功');
      loadList();
    } catch (error) {
      logger.error('删除失败', error);
      toast(errMsg(error, '删除失败'));
    }
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, { label: string; tone: StatusTone }> = {
      draft: { label: '草稿', tone: 'neutral' },
      approved: { label: '已审核', tone: 'ok' },
      cancelled: { label: '已作废', tone: 'danger' },
    };
    return map[status] || { label: status, tone: 'neutral' };
  };

  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await axiosForBackend.post(`/api/purchase/return/${id}/void`);
      toast('作废成功');
      loadList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };

  return (
    <div className="p-5 bg-white rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">采购退货</h1>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary flex items-center gap-1"
        >
          <Plus size={16} /> 新增采购退货
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-50 rounded">
        <select
          value={filterSupplier}
          onChange={(e) => { setFilterSupplier(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部供应商</option>
          {supplierOptions.map((s: { id: string; code: string; name: string }) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={filterWarehouse}
          onChange={(e) => { setFilterWarehouse(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部仓库</option>
          {warehouseOptions.map((w: { id: string; code: string; name: string }) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <span className="text-gray-600 text-sm">单据日期：</span>
          <input
            type="date"
            value={filterDocStart}
            onChange={(e) => { setFilterDocStart(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
          <span className="text-gray-400">至</span>
          <input
            type="date"
            value={filterDocEnd}
            onChange={(e) => { setFilterDocEnd(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-600 text-sm">退货日期：</span>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => { setFilterStartDate(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
          <span className="text-gray-400">至</span>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => { setFilterEndDate(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <input
          type="text"
          placeholder="搜索单号/供应商"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-52 focus:outline-none focus:border-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿（未出库）</option>
          <option value="approved">已审核</option>
          <option value="cancelled">已作废</option>
        </select>
        <button
          onClick={() => { setPage(1); loadList(); }}
          className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary"
        >
          查询
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          导出
        </button>
        <button
          onClick={() => {
            setKeyword(''); setStatusFilter('draft');
            setFilterDocStart(defaultDocStart); setFilterDocEnd(defaultDocEnd);
            setFilterStartDate(''); setFilterEndDate('');
            setFilterSupplier(''); setFilterWarehouse('');
            setPage(1); setTimeout(loadList, 0);
          }}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
        >
          重置
        </button>
      </div>

      <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
              <th className="px-4 py-3 text-left">退货单号</th>
              <th className="px-4 py-3 text-left">入库单号</th>
              <th className="px-4 py-3 text-left">供应商</th>
              <th className="px-4 py-3 text-left">仓库</th>
              <th className="px-4 py-3 text-left">退货日期</th>
              <th className="px-4 py-3 text-right">退货金额</th>
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => {
                const s = getStatusLabel(item.status);
                return (
                  <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{item.returnNo}</td>
                    <td className="px-4 py-3 text-gray-600">{item.inboundNo}</td>
                    <td className="px-4 py-3 text-gray-700">{item.supplierName || '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{item.warehouseName || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.returnDate}</td>
                    <td className="px-4 py-3 text-right text-gray-700">¥{item.totalAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.status === 'draft' ? (
                        <>
                          <button onClick={() => handleApprove(item.id)} className="text-green-500 hover:text-green-600 mr-3">审核</button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-600 mr-3">删除</button><button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600 mr-3">作废</button>
                          <button onClick={() => handleListPrint(item)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                            <Printer size={14} />
                          </button>
                        </>
                       ) : (
                         <>
                           <button onClick={() => handleView(item)} className="text-primary hover:text-primary mr-3">查看</button>
                           <button onClick={() => handleListPrint(item)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                             <Printer size={14} />
                           </button>
                         </>
                       )}
                    </td>
                  </tr>
                );
              })
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

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="采购退货单"
      >
        <MaterialDocPrintContent
          docType="采购退货单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="供应商"
          partnerName={printPartnerName}
          warehouseName={printWarehouseName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </div>
  );
};

export default PurchaseReturnPage;
