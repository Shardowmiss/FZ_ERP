import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';
import { useNavigate } from 'react-router-dom';
import { salesApi } from '@client/src/api/sales';
import { baseApi } from '@client/src/api/base';
import type { SalesOrder, Dealer, PaginationResult } from '@shared/api.interface';
import { SALES_ORDER_SOURCE_LABELS } from '@shared/api.interface';
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
import { validateDateRange } from '@client/src/utils/date-utils';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '新增', tone: 'neutral' },
  audited: { label: '审核', tone: 'warn' },
  booked: { label: '记账', tone: 'info' },
  cancelled: { label: '已作废', tone: 'danger' },
};

export default function SalesOrderPage() {
  const { hasPermission } = useAuth();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [dealerId, setDealerId] = useState('');
  const [status, setStatus] = useState('');
  const def = useDefaultDocDate();
  const [startDate, setStartDate] = useState(def.startDate);
  const [endDate, setEndDate] = useState(def.endDate);
  const [keyword, setKeyword] = useState('');

  const [dealers, setDealers] = useState<Dealer[]>([]);
  const navigate = useNavigate();

  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState(0);
  const [printRemark, setPrintRemark] = useState('');
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

  const loadAllSizesByStyle = async (styleNos: string[]): Promise<Record<string, string[]>> => {
    const result: Record<string, string[]> = {};
    try {
      const allStylesRes = await baseApi.style.list({ page: 1, pageSize: 1000 });
      const sizeGroupMap = new Map<string, string>();
      for (const s of allStylesRes.items) {
        if (styleNos.includes(s.styleNo)) {
          sizeGroupMap.set(s.styleNo, s.sizeGroupId);
        }
      }
      const sizeGroupIds = Array.from(new Set(sizeGroupMap.values()));
      const sizesByGroup: Record<string, string[]> = {};
      for (const gid of sizeGroupIds) {
        try {
          const sg = await baseApi.sizeGroup.get(gid);
          sizesByGroup[gid] = sg.sizes;
        } catch (e) {
          sizesByGroup[gid] = [];
        }
      }
      for (const [styleNo, gid] of sizeGroupMap.entries()) {
        result[styleNo] = sizesByGroup[gid] || [];
      }
    } catch (e) {
      // 失败则返回空
    }
    return result;
  };

  const handleShowAllSizesChange = async (checked: boolean) => {
    setShowAllSizes(checked);
    if (checked) {
      const styleNos = Array.from(new Set(printItems.map((it: SkuMatrixItem) => it.styleNo)));
      const sizes = await loadAllSizesByStyle(styleNos);
      setAllSizesByStyle(sizes);
    } else {
      setAllSizesByStyle({});
    }
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (dealerId) params.dealerId = dealerId;
      if (status) params.status = status;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<SalesOrder> = await salesApi.order.list(params);
      setOrders(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载销售订单失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const fetchDealers = async () => {
    try {
      const res = await baseApi.dealer.list({ page: 1, pageSize: 1000, status: 'active' });
      setDealers(res.items);
    } catch (e) {
      logger.error('加载经销商失败', e);
    }
  };

  useEffect(() => {
    fetchList();
    fetchDealers();
  }, [page]);

  const handleSearch = () => {
    const error = validateDateRange(startDate, endDate);
    if (error) {
      toast.error(error);
      return;
    }
    setPage(1);
    fetchList();
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: any = { page: 1, pageSize: 10000 };
      if (dealerId) params.dealerId = dealerId;
      if (status) params.status = status;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<SalesOrder> = await salesApi.order.list(params);
      const exportRows = (res.items as unknown as Array<Record<string, unknown>>).map(
        (o: Record<string, unknown>) => ({
          ...o,
          sourceTypeLabel:
            SALES_ORDER_SOURCE_LABELS[String(o.sourceType || '')] || o.sourceType || '-',
        }),
      );
      exportTableToCSV('销售订单', exportRows, {
        orderNo: '订单编号',
        customerName: '经销商名称',
        orderDate: '订单日期',
        deliveryDate: '交期',
        totalAmount: '金额',
        status: '状态',
        sourceTypeLabel: '来源',
      });
    } catch (e) {
      logger.error('导出失败', e);
      toast.error(errMsg(e, '导出失败'));
    }
  };

  const openCreate = () => {
    navigate('/sales/order/new');
  };

  const openEdit = (order: SalesOrder) => {
    navigate(`/sales/order/${order.id}/edit`);
  };

  const openView = (order: SalesOrder) => {
    navigate(`/sales/order/${order.id}/edit?view=1`);
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定删除该订单？')) return;
    try {
      await salesApi.order.remove(id);
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
      await salesApi.order.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleAudit = async (id: string) => {
    if (!await showConfirm('确定审核？')) return;
    try {
      await salesApi.order.audit(id);
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
      await salesApi.order.book(id);
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
      await salesApi.order.cancelAudit(id);
      toast('取消审核成功');
      fetchList();
    } catch (e) {
      logger.error('取消审核失败', e);
      toast(errMsg(e, '取消审核失败'));
    }
  };

  const handlePrintFromList = async (id: string) => {
    try {
      const detail = await salesApi.order.get(id);
      setPrintDocNo(detail.orderNo);
      setPrintDocDate(detail.orderDate.slice(0, 10));
      setPrintPartnerName(detail.customerName);
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

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">销售订单</h1>
        {hasPermission('sales:order:create') && (
          <button
            onClick={openCreate}
            className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-primary flex items-center gap-1"
          >
            <Plus size={16} /> 新增销售订单
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">经销商</label>
          <select
            value={dealerId}
            onChange={(e) => setDealerId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
          >
            <option value="">全部</option>
            {dealers.map((c: Dealer) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
</select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">状态</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
          >
            <option value="">全部</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">开始日期</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">结束日期</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">搜索</label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="单号/经销商"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
          />
        </div>
        <button
          onClick={handleSearch}
          className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary"
        >
          查询
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-1.5 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          导出
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <TableContainer>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">经销商</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">订单日期</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">交期</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">金额</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">来源</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">加载中...</td></tr>
            )}
            {!loading && orders.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            )}
            {!loading && orders.map((order: SalesOrder) => {
              const st = STATUS_MAP[order.status] || { label: order.status, tone: 'neutral' };
              return (
                <tr key={order.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4">{order.orderNo}</td>
                  <td className="px-4">{order.customerName}</td>
                  <td className="px-4">{order.orderDate.slice(0, 10)}</td>
                  <td className="px-4">{order.deliveryDate?.slice(0, 10) || '-'}</td>
                  <td className="px-4 text-right">{order.totalAmount.toFixed(2)}</td>
                  <td className="px-4">
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </td>
                  <td className="px-4">{SALES_ORDER_SOURCE_LABELS[order.sourceType || ''] || order.sourceType || '-'}</td>
                  <td className="px-4">
                    <span key={`actions-${order.status}`} className="space-x-2 inline-flex items-center">
                      {order.status === 'draft' && (
                        <>
                          {hasPermission('sales:order:edit') && (
                            <button onClick={() => openEdit(order)} className="text-primary hover:underline">编辑</button>
                          )}
                          {hasPermission('sales:order:delete') && (
                            <button onClick={() => handleDelete(order.id)} className="text-red-500 hover:underline">删除</button>
                          )}
                          {hasPermission('sales:order:approve') && (
                            <button onClick={() => handleAudit(order.id)} className="text-green-500 hover:underline">审核</button>
                          )}
                          {hasPermission('sales:order:void') && (
                            <button onClick={() => handleVoid(order.id)} className="text-red-500 hover:underline">作废</button>
                          )}
                          {hasPermission('sales:order:print') && (
                            <button onClick={() => handlePrintFromList(order.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {order.status === 'audited' && (
                        <>
                          <button onClick={() => openView(order)} className="text-primary hover:underline">查看</button>
                          {hasPermission('sales:order:approve') && (
                            <button onClick={() => handleBook(order.id)} className="text-primary hover:underline">记账</button>
                          )}
                          {hasPermission('sales:order:approve') && (
                            <button onClick={() => handleCancelAudit(order.id)} className="text-orange-500 hover:underline">取消审核</button>
                          )}
                          {hasPermission('sales:order:print') && (
                            <button onClick={() => handlePrintFromList(order.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
                              <Printer size={14} />
                            </button>
                          )}
                        </>
                      )}
                      {order.status === 'booked' && (
                        <>
                          <button onClick={() => openView(order)} className="text-primary hover:underline">查看</button>
                          {hasPermission('sales:order:print') && (
                            <button onClick={() => handlePrintFromList(order.id)} className="text-primary hover:underline inline-flex items-center" title="打印">
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
        title="销售订单"
        landscape={showAllSizes || printItems.length > 30}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="销售订单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerName={printPartnerName}
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
