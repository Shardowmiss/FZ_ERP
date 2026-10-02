import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { memberApi } from '@client/src/api/member';
import type { MemberMergeLog } from '@client/src/api/member';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';
import { useAuth } from '@client/src/contexts/AuthContext';

type StatusFilter = 'all' | 'active' | 'reversed';

/** 按批次(runId)聚合的展示结构 */
interface MergeRunGroup {
  runId: string;
  survivorId: string;
  reason: string | null;
  operator: string | null;
  createdAt: string;
  reversed: boolean;
  items: MemberMergeLog[];
}

/** 分 → 元（保留两位） */
const toYuan = (cents: string | number): string => (Number(cents) / 100).toFixed(2);
const fmtInt = (n: string | number): string => Number(n).toLocaleString('zh-CN');

const MemberMergeAuditPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canMerge = hasPermission('member:merge');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<MemberMergeLog[]>([]);
  const [reversingRun, setReversingRun] = useState<string | null>(null);

  const fetchLogs = async () => {
    if (!canMerge) return;
    setLoading(true);
    try {
      const revOpt = statusFilter === 'all' ? undefined : statusFilter === 'reversed';
      const data = await memberApi.mergeLogs(revOpt);
      setRows(data);
    } catch (e) {
      toast(errMsg(e, '加载会员合并审计日志失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, canMerge]);

  const groups = useMemo<MergeRunGroup[]>(() => {
    const map = new Map<string, MergeRunGroup>();
    for (const r of rows) {
      let g = map.get(r.runId);
      if (!g) {
        g = {
          runId: r.runId,
          survivorId: r.survivorId,
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
      title: '确认整批回滚该次会员合并？',
      message: `批次号 ${g.runId}（保留方 ${g.survivorId.slice(0, 8)}）。回滚将解除被合并会员的「已合并」标记并还原其积分/储值/消费额/订单数，保留方按精确增量反向扣减（资金无双计、无级联清空）。其历史业务流水仍作为保留方账本一部分保留。`,
      confirmText: '确认回滚',
      cancelText: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    setReversingRun(g.runId);
    try {
      // run_id 以 merge_ 前缀，控制器按整批回滚处理
      const res = await memberApi.reverseMerge(g.runId);
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
        无权限访问（需要 <code>member:merge</code> 权限）
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-xl font-semibold">会员合并审计</h2>
        <span className="text-xs text-gray-400">
          会员合并的审计与回滚 · 被合并会员仅打标、绝不删除 · 资金安全无双计
        </span>
      </div>

      <div className="flex items-center gap-3 mb-4 mt-3">
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
        <div className="text-center py-8 text-gray-400">暂无会员合并记录</div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const totalPoints = g.items.reduce((s, it) => s + Number(it.movedPoints), 0);
            const totalStoredValue = g.items.reduce((s, it) => s + Number(it.movedStoredValue), 0);
            const totalSpent = g.items.reduce((s, it) => s + Number(it.movedTotalSpent), 0);
            const totalOrders = g.items.reduce((s, it) => s + Number(it.movedOrderCount), 0);
            return (
              <div key={g.runId} className="border rounded overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-gray-50 border-b text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
                    <span>
                      保留方：
                      <span className="font-medium text-gray-800 font-mono">
                        {g.survivorId.slice(0, 8)}
                      </span>
                    </span>
                    <span>合并数：{g.items.length}</span>
                    <span>
                      转移积分：<span className="text-gray-800 font-medium">{fmtInt(totalPoints)}</span>
                    </span>
                    <span>
                      转移储值：<span className="text-gray-800 font-medium">¥{toYuan(totalStoredValue)}</span>
                    </span>
                    <span>
                      转移消费额：<span className="text-gray-800 font-medium">¥{toYuan(totalSpent)}</span>
                    </span>
                    <span>转移订单数：{fmtInt(totalOrders)}</span>
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
                        <th className="text-left px-4 py-2 border-b border-gray-100">被合并方会员号</th>
                        <th className="text-left px-4 py-2 border-b border-gray-100">被合并方名称</th>
                        <th className="text-right px-4 py-2 border-b border-gray-100 w-24">转移积分</th>
                        <th className="text-right px-4 py-2 border-b border-gray-100 w-28">转移储值(元)</th>
                        <th className="text-right px-4 py-2 border-b border-gray-100 w-28">转移消费额(元)</th>
                        <th className="text-right px-4 py-2 border-b border-gray-100 w-20">订单数</th>
                        <th className="text-left px-4 py-2 border-b border-gray-100 w-24">日志ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((it) => (
                        <tr key={it.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2">{it.mergedMemberNo ?? '-'}</td>
                          <td className="px-4 py-2">{it.mergedName ?? '-'}</td>
                          <td className="px-4 py-2 text-right">{fmtInt(it.movedPoints)}</td>
                          <td className="px-4 py-2 text-right">¥{toYuan(it.movedStoredValue)}</td>
                          <td className="px-4 py-2 text-right">¥{toYuan(it.movedTotalSpent)}</td>
                          <td className="px-4 py-2 text-right">{fmtInt(it.movedOrderCount)}</td>
                          <td className="px-4 py-2 text-gray-400 font-mono text-xs">{it.id.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableContainer>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 text-xs text-gray-400">
        提示：会员合并不会删除被合并方，仅打标并改指其关联业务与资金到保留方。如需撤销，可在此按批次整批回滚。
        也可从 <Link to="/member" className="text-primary hover:underline">会员运营</Link> 完成合并后回到本页处理。
      </div>
    </div>
  );
};

export default MemberMergeAuditPage;
