import { useState, useCallback, useEffect } from 'react';
import ReportFilter, { type ReportFilterValues } from './ReportFilter';
import { reportApi } from '@client/src/api/report';
import type { ReportInventoryItem } from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { formatAmount, formatQty } from './report-utils';

export default function InventoryReportPage() {
  const [items, setItems] = useState<ReportInventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ totalQty: 0, totalAmount: 0 });
  const [filterValues, setFilterValues] = useState<ReportFilterValues | null>(
    null,
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = useCallback(
    async (filters: ReportFilterValues, p: number, ps: number) => {
      setLoading(true);
      try {
        const params: Record<string, string | number> = {
          page: p,
          pageSize: ps,
        };
        if (filters.keyword) params.keyword = filters.keyword;
        if (filters.brand) params.brand = filters.brand;
        if (filters.warehouseId) params.warehouseId = filters.warehouseId;
        const res = await reportApi.inventory(params as any);
        setItems(res.items);
        setTotal(res.total);
        setSummary(res.summary);
      } catch (e) {
        logger.error('加载库存报表失败', e);
        toast.error('加载失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleSearch = (values: ReportFilterValues) => {
    setFilterValues(values);
    setPage(1);
    fetchData(values, 1, pageSize);
  };

  const handleReset = () => {
    setFilterValues(null);
    setPage(1);
    setItems([]);
    setTotal(0);
    setSummary({ totalQty: 0, totalAmount: 0 });
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

  const columns = [
    { key: 'brand', label: '品牌', width: 'w-20' },
    { key: 'styleNo', label: '款号', width: 'w-32' },
    { key: 'styleName', label: '款名', width: 'w-36' },
    { key: 'color', label: '颜色', width: 'w-20' },
    { key: 'size', label: '尺码', width: 'w-16' },
    { key: 'warehouseName', label: '仓库', width: 'w-28' },
    { key: 'quantity', label: '现有库存', width: 'w-24', align: 'right' },
    { key: 'inTransitQty', label: '在途数量', width: 'w-24', align: 'right' },
    { key: 'availableQty', label: '可用库存', width: 'w-24', align: 'right' },
    { key: 'unitCost', label: '单位成本', width: 'w-24', align: 'right' },
    { key: 'stockAmount', label: '库存金额', width: 'w-28', align: 'right' },
  ];

  const renderCell = (item: ReportInventoryItem, key: string) => {
    switch (key) {
      case 'quantity':
        return formatQty(item.quantity);
      case 'inTransitQty':
        return formatQty(item.inTransitQty);
      case 'availableQty':
        return formatQty(item.availableQty);
      case 'unitCost':
        return formatAmount(item.unitCost);
      case 'stockAmount':
        return formatAmount(item.stockAmount);
      case 'brand':
        return item.brand || '-';
      default:
        return (item as any)[key] || '-';
    }
  };

  return (
    <div className="p-5">
      <h1 className="text-xl font-semibold mb-4">库存查询</h1>

      <ReportFilter
        showWarehouse
        onSearch={handleSearch}
        onReset={handleReset}
      />

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
                items.map((item: ReportInventoryItem, idx: number) => (
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
                  colSpan={6}
                  className="px-3 font-medium text-gray-700 text-right"
                >
                  合计：
                </td>
                <td className="px-3 text-right font-medium text-gray-700">
                  {formatQty(summary.totalQty)}
                </td>
                <td colSpan={3}></td>
                <td className="px-3 text-right font-medium text-blue-600">
                  {formatAmount(summary.totalAmount)}
                </td>
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
