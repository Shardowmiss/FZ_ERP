import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { PurchaseFilterBar } from '@client/src/components/PurchaseFilterBar';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { MaterialDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { MaterialListItem } from '@client/src/components/print/MaterialListTable';
import { purchaseApi } from '@client/src/api/purchase';
import { baseApi } from '@client/src/api/base';
import type { PurchaseInbound, PurchaseInboundItem, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
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

const PurchaseInboundPage: React.FC = () => {
  const [list, setList] = useState<PurchaseInbound[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterSupplier, setFilterSupplier] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('draft,approved');
  const [keyword, setKeyword] = useState<string>('');

  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [filterDocStartDate, setFilterDocStartDate] = useState<string>(defaultDocStart);
  const [filterDocEndDate, setFilterDocEndDate] = useState<string>(defaultDocEnd);
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [filterWarehouse, setFilterWarehouse] = useState<string>('');

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
        startDate?: string; endDate?: string; warehouseId?: string;
        docStartDate?: string; docEndDate?: string;
      } = { page, pageSize };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.orderNo = keyword;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (filterDocStartDate) params.docStartDate = filterDocStartDate;
      if (filterDocEndDate) params.docEndDate = filterDocEndDate;
      const res = await purchaseApi.inbound.list(params);
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
  }, [page, filterSupplier, filterStatus, keyword, filterStartDate, filterEndDate, filterWarehouse, filterDocStartDate, filterDocEndDate]);

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
    navigate('/purchase/inbound/new');
  };

  const openView = (id: string): void => {
    navigate(`/purchase/inbound/${id}/edit?view=1`);
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!await showConfirm('确定删除该入库单吗？')) return;
    try {
      await purchaseApi.inbound.remove(id);
      toast('删除成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await purchaseApi.inbound.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleApprove = async (id: string): Promise<void> => {
    if (!await showConfirm('确定审核通过吗？')) return;
    try {
      await purchaseApi.inbound.approve(id);
      toast('审核成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '审核失败'));
    }
  };

  const handleListPrint = async (id: string): Promise<void> => {
    try {
      const inbound = await purchaseApi.inbound.get(id);
      const items: MaterialListItem[] = (inbound.items ?? []).map((it: PurchaseInboundItem) => ({
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

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async (): Promise<void> => {
    try {
      const params: {
        page: number; pageSize: number;
        supplierId?: string; status?: string; orderNo?: string;
        startDate?: string; endDate?: string; warehouseId?: string;
        docStartDate?: string; docEndDate?: string;
      } = { page: 1, pageSize: 10000 };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (keyword) params.orderNo = keyword;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (filterDocStartDate) params.docStartDate = filterDocStartDate;
      if (filterDocEndDate) params.docEndDate = filterDocEndDate;
      const res: PaginationResult<PurchaseInbound> = await purchaseApi.inbound.list(params);
      exportTableToCSV('采购入库单', res.items as unknown as Record<string, unknown>[], {
        inboundNo: '入库单号',
        orderNo: '采购单号',
        supplierName: '供应商',
        warehouseName: '仓库',
        inboundDate: '入库日期',
        totalAmount: '金额',
        status: '状态',
      });
    } catch (e) {
      toast.error(errMsg(e, '导出失败'));
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部筛选 */}
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
            setFilterStatus('draft,approved');
            setFilterWarehouse('');
            setFilterDocStartDate(defaultDocStart);
            setFilterDocEndDate(defaultDocEnd);
            setFilterStartDate('');
            setFilterEndDate('');
            setKeyword('');
            setPage(1);
            fetchList();
          }}
          dateLabel="单据日期"
          dateStart={filterDocStartDate}
          dateEnd={filterDocEndDate}
          onDateStartChange={setFilterDocStartDate}
          onDateEndChange={setFilterDocEndDate}
          showSecondaryDate
          secondaryDateLabel="入库日期"
          secondaryDateStart={filterStartDate}
          secondaryDateEnd={filterEndDate}
          onSecondaryDateStartChange={setFilterStartDate}
          onSecondaryDateEndChange={setFilterEndDate}
          showSupplier
          supplierId={filterSupplier}
          onSupplierChange={setFilterSupplier}
          supplierOptions={supplierOptions}
          showStatus
          status={filterStatus}
          onStatusChange={setFilterStatus}
          statusOptions={[
            { value: 'draft,approved', label: '未验收' },
            { value: 'draft', label: '草稿' },
            { value: 'approved', label: '已审' },
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

      {/* 列表 */}
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
              list.map((item: PurchaseInbound) => (
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
        title="采购入库单"
      >
        <MaterialDocPrintContent
          docType="采购入库单"
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

export default PurchaseInboundPage;
