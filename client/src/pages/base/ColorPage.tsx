import { StatusBadge } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { baseApi } from '@client/src/api';
import type { Color, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

const ColorPage: React.FC = () => {
  const [list, setList] = useState<Color[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ code: string; name: string; hex: string; sortOrder: number; status: string; remark: string }>({
    code: '',
    name: '',
    hex: '#000000',
    sortOrder: 0,
    status: 'active',
    remark: '',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<Color> = await baseApi.color.list({
        page,
        pageSize,
        keyword: searchKeyword || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword]);

  const handleSearch = () => {
    setPage(1);
    setSearchKeyword(keyword);
  };

  const handleReset = () => {
    setKeyword('');
    setPage(1);
    setSearchKeyword('');
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ code: '', name: '', hex: '#000000', sortOrder: 0, status: 'active', remark: '' });
    setDialogOpen(true);
  };

  const openEdit = async (item: Color) => {
    setEditingId(item.id);
    setForm({
      code: item.code,
      name: item.name,
      hex: item.hex || '#000000',
      sortOrder: item.sortOrder ?? 0,
      status: item.status || 'active',
      remark: item.remark ?? '',
    });
    setDialogOpen(true);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (submitting) return;
    if (!form.code.trim()) { toast('请输入编码'); return; }
    if (!form.name.trim()) { toast('请输入名称'); return; }
    setSubmitting(true);
    try {
      if (editingId) {
        await baseApi.color.update(editingId, { ...form });
      } else {
        await baseApi.color.create({ ...form });
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定要删除吗？')) return;
    try {
      await baseApi.color.remove(id);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const renderStatus = (status?: string) => {
    const active = status === 'active';
    return (
      <StatusBadge tone={active ? 'ok' : 'neutral'}>{active ? '启用' : '停用'}</StatusBadge>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">颜色管理</h2>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={openAdd}
        >
          + 新增颜色
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200">
        <input
          type="text"
          placeholder="搜索编码/名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-primary"
        />
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={handleSearch}
        >
          查询
        </button>
        <button
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
          onClick={handleReset}
        >
          重置
        </button>
      </div>

      <TableContainer>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="text-left px-4 py-3 border-b border-gray-200">编码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">名称</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">色值</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">排序</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">备注</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">创建时间</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3">{item.code}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-5 h-5 rounded border border-gray-300"
                        style={{ backgroundColor: item.hex || '#000000' }}
                      />
                      <span className="text-gray-500 text-xs">{item.hex || '-'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{item.sortOrder ?? 0}</td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
                  <td className="px-4 py-3 text-gray-600">{item.remark || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{item.createdAt?.replace('T', ' ').slice(0, 19) || '-'}</td>
                  <td className="px-4 py-3">
                    <button className="text-primary hover:text-blue-700 mr-3" onClick={() => openEdit(item)}>编辑</button>
                    <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(item.id)}>删除</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableContainer>

      <DataPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(v) => { setPageSize(v); setPage(1); }}
      />

      {dialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[500px] max-w-[95vw] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">{editingId ? '编辑颜色' : '新增颜色'}</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={() => setDialogOpen(false)}>×</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">编码<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">名称<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-700 mb-1">色值</label>
                    <input
                      type="text"
                      value={form.hex}
                      onChange={(e) => setForm({ ...form, hex: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <input
                    type="color"
                    value={form.hex}
                    onChange={(e) => setForm({ ...form, hex: e.target.value })}
                    className="w-12 h-9 border border-gray-300 rounded cursor-pointer"
                  />
                </div>
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-700 mb-1">排序</label>
                    <input
                      type="number"
                      value={form.sortOrder}
                      onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-700 mb-1">状态</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="active">启用</option>
                      <option value="inactive">停用</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">备注</label>
                  <input
                    type="text"
                    value={form.remark}
                    onChange={(e) => setForm({ ...form, remark: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
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

export default ColorPage;
