import React, { useState, useEffect } from 'react';
import { baseApi } from '@client/src/api';
import type { SizeGroup, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { errMsg } from '@/utils/errMsg';

const SizeGroupPage: React.FC = () => {
  const [list, setList] = useState<SizeGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{ code: string; name: string }>({
    code: '',
    name: '',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<SizeGroup> = await baseApi.sizeGroup.list({
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

  const handleExport = () => {
    toast('导出功能开发中');
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ code: '', name: '' });
    setDialogOpen(true);
  };

  const openEdit = async (item: SizeGroup) => {
    setEditingId(item.id);
    setForm({
      code: item.code,
      name: item.name,
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
      // 尺码组的尺码成员改由「尺码组与尺码关系」页面维护，此处只维护尺码组本身
      if (editingId) {
        await baseApi.sizeGroup.update(editingId, { code: form.code, name: form.name });
      } else {
        await baseApi.sizeGroup.create({ code: form.code, name: form.name });
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
      await baseApi.sizeGroup.remove(id);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">尺码组管理</h2>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary transition-colors"
          onClick={openAdd}
        >
          + 新增尺码组
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
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary transition-colors"
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
              <th className="text-left px-4 py-3 border-b border-gray-200">创建时间</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-8 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3">{item.code}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3 text-gray-500">{item.createdAt?.replace('T', ' ').slice(0, 19) || '-'}</td>
                  <td className="px-4 py-3">
                    <button className="text-primary hover:text-primary/90 mr-3" onClick={() => openEdit(item)}>编辑</button>
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
              <h3 className="text-lg font-medium">{editingId ? '编辑尺码组' : '新增尺码组'}</h3>
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
                className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

export default SizeGroupPage;
