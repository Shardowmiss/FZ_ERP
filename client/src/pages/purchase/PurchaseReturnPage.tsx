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
  const [statusFilter, setStatusFilter] = useState('');
  const [keyword, setKeyword] = useState('');

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
  }, [page, pageSize, statusFilter]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (statusFilter) params.append('status', statusFilter);
      if (keyword) params.append('keyword', keyword);

      const res = await axiosForBackend.get(`/api/purchase/return?${params.toString()}`);
      setList(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (error) {
      logger.error('加载采购退货列表失败', error);
      toast('加载失败');
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
      const params = new URLSearchParams({
        page: '1',
        pageSize: '10000',
      });
      if (statusFilter) params.append('status', statusFilter);
      if (keyword) params.append('keyword', keyword);
      const res = await axiosForBackend.get(`/api/purchase/return?${params.toString()}`);
      exportTableToCSV('采购退货单', (res.data.items || []) as Record<string, unknown>[], {
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
    const map: Record<string, { label: string; className: string }> = {
      draft: { label: '草稿', className: 'bg-gray-100 text-gray-600' },
      approved: { label: '已审核', className: 'bg-green-100 text-green-700' },
    };
    return map[status] || { label: status, className: 'bg-gray-100 text-gray-600' };
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
          className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 flex items-center gap-1"
        >
          <Plus size={16} /> 新增采购退货
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded">
        <input
          type="text"
          placeholder="搜索单号/供应商"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-52 focus:outline-none focus:border-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="approved">已审核</option>
                    <option value="cancelled">已作废</option>
</select>
        <button
          onClick={() => { setPage(1); loadList(); }}
          className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
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
          onClick={() => { setKeyword(''); setStatusFilter(''); setPage(1); setTimeout(loadList, 0); }}
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
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${s.className}`}>
                        {s.label}
                      </span>
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
                           <button onClick={() => handleView(item)} className="text-blue-500 hover:text-blue-600 mr-3">查看</button>
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
