import React, { useState, useEffect } from 'react';
import { rbacApi } from '@client/src/api';
import type { RbacUser, RbacRole, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';

interface UserFormData {
  username: string;
  name: string;
  password: string;
  confirmPassword: string;
  phone: string;
  department: string;
  status: string;
  roleIds: string[];
  remark: string;
}

const UserManagePage: React.FC = () => {
  const [list, setList] = useState<RbacUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormData>({
    username: '',
    name: '',
    password: '',
    confirmPassword: '',
    phone: '',
    department: '',
    status: 'active',
    roleIds: [],
    remark: '',
  });

  const [roleList, setRoleList] = useState<RbacRole[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<RbacUser> = await rbacApi.users.list({
        page,
        pageSize,
        keyword: searchKeyword || undefined,
        status: searchStatus || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchRoles = async () => {
    try {
      const res: RbacRole[] = await rbacApi.roles.all();
      setRoleList(res);
    } catch (e) {
      toast.error('加载角色列表失败');
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword, searchStatus]);

  useEffect(() => {
    fetchRoles();
  }, []);

  const handleSearch = () => {
    setPage(1);
    setSearchKeyword(keyword);
    setSearchStatus(statusFilter);
  };

  const handleReset = () => {
    setKeyword('');
    setStatusFilter('');
    setPage(1);
    setSearchKeyword('');
    setSearchStatus('');
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({
      username: '',
      name: '',
      password: '',
      confirmPassword: '',
      phone: '',
      department: '',
      status: 'active',
      roleIds: [],
      remark: '',
    });
    setDialogOpen(true);
  };

  const openEdit = (item: RbacUser) => {
    setEditingId(item.id);
    setForm({
      username: item.username,
      name: item.name,
      password: '',
      confirmPassword: '',
      phone: item.phone || '',
      department: item.department || '',
      status: item.status,
      roleIds: item.roleIds || [],
      remark: item.remark || '',
    });
    setDialogOpen(true);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (submitting) return;
    if (!editingId) {
      if (!form.username.trim()) {
        toast.error('请输入用户名');
        return;
      }
      if (!form.password) {
        toast.error('请输入密码');
        return;
      }
    }
    if (!form.name.trim()) {
      toast.error('请输入姓名');
      return;
    }
    if (form.password && form.password !== form.confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        username: form.username,
        name: form.name,
        phone: form.phone || undefined,
        department: form.department || undefined,
        status: form.status,
        remark: form.remark || undefined,
        roleIds: form.roleIds,
        ...(form.password ? { password: form.password } : {}),
      };

      if (editingId) {
        await rbacApi.users.update(editingId, payload);
        toast.success('更新成功');
      } else {
        await rbacApi.users.create({ ...payload, password: form.password });
        toast.success('创建成功');
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast.error(editingId ? '更新失败' : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (item: RbacUser) => {
    const newStatus = item.status === 'active' ? 'inactive' : 'active';
    const action = newStatus === 'active' ? '启用' : '禁用';
    if (!await showConfirm(`确定要${action}该用户吗？`)) return;
    try {
      await rbacApi.users.update(item.id, { status: newStatus });
      toast.success(`${action}成功`);
      fetchData();
    } catch (e) {
      toast.error(`${action}失败`);
    }
  };

  const handleRoleChange = (roleId: string, checked: boolean) => {
    if (checked) {
      setForm({ ...form, roleIds: [...form.roleIds, roleId] });
    } else {
      setForm({ ...form, roleIds: form.roleIds.filter((id: string) => id !== roleId) });
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const renderStatus = (status: string) => {
    if (status === 'active') {
      return (
        <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">
          启用
        </span>
      );
    }
    return (
      <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
        禁用
      </span>
    );
  };

  return (
    <div className="p-5 bg-white rounded shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">用户管理</h2>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={openAdd}
        >
          新增用户
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <input
          type="text"
          placeholder="搜索用户名/姓名"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-primary"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">禁用</option>
        </select>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={handleSearch}
        >
          搜索
        </button>
        <button
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
          onClick={handleReset}
        >
          重置
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="text-left px-4 py-3 border-b border-gray-200">用户名</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">姓名</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">手机</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">所属部门</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">创建时间</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-40">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item: RbacUser) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{item.username}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3 text-gray-600">{item.phone || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.department || '-'}</td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {item.createdAt ? item.createdAt.substring(0, 10) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="text-primary hover:text-blue-700 mr-3"
                      onClick={() => openEdit(item)}
                    >
                      编辑
                    </button>
                    <button
                      className={
                        item.status === 'active'
                          ? 'text-orange-500 hover:text-orange-700'
                          : 'text-green-500 hover:text-green-700'
                      }
                      onClick={() => handleToggleStatus(item)}
                    >
                      {item.status === 'active' ? '禁用' : '启用'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4">
        <div className="text-sm text-gray-500">共 {total} 条</div>
        <div className="flex items-center gap-2">
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value={10}>10条/页</option>
            <option value={20}>20条/页</option>
            <option value={50}>50条/页</option>
            <option value={100}>100条/页</option>
          </select>
          <button
            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span className="text-sm text-gray-600">
            第 {page} / {totalPages || 1} 页
          </span>
          <button
            className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">
                {editingId ? '编辑用户' : '新增用户'}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-xl"
                onClick={() => setDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    用户名<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    disabled={!!editingId}
                    className={
                      'w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary ' +
                      (editingId ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : '')
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    姓名<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    密码
                    {!editingId && <span className="text-red-500">*</span>}
                    {editingId && <span className="text-xs text-gray-400 ml-1">留空表示不修改</span>}
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    确认密码
                  </label>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(e) =>
                      setForm({ ...form, confirmPassword: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">手机</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">所属部门</label>
                  <input
                    type="text"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">状态</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="active">启用</option>
                    <option value="inactive">禁用</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-700 mb-1">关联角色</label>
                  <div className="border border-gray-300 rounded p-3 max-h-32 overflow-y-auto">
                    {roleList.length === 0 ? (
                      <span className="text-gray-400 text-sm">暂无角色</span>
                    ) : (
                      <div className="flex flex-wrap gap-4">
                        {roleList.map((role: RbacRole) => (
                          <label
                            key={role.id}
                            className="flex items-center gap-2 cursor-pointer text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={form.roleIds.includes(role.id)}
                              onChange={(e) =>
                                handleRoleChange(role.id, e.target.checked)
                              }
                              className="w-4 h-4 accent-primary"
                            />
                            <span>{role.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-700 mb-1">备注</label>
                  <textarea
                    value={form.remark}
                    onChange={(e) => setForm({ ...form, remark: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSave}
                disabled={submitting}
              >
                {submitting ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagePage;
