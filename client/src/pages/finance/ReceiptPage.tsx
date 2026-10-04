import React, { useState, useEffect } from 'react';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { financeApi } from '@client/src/api/finance';
import { baseApi } from '@client/src/api/base';
import type { FinanceReceipt, PaginationResult } from '@shared/api.interface';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { errMsg } from '@/utils/errMsg';
import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  approved: '已审核',
  voided: '已作废',
  cancelled: '已作废',
};

const statusTone: Record<string, StatusTone> = {
  draft: 'neutral',
  approved: 'ok',
  voided: 'danger',
};

const paymentMethodLabel: Record<string, string> = {
  cash: '现金',
  bank: '转账',
  check: '支票',
  other: '其他',
};

const ReceiptPage: React.FC = () => {
  const navigate = useNavigate();

  const [list, setList] = useState<FinanceReceipt[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterDealer, setFilterDealer] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const def = useDefaultDocDate();
  const [filterStartDate, setFilterStartDate] = useState<string>(def.startDate);
  const [filterEndDate, setFilterEndDate] = useState<string>(def.endDate);
  const [keyword, setKeyword] = useState<string>('');

  const [dealerOptions, setDealerOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        dealerId?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
        keyword?: string;
      } = { page, pageSize };
      if (filterDealer) params.dealerId = filterDealer;
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<FinanceReceipt> = await financeApi.receipt.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, pageSize, filterDealer, filterStatus, filterStartDate, filterEndDate, keyword]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const dealers = await baseApi.dealer.options();
        setDealerOptions(dealers);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  const openAdd = (): void => {
    navigate('/finance/receipt/new');
  };

  const openView = (id: string): void => {
    navigate(`/finance/receipt/${id}/edit?view=1`);
  };

  const handleApprove = async (rid: string): Promise<void> => {
    if (!await showConfirm('确定审核该收款单吗？审核后不可修改。')) return;
    try {
      await financeApi.receipt.approve(rid);
      toast.success('审核成功');
      fetchList();
    } catch (e) {
      toast.error(errMsg(e, '审核失败'));
    }
  };

  const handleDelete = async (rid: string): Promise<void> => {
    if (!await showConfirm('确定删除该收款单吗？')) return;
    try {
      await financeApi.receipt.remove(rid);
      toast.success('删除成功');
      fetchList();
    } catch (e) {
      toast.error(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await financeApi.receipt.void(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleSearch = (): void => {
    setPage(1);
    fetchList();
  };

  const handleReset = (): void => {
    setFilterDealer('');
    setFilterStatus('');
    setFilterStartDate('');
    setFilterEndDate('');
    setKeyword('');
    setPage(1);
  };

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return '-';
    return dateStr.slice(0, 10);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-800">收款单</h1>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
            <Plus size={16} /> 新增收款单
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">经销商：</span>
            <select
              value={filterDealer}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterDealer(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
            >
              <option value="">全部</option>
              {dealerOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">状态：</span>
            <select
              value={filterStatus}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
            >
              <option value="">全部</option>
              <option value="draft">草稿</option>
              <option value="approved">已审核</option>
                        <option value="cancelled">已作废</option>
</select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">日期：</span>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
            />
            <span className="text-gray-400">~</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
                placeholder="搜索单号/经办人"
                className="border border-gray-300 rounded pl-7 pr-2 py-1 text-sm focus:outline-none focus:border-primary w-44"
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            className="px-3 py-1.5 text-sm bg-primary text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
            <Search size={14} /> 查询
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            重置
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5">
        <TableContainer>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
                <th className="text-left py-2.5 px-4 font-medium">收款单号</th>
                <th className="text-left py-2.5 px-4 font-medium">收款日期</th>
                <th className="text-left py-2.5 px-4 font-medium">经销商</th>
                <th className="text-right py-2.5 px-4 font-medium">收款金额</th>
                <th className="text-left py-2.5 px-4 font-medium">收款方式</th>
                <th className="text-left py-2.5 px-4 font-medium">经办人</th>
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
                list.map((item: FinanceReceipt) => (
                  <tr key={item.id} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                    <td className="py-2 px-4 font-medium text-gray-800">{item.receiptNo}</td>
                    <td className="py-2 px-4">{formatDate(item.receiptDate)}</td>
                    <td className="py-2 px-4">{item.customerName}</td>
                    <td className="py-2 px-4 text-right font-medium text-gray-800">¥ {item.amount.toFixed(2)}</td>
                    <td className="py-2 px-4">{paymentMethodLabel[item.paymentMethod] ?? item.paymentMethod}</td>
                    <td className="py-2 px-4 text-gray-500">{item.handler ?? '-'}</td>
                    <td className="py-2 px-4">
                      <StatusBadge tone={statusTone[item.status] ?? 'neutral'}>{statusLabel[item.status] ?? item.status}</StatusBadge>
                    </td>
                    <td className="py-2 px-4 space-x-2">
                      {item.status === 'draft' && (
                        <>
                          <button onClick={() => navigate(`/finance/receipt/${item.id}/edit`)} className="text-primary hover:text-blue-600">编辑</button>
                          <button onClick={() => handleApprove(item.id)} className="text-green-500 hover:text-green-600">审核</button>
                          <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:text-red-600">删除</button>
                                                <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                      )}
                      {item.status === 'approved' && (
                        <button onClick={() => openView(item.id)} className="text-primary hover:text-blue-600">查看</button>
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

    </div>
  );
};

export default ReceiptPage;
