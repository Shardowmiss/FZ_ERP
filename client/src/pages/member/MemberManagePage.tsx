import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { memberApi } from '@client/src/api/member';
import { memberLevelApi } from '@client/src/api/member-level';
import type { Member } from '@shared/api.interface';
import { useAuth } from '@client/src/contexts/AuthContext';
import { errMsg } from '@/utils/errMsg';

const STATUS_LABEL: Record<string, string> = {
  active: '正常',
  disabled: '停用',
  inactive: '未激活',
};

const GENDERS = [
  { v: 'unknown', l: '未知' },
  { v: 'male', l: '男' },
  { v: 'female', l: '女' },
];

function calcAge(birthday?: string): string {
  if (!birthday) return '-';
  const b = new Date(birthday);
  if (Number.isNaN(b.getTime())) return '-';
  const diff = Date.now() - b.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return age >= 0 && age < 150 ? String(age) : '-';
}

const MemberManagePage: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('member:manage');

  const [list, setList] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [levelOptions, setLevelOptions] = useState<{ code: string; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Member>>({
    name: '',
    gender: 'unknown',
    level: 'normal',
    status: 'active',
  });

  const load = useCallback(async () => {
    try {
      const res = await memberApi.list(page, 20, keyword || undefined);
      setList(res.list ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [page, keyword]);

  useEffect(() => {
    void load();
    memberLevelApi
      .options()
      .then((opts) => setLevelOptions(opts))
      .catch(() => setLevelOptions([]));
  }, [load]);

  const levelName = (code?: string) =>
    levelOptions.find((o) => o.code === code)?.name ?? code ?? '-';

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', gender: 'unknown', level: 'normal', status: 'active' });
    setShowForm(true);
  };

  const openEdit = (row: Member) => {
    setEditingId(row.id);
    setForm({
      id: row.id,
      name: row.name,
      gender: row.gender,
      birthday: row.birthday,
      phone: row.phone,
      email: row.email,
      level: row.level,
      remark: row.remark,
      status: row.status,
    });
    setShowForm(true);
  };

  const submit = async () => {
    try {
      if (!form.name) {
        toast.error('姓名必填');
        return;
      }
      if (editingId) {
        await memberApi.update(form);
        toast.success('更新成功');
      } else {
        await memberApi.create(form);
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
    if (!confirm('确定删除该会员？（软删除，可在数据治理审计中追溯）')) return;
    try {
      await memberApi.remove(id);
      toast.success('删除成功');
      void load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const adjustPoints = async (row: Member) => {
    const input = prompt(`为「${row.name}」调整积分（正加负减）：`, '0');
    if (input === null) return;
    const delta = Number(input);
    if (!delta) return;
    try {
      await memberApi.adjustPoints(row.id, delta > 0 ? 'manual_add' : 'manual_deduct', delta, '会员管理手工调整');
      toast.success('积分调整成功');
      void load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const adjustStored = async (row: Member) => {
    const input = prompt(`为「${row.name}」调整储值金额（元，正加负减）：`, '0');
    if (input === null) return;
    const yuan = Number(input);
    if (!yuan) return;
    try {
      const res = await memberApi.adjustStoredValue(row.id, Math.round(yuan * 100));
      if (res.status === 'rejected') {
        toast.error(res.message ?? '储值调整被拒（可能透支）');
      } else {
        toast.success('储值调整成功');
      }
      void load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">会员管理</h2>
        {canEdit && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-primary text-white rounded text-sm hover:bg-blue-600"
          >
            新增会员
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索姓名"
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
            <th className="px-3 py-2">会员号</th>
            <th className="px-3 py-2">姓名</th>
            <th className="px-3 py-2">性别</th>
            <th className="px-3 py-2">年龄</th>
            <th className="px-3 py-2">手机</th>
            <th className="px-3 py-2">邮箱</th>
            <th className="px-3 py-2">会员等级</th>
            <th className="px-3 py-2">积分</th>
            <th className="px-3 py-2">资金余额(元)</th>
            <th className="px-3 py-2">状态</th>
            {canEdit && <th className="px-3 py-2">操作</th>}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="px-3 py-2 font-mono text-xs">{r.memberNo}</td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2">
                {GENDERS.find((g) => g.v === r.gender)?.l ?? r.gender ?? '-'}
              </td>
              <td className="px-3 py-2">{calcAge(r.birthday)}</td>
              <td className="px-3 py-2">{r.phone ?? '-'}</td>
              <td className="px-3 py-2 text-gray-500 max-w-[160px] truncate">{r.email ?? '-'}</td>
              <td className="px-3 py-2">{levelName(r.level)}</td>
              <td className="px-3 py-2">{r.points}</td>
              <td className="px-3 py-2">
                {((r.storedValue ?? 0) / 100).toFixed(2)}
              </td>
              <td className="px-3 py-2">
                <span className={r.status === 'active' ? 'text-green-600' : 'text-gray-400'}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </td>
              {canEdit && (
                <td className="px-3 py-2 whitespace-nowrap">
                  <button onClick={() => openEdit(r)} className="text-blue-600 hover:underline mr-2">编辑</button>
                  <button onClick={() => adjustPoints(r)} className="text-blue-600 hover:underline mr-2">积分</button>
                  <button onClick={() => adjustStored(r)} className="text-blue-600 hover:underline mr-2">储值</button>
                  <button onClick={() => remove(r.id)} className="text-red-600 hover:underline">删除</button>
                </td>
              )}
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 11 : 10} className="px-3 py-6 text-center text-gray-400">
                暂无会员数据
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
          <div className="bg-white rounded-lg p-6 w-[520px] max-h-[90vh] overflow-auto">
            <h3 className="text-base font-semibold mb-4">
              {editingId ? '编辑会员' : '新增会员'}
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">姓名 *</label>
                  <input
                    value={form.name ?? ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">性别</label>
                  <select
                    value={form.gender ?? 'unknown'}
                    onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    {GENDERS.map((g) => (
                      <option key={g.v} value={g.v}>{g.l}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">生日</label>
                  <input
                    type="date"
                    value={form.birthday ?? ''}
                    onChange={(e) => setForm({ ...form, birthday: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">会员等级</label>
                  <select
                    value={form.level ?? 'normal'}
                    onChange={(e) => setForm({ ...form, level: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    {levelOptions.length === 0 && <option value="normal">会员卡</option>}
                    {levelOptions.map((o) => (
                      <option key={o.code} value={o.code}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">手机号</label>
                  <input
                    value={form.phone ?? ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">邮箱</label>
                  <input
                    value={form.email ?? ''}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-gray-500 mb-1">状态</label>
                  <select
                    value={form.status ?? 'active'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  >
                    <option value="active">正常</option>
                    <option value="disabled">停用</option>
                    <option value="inactive">未激活</option>
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
              <p className="text-xs text-gray-400">
                积分与资金余额通过列表「积分 / 储值」按钮调整（走账本，资金安全）。
              </p>
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

export default MemberManagePage;
