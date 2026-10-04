import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { salesApi } from '@client/src/api/sales';
import type { SalesReturn, PaginationResult } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import { Printer, Plus } from 'lucide-react';
import { useAuth } from '@client/src/contexts/AuthContext';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '新增', tone: 'neutral' },
  audited: { label: '审核', tone: 'warn' },
  booked: { label: '记账', tone: 'info' },
  accepted: { label: '验收', tone: 'ok' },
};

export default function SalesReturnPage() {
  const { hasPermission } = useAuth();
  const [list, setList] = useState<SalesReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');

  const navigate = useNavigate();

  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printWarehouseName, setPrintWarehouseName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState(0);
  const [printRemark, setPrintRemark] = useState('');
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (status) params.status = status;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<SalesReturn> = await salesApi.return.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载退货单失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, [page]);

  const handleSearch = () => { setPage(1); fetchList(); };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (status) params.status = status;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<SalesReturn> = await salesApi.return.list(params);
      exportTableToCSV('销售退货单', res.items as unknown as Record<string, unknown>[], {
        returnNo: '退货单号',
        outboundNo: '出库单号',
        customerName: '客户',
        warehouseName: '仓库',
        returnDate: '退货日期',
        totalAmount: '金额',
        status: '状态',
      });
    } catch (e) {
      logger.error('导出失败', e);
      toast.error(errMsg(e, '导出失败'));
    }
  };

  const openCreate = () => {
    navigate('/sales/return/new');
  };

  const openView = (id: string) => {
    navigate(`/sales/return/${id}/edit?view=1`);
  };

  const handlePrintFromList = async (id: string) => {
    try {
      const detail = await salesApi.return.get(id);
      setPrintDocNo(detail.returnNo);
      setPrintDocDate(detail.returnDate.slice(0, 10));
      setPrintPartnerName(detail.customerName);
      setPrintWarehouseName(detail.warehouseName);
      setPrintTotalAmount(detail.totalAmount);
      setPrintRemark(detail.remark || '');
      setPrintItems((detail.items || []).map((it: any) => ({
        styleNo: it.styleNo || it.skuCode,
        color: it.color,
        size: it.size,
        quantity: it.quantity,
      })));
      setPrintOpen(true);
    } catch (e) {
      logger.error('加载打印数据失败', e);
      toast(errMsg(e, '加载打印数据失败'));
    }
  };

  const handleAudit = async (id: string) => {
    if (!await showConfirm('确定审核？')) return;
    try {
      await salesApi.return.audit(id);
      toast('审核成功');
      fetchList();
    } catch (e) {
      logger.error('审核失败', e);
      toast(errMsg(e, '审核失败'));
    }
  };

  const handleBook = async (id: string) => {
    if (!await showConfirm('确定记账？')) return;
    try {
      await salesApi.return.book(id);
      toast('记账成功');
      fetchList();
    } catch (e) {
      logger.error('记账失败', e);
      toast(errMsg(e, '记账失败'));
    }
  };

  const handleCancelAudit = async (id: string) => {
    if (!await showConfirm('确定取消审核？')) return;
    try {
      await salesApi.return.cancelAudit(id);
      toast('取消审核成功');
      fetchList();
    } catch (e) {
      logger.error('取消审核失败', e);
      toast(errMsg(e, '取消审核失败'));
    }
  };

  const handleAccept = async (id: string) => {
    if (!await showConfirm('确定验收？')) return;
    try {
      await salesApi.return.accept(id);
      toast('验收成功');
      fetchList();
    } catch (e) {
      logger.error('验收失败', e);
      toast(errMsg(e, '验收失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定删除？')) return;
    try {
      await salesApi.return.remove(id);
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
      await salesApi.return.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">销售退货</h1>
        {hasPermission('sales:return:create') && (
          <button onClick={openCreate} className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-blue-600 flex items-center gap-1">
            <Plus size={16} /> 新增销售退货
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">状态</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32">
            <option value="">全部</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
                      <option value="cancelled">已作废</option>
</select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">搜索</label>
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="退货单号/出库单号"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48" />
        </div>
        <button onClick={handleSearch}
          className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600">查询</button>
        <button onClick={handleExport}
          className="px-4 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">导出</button>
       </div>

       <div className="bg-white rounded-lg shadow-sm">
        <TableContainer>
         <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">退货单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">出库单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">客户</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">仓库</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">退货日期</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">金额</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={8} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: SalesReturn) => {
              const st = STATUS_MAP[item.status] || { label: item.status, tone: 'neutral' };
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4">{item.returnNo}</td>
                  <td className="px-4">{item.outboundNo}</td>
                  <td className="px-4">{item.customerName}</td>
                  <td className="px-4">{item.warehouseName}</td>
                  <td className="px-4">{item.returnDate.slice(0, 10)}</td>
                  <td className="px-4 text-right">{item.totalAmount.toFixed(2)}</td>
                  <td className="px-4"><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                  <td className="px-4">
                    <span className="space-x-2 inline-flex items-center">
                      {item.status === 'draft' && (
                        <>
                          {hasPermission('sales:return:approve') && (
                            <button onClick={() => handleAudit(item.id)} className="text-green-500 hover:underline">审核</button>
                          )}
                          {hasPermission('sales:return:delete') && (
                            <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">删除</button>
                          )}
                          {hasPermission('sales:return:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                                                <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                      )}
                      {item.status === 'audited' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                          {hasPermission('sales:return:approve') && (
                            <button onClick={() => handleBook(item.id)} className="text-primary hover:underline">记账</button>
                          )}
                          {hasPermission('sales:return:approve') && (
                            <button onClick={() => handleCancelAudit(item.id)} className="text-orange-500 hover:underline">取消审核</button>
                          )}
                          {hasPermission('sales:return:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {item.status === 'booked' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                          {hasPermission('sales:return:approve') && (
                            <button onClick={() => handleAccept(item.id)} className="text-green-500 hover:underline">验收</button>
                          )}
                          {hasPermission('sales:return:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {item.status === 'accepted' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                          {hasPermission('sales:return:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </span>
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

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="销售退货单"
        landscape={printItems.length > 30}
      >
        <SkuDocPrintContent
          docType="销售退货单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerName={printPartnerName}
          warehouseName={printWarehouseName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
          showAllSizes={showAllSizes}
          allSizesByStyle={allSizesByStyle}
        />
      </PrintDialog>
    </div>
  );
}
