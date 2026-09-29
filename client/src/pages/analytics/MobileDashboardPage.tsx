import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { analyticsApi } from '@client/src/api/analytics';
import type { MobileDashboard, PendingApproval } from '@shared/api.interface';

const DOC_LABEL: Record<string, string> = {
  sales_order: '销售订单',
  purchase_order: '采购订单',
  sales_outbound: '销售出库',
  purchase_inbound: '采购入库',
};

const MobileDashboardPage: React.FC = () => {
  const [data, setData] = useState<MobileDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setData(await analyticsApi.mobileDashboard());
    } catch {
      toast('加载失败');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const approve = async (item: PendingApproval) => {
    try {
      const r = await analyticsApi.approve(item.docType, item.docId);
      if (r.updated) {
        toast.success('已审批');
        load();
      } else {
        toast('该单据已不是待审状态');
      }
    } catch {
      toast('审批失败');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">加载中...</div>;
  }

  return (
    <div className="max-w-md mx-auto bg-gray-100 min-h-screen p-3 space-y-3">
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl p-4">
        <div className="text-sm opacity-80">今日经营概览</div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div>
            <div className="text-2xl font-bold">¥{(data?.stats.todaySales ?? 0).toFixed(0)}</div>
            <div className="text-xs opacity-80">销售额</div>
          </div>
          <div>
            <div className="text-2xl font-bold">¥{(data?.stats.todayRetail ?? 0).toFixed(0)}</div>
            <div className="text-xs opacity-80">零售额</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{data?.stats.todayOutboundCount ?? 0}</div>
            <div className="text-xs opacity-80">出库单量</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{data?.stats.pendingDocCount ?? 0}</div>
            <div className="text-xs opacity-80">待审单据</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4">
        <div className="text-sm font-medium text-gray-800 mb-2">待我审批</div>
        {!data || data.pendingApprovals.length === 0 ? (
          <div className="text-xs text-gray-400 py-3 text-center">暂无待审单据</div>
        ) : (
          data.pendingApprovals.map((a) => (
            <div key={`${a.docType}-${a.docId}`} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div>
                <div className="text-sm text-gray-700">{DOC_LABEL[a.docType] || a.docType} · {a.docNo}</div>
                <div className="text-xs text-gray-400">{a.date || ''}</div>
              </div>
              <button
                onClick={() => approve(a)}
                className="px-3 py-1 bg-blue-500 text-white rounded text-xs"
              >
                审批
              </button>
            </div>
          ))
        )}
      </div>

      <div className="bg-white rounded-xl p-4">
        <div className="text-sm font-medium text-gray-800 mb-2">畅销款 TOP5</div>
        {data?.topStyles.map((s, i) => (
          <div key={s.styleNo} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-gray-700">{i + 1}. {s.styleNo}</span>
            <span className="text-xs text-gray-500">销量 {s.quantity}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-4">
        <div className="text-sm font-medium text-gray-800 mb-2">库存预警</div>
        {!data || data.warnings.length === 0 ? (
          <div className="text-xs text-gray-400 py-3 text-center">库存健康</div>
        ) : (
          data.warnings.map((w, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-gray-700">{w.styleNo}/{w.color}/{w.size}</span>
              <span className="text-red-500">现 {w.quantity} ＜ 下限 {w.safetyMin}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MobileDashboardPage;
