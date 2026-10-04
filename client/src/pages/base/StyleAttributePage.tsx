import { StatusBadge } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { baseApi } from '@client/src/api';
import type { StyleAttribute } from '@client/src/api/base';
import type { PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';

type AttrType = 'year' | 'season' | 'category' | 'sub_category' | 'fit' | 'brand';

interface TabDef {
  key: AttrType;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'year', label: '年份' },
  { key: 'season', label: '季节' },
  { key: 'category', label: '商品大类' },
  { key: 'sub_category', label: '商品小类' },
  { key: 'fit', label: '版型' },
  { key: 'brand', label: '品牌' },
];

interface FormState {
  attrCode: string;
  attrName: string;
  sortOrder: number;
  status: string;
  remark: string;
  parentCode: string;
}

const defaultForm: FormState = {
  attrCode: '',
  attrName: '',
  sortOrder: 0,
  status: 'active',
  remark: '',
  parentCode: '',
};

const StyleAttributePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AttrType>('year');
  const [list, setList] = useState<StyleAttribute[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [categoryOptions, setCategoryOptions] = useState<StyleAttribute[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<StyleAttribute> = await baseApi.styleAttribute.list({
        attrType: activeTab,
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

  const fetchCategoryOptions = async () => {
    try {
      const res = await baseApi.styleAttribute.getAll('category', true);
      setCategoryOptions(res);
    } catch (e) {
      // non-critical
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword, activeTab]);

  const handleTabChange = (key: AttrType) => {
    setActiveTab(key);
    setPage(1);
    setKeyword('');
    setSearchKeyword('');
  };

  const handleSearch = () => {
    setPage(1);
    setSearchKeyword(keyword);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...defaultForm });
    if (activeTab === 'sub_category') {
      fetchCategoryOptions();
    }
    setDialogOpen(true);
  };

  const openEdit = (item: StyleAttribute) => {
    setEditingId(item.id);
    setForm({
      attrCode: item.attrCode,
      attrName: item.attrName,
      sortOrder: item.sortOrder,
      status: item.status,
      remark: item.remark || '',
      parentCode: item.parentCode || '',
    });
    if (activeTab === 'sub_category') {
      fetchCategoryOptions();
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.attrCode.trim()) { toast('请输入属性编码'); return; }
    if (!form.attrName.trim()) { toast('请输入属性名称'); return; }
    if (activeTab === 'sub_category' && !form.parentCode) {
      toast('请选择所属大类'); return;
    }
    try {
      const payload = {
        ...form,
        attrType: activeTab,
      };
      if (editingId) {
        await baseApi.styleAttribute.update(editingId, payload);
      } else {
        await baseApi.styleAttribute.create(payload);
      }
      toast('保存成功');
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定要删除该属性吗？')) return;
    try {
      const res = await baseApi.styleAttribute.remove(id);
      if (res.disabled) {
        toast.warning(res.message || '该属性已被引用，已改为禁用状态');
      } else {
        toast('删除成功');
      }
      fetchData();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const renderStatus = (status: string) => {
    if (status === 'active') {
      return <StatusBadge tone="ok">启用</StatusBadge>;
    }
    return <StatusBadge tone="neutral">禁用</StatusBadge>;
  };

  const getCategoryLabel = (code: string | undefined) => {
    if (!code) return '-';
    const cat = categoryOptions.find(c => c.attrCode === code);
    return cat ? `${cat.attrName}(${cat.attrCode})` : code;
  };

  const isSubCategory = activeTab === 'sub_category';

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">款号属性维护</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? 'text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200">
        <input
          type="text"
          placeholder="搜索编码/名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          onBlur={handleSearch}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-primary"
        />
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={handleSearch}
        >
          查询
        </button>
        <div className="flex-1" />
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={openAdd}
        >
          + 新增属性
        </button>
      </div>

      {/* 表格 */}
      <TableContainer>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="text-left px-4 py-3 border-b border-gray-200">属性编码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">属性名称</th>
              {isSubCategory && (
                <th className="text-left px-4 py-3 border-b border-gray-200">所属大类</th>
              )}
              <th className="text-left px-4 py-3 border-b border-gray-200">排序号</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-32">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={isSubCategory ? 6 : 5} className="text-center py-8 text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={isSubCategory ? 6 : 5} className="text-center py-8 text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{item.attrCode}</td>
                  <td className="px-4 py-3">{item.attrName}</td>
                  {isSubCategory && (
                    <td className="px-4 py-3 text-gray-600">
                      {item.parentName ? `${item.parentName}(${item.parentCode})` : getCategoryLabel(item.parentCode)}
                    </td>
                  )}
                  <td className="px-4 py-3">{item.sortOrder}</td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
                  <td className="px-4 py-3">
                    <button
                      className="text-primary hover:text-blue-700 mr-3"
                      onClick={() => openEdit(item)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-red-500 hover:text-red-700"
                      onClick={() => handleDelete(item.id)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableContainer>

      {/* 分页 */}
      <DataPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(v) => { setPageSize(v); setPage(1); }}
      />

      {/* 弹窗 */}
      {dialogOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[520px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">
                {editingId ? '编辑属性' : '新增属性'}
              </h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-xl"
                onClick={() => setDialogOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="space-y-4">
                {isSubCategory && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      所属大类<span className="text-red-500">*</span>
                    </label>
                    <select
                      value={form.parentCode}
                      onChange={(e) => setForm({ ...form, parentCode: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="">请选择大类</option>
                      {categoryOptions.map((c) => (
                        <option key={c.id} value={c.attrCode}>
                          {c.attrName}({c.attrCode})
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    属性编码<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.attrCode}
                    onChange={(e) => setForm({ ...form, attrCode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    placeholder="请输入属性编码"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">
                    属性名称<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.attrName}
                    onChange={(e) => setForm({ ...form, attrName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    placeholder="请输入属性名称"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">排序号</label>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
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
                <div>
                  <label className="block text-sm text-gray-700 mb-1">备注</label>
                  <textarea
                    value={form.remark}
                    onChange={(e) => setForm({ ...form, remark: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary resize-none"
                    placeholder="可选"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
                onClick={handleSave}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StyleAttributePage;
