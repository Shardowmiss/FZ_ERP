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
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

const InventoryOutboundPage: React.FC = () => {
  const navigate = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [bizNo, setBizNo] = useState('');
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [bizDateStart, setBizDateStart] = useState(defaultDocStart);
  const [bizDateEnd, setBizDateEnd] = useState(defaultDocEnd);
  const [createdAtStart, setCreatedAtStart] = useState('');
  const [createdAtEnd, setCreatedAtEnd] = useState('');
  const [warehouseName, setWarehouseName] = useState('');

  useEffect(() => {
    loadList();
  }, [page, pageSize, typeFilter, bizNo, bizDateStart, bizDateEnd, createdAtStart, createdAtEnd, warehouseName]);

  const handleAdd = () => {
    navigate('/inventory/outbound/new');
  };

  const handleView = (item: any) => {
    navigate(`/inventory/outbound/${item.id}/edit?view=true`);
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('flowType', 'out');
      if (typeFilter) params.set('outboundType', typeFilter);
      if (bizNo) params.set('bizNo', bizNo);
      if (bizDateStart) params.set('bizDateStart', bizDateStart);
      if (bizDateEnd) params.set('bizDateEnd', bizDateEnd);
      if (createdAtStart) params.set('startDate', createdAtStart);
      if (createdAtEnd) params.set('endDate', createdAtEnd);
      if (warehouseName) params.set('warehouseName', warehouseName);
      const res = await axiosForBackend.get(
        `/api/inventory/flow?${params.toString()}`
      );
      const flows = res.data.items || [];
      const grouped: Record<string, any> = {};
      flows.forEach((f: any) => {
        const key = f.bizNo;
        if (!grouped[key]) {
          grouped[key] = {
            id: f.id,
            orderNo: f.bizNo,
            warehouseId: f.warehouseId,
            warehouseName: f.warehouseName,
            outboundType: f.bizType,
            bizDate: f.bizDate ? f.bizDate : '',
            outboundDate: f.createdAt ? f.createdAt.split('T')[0] : '',
            status: 'completed',
            createdAt: f.createdAt,
          };
        }
      });
      const result = Object.values(grouped);
      setList(result);
      setTotal(res.data.total || 0);
    } catch (error) {
      logger.error('加载出库单失败', error);
      setList([]);
    }
    setLoading(false);
  };

  const typeMap: Record<string, string> = {
    sales: '销售出库',
    purchase_return: '采购退货',
    production_issue: '生产领料',
    transfer_out: '调拨出库',
    stocktake: '盘亏调整',
    other_out: '其他出库',
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams();
      params.set('page', '1');
      params.set('pageSize', '10000');
      params.set('flowType', 'out');
      if (typeFilter) params.set('outboundType', typeFilter);
      if (bizNo) params.set('bizNo', bizNo);
      if (bizDateStart) params.set('bizDateStart', bizDateStart);
      if (bizDateEnd) params.set('bizDateEnd', bizDateEnd);
      if (createdAtStart) params.set('startDate', createdAtStart);
      if (createdAtEnd) params.set('endDate', createdAtEnd);
      if (warehouseName) params.set('warehouseName', warehouseName);
      const res = await axiosForBackend.get(
        `/api/inventory/flow?${params.toString()}`
      );
      const flows = res.data.items || [];
      const grouped: Record<string, any> = {};
      flows.forEach((f: any) => {
        const key = f.bizNo;
        if (!grouped[key]) {
          grouped[key] = {
            id: f.id,
            orderNo: f.bizNo,
            warehouseId: f.warehouseId,
            warehouseName: f.warehouseName,
            outboundType: f.bizType,
            bizDate: f.bizDate ? f.bizDate : '',
            outboundDate: f.createdAt ? f.createdAt.split('T')[0] : '',
            status: 'completed',
            createdAt: f.createdAt,
          };
        }
      });
      const result = Object.values(grouped);
      exportTableToCSV('出库单', result as unknown as Record<string, unknown>[], {
        orderNo: '出库单号',
        warehouseName: '仓库',
        outboundType: '出库类型',
        bizDate: '单据日期',
        outboundDate: '入库日期',
        status: '状态',
        createdAt: '创建时间',
      });
    } catch (error) {
      logger.error('导出出库单失败', error);
      toast(errMsg(error, '导出失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">出库单</h1>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary"
          >
            + 新增出库单
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
        <input
          type="text"
          placeholder="单号"
          value={bizNo}
          onChange={(e) => { setBizNo(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary w-32"
        />
        <input
          type="text"
          placeholder="店仓名称"
          value={warehouseName}
          onChange={(e) => { setWarehouseName(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary w-32"
        />
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <span>单据日期</span>
          <input
            type="date"
            value={bizDateStart}
            onChange={(e) => { setBizDateStart(e.target.value); setPage(1); }}
            className="px-2 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
          <span>~</span>
          <input
            type="date"
            value={bizDateEnd}
            onChange={(e) => { setBizDateEnd(e.target.value); setPage(1); }}
            className="px-2 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-1 text-sm text-gray-600">
          <span>入库日期</span>
          <input
            type="date"
            value={createdAtStart}
            onChange={(e) => { setCreatedAtStart(e.target.value); setPage(1); }}
            className="px-2 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
          <span>~</span>
          <input
            type="date"
            value={createdAtEnd}
            onChange={(e) => { setCreatedAtEnd(e.target.value); setPage(1); }}
            className="px-2 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>
        <button
          onClick={loadList}
          className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary"
        >
          查询
        </button>
        <button
          onClick={() => {
            setBizNo(''); setWarehouseName(''); setBizDateStart(''); setBizDateEnd('');
            setCreatedAtStart(''); setCreatedAtEnd(''); setPage(1);
          }}
          className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded text-sm hover:bg-gray-50"
        >
          重置
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
              <th className="px-4 py-3 text-left">出库单号</th>
              <th className="px-4 py-3 text-left">仓库</th>
              <th className="px-4 py-3 text-left">出库类型</th>
              <th className="px-4 py-3 text-left">单据日期</th>
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
                  <td className="px-4 py-3 text-gray-600">{typeMap[item.outboundType] || item.outboundType}</td>
                  <td className="px-4 py-3 text-gray-500">{item.bizDate || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{item.outboundDate}</td>
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

export default InventoryOutboundPage;
