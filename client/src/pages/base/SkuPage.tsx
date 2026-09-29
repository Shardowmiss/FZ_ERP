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
      toast('加载失败');
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

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword, searchStyleId, searchColor, searchSize]);

  useEffect(() => {
    fetchStyleOptions();
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

  const renderStatus = (status: string) => {
    if (status === 'active') {
      return <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">启用</span>;
    }
    return <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">停用</span>;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">SKU管理</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">SKU由款号自动生成，仅支持编辑</span>
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
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-blue-500"
        />
        <select
          value={styleFilter}
          onChange={(e) => setStyleFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 min-w-[160px]"
        >
          <option value="">全部款号</option>
          {styleOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.styleNo} - {s.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="颜色"
          value={colorFilter}
          onChange={(e) => setColorFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-28 focus:outline-none focus:border-blue-500"
        />
        <input
          type="text"
          placeholder="尺码"
          value={sizeFilter}
          onChange={(e) => setSizeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-24 focus:outline-none focus:border-blue-500"
        />
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
                    <button className="text-blue-500 hover:text-blue-700" onClick={() => openEdit(item)}>编辑</button>
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
                     className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">吊牌价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.tagPrice ?? ''}
                    onChange={(e) => setForm({ ...form, tagPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">供货价</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.supplyPrice ?? ''}
                    onChange={(e) => setForm({ ...form, supplyPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">安全库存下限</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.safetyStockMin ?? ''}
                    onChange={(e) => setForm({ ...form, safetyStockMin: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">安全库存上限</label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.safetyStockMax ?? ''}
                    onChange={(e) => setForm({ ...form, safetyStockMax: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="col-span-2">
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

export default SkuPage;
