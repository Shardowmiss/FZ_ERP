import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';

interface ReconNode {
  dealerId: string;
  dealerName: string | null;
  dealerCode: string | null;
  level: number | null;
  treePath: string | null;
  asBuyerReceivable: number;
  asSellerPayable: number;
  netPosition: number;
}

interface ReconResult {
  nodes: ReconNode[];
  summary: {
    nodeCount: number;
    totalAsBuyerReceivable: number;
    totalAsSellerPayable: number;
    totalNetPosition: number;
  };
}

const PortalReconciliationPage: React.FC = () => {
  const [data, setData] = useState<ReconResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res: any = await axiosForBackend.get('/api/distribution/portal/reconciliation');
        setData(res.data as ReconResult);
      } catch (error) {
        logger.error('加载对账失败', error);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const fmt = (n: number) => `¥${Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const netTone = (n: number) => (n > 0 ? 'text-green-600' : n < 0 ? 'text-red-500' : 'text-gray-700');

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">应收应付对账</h1>

        {loading && !data ? (
          <div className="py-10 text-center text-gray-400">加载中...</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="bg-blue-50 border border-blue-200 rounded p-4 text-center">
                <div className="text-sm text-gray-600 mb-1">作为买方欠上游（应收）</div>
                <div className="text-xl font-semibold text-primary">{fmt(data?.summary.totalAsBuyerReceivable ?? 0)}</div>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded p-4 text-center">
                <div className="text-sm text-gray-600 mb-1">作为卖方被下级欠（应付）</div>
                <div className="text-xl font-semibold text-orange-500">{fmt(data?.summary.totalAsSellerPayable ?? 0)}</div>
              </div>
              <div className="bg-green-50 border border-green-200 rounded p-4 text-center">
                <div className="text-sm text-gray-600 mb-1">净头寸</div>
                <div className={`text-xl font-semibold ${netTone(data?.summary.totalNetPosition ?? 0)}`}>{fmt(data?.summary.totalNetPosition ?? 0)}</div>
              </div>
            </div>

            <TableContainer>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                    <th className="px-4 py-3 text-left">分销节点</th>
                    <th className="px-4 py-3 text-left">编码</th>
                    <th className="px-4 py-3 text-left">层级</th>
                    <th className="px-4 py-3 text-right">作为买方应收</th>
                    <th className="px-4 py-3 text-right">作为卖方应付</th>
                    <th className="px-4 py-3 text-right">净头寸</th>
                  </tr>
                </thead>
                <tbody>
                  {data && data.nodes.length === 0 ? (
                    <tr><td colSpan={6} className="py-8 text-center text-gray-400">暂无数据</td></tr>
                  ) : (
                    data?.nodes.map((n) => (
                      <tr key={n.dealerId} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-700">{n.dealerName ?? '-'}</td>
                        <td className="px-4 py-3 text-gray-500">{n.dealerCode ?? '-'}</td>
                        <td className="px-4 py-3 text-gray-500">L{n.level ?? '-'}</td>
                        <td className="px-4 py-3 text-right text-primary">{fmt(n.asBuyerReceivable)}</td>
                        <td className="px-4 py-3 text-right text-orange-500">{fmt(n.asSellerPayable)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${netTone(n.netPosition)}`}>{fmt(n.netPosition)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </TableContainer>
          </>
        )}
      </div>
    </div>
  );
};

export default PortalReconciliationPage;
