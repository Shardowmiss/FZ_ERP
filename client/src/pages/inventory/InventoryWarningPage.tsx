import React, { useState, useEffect } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { request } from '@client/src/api/request';
import { inventoryApi } from '@client/src/api/inventory';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';
import type { InventoryWarningItem } from '@shared/api.interface';

interface WarningItem {
  id: string;
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseId: string;
  warehouseName: string;
  stockQty: number;
  minStock: number;
  maxStock: number;
  warningType: string;
}

/** 将后端返回的 InventoryWarningItem 映射为页面使用的 WarningItem */
function toWarningItem(it: InventoryWarningItem): WarningItem {
  return {
    id: `${it.skuCode}-${it.warehouseName}`,
    skuId: '',
    skuCode: it.skuCode,
    styleNo: it.styleNo,
    color: it.color,
    size: it.size,
    warehouseId: '',
    warehouseName: it.warehouseName,
    stockQty: Number(it.quantity),
    minStock: Number(it.safetyMin),
    maxStock: Number(it.safetyMax),
    warningType: it.warningType,
  };
}

const InventoryWarningPage: React.FC = () => {
  const [list, setList] = useState<WarningItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [warningType, setWarningType] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string; type: string }[]>([]);

  useEffect(() => {
    loadWarehouses();
  }, []);

  const loadWarehouses = async () => {
    try {
      const options = await request<{ id: string; code: string; name: string; type: string }[]>(
        '/api/base/warehouse/options',
        'GET',
      );
      setWarehouseOptions(options || []);
    } catch (error) {
      logger.error('加载仓库失败', error);
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        pageSize: String(pageSize),
      };
      if (warningType) params.warningType = warningType;
      if (warehouseFilter) params.warehouseId = warehouseFilter;
      if (keyword) params.keyword = keyword;

      const res = await inventoryApi.warning.list(params as any);
      setList((res.items || []).map(toWarningItem));
      setTotal(res.total || 0);
    } catch (error) {
      logger.error('加载库存预警失败', error);
      toast(errMsg(error, '加载失败'));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadList();
  }, [page, pageSize, warningType, warehouseFilter]);

  const handleSearch = () => {
    setPage(1);
    loadList();
  };

  const handleReset = () => {
    setKeyword('');
    setWarningType('');
    setWarehouseFilter('');
    setPage(1);
    setTimeout(loadList, 0);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {
        page: '1',
        pageSize: '10000',
      };
      if (warningType) params.warningType = warningType;
      if (warehouseFilter) params.warehouseId = warehouseFilter;
      if (keyword) params.keyword = keyword;

      const res = await inventoryApi.warning.list(params as any);
      const items = (res.items || []).map(toWarningItem);
      const labelMap: Record<string, string> = {
        below_min: '低于下限',
        above_max: '高于上限',
      };
      const data = items.map((it: WarningItem) => ({
        skuCode: it.skuCode,
        styleNo: it.styleNo,
        color: it.color,
        size: it.size,
        warehouseName: it.warehouseName,
        stockQty: it.stockQty,
        minStock: it.minStock,
        maxStock: it.maxStock,
        warningType: labelMap[it.warningType] || it.warningType,
      }));
      exportTableToCSV('库存预警', data as unknown as Record<string, unknown>[], {
        skuCode: 'SKU编码',
        styleNo: '款号',
        color: '颜色',
        size: '尺码',
        warehouseName: '仓库',
        stockQty: '现存量',
        minStock: '安全下限',
        maxStock: '安全上限',
        warningType: '预警类型',
      });
    } catch (error) {
      logger.error('导出库存预警失败', error);
      toast(errMsg(error, '导出失败'));
    }
  };

  const getWarningLabel = (type: string) => {
    const map: Record<string, { label: string; className: string }> = {
      below_min: { label: '低于下限', className: 'bg-red-100 text-red-700' },
      above_max: { label: '高于上限', className: 'bg-orange-100 text-orange-700' },
    };
    return map[type] || { label: type, className: 'bg-gray-100 text-gray-600' };
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">库存预警</h1>
        </div>

      <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded">
        <input
          type="text"
          placeholder="搜索款号/SKU"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-52 focus:outline-none focus:border-blue-500"
        />
        <select
          value={warehouseFilter}
          onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">全部仓库</option>
          {warehouseOptions.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          value={warningType}
          onChange={(e) => { setWarningType(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">全部预警</option>
          <option value="below_min">低于下限</option>
          <option value="above_max">高于上限</option>
        </select>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
        >
          查询
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          导出
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
        >
          重置
        </button>
      </div>

      <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
              <th className="px-4 py-3 text-left">SKU编码</th>
              <th className="px-4 py-3 text-left">款号</th>
              <th className="px-4 py-3 text-left">颜色</th>
              <th className="px-4 py-3 text-left">尺码</th>
              <th className="px-4 py-3 text-left">仓库</th>
              <th className="px-4 py-3 text-right">现存量</th>
              <th className="px-4 py-3 text-right">安全下限</th>
              <th className="px-4 py-3 text-right">安全上限</th>
              <th className="px-4 py-3 text-center">预警类型</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-8 text-center text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={9} className="py-8 text-center text-gray-400">暂无预警数据</td></tr>
            ) : (
              list.map((item) => {
                const w = getWarningLabel(item.warningType);
                const isLow = item.warningType === 'below_min';
                return (
                  <tr key={item.id} className={`border-b border-gray-200 hover:bg-gray-50 ${isLow ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3 text-gray-700">{item.skuCode}</td>
                    <td className="px-4 py-3 text-gray-700">{item.styleNo}</td>
                    <td className="px-4 py-3 text-gray-600">{item.color}</td>
                    <td className="px-4 py-3 text-gray-600">{item.size}</td>
                    <td className="px-4 py-3 text-gray-600">{item.warehouseName}</td>
                    <td className={`px-4 py-3 text-right font-medium ${isLow ? 'text-red-600' : 'text-orange-600'}`}>
                      {item.stockQty.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{item.minStock?.toFixed(3) || '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{item.maxStock?.toFixed(3) || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs ${w.className}`}>
                        {w.label}
                      </span>
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
      </div>
    </div>
  );
};

export default InventoryWarningPage;
