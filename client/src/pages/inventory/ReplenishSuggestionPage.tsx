import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { errMsg } from '@/utils/errMsg';

interface Suggestion {
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  safetyMin: number;
  safetyMax: number;
  suggestQty: number;
}

const ReplenishSuggestionPage: React.FC = () => {
  const [list, setList] = useState<Suggestion[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string; type: string }[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    loadWarehouses();
    loadSuppliers();
  }, []);

  const loadWarehouses = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/warehouse/options');
      setWarehouseOptions(res.data || []);
    } catch (error) {
      logger.error('加载仓库失败', error);
    }
  };

  const loadSuppliers = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/supplier/options');
      setSupplierOptions(res.data || []);
    } catch (error) {
      logger.error('加载供应商失败', error);
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (warehouseFilter) params.append('warehouseId', warehouseFilter);
      if (keyword) params.append('keyword', keyword);
      const res = await axiosForBackend.get(`/api/inventory/replenish/suggest?${params.toString()}`);
      setList(res.data || []);
      setTotal(res.data?.length || 0);
    } catch (error) {
      logger.error('加载补货建议失败', error);
      toast(errMsg(error, '加载失败'));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadList();
  }, [page, pageSize, warehouseFilter]);

  const handleGenerate = async () => {
    if (!supplierId) {
      toast('请先选择供应商');
      return;
    }
    const items = list.filter((it) => it.suggestQty > 0).map((it) => ({
      skuId: it.skuId,
      supplierId,
      quantity: it.suggestQty,
    }));
    if (items.length === 0) {
      toast('没有可生成的补货明细');
      return;
    }
    setGenerating(true);
    try {
      const res = await axiosForBackend.post('/api/inventory/replenish/generate', {
        orderDate,
        items,
      });
      toast.success(`已生成 ${res.data.orderCount} 张采购订单`);
      loadList();
    } catch (error) {
      logger.error('生成采购单失败', error);
      toast(errMsg(error, '生成失败'));
    }
    setGenerating(false);
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">补货建议</h1>
          <span className="text-sm text-gray-400">基于库存低于安全下限自动生成补货建议</span>
        </div>

        <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">仓库</label>
            <select
              value={warehouseFilter}
              onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="">全部仓库</option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            placeholder="搜索款号/SKU"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm w-52 focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => { setPage(1); loadList(); }}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary"
          >
            查询
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-4 p-3 bg-blue-50 rounded items-end border border-blue-100">
          <div>
            <label className="block text-xs text-gray-500 mb-1">补货供应商 *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            >
              <option value="">请选择供应商</option>
              {supplierOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">订单日期</label>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            {generating ? '生成中...' : '一键生成采购订单'}
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
                <th className="px-4 py-3 text-right">建议补货量</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={9} className="py-8 text-center text-gray-400">暂无低于安全下限的库存</td></tr>
              ) : (
                list.map((item, idx) => (
                  <tr key={`${item.skuId}-${item.warehouseId}-${idx}`} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{item.skuCode}</td>
                    <td className="px-4 py-3 text-gray-700">{item.styleNo}</td>
                    <td className="px-4 py-3 text-gray-600">{item.color}</td>
                    <td className="px-4 py-3 text-gray-600">{item.size}</td>
                    <td className="px-4 py-3 text-gray-600">{item.warehouseName}</td>
                    <td className="px-4 py-3 text-right text-red-600 font-medium">{item.quantity.toFixed(3)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{item.safetyMin.toFixed(3)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{item.safetyMax.toFixed(3)}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">{item.suggestQty.toFixed(3)}</td>
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
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      </div>
    </div>
  );
};

export default ReplenishSuggestionPage;
