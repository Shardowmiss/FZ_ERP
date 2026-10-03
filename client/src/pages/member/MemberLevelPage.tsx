import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { memberLevelApi } from '@client/src/api/member-level';
import type { MemberLevel } from '@shared/api.interface';
import { useAuth } from '@client/src/contexts/AuthContext';
import { errMsg } from '@/utils/errMsg';

const STATUS_LABEL: Record<string, string> = { active: '启用', inactive: '停用' };
const CONDITION_LABEL: Record<string, string> = {
  cumulative: '累计消费',
  monthly: '月度消费',
  quarterly: '季度消费',
};

const MemberLevelPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('member:level');

  const [list, setList] = useState<MemberLevel[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<MemberLevel>>({
    code: '',
    name: '',
    conditionType: 'cumulative',
    thresholdAmount: 0,
    discount: 1,
    discountOnPromo: false,
    sortOrder: 0,
    status: 'active',
  });

  const load = useCallback(async () => {
    try {
      const res = await memberLevelApi.list(page, 20, keyword || undefined);
      setList(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [page, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      code: '',
      name: '',
      conditionType: 'cumulative',
      thresholdAmount: 0,
      discount: 1,
      discountOnPromo: false,
      sortOrder: 0,
      status: 'active',
    });
    setShowForm(true);
  };

  const openEdit = (row: MemberLevel) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      conditionType: row.conditionType,
      thresholdAmount: row.thresholdAmount,
      discount: row.discount,
      discountOnPromo: row.discountOnPromo,
      sortOrder: row.sortOrder,
      status: row.status,
      remark: row.remark,
    });
    setShowForm(true);
  };

  const submit = async () => {
    try {
      if (!form.code || !form.name) {
        toast.error('等级编码与名称必填');
        return;
      }
      if (editingId) {
        await memberLevelApi.update(editingId, form);
        toast.success('更新成功');
      } else {
        await memberLevelApi.create(form);
        toast.success('创建成功');
      }
      setShowForm(false);
      setPage(1);
      void load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm('确定删除该会员等级？')) return;
    try {
      await memberLevelApi.remove(id);
      toast.success('删除成功');
      void load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">会员等级</h2>
        {canEdit && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
          >
            新增等级
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索等级名称"
          className="px-3 py-2 border border-gray-300 rounded text-sm"
        />
        <button
          onClick={() => { setPage(1); void load(); }}
          className="px-4 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200"
        >
          查询
        </button>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-3 py-2">编码</th>
            <th className="px-3 py-2">等级名称</th>
            <th className="px-3 py-2">达成条件</th>
            <th className="px-3 py-2">门槛(元)</th>
            <th className="px-3 py-2">正常折扣</th>
            <th className="px-3 py-2">折上折</th>
            <th className="px-3 py-2">排序</th>
            <th className="px-3 py-2">状态</th>
            <th className="px-3 py-2">备注</th>
            {canEdit && <th className="px-3 py-2">操作</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2">{CONDITION_LABEL[r.conditionType] ?? r.conditionType}</td>
              <td className="px-3 py-2">{r.thresholdAmount}</td>
              <td className="px-3 py-2">{(Number(r.discount) * 10).toFixed(1)} 折</td>
              <td className="px-3 py-2">
                {r.discountOnPromo ? (
                  <span className="text-green-600">支持</span>
                ) : (
                  <span className="text-gray-400">不支持</span>
                )}
              </td>
              <td className="px-3 py-2">{r.sortOrder}</td>
              <td className="px-3 py-2">
                <span className={r.status === 'active' ? 'text-green-600' : 'text-gray-400'}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{r.remark ?? '-'}</td>
              {canEdit && (
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => openEdit(r)} className="text-blue-600 hover:underline mr-3">编辑</button>
                  <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">删除</button>
                </td>
              )}
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 10 : 9} className="px-3 py-6 text-center text-gray-400">
                暂无等级数据
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="flex items-center justify-end gap-2 mt-4 text-sm text-gray-500">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 border rounded disabled:opacity-40"
        >
          上一页
        </button>
        <span>{page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="px-3 py-1 border rounded disabled:opacity-40"
        >
          下一页
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[480px] max-h-[90vh] overflow-auto">
            <h3 className="text-base font-semibold mb-4">
              {editingId ? '编辑等级' : '新增等级'}
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">等级编码 *</label>
                  <input
                    disabled={!!editingId}
                    value={form.code ?? ''}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded disabled:bg-gray-100"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">等级名称 *</label>
                  <input
                    value={form.name ?? ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">达成条件</label>
                  <select
                    value={form.conditionType ?? 'cumulative'}
                    onChange={(e) => setForm({ ...form, conditionType: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    <option value="cumulative">累计消费</option>
                    <option value="monthly">月度消费</option>
                    <option value="quarterly">季度消费</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">门槛金额(元)</label>
                  <input
                    type="number"
                    value={form.thresholdAmount ?? 0}
                    onChange={(e) => setForm({ ...form, thresholdAmount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">正常折扣(如 0.85=8.5折)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.discount ?? 1}
                    onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">排序</label>
                  <input
                    type="number"
                    value={form.sortOrder ?? 0}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form.discountOnPromo}
                  onChange={(e) => setForm({ ...form, discountOnPromo: e.target.checked })}
                />
                <label className="text-gray-600">支持折上折</label>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">状态</label>
                  <select
                    value={form.status ?? 'active'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    <option value="active">启用</option>
                    <option value="inactive">停用</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-gray-500 mb-1">备注</label>
                <textarea
                  value={form.remark ?? ''}
                  onChange={(e) => setForm({ ...form, remark: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                  rows={2}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={submit}
                className="px-4 py-2 bg-primary text-white rounded hover:bg-blue-600"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MemberLevelPage;
