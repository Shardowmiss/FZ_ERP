import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';

interface PortalPR {
  id: string;
  returnNo: string;
  sourceReturnNo: string | null;
  sourceDocType: string | null;
  supplierName: string | null;
  partnerName: string | null;
  returnDate: string | null;
  totalAmount: string | null;
  totalQty: string | null;
  status: string;
  remark: string | null;
}

const prStatusLabel: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  wait_confirm: { label: '待接收', tone: 'warn' },
  approved: { label: '已审核', tone: 'ok' },
  completed: { label: '已完成', tone: 'ok' },
  voided: { label: '已作废', tone: 'danger' },
};

const MyPurchaseReturnsPage: React.FC = () => {
  const [list, setList] = useState<PortalPR[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (keyword) params.append('keyword', keyword);
      if (statusFilter) params.append('status', statusFilter);
      const res: any = await axiosForBackend.get(`/api/distribution/portal/purchase-returns?${params.toString()}`);
      setList(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (error) {
      logger.error('加载我的采购退货单失败', error);
      toast('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, statusFilter]);

  const handleSearch = () => { setPage(1); loadList(); };
  const handleReset = () => { setKeyword(''); setStatusFilter(''); setPage(1); setTimeout(loadList, 0); };
  const fmtDate = (s: string | null) => (s ? s.slice(0, 10) : '-');
  const fmtMoney = (s: string | null) => (s ? `¥${Number(s).toFixed(2)}` : '-');

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">我的采购退货单</h1>
          <span className="text-xs text-gray-400">上游销售退货单在本节点的镜像</span>
        </div>

        <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded">
          <input
            type="text"
            placeholder="搜索退货单号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm w-52 focus:outline-none focus:border-primary"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value="">全部状态</option>
            <option value="wait_confirm">待接收</option>
            <option value="approved">已审核</option>
            <option value="completed">已完成</option>
            <option value="voided">已作废</option>
          </select>
          <button onClick={handleSearch} className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-primary">查询</button>
          <button onClick={handleReset} className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300">重置</button>
        </div>

        <TableContainer>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                <th className="px-4 py-3 text-left">退货单号</th>
                <th className="px-4 py-3 text-left">上游退货单号</th>
                <th className="px-4 py-3 text-left">供应商（上家）</th>
                <th className="px-4 py-3 text-left">本方节点</th>
                <th className="px-4 py-3 text-left">退货日期</th>
                <th className="px-4 py-3 text-right">数量</th>
                <th className="px-4 py-3 text-right">金额</th>
                <th className="px-4 py-3 text-center">状态</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">暂无采购退货单</td></tr>
              ) : (
                list.map((it) => {
                  const s = prStatusLabel[it.status] || { label: it.status, tone: 'neutral' as StatusTone };
                  return (
                    <tr key={it.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{it.returnNo}</td>
                      <td className="px-4 py-3 text-gray-500">{it.sourceReturnNo || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{it.supplierName || '-'}</td>
                      <td className="px-4 py-3 text-gray-700">{it.partnerName || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{fmtDate(it.returnDate)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{it.totalQty ?? '-'}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{fmtMoney(it.totalAmount)}</td>
                      <td className="px-4 py-3 text-center"><StatusBadge tone={s.tone}>{s.label}</StatusBadge></td>
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
          onPageSizeChange={(size: number) => { setPageSize(size); setPage(1); }}
        />
      </div>
    </div>
  );
};

export default MyPurchaseReturnsPage;
