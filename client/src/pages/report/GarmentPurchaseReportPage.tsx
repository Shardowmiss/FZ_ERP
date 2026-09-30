import { useState, useEffect, useCallback } from 'react';
import { garmentPurchaseApi } from '@client/src/api/production';
import { baseApi } from '@client/src/api/base';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { GarmentPurchaseInbound } from '@shared/api.interface';

const formatAmount = (v: number | undefined): string =>
  v === undefined || v === null ? '-' : v.toFixed(2);

const formatQty = (v: number | undefined): string =>
  v === undefined || v === null ? '-' : v.toFixed(0);

export default function GarmentPurchaseReportPage() {
  const [list, setList] = useState<GarmentPurchaseInbound[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  const [supplierOptions, setSupplierOptions] = useState<
    { id: string; code: string; name: string }[]
  >([]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, pageSize };
      if (filterSupplier) params.supplierId = filterSupplier;
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (filterKeyword) params.keyword = filterKeyword;
      const res = await garmentPurchaseApi.inbound.list(params as any);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载成衣采购报表失败', e);
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterSupplier, filterStatus, filterStartDate, filterEndDate, filterKeyword]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const res = await baseApi.supplier.options();
        setSupplierOptions(res);
      } catch {
        toast.error('加载供应商失败');
      }
    };
    loadOpts();
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
  };

  const handleReset = () => {
    setFilterSupplier('');
    setFilterStatus('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterKeyword('');
    setPage(1);
  };

  const handleExport = () => {
    toast.info('导出功能开发中');
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  const columns = [
    { key: 'inboundNo', label: '入库单号', width: 'w-40' },
    { key: 'orderNo', label: '采购订单号', width: 'w-40' },
    { key: 'inboundDate', label: '入库日期', width: 'w-28' },
    { key: 'supplierName', label: '供应商', width: 'w-36' },
    { key: 'warehouseName', label: '仓库', width: 'w-28' },
    { key: 'totalQty', label: '总数量', width: 'w-24', align: 'right' },
    { key: 'totalAmount', label: '总金额', width: 'w-28', align: 'right' },
    { key: 'status', label: '状态', width: 'w-24' },
  ];

  const statusLabel: Record<string, string> = {
    draft: '草稿',
    pending: '待审',
    approved: '已审',
  };

  const statusColor: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    pending: 'bg-orange-100 text-orange-600',
    approved: 'bg-green-100 text-green-600',
  };

  const renderCell = (item: GarmentPurchaseInbound, key: string) => {
    switch (key) {
      case 'totalQty':
        return formatQty(item.totalQty);
      case 'totalAmount':
        return formatAmount(item.totalAmount);
      case 'status':
        return (
          <span className={`px-2 py-0.5 rounded text-xs ${statusColor[item.status] || ''}`}>
            {statusLabel[item.status] || item.status}
          </span>
        );
      default:
        return (item as any)[key] || '-';
    }
  };

  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold mb-4">成衣采购查询</h1>

      <div className="bg-white rounded border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-5 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">供应商</label>
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="">全部</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">状态</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="">全部</option>
              <option value="draft">草稿</option>
              <option value="pending">待审</option>
              <option value="approved">已审</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">开始日期</label>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">结束日期</label>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">关键词</label>
            <input
              type="text"
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              placeholder="单号搜索"
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={handleReset}
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
          >
            重置
          </button>
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          >
            搜索
          </button>
        </div>
      </div>

      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span className="text-sm text-gray-600">
            共 <span className="font-medium">{total}</span> 条记录
          </span>
          <button
            onClick={handleExport}
            className="bg-white text-gray-700 px-3 py-1.5 rounded text-sm border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            导出
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-gray-400">
                    加载中...
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-8 text-gray-400">
                    暂无数据
                  </td>
                </tr>
              ) : (
                list.map((item) => (
                  <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50">
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        {renderCell(item, col.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <span className="text-sm text-gray-500">
            共 {total} 条，{totalPages} 页
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="text-sm text-gray-600">第 {page} 页</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="px-2 py-1.5 text-sm border border-gray-300 rounded"
            >
              <option value={10}>10条/页</option>
              <option value={20}>20条/页</option>
              <option value={50}>50条/页</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
