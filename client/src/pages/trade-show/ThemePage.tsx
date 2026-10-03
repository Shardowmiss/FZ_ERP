import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { tradeShowApi } from '@client/src/api/trade-show';
import type { TradeShowTheme } from '@shared/api.interface';
import { useAuth } from '@client/src/contexts/AuthContext';
import { errMsg } from '@/utils/errMsg';

const STATUS_LABEL: Record<string, string> = { active: '启用', inactive: '停用' };
const SEASONS = ['春季', '夏季', '秋季', '冬季', '春夏', '秋冬'];

const ThemePage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('tradeshow:theme');

  const [list, setList] = useState<TradeShowTheme[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<TradeShowTheme>>({
    themeName: '',
    year: String(new Date().getFullYear()),
    season: '',
    sortOrder: 0,
    status: 'active',
  });

  const load = useCallback(async () => {
    try {
      const res = await tradeShowApi.theme.list({ page, pageSize: 20, keyword });
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
      themeName: '',
      year: String(new Date().getFullYear()),
      season: '',
      sortOrder: 0,
      status: 'active',
    });
    setShowForm(true);
  };

  const openEdit = (row: TradeShowTheme) => {
    setEditingId(row.id);
    setForm({
      themeCode: row.themeCode,
      themeName: row.themeName,
      year: row.year,
      season: row.season,
      sortOrder: row.sortOrder,
      status: row.status,
      remark: row.remark,
    });
    setShowForm(true);
  };

  const submit = async () => {
    try {
      if (!form.themeName) {
        toast.error('主题名称必填');
        return;
      }
      if (editingId) {
        await tradeShowApi.theme.update(editingId, form);
        toast.success('更新成功');
      } else {
        await tradeShowApi.theme.create(form);
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
    if (!confirm('确定删除该订货会主题？')) return;
    try {
      await tradeShowApi.theme.remove(id);
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
        <h2 className="text-lg font-semibold">订货会主题</h2>
        {canEdit && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
          >
            新增主题
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索主题名称"
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
            <th className="px-3 py-2">主题编码</th>
            <th className="px-3 py-2">主题名称</th>
            <th className="px-3 py-2">年份</th>
            <th className="px-3 py-2">季节</th>
            <th className="px-3 py-2">排序</th>
            <th className="px-3 py-2">状态</th>
            <th className="px-3 py-2">备注</th>
            {canEdit && <th className="px-3 py-2">操作</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-2 font-mono text-xs">{r.themeCode}</td>
              <td className="px-3 py-2">{r.themeName}</td>
              <td className="px-3 py-2">{r.year ?? '-'}</td>
              <td className="px-3 py-2">{r.season ?? '-'}</td>
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
              <td colSpan={canEdit ? 8 : 7} className="px-3 py-6 text-center text-gray-400">
                暂无主题数据
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
        <span>
          {page} / {totalPages}
        </span>
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
              {editingId ? '编辑主题' : '新增主题'}
            </h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-gray-500 mb-1">主题名称 *</label>
                <input
                  value={form.themeName ?? ''}
                  onChange={(e) => setForm({ ...form, themeName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">年份</label>
                  <input
                    value={form.year ?? ''}
                    onChange={(e) => setForm({ ...form, year: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">季节</label>
                  <select
                    value={form.season ?? ''}
                    onChange={(e) => setForm({ ...form, season: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    <option value="">未指定</option>
                    {SEASONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">排序</label>
                  <input
                    type="number"
                    value={form.sortOrder ?? 0}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
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

export default ThemePage;
