import { StatusBadge } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { baseApi } from '@client/src/api';
import type { Sku, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';

const SkuPage: React.FC = () => {
  const [list, setList] = useState<Sku[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [searchColor, setSearchColor] = useState('');
  const [sizeFilter, setSizeFilter] = useState('');
  const [searchSize, setSearchSize] = useState('');
  const [styleOptions, setStyleOptions] = useState<{ id: string; styleNo: string; name: string }[]>([]);
  const [colorOptions, setColorOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [sizeOptions, setSizeOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [styleFilter, setStyleFilter] = useState('');
  const [searchStyleId, setSearchStyleId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Sku>>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<Sku> = await baseApi.sku.list({
        page,
        pageSize,
        keyword: searchKeyword || undefined,
        styleId: searchStyleId || undefined,
        color: searchColor || undefined,
        size: searchSize || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const fetchStyleOptions = async () => {
    try {
      const res = await baseApi.style.options();
      setStyleOptions(res);
    } catch (e) {
      // non-critical
    }
  };

  // M7（B.1 颜色尺码双轨统一）：颜色/尺码筛选改用主数据下拉，避免自由串输入
  const fetchColorOptions = async () => {
    try {
      const res = await baseApi.color.options();
      setColorOptions(res);
    } catch (e) {
      // non-critical
    }
  };
  const fetchSizeOptions = async () => {
    try {
      const res = await baseApi.size.options();
      setSizeOptions(res);
    } catch (e) {
      // non-critical
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword, searchStyleId, searchColor, searchSize]);

  useEffect(() => {
    fetchStyleOptions();
    fetchColorOptions();
    fetchSizeOptions();
  }, []);

  const handleSearch = () => {
    setPage(1);
    setSearchKeyword(keyword);
    setSearchStyleId(styleFilter);
    setSearchColor(colorFilter);
    setSearchSize(sizeFilter);
  };

  const handleReset = () => {
    setKeyword('');
    setStyleFilter('');
    setColorFilter('');
    setSizeFilter('');
    setPage(1);
    setSearchKeyword('');
    setSearchStyleId('');
    setSearchColor('');
    setSearchSize('');
  };

  const openEdit = (item: Sku) => {
    setEditingId(item.id);
    setForm({ ...item });
    setDialogOpen(true);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSave = async () => {
    if (submitting) return;
    if (!editingId) return;
    setSubmitting(true);
    try {
      await baseApi.sku.update(editingId, form);
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleExport = () => {
    toast('导出功能开发中');
  };

  // 按款号的「色组 × 尺码组」笛卡尔积批量生成 SKU 矩阵（幂等：重复点击不会产生重复 SKU）
  const [matrixStyleId, setMatrixStyleId] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerateMatrix = async () => {
    if (!matrixStyleId) {
      toast('请先选择要生成矩阵的款号');
      return;
    }
    if (generating) return;
    setGenerating(true);
    try {
      const res = await baseApi.sku.generateMatrix(matrixStyleId);
      if (res.inserted > 0) {
        toast.success(
          `款号 ${res.styleNo}：${res.colors} 色 × ${res.sizes} 码 = ${res.total} 个 SKU，已新增 ${res.inserted} 个` +
            (res.skipped > 0 ? `，跳过已存在 ${res.skipped} 个` : ''),
        );
      } else {
        toast.info(
          `款号 ${res.styleNo}：矩阵已完整（${res.total} 个），本次无需新增` +
            (res.skipped > 0 ? `，跳过 ${res.skipped} 个` : ''),
        );
      }
      setPage(1);
      setStyleFilter(matrixStyleId);
      setSearchStyleId(matrixStyleId);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '生成 SKU 矩阵失败'));
    } finally {
      setGenerating(false);
    }
  };

  const renderStatus = (status: string) => {
    if (status === 'active') {
      return <StatusBadge tone="ok">启用</StatusBadge>;
    }
    return <StatusBadge tone="neutral">停用</StatusBadge>;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">SKU管理</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">SKU由款号的色组×尺码组批量生成，生成后可编辑</span>
          <select
            value={matrixStyleId}
            onChange={(e) => setMatrixStyleId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[180px]"
          >
            <option value="">选择款号…</option>
            {styleOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
            ))}
          </select>
          <button
            className="px-4 py-2 bg-primary text-white text-sm rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            onClick={handleGenerateMatrix}
            disabled={generating}
          >
            {generating ? '生成中…' : '生成矩阵'}
          </button>
          <button
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
            onClick={handleExport}
          >
            <Download size={16} /> 导出
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <input
          type="text"
          placeholder="搜索SKU编码"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-primary"
        />
        <select
          value={styleFilter}
          onChange={(e) => setStyleFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[160px]"
        >
          <option value="">全部款号</option>
          {styleOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
          ))}
        </select>
        <select
          value={colorFilter}
          onChange={(e) => setColorFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[120px]"
        >
          <option value="">全部颜色</option>
          {colorOptions.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <select
          value={sizeFilter}
          onChange={(e) => setSizeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[100px]"
        >
          <option value="">全部尺码</option>
          {sizeOptions.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
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
              <th className="text-left px-4 py-3 border-b border-gray-200">SKU编码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">款号</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">颜色</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">尺码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">条码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">成本价</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">吊牌价</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">供货价</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">安全库存下限</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">安全库存上限</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">状态</th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} className="text-center py-8 text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-8 text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((item) => (
                <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{item.skuCode}</td>
                  <td className="px-4 py-3">{item.styleNo}</td>
                  <td className="px-4 py-3">{item.color}</td>
                  <td className="px-4 py-3">{item.size}</td>
                  <td className="px-4 py-3 text-gray-600">{item.barcode || '-'}</td>
                  <td className="px-4 py-3">¥{item.costPrice?.toFixed(2)}</td>
                  <td className="px-4 py-3">¥{item.tagPrice?.toFixed(2)}</td>
                  <td className="px-4 py-3">¥{item.supplyPrice?.toFixed(2)}</td>
                  <td className="px-4 py-3">{item.safetyStockMin?.toFixed(3)}</td>
                  <td className="px-4 py-3">{item.safetyStockMax?.toFixed(3)}</td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
                  <td className="px-4 py-3">
                    <button className="text-primary hover:text-primary/90" onClick={() => openEdit(item)}>编辑</button>
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
          <div className="bg-white rounded shadow-lg w-[480px] max-w-[95vw] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">编辑SKU</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={() => setDialogOpen(false)}>×</button>
            </div>
            <div className="p-5">
               <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="block text-sm text-gray-700 mb-1">SKU编码</label>
                   <input
                     type="text"
                     value={form.skuCode || ''}
                     disabled
                     className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                   />
                 </div>
                 <div>
                   <label className="block text-sm text-gray-700 mb-1">条码</label>
                   <input
                     type="text"
                     value={form.barcode || ''}
                     onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                     className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                   />
                 </div>
                 <div>
                   <label className="block text-sm text-gray-700 mb-1">颜色</label>
                   <input
                     type="text"
                     value={form.color || ''}
                     disabled
                     className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                   />
                 </div>
                 <div>
                   <label className="block text-sm text-gray-700 mb-1">尺码</label>
                   <input
                     type="text"
                     value={form.size || ''}
                     disabled
                     className="w-full px-3 py-2 border border-gray-300 rounded text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                   />
                 </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">成本价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.costPrice ?? ''}
                    onChange={(e) => setForm({ ...form, costPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">吊牌价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.tagPrice ?? ''}
                    onChange={(e) => setForm({ ...form, tagPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">供货价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.supplyPrice ?? ''}
                    onChange={(e) => setForm({ ...form, supplyPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">安全库存下限</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.safetyStockMin ?? ''}
                    onChange={(e) => setForm({ ...form, safetyStockMin: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">安全库存上限</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.safetyStockMax ?? ''}
                    onChange={(e) => setForm({ ...form, safetyStockMax: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-700 mb-1">状态</label>
                  <select
                    value={form.status || 'active'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="active">启用</option>
                    <option value="inactive">停用</option>
                  </select>
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

export default SkuPage;
