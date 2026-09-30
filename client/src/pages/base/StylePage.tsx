import React, { useState, useEffect, useRef } from 'react';
import { Download } from 'lucide-react';
import { baseApi } from '@client/src/api';
import type { Style, ColorGroup, SizeGroup, PaginationResult, StyleCreateAutoRequest, StyleAttribute } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { AutoCreateForm, ManualForm, type AutoCreateFormHandle } from './StyleForm';
import { errMsg } from '@/utils/errMsg';

const StylePage: React.FC = () => {
  const [list, setList] = useState<Style[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);
  const [colorGroups, setColorGroups] = useState<ColorGroup[]>([]);
  const [sizeGroups, setSizeGroups] = useState<SizeGroup[]>([]);
  const [brandOptions, setBrandOptions] = useState<StyleAttribute[]>([]);
  const [brandFilter, setBrandFilter] = useState('');
  const [searchBrand, setSearchBrand] = useState('');
  const [form, setForm] = useState<Partial<Style>>({
    styleNo: '', name: '', category: '', season: '', wave: '',
    tagPrice: 0, costPrice: 0, supplyPrice: 0,
    colorGroupId: '', sizeGroupId: '', status: 'active', remark: '',
  });
  const [autoFormKey, setAutoFormKey] = useState(0);
  const autoFormRef = useRef<AutoCreateFormHandle>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<Style> = await baseApi.style.list({
        page, pageSize,
        keyword: searchKeyword || undefined,
        status: searchStatus || undefined,
        brand: searchBrand || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const fetchOptions = async () => {
    try {
      const [cgRes, sgRes, brandRes] = await Promise.all([
        baseApi.colorGroup.list({ page: 1, pageSize: 1000 }),
        baseApi.sizeGroup.list({ page: 1, pageSize: 1000 }),
        baseApi.styleAttribute.getAll('brand', true),
      ]);
      setColorGroups(cgRes.items);
      setSizeGroups(sgRes.items);
      setBrandOptions(brandRes);
    } catch {
      // non-critical
    }
  };

  useEffect(() => { fetchData(); }, [page, pageSize, searchKeyword, searchStatus, searchBrand]);

  const handleSearch = () => { setPage(1); setSearchKeyword(keyword); setSearchStatus(statusFilter); setSearchBrand(brandFilter); };
  const handleReset = () => { setKeyword(''); setStatusFilter(''); setBrandFilter(''); setPage(1); setSearchKeyword(''); setSearchStatus(''); setSearchBrand(''); };

  const openAddAuto = () => {
    setEditingId(null);
    setIsAutoMode(true);
    setAutoFormKey(k => k + 1);
    fetchOptions();
    setAddDropdownOpen(false);
    setDialogOpen(true);
  };

  const openAddManual = () => {
    setEditingId(null);
    setIsAutoMode(false);
    setForm({
      styleNo: '', name: '', category: '', season: '', brand: '', wave: '',
      tagPrice: 0, costPrice: 0, supplyPrice: 0,
      colorGroupId: '', sizeGroupId: '', status: 'active', remark: '',
    });
    fetchOptions();
    setAddDropdownOpen(false);
    setDialogOpen(true);
  };

  const openEdit = (item: Style) => {
    setEditingId(item.id);
    setIsAutoMode(false);
    setForm({ ...item });
    fetchOptions();
    setDialogOpen(true);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSaveAuto = async (data: StyleCreateAutoRequest) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await baseApi.style.createAuto(data);
      setDialogOpen(false);
      fetchData();
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveManual = async () => {
    if (submitting) return;
    if (!form.styleNo?.trim()) { toast('请输入款号'); return; }
    if (!form.name?.trim()) { toast('请输入款名'); return; }
    if (!form.colorGroupId) { toast('请选择颜色组'); return; }
    if (!form.sizeGroupId) { toast('请选择尺码组'); return; }
    setSubmitting(true);
    try {
      if (editingId) {
        await baseApi.style.update(editingId, form);
      } else {
        await baseApi.style.create(form);
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = async () => {
    if (isAutoMode && !editingId) {
      try {
        await autoFormRef.current?.submit();
      } catch {
        // 错误已在子组件提示
      }
    } else {
      await handleSaveManual();
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定要删除吗？删除后关联SKU也会被清除。')) return;
    try { await baseApi.style.remove(id); fetchData(); } catch (e) { toast(errMsg(e, '删除失败')); }
  };

  const renderStatus = (status: string) => (
    status === 'active'
      ? <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">启用</span>
      : <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">停用</span>
  );

  const getStyleTooltip = (item: Style): string => {
    if (item.year && item.category && item.fit) {
      return `款号: ${item.styleNo}\n年份: ${item.year}\n季节: ${item.season || '-'}\n大类: ${item.category}\n小类: ${item.subCategory || '-'}\n版型: ${item.fit}`;
    }
    return `款号: ${item.styleNo}`;
  };

  const dialogTitle = editingId ? '编辑款号' : (isAutoMode ? '自动编码新增款号' : '新增款号');

  const handleExport = () => {
    toast('导出功能开发中');
  };
  const dialogWidth = isAutoMode && !editingId ? 'w-[900px] max-w-[95vw]' : 'w-[640px] max-w-[95vw]';
  const isAuto = isAutoMode && !editingId;

  return (
    <div className="bg-white rounded-lg shadow-sm p-5" onClick={() => addDropdownOpen && setAddDropdownOpen(false)}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">款号管理</h2>
        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
            onClick={handleExport}
          >
            <Download size={16} /> 导出
          </button>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
              onClick={() => setAddDropdownOpen(v => !v)}
            >
              新增<span className="text-xs">▼</span>
            </button>
            {addDropdownOpen && (
              <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded shadow-md z-10">
                <button className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50" onClick={openAddAuto}>
                  自动编码新增
                </button>
                <button className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 border-t border-gray-100" onClick={openAddManual}>
                  手动录入
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <input type="text" placeholder="搜索款号/款名" value={keyword}
          onChange={e => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-primary" />
        <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary">
          <option value="">全部品牌</option>
          {brandOptions.map((b: StyleAttribute) => (
            <option key={b.id} value={b.attrName}>{b.attrName}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary">
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">停用</option>
        </select>
           <button className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
           onClick={handleSearch}>查询</button>
        <button className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
          onClick={handleReset}>重置</button>
      </div>

      <TableContainer>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="text-left px-4 py-3 border-b border-gray-200">款号</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">款名</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">品类</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">品牌</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">季节</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">波段</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">吊牌价</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">创建时间</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-32">操作</th>
            </tr>
          </thead>
           <tbody>
             {loading ? (
               <tr><td colSpan={10} className="text-center py-8 text-gray-400">加载中...</td></tr>
             ) : !loading && list.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            ) : !loading && list.map(item => (
              <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium" title={getStyleTooltip(item)}>{item.styleNo}</td>
                <td className="px-4 py-3">{item.name}</td>
                <td className="px-4 py-3 text-gray-600">{item.category || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{item.brand || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{item.season || '-'}</td>
                <td className="px-4 py-3 text-gray-600">{item.wave || '-'}</td>
                <td className="px-4 py-3">¥{item.tagPrice?.toFixed(2)}</td>
                <td className="px-4 py-3">{renderStatus(item.status)}</td>
                <td className="px-4 py-3 text-gray-500">{item.createdAt?.replace('T', ' ').slice(0, 19) || '-'}</td>
                <td className="px-4 py-3">
                  <button className="text-primary hover:text-blue-700 mr-3" onClick={() => openEdit(item)}>编辑</button>
                  <button className="text-red-500 hover:text-red-700" onClick={() => handleDelete(item.id)}>删除</button>
                </td>
              </tr>
            ))}
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
          <div className={`bg-white rounded shadow-lg max-h-[85vh] flex flex-col ${dialogWidth}`}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">{dialogTitle}</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl"
                onClick={() => setDialogOpen(false)}>×</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              {isAuto ? (
                <AutoCreateForm
                  key={autoFormKey}
                  ref={autoFormRef}
                  colorGroups={colorGroups}
                  sizeGroups={sizeGroups}
                  brandOptions={brandOptions}
                  onSave={handleSaveAuto}
                />
              ) : (
                <ManualForm
                  form={form}
                  editing={!!editingId}
                  colorGroups={colorGroups}
                  sizeGroups={sizeGroups}
                  brandOptions={brandOptions}
                  onChange={patch => setForm({ ...form, ...patch })}
                />
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={() => setDialogOpen(false)}>取消</button>
              <button className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSave} disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StylePage;
