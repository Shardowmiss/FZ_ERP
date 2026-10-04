import { StatusBadge } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';

interface InboundOrder {
  id: string;
  orderNo: string;
  warehouseId: string;
  warehouseName?: string;
  inboundType: string;
  inboundDate: string;
  status: string;
  totalAmount?: number;
  remark?: string;
  createdAt: string;
}

const InventoryInboundPage: React.FC = () => {
  const navigate = useNavigate();
  const [list, setList] = useState<InboundOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    loadList();
  }, [page, pageSize, typeFilter]);

  const handleAdd = () => {
    navigate('/inventory/inbound/new');
  };

  const handleView = (item: InboundOrder) => {
    navigate(`/inventory/inbound/${item.id}/edit?view=true`);
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await axiosForBackend.get(
        `/api/inventory/flow?page=${page}&pageSize=${pageSize}&flowType=inbound` +
        (typeFilter ? `&inboundType=${typeFilter}` : '')
      );
      const flows = res.data.items || [];
      const grouped: Record<string, InboundOrder> = {};
      flows.forEach((f: any) => {
        const key = f.bizNo;
        if (!grouped[key]) {
          grouped[key] = {
            id: f.id,
            orderNo: f.bizNo,
            warehouseId: f.warehouseId,
            warehouseName: f.warehouseName,
            inboundType: f.bizType,
            inboundDate: f.createdAt ? f.createdAt.split('T')[0] : '',
            status: 'completed',
            createdAt: f.createdAt,
          };
        }
      });
      const result = Object.values(grouped);
      setList(result);
      setTotal(res.data.total || 0);
    } catch (error) {
      logger.error('加载入库单失败', error);
      setList([]);
    }
    setLoading(false);
  };

  const typeMap: Record<string, string> = {
    purchase: '采购入库',
    sales_return: '销售退货',
    production_finished: '生产完工',
    transfer_in: '调拨入库',
    stocktake: '盘盈调整',
    other_in: '其他入库',
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const res = await axiosForBackend.get(
        `/api/inventory/flow?page=1&pageSize=10000&flowType=inbound` +
        (typeFilter ? `&inboundType=${typeFilter}` : '')
      );
      const flows = res.data.items || [];
      const grouped: Record<string, InboundOrder> = {};
      flows.forEach((f: any) => {
        const key = f.bizNo;
        if (!grouped[key]) {
          grouped[key] = {
            id: f.id,
            orderNo: f.bizNo,
            warehouseId: f.warehouseId,
            warehouseName: f.warehouseName,
            inboundType: f.bizType,
            inboundDate: f.createdAt ? f.createdAt.split('T')[0] : '',
            status: 'completed',
            createdAt: f.createdAt,
          };
        }
      });
      const result = Object.values(grouped);
      exportTableToCSV('入库单', result as unknown as Record<string, unknown>[], {
        orderNo: '入库单号',
        warehouseName: '仓库',
        inboundType: '入库类型',
        inboundDate: '入库日期',
        status: '状态',
        createdAt: '创建时间',
      });
    } catch (error) {
      logger.error('导出入库单失败', error);
      toast(errMsg(error, '导出失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">入库单</h1>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
          >
            + 新增入库单
          </button>
        </div>

      <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded">
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部类型</option>
          {Object.entries(typeMap).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button
          onClick={loadList}
          className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
        >
          查询
        </button>
        <button
          onClick={handleExport}
          className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          导出
        </button>
      </div>

      <TableContainer>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
              <th className="px-4 py-3 text-left">入库单号</th>
              <th className="px-4 py-3 text-left">仓库</th>
              <th className="px-4 py-3 text-left">入库类型</th>
              <th className="px-4 py-3 text-left">入库日期</th>
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-left">创建时间</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{item.orderNo}</td>
                  <td className="px-4 py-3 text-gray-600">{item.warehouseName || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{typeMap[item.inboundType] || item.inboundType}</td>
                  <td className="px-4 py-3 text-gray-500">{item.inboundDate}</td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge tone="ok">已完成</StatusBadge>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{item.createdAt || '-'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => handleView(item)} className="text-primary hover:underline text-sm">查看</button>
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
    </div>
  );
};

export default InventoryInboundPage;
