import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { salesApi } from '@client/src/api/sales';
import { baseApi } from '@client/src/api/base';
import type { SalesOutbound, PaginationResult } from '@shared/api.interface';
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

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  draft: { label: '新增', color: 'bg-gray-100 text-gray-600' },
  audited: { label: '审核', color: 'bg-orange-100 text-orange-600' },
  booked: { label: '记账', color: 'bg-blue-100 text-blue-600' },
  accepted: { label: '验收', color: 'bg-green-100 text-green-600' },
};

const BACK_PATH = '/sales/outbound';

export default function SalesOutboundPage() {
  const { hasPermission } = useAuth();
  const [list, setList] = useState<SalesOutbound[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [brand, setBrand] = useState('');
  const [brandOptions, setBrandOptions] = useState<{ attrCode: string; attrName: string }[]>([]);

  const navigate = useNavigate();

  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printWarehouseName, setPrintWarehouseName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState(0);
  const [printRemark, setPrintRemark] = useState('');

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
       if (status) params.status = status;
       if (keyword) params.keyword = keyword;
       if (brand) params.brand = brand;
       const res: PaginationResult<SalesOutbound> = await salesApi.outbound.list(params);
       setList(res.items);
       setTotal(res.total);
     } catch (e) {
       logger.error('加载出库单失败', e);
       toast('加载失败');
     } finally {
       setLoading(false);
     }
   };

  const fetchBrands = async () => {
    try {
      const res = await baseApi.styleAttribute.getAll('brand', true);
      setBrandOptions(res.map((b: any) => ({ attrCode: b.attrCode, attrName: b.attrName })));
    } catch (e) {
      logger.error('加载品牌失败', e);
    }
  };

  useEffect(() => {
    fetchList();
    fetchBrands();
  }, [page]);

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
      if (brand) params.brand = brand;
      const res: PaginationResult<SalesOutbound> = await salesApi.outbound.list(params);
      exportTableToCSV('销售出库单', res.items as unknown as Record<string, unknown>[], {
        outboundNo: '出库单号',
        orderNo: '销售单号',
        customerName: '客户',
        warehouseName: '仓库',
        outboundDate: '出库日期',
        totalAmount: '金额',
        costAmount: '成本',
        status: '状态',
      });
    } catch (e) {
      logger.error('导出失败', e);
      toast.error(errMsg(e, '导出失败'));
    }
  };

  const openCreate = () => {
    navigate('/sales/outbound/new');
  };

  const openView = (id: string) => {
    navigate(`/sales/outbound/${id}/edit?view=1`);
  };

  const handlePrintFromList = async (id: string) => {
    try {
      const detail = await salesApi.outbound.get(id);
      setPrintDocNo(detail.outboundNo);
      setPrintDocDate(detail.outboundDate.slice(0, 10));
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
      toast('加载打印数据失败');
    }
  };

  const handleAudit = async (id: string) => {
    if (!await showConfirm('确定审核？')) return;
    try {
      await salesApi.outbound.audit(id);
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
      await salesApi.outbound.book(id);
      toast('记账成功');
      fetchList();
    } catch (e) {
      logger.error('记账失败', e);
      toast('记账失败');
    }
  };

  const handleCancelAudit = async (id: string) => {
    if (!await showConfirm('确定取消审核？')) return;
    try {
      await salesApi.outbound.cancelAudit(id);
      toast('取消审核成功');
      fetchList();
    } catch (e) {
      logger.error('取消审核失败', e);
      toast('取消审核失败');
    }
  };

  const handleAccept = async (id: string) => {
    if (!await showConfirm('确定验收？')) return;
    try {
      await salesApi.outbound.accept(id);
      toast('验收成功');
      fetchList();
    } catch (e) {
      logger.error('验收失败', e);
      toast('验收失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定删除？')) return;
    try {
      await salesApi.outbound.remove(id);
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
      await salesApi.outbound.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">销售出库</h1>
        {hasPermission('sales:outbound:create') && (
          <button onClick={openCreate} className="bg-blue-500 text-white px-4 py-2 rounded text-sm hover:bg-blue-600 flex items-center gap-1">
            <Plus size={16} /> 新增销售出库
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
           <label className="text-xs text-gray-500 mb-1">品牌</label>
           <select value={brand} onChange={(e) => setBrand(e.target.value)}
             className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32">
             <option value="">全部</option>
             {brandOptions.map((b: { attrCode: string; attrName: string }) => (
               <option key={b.attrCode} value={b.attrName}>{b.attrName}</option>
             ))}
           </select>
         </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">搜索</label>
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="单号/销售单号"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48" />
        </div>
        <button onClick={handleSearch}
          className="bg-blue-500 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600">查询</button>
        <button onClick={handleExport}
          className="px-4 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50">导出</button>
       </div>

       <div className="bg-white rounded-lg shadow-sm">
        <TableContainer>
         <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">出库单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">销售单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">客户</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">仓库</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">出库日期</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">金额</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">成本</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: SalesOutbound) => {
              const st = STATUS_MAP[item.status] || { label: item.status, color: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4">{item.outboundNo}</td>
                  <td className="px-4">{item.orderNo}</td>
                  <td className="px-4">{item.customerName}</td>
                  <td className="px-4">{item.warehouseName}</td>
                  <td className="px-4">{item.outboundDate.slice(0, 10)}</td>
                  <td className="px-4 text-right">{item.totalAmount.toFixed(2)}</td>
                  <td className="px-4 text-right">{item.costAmount.toFixed(2)}</td>
                  <td className="px-4"><span className={`px-2 py-0.5 rounded text-xs ${st.color}`}>{st.label}</span></td>
                  <td className="px-4">
                    <span className="space-x-2 inline-flex items-center">
                      {item.status === 'draft' && (
                        <>
                          {hasPermission('sales:outbound:approve') && (
                            <button onClick={() => handleAudit(item.id)} className="text-green-500 hover:underline">审核</button>
                          )}
                          {hasPermission('sales:outbound:delete') && (
                            <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">删除</button>
                          )}
                          {hasPermission('sales:outbound:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-blue-500 hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                                                <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                      )}
                      {item.status === 'audited' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-blue-500 hover:underline">查看</button>
                          {hasPermission('sales:outbound:approve') && (
                            <button onClick={() => handleBook(item.id)} className="text-blue-500 hover:underline">记账</button>
                          )}
                          {hasPermission('sales:outbound:approve') && (
                            <button onClick={() => handleCancelAudit(item.id)} className="text-orange-500 hover:underline">取消审核</button>
                          )}
                          {hasPermission('sales:outbound:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-blue-500 hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {item.status === 'booked' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-blue-500 hover:underline">查看</button>
                          {hasPermission('sales:outbound:approve') && (
                            <button onClick={() => handleAccept(item.id)} className="text-green-500 hover:underline">验收</button>
                          )}
                          {hasPermission('sales:outbound:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-blue-500 hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {item.status === 'accepted' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-blue-500 hover:underline">查看</button>
                          {hasPermission('sales:outbound:print') && (
                            <button onClick={() => handlePrintFromList(item.id)} className="text-blue-500 hover:underline inline-flex items-center" title="打印">
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
        title="销售出库单"
        landscape={printItems.length > 30}
      >
        <SkuDocPrintContent
          docType="销售出库单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerName={printPartnerName}
          warehouseName={printWarehouseName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </div>
  );
}
