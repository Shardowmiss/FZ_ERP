import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { purchaseApi } from '@client/src/api/purchase';
import { baseApi } from '@client/src/api/base';
import type { PurchaseOrder, PurchaseOrderItem, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { validateDateRange } from '@client/src/utils/date-utils';
import { errMsg } from '@/utils/errMsg';

const statusLabel: Record<string, string> = {
  draft: '新增',
  audited: '审核',
  booked: '记账',
  accepted: '验收',
  cancelled: '已作废',
};

const statusColor: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  audited: 'bg-orange-100 text-orange-600',
  booked: 'bg-blue-100 text-blue-600',
  accepted: 'bg-green-100 text-green-600',
};

const PurchaseOrderPage: React.FC = () => {
  const [list, setList] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');

  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [materialOptions, setMaterialOptions] = useState<{ id: string; code: string; name: string; unit: string }[]>([]);

  const navigate = useNavigate();

  const [printOpen, setPrintOpen] = useState<boolean>(false);
  const [printItems, setPrintItems] = useState<MaterialListItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState<string>('');
  const [printDocDate, setPrintDocDate] = useState<string>('');
  const [printPartnerName, setPrintPartnerName] = useState<string>('');
  const [printWarehouseName, setPrintWarehouseName] = useState<string>('');
  const [printTotalAmount, setPrintTotalAmount] = useState<number>(0);
  const [printRemark, setPrintRemark] = useState<string>('');

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number; pageSize: number;
        supplierId?: string; status?: string;
        startDate?: string; endDate?: string; keyword?: string;
      } = { page, pageSize };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (keyword) params.keyword = keyword;
      const res = await purchaseApi.order.list(params);
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
  }, [page, filterSupplier, filterStatus, filterStartDate, filterEndDate, keyword]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const [s, m] = await Promise.all([
          baseApi.supplier.options(),
          baseApi.material.options(),
        ]);
        setSupplierOptions(s);
        setMaterialOptions(m);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  const openAdd = (): void => {
    navigate('/purchase/order/new');
  };

  const openEdit = (id: string): void => {
    navigate(`/purchase/order/${id}/edit`);
  };

  const openView = (id: string): void => {
    navigate(`/purchase/order/${id}/edit?view=1`);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该采购订单吗？')) return;
    try {
      await purchaseApi.order.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await purchaseApi.order.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleListPrint = async (id: string): Promise<void> => {
    try {
      const order = await purchaseApi.order.get(id);
      const items: MaterialListItem[] = (order.items ?? []).map((it: PurchaseOrderItem) => ({
        code: it.materialCode,
        name: it.materialName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.price,
        amount: it.amount,
      }));
      setPrintItems(items);
      setPrintDocNo(order.orderNo);
      setPrintDocDate(order.orderDate.slice(0, 10));
      setPrintPartnerName(order.supplierName);
      setPrintTotalAmount(order.totalAmount);
      setPrintRemark(order.remark ?? '');
      setPrintOpen(true);
    } catch {
      toast('加载详情失败');
    }
  };

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async (): Promise<void> => {
    try {
      const params: {
        page: number; pageSize: number;
        supplierId?: string; status?: string;
        startDate?: string; endDate?: string; keyword?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<PurchaseOrder> = await purchaseApi.order.list(params);
      exportTableToCSV('采购订单', res.items as unknown as Record<string, unknown>[], {
        orderNo: '单号',
        supplierName: '供应商',
        orderDate: '订单日期',
        expectDate: '预计到货',
        totalAmount: '金额',
        status: '状态',
      });
    } catch (e) {
      toast.error(errMsg(e, '导出失败'));
    }
  };

  const handleStatusAction = async (id: string, action: 'audit' | 'cancelAudit' | 'book' | 'accept'): Promise<void> => {
    const actionMap = { audit: '审核', cancelAudit: '取消审核', book: '记账', accept: '验收' };
    if (!await showConfirm(`确定${actionMap[action]}吗？`)) return;
    try {
      if (action === 'audit') await purchaseApi.order.audit(id);
      if (action === 'cancelAudit') await purchaseApi.order.cancelAudit(id);
      if (action === 'book') await purchaseApi.order.book(id);
      if (action === 'accept') await purchaseApi.order.accept(id);
      toast(`${actionMap[action]}成功`);
      fetchList();
    } catch {
      toast(`${actionMap[action]}失败`);
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部筛选 */}
      <div className="bg-white rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-800">采购订单</h1>
           <button
             onClick={openAdd}
             className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
           >
             <Plus size={16} /> 新增采购订单
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
              <option value="draft">新增</option>
              <option value="audited">审核</option>
              <option value="booked">记账</option>
              <option value="accepted">验收</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">日期：</span>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
            <span className="text-gray-400">~</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
                placeholder="搜索单号"
                className="border border-gray-300 rounded pl-7 pr-2 py-1 text-sm focus:outline-none focus:border-blue-500 w-44"
              />
            </div>
          </div>
          <button
            onClick={() => {
              const error = validateDateRange(filterStartDate, filterEndDate);
              if (error) { toast.error(error); return; }
              setPage(1);
              fetchList();
            }}
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

      {/* 列表 */}
      <div className="bg-white rounded-lg shadow-sm p-5">
        <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
              <th className="text-left py-2.5 px-4 font-medium">单号</th>
              <th className="text-left py-2.5 px-4 font-medium">供应商</th>
              <th className="text-left py-2.5 px-4 font-medium">订单日期</th>
              <th className="text-left py-2.5 px-4 font-medium">预计到货</th>
              <th className="text-right py-2.5 px-4 font-medium">金额</th>
              <th className="text-left py-2.5 px-4 font-medium">状态</th>
              <th className="text-left py-2.5 px-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item: PurchaseOrder) => (
                <tr key={item.id} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                  <td className="py-2 px-4 font-medium text-gray-800">{item.orderNo}</td>
                  <td className="py-2 px-4">{item.supplierName}</td>
                  <td className="py-2 px-4 text-gray-500">{item.orderDate.slice(0, 10)}</td>
                  <td className="py-2 px-4 text-gray-500">{item.expectDate ? item.expectDate.slice(0, 10) : '-'}</td>
                  <td className="py-2 px-4 text-right font-medium text-gray-800">¥ {item.totalAmount.toFixed(2)}</td>
                  <td className="py-2 px-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusColor[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {statusLabel[item.status] ?? item.status}
                    </span>
                  </td>
                  <td className="py-2 px-4">
                    <span key={`actions-${item.status}`} className="space-x-2 inline-flex items-center">
                      {item.status === 'draft' && (
                        <>
                          <button onClick={() => openEdit(item.id)} className="text-blue-500 hover:text-blue-600">编辑</button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-600">删除</button>
                          <button onClick={() => handleStatusAction(item.id, 'audit')} className="text-orange-500 hover:text-orange-600">审核</button>
                          <button onClick={() => handleListPrint(item.id)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                            <Printer size={14} />
                          </button>
                                                <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                      )}
                      {item.status === 'audited' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-blue-500 hover:text-blue-600">查看</button>
                          <button onClick={() => handleStatusAction(item.id, 'cancelAudit')} className="text-orange-500 hover:text-orange-600">取消审核</button>
                          <button onClick={() => handleStatusAction(item.id, 'book')} className="text-blue-500 hover:text-blue-600">记账</button>
                          <button onClick={() => handleListPrint(item.id)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                            <Printer size={14} />
                          </button>
                        </>
                      )}
                      {item.status === 'booked' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-blue-500 hover:text-blue-600">查看</button>
                          <button onClick={() => handleStatusAction(item.id, 'accept')} className="text-green-500 hover:text-green-600">验收</button>
                          <button onClick={() => handleListPrint(item.id)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                            <Printer size={14} />
                          </button>
                        </>
                      )}
                      {item.status === 'accepted' && (
                        <>
                          <button onClick={() => openView(item.id)} className="text-blue-500 hover:text-blue-600">查看</button>
                          <button onClick={() => handleListPrint(item.id)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                            <Printer size={14} />
                          </button>
                        </>
                      )}
                    </span>
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

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="采购订单"
      >
        <MaterialDocPrintContent
          docType="采购订单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="供应商"
          partnerName={printPartnerName}
          remark={printRemark}
          items={printItems}
          totalAmount={printTotalAmount}
        />
      </PrintDialog>
    </div>
  );
};

export default PurchaseOrderPage;
