import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Download, Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { productionApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import type {
  MaterialPurchaseInbound,
  MaterialPurchaseInboundItem,
  MaterialPurchaseOrder,
  PaginationResult,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  approved: '已审',
  completed: '已完成',
  cancelled: '已作废',
};

const statusColor: Record<string, StatusTone> = {
  draft: 'neutral',
  approved: 'ok',
  completed: 'info',
};

const MaterialPurchaseInboundPage: React.FC = () => {
  const [list, setList] = useState<MaterialPurchaseInbound[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState<string>('');

  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  // 单据默认查询窗口（近 N 天，来自系统参数 defaultDocQueryDays）
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [filterDocStart, setFilterDocStart] = useState(defaultDocStart);
  const [filterDocEnd, setFilterDocEnd] = useState(defaultDocEnd);
  const [filterInboundStart, setFilterInboundStart] = useState('');
  const [filterInboundEnd, setFilterInboundEnd] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [approvedOrders, setApprovedOrders] = useState<MaterialPurchaseOrder[]>([]);

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
        supplierId?: string; status?: string; orderNo?: string;
        warehouseId?: string; docStartDate?: string; docEndDate?: string; startDate?: string; endDate?: string;
      } = { page, pageSize };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (searchKeyword) params.orderNo = searchKeyword;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterInboundStart) params.startDate = filterInboundStart;
      if (filterInboundEnd) params.endDate = filterInboundEnd;
      const res = await productionApi.materialPurchaseInbound.list(params);
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
  }, [page, filterSupplier, filterStatus, searchKeyword, filterWarehouse, filterDocStart, filterDocEnd, filterInboundStart, filterInboundEnd]);

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

  const loadApprovedOrders = async (): Promise<void> => {
    try {
      const res = await productionApi.materialPurchaseOrder.list({ page: 1, pageSize: 100, status: 'approved' });
      setApprovedOrders(res.items);
    } catch {
      // ignore
    }
  };

  const openAdd = (): void => {
    navigate('/production/material-purchase-inbound/new');
  };

  const openView = (id: string): void => {
    navigate(`/production/material-purchase-inbound/${id}/edit?view=1`);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该入库单吗？')) return;
    try {
      await productionApi.materialPurchaseInbound.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await productionApi.materialPurchaseInbound.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleApprove = async (id: string): Promise<void> => {
    if (!await showConfirm('确定审核通过吗？')) return;
    try {
      await productionApi.materialPurchaseInbound.approve(id);
      toast('审核成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '审核失败'));
    }
  };

  const handleListPrint = async (id: string): Promise<void> => {
    try {
      const inbound = await productionApi.materialPurchaseInbound.get(id);
      const items: MaterialListItem[] = (inbound.items ?? []).map((it: MaterialPurchaseInboundItem) => ({
        code: it.materialCode,
        name: it.materialName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.price,
        amount: it.amount,
      }));
      setPrintItems(items);
      setPrintDocNo(inbound.inboundNo);
      setPrintDocDate(inbound.inboundDate.slice(0, 10));
      setPrintPartnerName(inbound.supplierName);
      setPrintWarehouseName(inbound.warehouseName);
      setPrintTotalAmount(inbound.totalAmount);
      setPrintRemark(inbound.remark ?? '');
      setPrintOpen(true);
    } catch (e) {
      toast(errMsg(e, '加载详情失败'));
    }
  };

  const handleSearch = (): void => {
    setSearchKeyword(keyword);
    setPage(1);
  };

  const handleExport = async (): Promise<void> => {
    try {
      const params: {
        page: number; pageSize: number;
        supplierId?: string; status?: string; orderNo?: string;
        warehouseId?: string; docStartDate?: string; docEndDate?: string; startDate?: string; endDate?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (searchKeyword) params.orderNo = searchKeyword;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterInboundStart) params.startDate = filterInboundStart;
      if (filterInboundEnd) params.endDate = filterInboundEnd;
      const res: PaginationResult<MaterialPurchaseInbound> = await productionApi.materialPurchaseInbound.list(params);
      const columnMap: Record<string, string> = {
        inboundNo: '入库单号',
        orderNo: '采购单号',
        supplierName: '供应商',
        warehouseName: '仓库',
        inboundDate: '入库日期',
        totalAmount: '金额',
        status: '状态',
      };
      const data = res.items.map((item: MaterialPurchaseInbound) => ({
        inboundNo: item.inboundNo,
        orderNo: item.orderNo,
        supplierName: item.supplierName,
        warehouseName: item.warehouseName,
        inboundDate: item.inboundDate.slice(0, 10),
        totalAmount: item.totalAmount.toFixed(2),
        status: statusLabel[item.status] ?? item.status,
      }));
      exportTableToCSV('面辅料采购入库列表', data, columnMap);
      toast('导出成功');
    } catch (e) {
      toast.error(errMsg(e, '导出失败'));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">面辅料入库</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 text-gray-700 flex items-center gap-1"
          >
            <Download size={16} /> 导出
          </button>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary flex items-center gap-1"
          >
            <Plus size={16} /> + 新增入库
          </button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 text-sm mb-4 pb-4 border-b border-gray-200">
        <div className="flex items-center gap-1">
          <span className="text-gray-600">供应商：</span>
          <select
            value={filterSupplier}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setFilterSupplier(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
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
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setFilterStatus(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
          >
            <option value="">全部</option>
            <option value="draft">草稿</option>
            <option value="approved">已审</option>
            <option value="completed">已完成</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={keyword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="搜索采购单号"
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary w-44"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-600">仓库：</span>
          <select
            value={filterWarehouse}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setFilterWarehouse(e.target.value); setPage(1); }}
            className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
          >
            <option value="">全部</option>
            {warehouseOptions.map((w: { id: string; code: string; name: string }) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-600">单据日期：</span>
          <input type="date" value={filterDocStart} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setFilterDocStart(e.target.value); setPage(1); }} className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary" />
          <span className="text-gray-400">至</span>
          <input type="date" value={filterDocEnd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setFilterDocEnd(e.target.value); setPage(1); }} className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary" />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-600">入库日期：</span>
          <input type="date" value={filterInboundStart} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setFilterInboundStart(e.target.value); setPage(1); }} className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary" />
          <span className="text-gray-400">至</span>
          <input type="date" value={filterInboundEnd} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setFilterInboundEnd(e.target.value); setPage(1); }} className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary" />
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded hover:bg-primary"
        >
          查询
        </button>
        <div className="flex-1" />
      </div>

      {/* 列表 */}
      <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
              <th className="text-left py-2.5 px-4 font-medium">入库单号</th>
              <th className="text-left py-2.5 px-4 font-medium">采购单号</th>
              <th className="text-left py-2.5 px-4 font-medium">供应商</th>
              <th className="text-left py-2.5 px-4 font-medium">仓库</th>
              <th className="text-left py-2.5 px-4 font-medium">入库日期</th>
              <th className="text-right py-2.5 px-4 font-medium">金额</th>
              <th className="text-left py-2.5 px-4 font-medium">状态</th>
              <th className="text-left py-2.5 px-4 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item: MaterialPurchaseInbound) => (
                <tr key={item.id} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                  <td className="py-2 px-4 font-medium text-gray-800">{item.inboundNo}</td>
                  <td className="py-2 px-4">{item.orderNo}</td>
                  <td className="py-2 px-4">{item.supplierName}</td>
                  <td className="py-2 px-4">{item.warehouseName}</td>
                  <td className="py-2 px-4 text-gray-500">{item.inboundDate.slice(0, 10)}</td>
                  <td className="py-2 px-4 text-right font-medium text-gray-800">¥ {item.totalAmount.toFixed(2)}</td>
                  <td className="py-2 px-4">
                    <StatusBadge tone={statusColor[item.status] ?? 'neutral'}>{statusLabel[item.status] ?? item.status}</StatusBadge>
                  </td>
                  <td className="py-2 px-4 space-x-2">
                    {item.status === 'draft' && (
                      <>
                        <button onClick={() => handleApprove(item.id)} className="text-green-500 hover:text-green-600">审核</button>
                        <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-600">删除</button>
                        <button onClick={() => handleListPrint(item.id)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                          <Printer size={14} />
                        </button>
                                            <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                    )}
                    {(item.status === 'approved' || item.status === 'completed') && (
                      <>
                        <button onClick={() => openView(item.id)} className="text-primary hover:text-primary">查看</button>
                        <button onClick={() => handleListPrint(item.id)} className="text-gray-500 hover:text-gray-600 inline-flex align-middle" title="打印">
                          <Printer size={14} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableContainer>

      {/* 分页 */}
      <DataPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(v: number) => { setPageSize(v); setPage(1); }}
      />

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="面辅料入库单"
      >
        <MaterialDocPrintContent
          docType="面辅料入库单"
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

export default MaterialPurchaseInboundPage;
