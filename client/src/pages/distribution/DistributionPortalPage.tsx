import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';

interface PortalSummary {
  purchaseOrderCount: number;
  purchaseOrderAmount: number;
  purchaseReturnCount: number;
  purchaseReturnAmount: number;
}

interface BoundPartner {
  id: string;
  name: string;
  code: string | null;
  level: number | null;
  treePath: string | null;
  role: string;
}

const DistributionPortalPage: React.FC = () => {
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [partners, setPartners] = useState<BoundPartner[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [sRes, pRes] = await Promise.all([
          axiosForBackend.get('/api/distribution/portal/summary'),
          axiosForBackend.get('/api/distribution/portal/my-partners'),
        ]);
        setSummary(sRes.data as PortalSummary);
        setPartners((pRes.data as BoundPartner[]) || []);
      } catch (error) {
        logger.error('加载分销门户概览失败', error);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const fmt = (n: number) => `¥${Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const cards = [
    { label: '我的采购单数', value: String(summary?.purchaseOrderCount ?? 0), tone: 'text-primary' },
    { label: '我的采购单金额', value: fmt(summary?.purchaseOrderAmount ?? 0), tone: 'text-primary' },
    { label: '我的采购退货单数', value: String(summary?.purchaseReturnCount ?? 0), tone: 'text-orange-500' },
    { label: '我的采购退货单金额', value: fmt(summary?.purchaseReturnAmount ?? 0), tone: 'text-orange-500' },
  ];

  return (
    <div className="p-5 space-y-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">分销门户 · 概览</h1>
        {loading && !summary ? (
          <div className="py-10 text-center text-gray-400">加载中...</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {cards.map((c) => (
              <div key={c.label} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="text-sm text-gray-500 mb-2">{c.label}</div>
                <div className={`text-2xl font-semibold ${c.tone}`}>{c.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5">
        <h2 className="text-lg font-medium text-gray-800 mb-3">我绑定的分销节点</h2>
        <TableContainer>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                <th className="px-4 py-3 text-left">节点名称</th>
                <th className="px-4 py-3 text-left">编码</th>
                <th className="px-4 py-3 text-left">层级</th>
                <th className="px-4 py-3 text-left">角色</th>
              </tr>
            </thead>
            <tbody>
              {partners.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">暂无绑定节点（联系管理员分配）</td></tr>
              ) : (
                partners.map((p) => (
                  <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{p.name}</td>
                    <td className="px-4 py-3 text-gray-500">{p.code ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500">L{p.level ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{p.role ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableContainer>
      </div>
    </div>
  );
};

export default DistributionPortalPage;
