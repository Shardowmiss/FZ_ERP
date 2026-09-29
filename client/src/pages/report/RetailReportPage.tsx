import { useState, useCallback, useEffect } from 'react';
import ReportFilter, { type ReportFilterValues } from './ReportFilter';
import { reportApi } from '@client/src/api/report';
import type { ReportRetailItem, ReportRetailSummary } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { formatAmount, formatQty } from './report-utils';

export default function RetailReportPage() {
  const [items, setItems] = useState<ReportRetailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalQty: 0, totalAmount: 0 });
  const [topSummary, setTopSummary] = useState<ReportRetailSummary | null>(
    null,
  );
  const [filterValues, setFilterValues] = useState<ReportFilterValues | null>(
    null,
  );

  const fetchData = useCallback(
    async (filters: ReportFilterValues, p: number, ps: number) => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = {
          page: p,
          pageSize: ps,
        };
        if (filters.startDate) params.startDate = filters.startDate;
        if (filters.endDate) params.endDate = filters.endDate;
        if (filters.partnerId) params.storeId = filters.partnerId;
        if (filters.keyword) params.keyword = filters.keyword;
        if (filters.brand) params.brand = filters.brand;
        const res = await reportApi.retail(params as any);
        setItems(res.items);
        setTotal(res.total);
        setSummary(res.summary);
      } catch (e) {
        logger.error('加载零售报表失败', e);
        toast.error('加载失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchTopSummary = useCallback(
    async (filters: ReportFilterValues) => {
      try {
        const params: Record<string, string> = {};
        if (filters.startDate) params.startDate = filters.startDate;
        if (filters.endDate) params.endDate = filters.endDate;
        if (filters.partnerId) params.storeId = filters.partnerId;
        if (filters.brand) params.brand = filters.brand;
        const res = await reportApi.retailSummary(params as any);
        setTopSummary(res);
      } catch (e) {
        logger.error('加载零售汇总失败', e);
      }
    },
    [],
  );

  const handleSearch = (values: ReportFilterValues) => {
    setFilterValues(values);
    setPage(1);
    fetchData(values, 1, pageSize);
    fetchTopSummary(values);
  };

  const handleReset = () => {
    setFilterValues(null);
    setPage(1);
    setItems([]);
    setTotal(0);
    setSummary({ totalQty: 0, totalAmount: 0 });
    setTopSummary(null);
  };

  const handleExport = () => {
    toast.info('导出功能开发中');
  };

  const totalPages = Math.ceil(total / pageSize) || 1;

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    if (filterValues) {
      fetchData(filterValues, newPage, pageSize);
    }
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
    if (filterValues) {
      fetchData(filterValues, 1, size);
    }
  };

  useEffect(() => {
    const defaultFilters: ReportFilterValues = {
      startDate: '',
      endDate: '',
      partnerId: '',
      partnerType: '',
      keyword: '',
      brand: '',
      warehouseId: '',
    };
    setFilterValues(defaultFilters);
    fetchData(defaultFilters, 1, pageSize);
    fetchTopSummary(defaultFilters);
  }, []);

  const statCards = [
    {
      label: '总零售单数',
      value: topSummary?.orderCount ?? 0,
      suffix: '单',
    },
    {
      label: '总数量',
      value: formatQty(topSummary?.totalQty ?? 0),
      suffix: '件',
    },
    {
      label: '总金额',
      value: formatAmount(topSummary?.totalAmount ?? 0),
      prefix: '¥',
    },
    {
      label: '客单价',
      value: formatAmount(topSummary?.avgPrice ?? 0),
      prefix: '¥',
    },
  ];

  const columns = [
    { key: 'retailNo', label: '零售单号', width: 'w-40' },
    { key: 'saleDate', label: '日期', width: 'w-28' },
    { key: 'storeName', label: '门店', width: 'w-32' },
    { key: 'cashierName', label: '收银员', width: 'w-20' },
    { key: 'brand', label: '品牌', width: 'w-20' },
    { key: 'styleNo', label: '款号', width: 'w-32' },
    { key: 'color', label: '颜色', width: 'w-20' },
    { key: 'size', label: '尺码', width: 'w-16' },
    { key: 'quantity', label: '数量', width: 'w-20', align: 'right' },
    { key: 'dealPrice', label: '成交价', width: 'w-20', align: 'right' },
    { key: 'amount', label: '金额', width: 'w-24', align: 'right' },
    { key: 'payMethod', label: '支付方式', width: 'w-24' },
    { key: 'status', label: '单据状态', width: 'w-20' },
  ];

  const renderCell = (item: ReportRetailItem, key: string) => {
    switch (key) {
      case 'quantity':
        return formatQty(item.quantity);
      case 'dealPrice':
        return formatAmount(item.dealPrice);
      case 'amount':
        return formatAmount(item.amount);
      case 'brand':
        return item.brand || '-';
      case 'cashierName':
        return item.cashierName || '-';
      default:
        return (item as any)[key] || '-';
    }
  };

  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold mb-4">零售查询</h1>

      <div className="grid grid-cols-4 gap-4 mb-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white p-4 rounded border border-gray-200"
          >
            <div className="text-sm text-gray-500 mb-2">{card.label}</div>
            <div className="text-2xl font-semibold text-blue-600">
              {card.prefix}
              {card.value}
              <span className="text-sm font-normal text-gray-500 ml-1">
                {card.suffix}
              </span>
            </div>
          </div>
        ))}
      </div>

      <ReportFilter onSearch={handleSearch} onReset={handleReset} />

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
              {loading && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="text-center py-8 text-gray-400"
                  >
                    加载中...
                  </td>
                </tr>
              )}
              {!loading && items.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="text-center py-8 text-gray-400"
                  >
                    暂无数据
                  </td>
                </tr>
              )}
              {!loading &&
                items.map((item: ReportRetailItem, idx: number) => (
                  <tr
                    key={idx}
                    className="border-b border-gray-100 h-10 hover:bg-gray-50"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 whitespace-nowrap ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        {renderCell(item, col.key)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr className="h-10">
                <td
                  colSpan={8}
                  className="px-3 font-medium text-gray-700 text-right"
                >
                  合计：
                </td>
                <td className="px-3 text-right font-medium text-gray-700">
                  {formatQty(summary.totalQty)}
                </td>
                <td></td>
                <td className="px-3 text-right font-medium text-blue-600">
                  {formatAmount(summary.totalAmount)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">每页</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="border border-gray-300 rounded px-2 py-1 text-sm"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span className="text-sm text-gray-500">条</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
            >
              上一页
            </button>
            <span className="text-sm">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
