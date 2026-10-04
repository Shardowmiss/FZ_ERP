import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import type { Receivable } from '@shared/api.interface';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';
import { exportTableToCSV } from '@client/src/utils/export-csv';
import { errMsg } from '@/utils/errMsg';
import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';

interface PaymentItem {
  id: string;
  paymentDate: string;
  amount: number;
  paymentMethod?: string;
  remark?: string;
}

const ReceivablePage: React.FC = () => {
  const [list, setList] = useState<Receivable[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dealerFilter, setCustomerFilter] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [currentItem, setCurrentItem] = useState<Receivable | null>(null);
  const [payments, setPayments] = useState<PaymentItem[]>([]);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: 0,
    paymentMethod: 'bank',
    remark: '',
  });

  const loadList = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (keyword) params.append('keyword', keyword);
      if (statusFilter) params.append('status', statusFilter);
      if (dealerFilter) params.append('dealerId', dealerFilter);

      const res = await axiosForBackend.get(`/api/finance/receivable?${params.toString()}`);
      setList(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (error) {
      logger.error('加载应收列表失败', error);
      toast(errMsg(error, '加载失败'));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadList();
  }, [page, pageSize, statusFilter, dealerFilter]);

  const handleSearch = () => {
    setPage(1);
    loadList();
  };

  const handleReset = () => {
    setKeyword('');
    setStatusFilter('');
    setCustomerFilter('');
    setPage(1);
    setTimeout(loadList, 0);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '10000',
      });
      if (keyword) params.append('keyword', keyword);
      if (statusFilter) params.append('status', statusFilter);
      if (dealerFilter) params.append('dealerId', dealerFilter);

      const res = await axiosForBackend.get(`/api/finance/receivable?${params.toString()}`);
      const items = res.data.items || [];
      const statusLabelMap: Record<string, string> = {
        unpaid: '未收款',
        partial: '部分收款',
        paid: '已结清',
      };
      const data = items.map((it: Receivable) => ({
        receivableNo: it.receivableNo,
        customerName: it.customerName || '-',
        bizType: it.bizType || '-',
        bizNo: it.bizNo || '-',
        amount: it.amount.toFixed(2),
        receivedAmount: it.receivedAmount.toFixed(2),
        balance: it.balance.toFixed(2),
        createdAt: it.createdAt ? it.createdAt.split('T')[0] : '',
        status: statusLabelMap[it.status] || it.status,
      }));
      exportTableToCSV('应收列表', data as unknown as Record<string, unknown>[], {
        receivableNo: '应收单号',
        customerName: '客户',
        bizType: '业务类型',
        bizNo: '业务单号',
        amount: '应收金额',
        receivedAmount: '已收金额',
        balance: '未收金额',
        createdAt: '创建日期',
        status: '状态',
      });
    } catch (error) {
      logger.error('导出应收列表失败', error);
      toast(errMsg(error, '导出失败'));
    }
  };

  const handleViewDetail = async (item: Receivable) => {
    setCurrentItem(item);
    try {
      const res = await axiosForBackend.get(`/api/finance/receivable/${item.id}`);
      setPayments(res.data.payments || []);
    } catch (error) {
      setPayments([]);
    }
    setShowDetail(true);
  };

  const openPaymentModal = () => {
    setShowDetail(false);
    setShowPaymentModal(true);
    if (currentItem) {
      setPaymentForm({
        paymentDate: new Date().toISOString().split('T')[0],
        amount: currentItem.balance,
        paymentMethod: 'bank',
        remark: '',
      });
    }
  };

  const [submitting, setSubmitting] = useState(false);

  const handlePayment = async () => {
    if (submitting) return;
    if (!currentItem) return;
    if (!paymentForm.amount || paymentForm.amount <= 0) {
      toast('请输入收款金额');
      return;
    }
    if (paymentForm.amount > currentItem.balance + 0.001) {
      toast('收款金额不能大于未收金额');
      return;
    }
    setSubmitting(true);
    try {
      await axiosForBackend.post(
        `/api/finance/receivable/${currentItem.id}/payment`,
        paymentForm
      );
      toast('收款成功');
      setShowPaymentModal(false);
      setShowDetail(false);
      loadList();
    } catch (error) {
      logger.error('收款失败', error);
      toast(errMsg(error, '收款失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusLabel = (status: string) => {
    const map: Record<string, { label: string; tone: StatusTone }> = {
      unpaid: { label: '未收款', tone: 'danger' },
      partial: { label: '部分收款', tone: 'warn' },
      paid: { label: '已结清', tone: 'ok' },
    };
    return map[status] || { label: status, tone: 'neutral' };
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return dateStr.split('T')[0];
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">应收管理</h1>
        </div>

      <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded">
        <input
          type="text"
          placeholder="搜索单号/客户名"
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
          <option value="unpaid">未收款</option>
          <option value="partial">部分收款</option>
          <option value="paid">已结清</option>
        </select>
        <button
          onClick={handleSearch}
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
              <th className="px-4 py-3 text-left">应收单号</th>
              <th className="px-4 py-3 text-left">客户</th>
              <th className="px-4 py-3 text-left">业务类型</th>
              <th className="px-4 py-3 text-left">业务单号</th>
              <th className="px-4 py-3 text-right">应收金额</th>
              <th className="px-4 py-3 text-right">已收金额</th>
              <th className="px-4 py-3 text-right">未收金额</th>
              <th className="px-4 py-3 text-left">创建日期</th>
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-8 text-center text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={10} className="py-8 text-center text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => {
                const s = getStatusLabel(item.status);
                return (
                  <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{item.receivableNo}</td>
                    <td className="px-4 py-3 text-gray-700">{item.customerName || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.bizType || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.bizNo || '-'}</td>
                    <td className="px-4 py-3 text-right text-gray-700">¥{item.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-green-600">¥{item.receivedAmount.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-red-500 font-medium">¥{item.balance.toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(item.createdAt)}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleViewDetail(item)}
                        className="text-primary hover:text-blue-600 mr-3"
                      >
                        查看/收款
                      </button>
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

      {showDetail && currentItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[700px] max-w-[95vw] max-h-[80vh] overflow-auto">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium">应收单详情</h3>
              <button onClick={() => setShowDetail(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-gray-500">应收单号：</span>{currentItem.receivableNo}</div>
                <div><span className="text-gray-500">客户：</span>{currentItem.customerName}</div>
                <div><span className="text-gray-500">业务类型：</span>{currentItem.bizType || '-'}</div>
                <div><span className="text-gray-500">业务单号：</span>{currentItem.bizNo || '-'}</div>
                <div><span className="text-gray-500">应收金额：</span><span className="text-gray-800 font-medium">¥{currentItem.amount.toFixed(2)}</span></div>
                <div><span className="text-gray-500">已收金额：</span><span className="text-green-600 font-medium">¥{currentItem.receivedAmount.toFixed(2)}</span></div>
                <div><span className="text-gray-500">未收金额：</span><span className="text-red-500 font-medium">¥{currentItem.balance.toFixed(2)}</span></div>
                <div><span className="text-gray-500">创建日期：</span>{formatDate(currentItem.createdAt)}</div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">收款记录</h4>
                <table className="w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">收款日期</th>
                      <th className="px-3 py-2 text-right text-gray-600 font-medium">金额</th>
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">方式</th>
                      <th className="px-3 py-2 text-left text-gray-600 font-medium">备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length === 0 ? (
                      <tr><td colSpan={4} className="py-4 text-center text-gray-400">暂无收款记录</td></tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p.id} className="border-t border-gray-200">
                          <td className="px-3 py-2">{p.paymentDate}</td>
                          <td className="px-3 py-2 text-right">¥{p.amount.toFixed(2)}</td>
                          <td className="px-3 py-2">{p.paymentMethod || '-'}</td>
                          <td className="px-3 py-2 text-gray-500">{p.remark || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowDetail(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                关闭
              </button>
              {currentItem.status !== 'paid' && (
                <button
                  onClick={openPaymentModal}
                  className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
                >
                  收款核销
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && currentItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[480px] max-w-[95vw]">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium">收款核销</h3>
              <button onClick={() => setShowPaymentModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="text-sm text-gray-600">
                应收单号：{currentItem.receivableNo}
                <br />
                未收金额：<span className="text-red-500 font-medium">¥{currentItem.balance.toFixed(2)}</span>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">收款日期 *</label>
                <input
                  type="date"
                  value={paymentForm.paymentDate}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">收款金额 *</label>
                <input
                  type="number"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">收款方式</label>
                <select
                  value={paymentForm.paymentMethod}
                  onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                >
                  <option value="bank">银行转账</option>
                  <option value="cash">现金</option>
                  <option value="alipay">支付宝</option>
                  <option value="wechat">微信</option>
                  <option value="other">其他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">备注</label>
                <textarea
                  value={paymentForm.remark}
                  onChange={(e) => setPaymentForm({ ...paymentForm, remark: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  rows={2}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowPaymentModal(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handlePayment}
                disabled={submitting}
                className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '收款中...' : '确认收款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReceivablePage;
