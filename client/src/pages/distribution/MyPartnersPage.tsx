import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';

interface BoundPartner {
  id: string;
  name: string;
  code: string | null;
  level: number | null;
  treePath: string | null;
  role: string;
}

const MyPartnersPage: React.FC = () => {
  const [list, setList] = useState<BoundPartner[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res: any = await axiosForBackend.get('/api/distribution/portal/my-partners');
        setList(res.data as BoundPartner[]);
      } catch (error) {
        logger.error('加载绑定节点失败', error);
        toast('加载失败');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const pathDepth = (p: string | null) => (p ? p.split('/').filter(Boolean).length : 0);

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">我的分销节点</h1>
        <p className="text-xs text-gray-400 mb-4">绑定的分销节点及其下级子树的采购单 / 退货单，均可在分销门户查看。</p>
        <TableContainer>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                <th className="px-4 py-3 text-left">节点名称</th>
                <th className="px-4 py-3 text-left">编码</th>
                <th className="px-4 py-3 text-left">层级</th>
                <th className="px-4 py-3 text-left">子树深度</th>
                <th className="px-4 py-3 text-left">角色</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">暂无绑定节点（联系管理员分配）</td></tr>
              ) : (
                list.map((p) => (
                  <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{p.name}</td>
                    <td className="px-4 py-3 text-gray-500">{p.code ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500">L{p.level ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{pathDepth(p.treePath)} 层</td>
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

export default MyPartnersPage;
