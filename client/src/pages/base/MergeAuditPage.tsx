import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { baseApi } from '@client/src/api';
import type { MergeLog } from '@client/src/api';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';
import { useAuth } from '@client/src/contexts/AuthContext';

type EntityFilter = 'all' | 'style' | 'customer';
type StatusFilter = 'all' | 'active' | 'reversed';

/** 按批次(runId)聚合的展示结构 */
interface MergeRunGroup {
  runId: string;
  entityType: MergeLog['entityType'];
  survivorId: string;
  survivorName: string | null;
  reason: string | null;
  operator: string | null;
  createdAt: string;
  reversed: boolean;
  items: MergeLog[];
}

const ENTITY_LABEL: Record<MergeLog['entityType'], string> = {
  style: '款号',
  customer: '客户',
};

const MergeAuditPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canMerge = hasPermission('md:merge');

  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MergeLog[]>([]);
  const [reversingRun, setReversingRun] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!canMerge) return;
    setLoading(true);
    try {
      const types: MergeLog['entityType'][] =
        entityFilter === 'all' ? ['style', 'customer'] : [entityFilter];
      const reversedOpt = statusFilter === 'all' ? undefined : statusFilter === 'reversed';
      const results = await Promise.all(
        types.map((t) => baseApi.masterDataMerge.mergeLogs(t, { reversed: reversedOpt, limit: 500 })),
      );
      setRows(results.flat());
    } catch (e) {
      toast(errMsg(e, '加载合并审计日志失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter, statusFilter, canMerge]);

  const groups = useMemo<MergeRunGroup[]>(() => {
    const map = new Map<string, MergeRunGroup>();
    for (const r of rows) {
      let g = map.get(r.runId);
      if (!g) {
        g = {
          runId: r.runId,
          entityType: r.entityType,
          survivorId: r.survivorId,
          survivorName: r.survivorName,
          reason: r.reason,
          operator: r.operator,
          createdAt: r.createdAt,
          reversed: !!r.reversedAt,
          items: [],
        };
        map.set(r.runId, g);
      }
      g.items.push(r);
    }
    return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [rows]);

  const handleReverse = async (g: MergeRunGroup) => {
    const ok = await showConfirm({
      title: '确认整批回滚该次合并？',
      message: `批次号 ${g.runId}（实体：${ENTITY_LABEL[g.entityType]}）。回滚将解除被合并方的「已合并」标记，被合并方恢复为独立主数据；其关联业务保持归属当前保留方，不回指历史归属。该操作不可双计。`,
      confirmText: '确认回滚',
      cancelText: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    setReversingRun(g.runId);
    try {
      const res = await baseApi.masterDataMerge.reverse(g.entityType, g.runId);
      toast.success(`已回滚 ${res.reversed} 条合并记录（批次 ${g.runId}）`);
      await fetchLogs();
    } catch (e) {
      toast(errMsg(e, '回滚失败'));
    } finally {
      setReversingRun(null);
    }
  };

  if (!canMerge) {
    return (
      <div className="p-10 text-center text-gray-400">
        无权限访问（需要 <code>md:merge</code> 权限）
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xl font-semibold">合并审计</h2>
        <span className="text-xs text-gray-400">
          主数据合并（款号/客户）的审计与回滚 · 被合并方仅打标、绝不删除
        </span>
      </div>

      <div className="flex items-center gap-3 mb-4 mt-3">
        <select
          className="border rounded px-2 py-1.5 text-sm"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value as EntityFilter)}
        >
          <option value="all">全部实体</option>
          <option value="style">款号</option>
          <option value="customer">客户</option>
        </select>
        <select
          className="border rounded px-2 py-1.5 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">全部状态</option>
          <option value="active">有效</option>
          <option value="reversed">已回滚</option>
        </select>
        <button
          className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50"
          onClick={fetchLogs}
          disabled={loading}
        >
          {loading ? '加载中...' : '刷新'}
        </button>
        <span className="text-xs text-gray-400">共 {groups.length} 个合并批次</span>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">加载中...</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-8 text-gray-400">暂无合并记录</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.runId} className="border rounded overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50 border-b text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
                  <span>
                    保留方：
                    <span className="font-medium text-gray-800">
                      {g.survivorName || g.survivorId}
                    </span>
                  </span>
                  <span>实体：{ENTITY_LABEL[g.entityType]}</span>
                  <span>合并数：{g.items.length}</span>
                  <span>
                    状态：
                    {g.reversed ? (
                      <span className="text-gray-400">已回滚</span>
                    ) : (
                      <span className="text-green-600">有效</span>
                    )}
                  </span>
                  <span>原因：{g.reason || '-'}</span>
                  <span>操作人：{g.operator || '-'}</span>
                  <span>时间：{g.createdAt ? g.createdAt.replace('T', ' ').slice(0, 19) : '-'}</span>
                  <span className="text-gray-400">批次 {g.runId}</span>
                </div>
                <button
                  className="border border-red-300 text-red-600 rounded px-3 py-1 text-sm hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={g.reversed || reversingRun === g.runId}
                  onClick={() => handleReverse(g)}
                >
                  {g.reversed ? '已回滚' : reversingRun === g.runId ? '回滚中...' : '整批回滚'}
                </button>
              </div>
              <TableContainer>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-white text-gray-500">
                      <th className="text-left px-4 py-2 border-b border-gray-100">被合并方编码</th>
                      <th className="text-left px-4 py-2 border-b border-gray-100">被合并方名称</th>
                      <th className="text-left px-4 py-2 border-b border-gray-100 w-24">日志ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it) => (
                      <tr key={it.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2">{it.mergedCode ?? '-'}</td>
                        <td className="px-4 py-2">{it.mergedName ?? '-'}</td>
                        <td className="px-4 py-2 text-gray-400 font-mono text-xs">{it.id.slice(0, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableContainer>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 text-xs text-gray-400">
        提示：合并操作不会删除被合并方，仅打标并改指其关联业务到保留方。如需撤销，可在此按批次整批回滚。
        也可从 <Link to="/base/customer" className="text-primary hover:underline">客户管理</Link> 完成合并后回到本页处理。
      </div>
    </div>
  );
};

export default MergeAuditPage;
