import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { errMsg } from '@/utils/errMsg';

interface BatchRow {
  id: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  warehouseName: string;
  batchNo: string;
  quantity: number;
  status: string;
  createdAt: string;
}

const BarcodePage: React.FC = () => {
  const [list, setList] = useState<BatchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [skuCode, setSkuCode] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState('');

  useEffect(() => {
    loadWarehouses();
  }, []);

  const loadWarehouses = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/warehouse/options');
      setWarehouseOptions(res.data || []);
    } catch (error) {
      logger.error('加载仓库失败', error);
    }
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (skuCode) params.append('skuCode', skuCode);
      if (warehouseId) params.append('warehouseId', warehouseId);
      if (batchNo) params.append('batchNo', batchNo);
      const res = await axiosForBackend.get(`/api/inventory/batch?${params.toString()}`);
      setList(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (error) {
      logger.error('加载批次库存失败', error);
      toast(errMsg(error, '加载失败'));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadList();
  }, [page, pageSize, warehouseId]);
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await axiosForBackend.post('/api/inventory/barcode/generate');
      toast.success(`已生成 ${res.data.generated} 个条码`);
      loadList();
    } catch (error) {
      logger.error('生成条码失败', error);
      toast(errMsg(error, '生成失败'));
    }
    setGenerating(false);
  };

  const handleSearch = () => {
    setPage(1);
    loadList();
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">条码 / 批次管理</h1>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {generating ? '生成中...' : '为缺失条码的SKU生成条码'}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded items-end">
          <input
            type="text"
            placeholder="SKU编码"
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm w-44 focus:outline-none focus:border-primary"
          />
          <select
            value={warehouseId}
            onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value="">全部仓库</option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="批次号"
            value={batchNo}
            onChange={(e) => setBatchNo(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm w-44 focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
          >
            查询
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
                <th className="px-4 py-3 text-left">批次号</th>
                <th className="px-4 py-3 text-right">数量</th>
                <th className="px-4 py-3 text-center">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">暂无批次数据</td></tr>
              ) : (
                list.map((item) => (
                  <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{item.skuCode}</td>
                    <td className="px-4 py-3 text-gray-700">{item.styleNo}</td>
                    <td className="px-4 py-3 text-gray-600">{item.color}</td>
                    <td className="px-4 py-3 text-gray-600">{item.size}</td>
                    <td className="px-4 py-3 text-gray-600">{item.warehouseName}</td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">{item.batchNo}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.quantity.toFixed(3)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                        {item.status}
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
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        />
      </div>
    </div>
  );
};

export default BarcodePage;
