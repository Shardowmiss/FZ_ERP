import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { baseApi } from '@client/src/api';
import type { Material, Supplier, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';

const MaterialPage: React.FC = () => {
  const [list, setList] = useState<Material[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [searchCategory, setSearchCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [form, setForm] = useState<Partial<Material>>({
    code: '',
    name: '',
    spec: '',
    unit: '米',
    defaultSupplierId: '',
    stdPrice: 0,
    category: '主料',
    status: 'active',
    remark: '',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<Material> = await baseApi.material.list({
        page,
        pageSize,
        keyword: searchKeyword || undefined,
        category: searchCategory || undefined,
        status: searchStatus || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchSupplierOptions = async () => {
    try {
      const res = await baseApi.supplier.options();
      setSupplierOptions(res);
    } catch (e) {
      // non-critical
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword, searchCategory, searchStatus]);

  const handleSearch = () => {
    setPage(1);
    setSearchKeyword(keyword);
    setSearchCategory(categoryFilter);
    setSearchStatus(statusFilter);
  };

  const handleReset = () => {
    setKeyword('');
    setCategoryFilter('');
    setStatusFilter('');
    setPage(1);
    setSearchKeyword('');
    setSearchCategory('');
    setSearchStatus('');
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({
      code: '',
      name: '',
      spec: '',
      unit: '米',
      defaultSupplierId: '',
      stdPrice: 0,
      category: '主料',
      status: 'active',
      remark: '',
    });
    fetchSupplierOptions();
    setDialogOpen(true);
  };

  const openEdit = (item: Material) => {
    setEditingId(item.id);
    setForm({ ...item });
    fetchSupplierOptions();
    setDialogOpen(true);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (submitting) return;
    if (!form.code?.trim()) { toast('请输入物料编码'); return; }
    if (!form.name?.trim()) { toast('请输入名称'); return; }
    if (!form.unit) { toast('请选择单位'); return; }
    setSubmitting(true);
    try {
      if (editingId) {
        await baseApi.material.update(editingId, form);
      } else {
        await baseApi.material.create(form);
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
      await baseApi.material.remove(id);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const handleExport = () => {
    toast('导出功能开发中');
  };

  const renderStatus = (status: string) => {
    if (status === 'active') {
      return <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">启用</span>;
    }
    return <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">停用</span>;
  };

  const getSupplierName = (supplierId: string | undefined) => {
    if (!supplierId) return '-';
    const s = supplierOptions.find(o => o.id === supplierId);
    return s ? s.name : supplierId;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">面辅料档案</h2>
        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
            onClick={handleExport}
          >
            <Download size={16} /> 导出
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
            onClick={openAdd}
          >
            + 新增物料
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <input
          type="text"
          placeholder="搜索编码/名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-blue-500"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">全部分类</option>
          <option value="主料">主料</option>
          <option value="辅料">辅料</option>
          <option value="包材">包材</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
        </select>
        <button
          className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
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
              <th className="text-left px-4 py-3 border-b border-gray-200">物料编码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">名称</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">规格</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">单位</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">默认供应商</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">标准采购价</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">分类</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{item.code}</td>
                  <td className="px-4 py-3">{item.name}</td>
                  <td className="px-4 py-3 text-gray-600">{item.spec || '-'}</td>
                  <td className="px-4 py-3">{item.unit}</td>
                  <td className="px-4 py-3 text-gray-600">{getSupplierName(item.defaultSupplierId)}</td>
                  <td className="px-4 py-3">¥{item.stdPrice?.toFixed(2)}</td>
                  <td className="px-4 py-3">{item.category || '-'}</td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
                  <td className="px-4 py-3">
                    <button className="text-blue-500 hover:text-blue-700 mr-3" onClick={() => openEdit(item)}>编辑</button>
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
          <div className="bg-white rounded shadow-lg w-[600px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">{editingId ? '编辑面辅料' : '新增面辅料'}</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={() => setDialogOpen(false)}>×</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">物料编码<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.code || ''}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">名称<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name || ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">规格</label>
                  <input
                    type="text"
                    value={form.spec || ''}
                    onChange={(e) => setForm({ ...form, spec: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">单位<span className="text-red-500">*</span></label>
                  <select
                    value={form.unit || '米'}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="米">米</option>
                    <option value="码">码</option>
                    <option value="公斤">公斤</option>
                    <option value="个">个</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">默认供应商</label>
                  <select
                    value={form.defaultSupplierId || ''}
                    onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">请选择</option>
                    {supplierOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">标准采购价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.stdPrice ?? ''}
                    onChange={(e) => setForm({ ...form, stdPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">分类</label>
                  <select
                    value={form.category || '主料'}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="主料">主料</option>
                    <option value="辅料">辅料</option>
                    <option value="包材">包材</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">状态</label>
                  <select
                    value={form.status || 'active'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="active">启用</option>
                    <option value="inactive">停用</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-700 mb-1">备注</label>
                  <textarea
                    value={form.remark || ''}
                    onChange={(e) => setForm({ ...form, remark: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 resize-none"
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
                className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

export default MaterialPage;
