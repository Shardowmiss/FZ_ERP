import React, { useState, useEffect } from 'react';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { salesApi } from '@client/src/api/sales';
import { baseApi } from '@client/src/api/base';
import type { SalesReconciliation, SalesReconPreview, PaginationResult } from '@shared/api.interface';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';

const statusLabel: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  voided: '已作废',
};

const statusColor: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-green-100 text-green-600',
  voided: 'bg-red-100 text-red-600',
};

const SalesReconciliationPage: React.FC = () => {
  const [list, setList] = useState<SalesReconciliation[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterCustomer, setFilterCustomer] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');

  const [customerOptions, setCustomerOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  const [showModal, setShowModal] = useState<boolean>(false);
  const [formCustomerId, setFormCustomerId] = useState<string>('');
  const [formStartDate, setFormStartDate] = useState<string>('');
  const [formEndDate, setFormEndDate] = useState<string>('');

  const [previewData, setPreviewData] = useState<SalesReconPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewTab, setPreviewTab] = useState<'outbound' | 'return'>('outbound');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        customerId?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
      } = { page, pageSize };
      if (filterCustomer) params.customerId = filterCustomer;
      if (filterStatus) params.status = filterStatus;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      const res: PaginationResult<SalesReconciliation> = await salesApi.reconciliation.list(params);
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
  }, [page, pageSize, filterCustomer, filterStatus, filterStartDate, filterEndDate]);

  useEffect(() => {
    const loadOpts = async (): Promise<void> => {
      try {
        const customers = await baseApi.customer.options();
        setCustomerOptions(customers);
      } catch {
        // ignore
      }
    };
    loadOpts();
  }, []);

  const openAdd = (): void => {
    setFormCustomerId('');
    setFormStartDate('');
    setFormEndDate('');
    setPreviewData(null);
    setPreviewTab('outbound');
    setShowModal(true);
  };

  const openView = async (id: string): Promise<void> => {
    try {
      const recon = await salesApi.reconciliation.get(id);
      setFormCustomerId(recon.customerId);
      setFormStartDate(recon.startDate.slice(0, 10));
      setFormEndDate(recon.endDate.slice(0, 10));
      setPreviewData({
        outboundAmount: recon.outboundAmount,
        returnAmount: recon.returnAmount,
        totalAmount: recon.totalAmount,
        outboundList: [],
        returnList: [],
      });
      setShowModal(true);
    } catch {
      toast.error('加载详情失败');
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (!formCustomerId) { toast('请选择客户'); return; }
    if (!formStartDate || !formEndDate) { toast('请选择对账期间'); return; }
    if (formStartDate > formEndDate) { toast('开始日期不能晚于结束日期'); return; }
    setPreviewLoading(true);
    try {
      const res = await salesApi.reconciliation.preview({
        customerId: formCustomerId,
        startDate: formStartDate,
        endDate: formEndDate,
      });
      setPreviewData(res);
    } catch {
      toast.error('预览失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!previewData) { toast('请先预览对账数据'); return; }
    if (!await showConfirm('确定确认该对账单吗？确认后不可修改。')) return;
    setSubmitting(true);
    try {
      await salesApi.reconciliation.create({
        customerId: formCustomerId,
        startDate: formStartDate,
        endDate: formEndDate,
        outboundAmount: previewData.outboundAmount,
        returnAmount: previewData.returnAmount,
        totalAmount: previewData.totalAmount,
      });
      toast.success('对账成功');
      setShowModal(false);
      fetchList();
    } catch {
      toast.error('对账失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleSearch = (): void => {
    setPage(1);
    fetchList();
  };

  const handleReset = (): void => {
    setFilterCustomer('');
    setFilterStatus('');
    setFilterStartDate('');
    setFilterEndDate('');
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
          <h1 className="text-xl font-semibold text-gray-800">销售对账</h1>
          <button
            onClick={openAdd}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
            <Plus size={16} /> 新建对账
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">客户：</span>
            <select
              value={filterCustomer}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterCustomer(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">全部</option>
              {customerOptions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">状态：</span>
            <select
              value={filterStatus}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">全部</option>
              <option value="draft">草稿</option>
              <option value="confirmed">已确认</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">期间：</span>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
            <span className="text-gray-400">~</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleSearch}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
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
                <th className="text-left py-2.5 px-4 font-medium">对账单号</th>
                <th className="text-left py-2.5 px-4 font-medium">客户</th>
                <th className="text-left py-2.5 px-4 font-medium">对账期间</th>
                <th className="text-right py-2.5 px-4 font-medium">出库金额</th>
                <th className="text-right py-2.5 px-4 font-medium">退货金额</th>
                <th className="text-right py-2.5 px-4 font-medium">应收总额</th>
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
                list.map((item: SalesReconciliation) => (
                  <tr key={item.id} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                    <td className="py-2 px-4 font-medium text-gray-800">{item.reconNo}</td>
                    <td className="py-2 px-4">{item.customerName ?? '-'}</td>
                    <td className="py-2 px-4">
                      {formatDate(item.startDate)} ~ {formatDate(item.endDate)}
                    </td>
                    <td className="py-2 px-4 text-right text-blue-600">¥ {item.outboundAmount.toFixed(2)}</td>
                    <td className="py-2 px-4 text-right text-orange-500">-¥ {item.returnAmount.toFixed(2)}</td>
                    <td className="py-2 px-4 text-right font-medium text-gray-800">¥ {item.totalAmount.toFixed(2)}</td>
                    <td className="py-2 px-4">
                      <span className={`px-2 py-0.5 rounded text-xs ${statusColor[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel[item.status] ?? item.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 space-x-2">
                      <button onClick={() => openView(item.id)} className="text-blue-500 hover:text-blue-600">查看</button>
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

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[800px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-medium">新建销售对账</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="p-5 space-y-4 overflow-auto flex-1">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="block text-gray-700 mb-1">客户 *</label>
                  <select
                    value={formCustomerId}
                    onChange={(e) => setFormCustomerId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  >
                    <option value="">请选择</option>
                    {customerOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 mb-1">开始日期 *</label>
                  <input
                    type="date"
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-gray-700 mb-1">结束日期 *</label>
                  <input
                    type="date"
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handlePreview}
                  disabled={previewLoading}
                  className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {previewLoading ? '计算中...' : '预览'}
                </button>
              </div>

              {previewData && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-blue-50 border border-blue-200 rounded p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">出库金额合计</div>
                      <div className="text-xl font-semibold text-blue-600">¥ {previewData.outboundAmount.toFixed(2)}</div>
                    </div>
                    <div className="bg-orange-50 border border-orange-200 rounded p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">退货金额合计</div>
                      <div className="text-xl font-semibold text-orange-500">-¥ {previewData.returnAmount.toFixed(2)}</div>
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">应收总额</div>
                      <div className="text-xl font-semibold text-green-600">¥ {previewData.totalAmount.toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded">
                    <div className="flex border-b border-gray-200">
                      <button
                        onClick={() => setPreviewTab('outbound')}
                        className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                          previewTab === 'outbound'
                            ? 'border-blue-500 text-blue-600 font-medium'
                            : 'border-transparent text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        出库单列表 ({previewData.outboundList.length})
                      </button>
                      <button
                        onClick={() => setPreviewTab('return')}
                        className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                          previewTab === 'return'
                            ? 'border-blue-500 text-blue-600 font-medium'
                            : 'border-transparent text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        退货单列表 ({previewData.returnList.length})
                      </button>
                    </div>
                    <div className="max-h-[280px] overflow-auto">
                      {previewTab === 'outbound' ? (
                        previewData.outboundList.length === 0 ? (
                          <div className="py-10 text-center text-gray-400 text-sm">暂无出库单</div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr className="text-gray-600">
                                <th className="px-3 py-2 text-left font-medium">出库单号</th>
                                <th className="px-3 py-2 text-left font-medium">出库日期</th>
                                <th className="px-3 py-2 text-right font-medium">金额</th>
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.outboundList.map((it) => (
                                <tr key={it.id} className="border-t border-gray-100">
                                  <td className="px-3 py-2">{it.outboundNo}</td>
                                  <td className="px-3 py-2">{formatDate(it.outboundDate)}</td>
                                  <td className="px-3 py-2 text-right">¥{it.totalAmount.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      ) : previewData.returnList.length === 0 ? (
                        <div className="py-10 text-center text-gray-400 text-sm">暂无退货单</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr className="text-gray-600">
                              <th className="px-3 py-2 text-left font-medium">退货单号</th>
                              <th className="px-3 py-2 text-left font-medium">退货日期</th>
                              <th className="px-3 py-2 text-right font-medium">金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.returnList.map((it) => (
                              <tr key={it.id} className="border-t border-gray-100">
                                <td className="px-3 py-2">{it.returnNo}</td>
                                <td className="px-3 py-2">{formatDate(it.returnDate)}</td>
                                <td className="px-3 py-2 text-right">¥{it.totalAmount.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting || !previewData}
                className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '确认中...' : '确认对账'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesReconciliationPage;
