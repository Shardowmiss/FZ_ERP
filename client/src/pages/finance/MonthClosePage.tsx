import React, { useState, useEffect } from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { financeApi } from '@client/src/api/finance';
import { errMsg } from '@/utils/errMsg';
import type {
  MonthCloseRecord,
  MonthCloseDetailResponse,
  MonthCloseDetail,
} from '@shared/api.interface';

const MonthClosePage: React.FC = () => {
  const [list, setList] = useState<MonthCloseRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [showDetail, setShowDetail] = useState(false);
  const [detailData, setDetailData] = useState<MonthCloseDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<MonthCloseRecord | null>(null);

  const [confirmType, setConfirmType] = useState<'close' | 'reopen' | null>(null);
  const [confirmRecord, setConfirmRecord] = useState<MonthCloseRecord | null>(null);
  const [reopenRemark, setReopenRemark] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadList = async () => {
    setLoading(true);
    try {
      const data = await financeApi.monthClose.list();
      setList(data || []);
    } catch (error) {
      logger.error('加载月结列表失败', error);
      toast(errMsg(error, '加载失败'));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadList();
  }, []);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return dateStr.replace('T', ' ').substring(0, 16);
  };

  const formatAmount = (val: number) => {
    return `¥${val.toFixed(2)}`;
  };

  const formatQty = (val: number) => {
    return val.toFixed(3);
  };

  const handleClose = (record: MonthCloseRecord) => {
    setConfirmType('close');
    setConfirmRecord(record);
  };

  const handleReopen = (record: MonthCloseRecord) => {
    setConfirmType('reopen');
    setConfirmRecord(record);
    setReopenRemark('操作人反月结');
  };

  const handleViewDetail = async (record: MonthCloseRecord) => {
    setCurrentRecord(record);
    setDetailLoading(true);
    try {
      const data = await financeApi.monthClose.getDetail(record.id);
      setDetailData(data);
      setShowDetail(true);
    } catch (error) {
      logger.error('加载月结详情失败', error);
      toast(errMsg(error, '加载详情失败'));
    }
    setDetailLoading(false);
  };

  const handleConfirm = async () => {
    if (!confirmRecord || !confirmType) return;
    setActionLoading(true);
    try {
      if (confirmType === 'close') {
        await financeApi.monthClose.close(confirmRecord.id);
        toast('月结成功');
      } else {
        await financeApi.monthClose.reopen(confirmRecord.id, {
          remark: reopenRemark || undefined,
        });
        toast('反月结成功');
      }
      setConfirmType(null);
      setConfirmRecord(null);
      loadList();
    } catch (error) {
      logger.error(`${confirmType === 'close' ? '月结' : '反月结'}失败`, error);
      toast(errMsg(error, '操作失败'));
    }
    setActionLoading(false);
  };

  const handleCancelConfirm = () => {
    setConfirmType(null);
    setConfirmRecord(null);
    setReopenRemark('');
  };

  const getStatusLabel = (status: string) => {
    if (status === 'closed') {
      return { label: '已月结', className: 'bg-green-100 text-green-700' };
    }
    return { label: '未月结', className: 'bg-gray-100 text-gray-600' };
  };

  const renderDetailTable = (
    title: string,
    data: MonthCloseDetail[],
    columns: { key: string; label: string; align?: string }[]
  ) => (
    <div>
      <h4 className="text-sm font-medium text-gray-700 mb-2">{title}</h4>
      <table className="w-full text-sm border border-gray-200">
        <thead>
          <tr className="bg-gray-50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'} text-gray-600 font-medium border-b border-gray-200`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="py-4 text-center text-gray-400"
              >
                暂无数据
              </td>
            </tr>
          ) : (
            data.map((item, index) => (
              <tr
                key={item.id || index}
                className="border-b border-gray-200 last:border-b-0 odd:bg-white even:bg-gray-50"
              >
                {columns.map((col) => {
                  let val: string | number = '-';
                  if (col.key === 'brand') val = item.brand || '-';
                  else if (col.key === 'warehouseName') val = item.warehouseName || '-';
                  else if (col.key === 'flowType') val = item.flowType || '-';
                  else if (col.key === 'qty') val = formatQty(item.qty);
                  else if (col.key === 'amount') val = formatAmount(item.amount);
                  return (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${col.align === 'right' ? 'text-right' : 'text-left'} text-gray-700`}
                    >
                      {val}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">月结管理</h1>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
              <th className="px-4 py-3 text-left">月份</th>
              <th className="px-4 py-3 text-center">状态</th>
              <th className="px-4 py-3 text-left">月结人</th>
              <th className="px-4 py-3 text-left">月结时间</th>
              <th className="px-4 py-3 text-left">备注</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item) => {
                const s = getStatusLabel(item.status);
                return (
                  <tr
                    key={item.id}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 text-gray-700 font-medium">
                      {item.month}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${s.className}`}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {item.closedByName || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(item.closedAt)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {item.remark || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.status === 'open' ? (
                        <button
                          onClick={() => handleClose(item)}
                          className="px-3 py-1 bg-primary text-white rounded text-xs hover:bg-blue-600"
                        >
                          月结
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleViewDetail(item)}
                            className="text-primary hover:text-blue-600 text-xs"
                          >
                            查看详情
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => handleReopen(item)}
                            className="text-red-500 hover:text-red-600 text-xs"
                          >
                            反月结
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {showDetail && detailData && currentRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[900px] max-w-[95vw] max-h-[85vh] overflow-auto">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white">
              <h3 className="text-lg font-medium">
                月结明细 - {currentRecord.month}
              </h3>
              <button
                onClick={() => setShowDetail(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-5">
              {detailLoading ? (
                <div className="py-8 text-center text-gray-400">加载中...</div>
              ) : (
                <>
                  {renderDetailTable('期初库存汇总', detailData.opening, [
                    { key: 'brand', label: '品牌' },
                    { key: 'warehouseName', label: '仓库' },
                    { key: 'qty', label: '数量', align: 'right' },
                    { key: 'amount', label: '金额', align: 'right' },
                  ])}

                  {renderDetailTable('本期入库明细', detailData.inboundByType, [
                    { key: 'flowType', label: '入库类型' },
                    { key: 'qty', label: '数量', align: 'right' },
                    { key: 'amount', label: '金额', align: 'right' },
                  ])}

                  {renderDetailTable('本期出库明细', detailData.outboundByType, [
                    { key: 'flowType', label: '出库类型' },
                    { key: 'qty', label: '数量', align: 'right' },
                    { key: 'amount', label: '金额', align: 'right' },
                  ])}

                  {renderDetailTable('期末库存汇总', detailData.closing, [
                    { key: 'brand', label: '品牌' },
                    { key: 'warehouseName', label: '仓库' },
                    { key: 'qty', label: '数量', align: 'right' },
                    { key: 'amount', label: '金额', align: 'right' },
                  ])}

                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      应收应付
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-50 rounded border border-blue-100">
                        <div className="text-xs text-gray-500 mb-1">
                          本月应收发生额
                        </div>
                        <div className="text-xl font-semibold text-blue-600">
                          {formatAmount(detailData.receivableAmount)}
                        </div>
                      </div>
                      <div className="p-4 bg-orange-50 rounded border border-orange-100">
                        <div className="text-xs text-gray-500 mb-1">
                          本月应付发生额
                        </div>
                        <div className="text-xl font-semibold text-orange-600">
                          {formatAmount(detailData.payableAmount)}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmType && confirmRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-[480px] max-w-[95vw]">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-medium">
                {confirmType === 'close' ? '确认月结' : '确认反月结'}
              </h3>
              <button
                onClick={handleCancelConfirm}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                &times;
              </button>
            </div>
            <div className="p-5">
              {confirmType === 'close' ? (
                <p className="text-sm text-gray-700">
                  月结后该月所有出入库、零售、收付款单据将被冻结，不能再新增或修改。
                  <br />
                  确认对 <span className="font-medium">{confirmRecord.month}</span> 执行月结吗？
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-700">
                    确认反月结吗？反月结后该月单据将可修改。
                    <br />
                    当前月份：
                    <span className="font-medium">{confirmRecord.month}</span>
                  </p>
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">
                      备注
                    </label>
                    <textarea
                      value={reopenRemark}
                      onChange={(e) => setReopenRemark(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary resize-none"
                      placeholder="请输入反月结原因"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-gray-200 flex justify-end gap-2">
              <button
                onClick={handleCancelConfirm}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={actionLoading}
                className={`px-4 py-2 text-white rounded text-sm disabled:opacity-50 ${
                  confirmType === 'close'
                    ? 'bg-primary hover:bg-blue-600'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                {actionLoading
                  ? '处理中...'
                  : confirmType === 'close'
                  ? '确认月结'
                  : '确认反月结'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthClosePage;
