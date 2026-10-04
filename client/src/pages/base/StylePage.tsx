import { StatusBadge } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { baseApi } from '@client/src/api';
import type { MergeResult, MergeCandidateGroup } from '@client/src/api';
import { useAuth } from '@client/src/contexts/AuthContext';
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

  const { hasPermission } = useAuth();
  const canMerge = hasPermission('md:merge');

  // 合并相关状态
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [relatedCountMap, setRelatedCountMap] = useState<Record<string, number>>({});
  const [survivorId, setSurvivorId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null);

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
      // 单页选择：翻页/筛选后清空勾选，避免跨页误合并（防误操作）
      setSelectedIds([]);
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
      ? <StatusBadge tone="ok">启用</StatusBadge>
      : <StatusBadge tone="neutral">停用</StatusBadge>
  );

  const getStyleTooltip = (item: Style): string => {
    if (item.year && item.category && item.fit) {
      return `款号: ${item.styleNo}\n年份: ${item.year}\n季节: ${item.season || '-'}\n大类: ${item.category}\n小类: ${item.subCategory || '-'}\n版型: ${item.fit}`;
    }
    return `款号: ${item.styleNo}`;
  };

  // ===== 多选 =====
  const allOnPageSelected = list.length > 0 && list.every((c) => selectedIds.includes(c.id));
  const toggleSelectAll = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !list.some((c) => c.id === id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...list.map((c) => c.id)])));
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // ===== 打开合并弹窗：拉取查重候选补全关联单据数（帮运营判断 survivor） =====
  const openMergeModal = async () => {
    if (selectedIds.length < 2) return;
    setMergeLoading(true);
    try {
      // candidates 非必填：失败（如网络/权限）不阻断合并，仅失去 relatedCount 提示
      const groups = (await baseApi.masterDataMerge
        .candidates('style')
        .catch(() => [] as MergeCandidateGroup[])) || [];
      const map: Record<string, number> = {};
      for (const g of groups) for (const m of g.members) map[m.id] = m.relatedCount;
      setRelatedCountMap(map);
      // 默认 survivor = 关联单据最多者（并列取先选）
      const ranked = [...selectedIds].sort((a, b) => (map[b] ?? -1) - (map[a] ?? -1));
      setSurvivorId(ranked[0]);
      setReason('');
      setMergeResult(null);
      setMergeModalOpen(true);
    } finally {
      setMergeLoading(false);
    }
  };

  const handleMergeConfirm = async () => {
    if (!survivorId) { toast('请选择保留款号（survivor）'); return; }
    const mergedIds = selectedIds.filter((id) => id !== survivorId);
    if (mergedIds.length === 0) { toast('请至少勾选一个被合并款号'); return; }
    setMergeLoading(true);
    try {
      const res = await baseApi.masterDataMerge.merge('style', {
        survivorId,
        mergedIds,
        reason: reason.trim() || undefined,
      });
      setMergeResult(res);
      toast.success(`合并成功，批次号 ${res.runId}`);
      setSelectedIds([]);
    } catch (e) {
      toast(errMsg(e, '合并失败'));
    } finally {
      setMergeLoading(false);
    }
  };

  const closeMergeModal = () => {
    setMergeModalOpen(false);
    setMergeResult(null);
    fetchData();
  };

  const selectedStyles = list.filter((c) => selectedIds.includes(c.id));

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
          {canMerge && (
            <button
              className="px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={openMergeModal}
              disabled={selectedIds.length < 2 || mergeLoading}
            >
              合并重复款号（{selectedIds.length}）
            </button>
          )}
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
        {canMerge && selectedIds.length >= 2 && (
          <span className="text-xs text-amber-700">
            已选 {selectedIds.length} 个款号，点击「合并重复款号」选择保留方并完成合并
          </span>
        )}
      </div>

      <TableContainer>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="w-10 px-2 py-3 border-b border-gray-200 text-center">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  className="cursor-pointer"
                  aria-label="全选本页"
                />
              </th>
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
               <tr><td colSpan={11} className="text-center py-8 text-gray-400">加载中...</td></tr>
             ) : !loading && list.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            ) : !loading && list.map(item => (
              <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                <td className="px-2 py-3 text-center border-b border-gray-200">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="cursor-pointer"
                    aria-label={`选择 ${item.styleNo}`}
                  />
                </td>
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

      {mergeModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[680px] max-w-[95vw] max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">合并重复款号</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={closeMergeModal}>×</button>
            </div>

            {mergeResult ? (
              <div className="p-6 flex-1 overflow-y-auto">
                <div className="rounded bg-green-50 border border-green-200 p-4 text-sm text-green-800">
                  <p className="font-medium mb-1">合并成功</p>
                  <p>批次号（runId）：<span className="font-mono">{mergeResult.runId}</span></p>
                  <p>已合并 {mergeResult.mergedCount} 个款号到保留款号（被合并方仅打标，未删除，关联业务已全部改指到保留方）。</p>
                  <p className="text-gray-500 mt-1">如需撤销，可在<Link to="/base/merge-audit" className="text-primary hover:underline" onClick={closeMergeModal}>「合并审计」页</Link>按批次号回滚。</p>
                </div>
              </div>
            ) : (
              <div className="p-5 flex-1 overflow-y-auto">
                <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                  合并后，被合并款号<strong>不会被删除</strong>，仅打上「已合并」标记，其全部关联业务
                  （SKU / BOM / 工单 / 采购明细 / 配货 / 预订单）将改指到下方选中的「保留款号」。
                  该操作可经审计日志按批次回滚。
                </div>

                <p className="text-sm text-gray-600 mb-2">请选择保留款号（survivor）：</p>
                <div className="space-y-2">
                  {selectedStyles.map((c) => {
                    const rc = relatedCountMap[c.id];
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 border rounded p-3 cursor-pointer transition-colors ${
                          survivorId === c.id ? 'border-primary bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="survivor"
                          checked={survivorId === c.id}
                          onChange={() => setSurvivorId(c.id)}
                          className="cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {c.styleNo} · {c.brand || '无品牌'}
                          </div>
                        </div>
                        <div className="text-right text-xs whitespace-nowrap">
                          <div className="text-gray-500">关联单据</div>
                          <div className="font-medium">{rc === undefined ? '—' : rc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <label className="block text-sm text-gray-700 mb-1">合并原因（可选，写入审计日志）</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="如：重复建档，保留有交易的款号"
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary resize-none"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={closeMergeModal}
                disabled={mergeLoading}
              >
                {mergeResult ? '关闭' : '取消'}
              </button>
              {!mergeResult && (
                <button
                  className="px-4 py-2 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleMergeConfirm}
                  disabled={mergeLoading || !survivorId}
                >
                  {mergeLoading ? '合并中...' : `确认合并（${selectedIds.length - (survivorId ? 1 : 0)} 个被合并）`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StylePage;
