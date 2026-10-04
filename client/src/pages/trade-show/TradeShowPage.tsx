import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import React, { useState, useEffect } from 'react';
import { tradeShowApi } from '@client/src/api';
import type { TradeShow, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { CalendarCheck, CalendarX, Lock, Plus } from 'lucide-react';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  ongoing: { label: '进行中', tone: 'ok' },
  ended: { label: '已结束', tone: 'warn' },
  closed: { label: '已关闭', tone: 'neutral' },
};

const SEASON_OPTIONS = [
  { value: 'spring', label: '春' },
  { value: 'summer', label: '夏' },
  { value: 'autumn', label: '秋' },
  { value: 'winter', label: '冬' },
];

const TradeShowPage: React.FC = () => {
  const [list, setList] = useState<TradeShow[]>([]);
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
  const [form, setForm] = useState<Partial<TradeShow>>({
    showNo: '',
    name: '',
    year: '',
    season: '',
    startDate: '',
    endDate: '',
    status: 'draft',
    remark: '',
  });
  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<TradeShow> = await tradeShowApi.list({
        page,
        pageSize,
        keyword: searchKeyword || undefined,
        status: searchStatus || undefined,
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
  }, [page, pageSize, searchKeyword, searchStatus]);

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
      showNo: '',
      name: '',
      year: '',
      season: '',
      startDate: '',
      endDate: '',
      status: 'draft',
      remark: '',
    });
    setDialogOpen(true);
  };

  const openEdit = (item: TradeShow) => {
    setEditingId(item.id);
    setForm({ ...item });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.showNo?.trim()) {
      toast('请输入订货会编号');
      return;
    }
    if (!form.name?.trim()) {
      toast('请输入订货会名称');
      return;
    }
    try {
      if (editingId) {
        await tradeShowApi.update(editingId, form);
      } else {
        await tradeShowApi.create(form);
      }
      setDialogOpen(false);
      fetchData();
      toast('保存成功');
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await showConfirm('确定要删除该订货会吗？'))) return;
    try {
      await tradeShowApi.remove(id);
      fetchData();
      toast('删除成功');
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  }
  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await tradeShowApi.void(id);
      toast('作废成功');
      fetchData();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };;

  const handleStart = async (id: string) => {
    if (!(await showConfirm('确定要开始该订货会吗？'))) return;
    try {
      await tradeShowApi.start(id);
      fetchData();
      toast('操作成功');
    } catch (e) {
      toast(errMsg(e, '操作失败'));
    }
  };

  const handleEnd = async (id: string) => {
    if (!(await showConfirm('确定要结束该订货会吗？'))) return;
    try {
      await tradeShowApi.end(id);
      fetchData();
      toast('操作成功');
    } catch (e) {
      toast(errMsg(e, '操作失败'));
    }
  };

  const handleClose = async (id: string) => {
    if (!(await showConfirm('确定要关闭该订货会吗？关闭后不可恢复。')))
      return;
    try {
      await tradeShowApi.close(id);
      fetchData();
      toast('操作成功');
    } catch (e) {
      toast(errMsg(e, '操作失败'));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const renderStatus = (status: string) => {
    const cfg = STATUS_MAP[status] || STATUS_MAP.draft;
    return (
      <StatusBadge tone={cfg.tone}>{cfg.label}</StatusBadge>
    );
  };

  return (
    <div className="p-5 bg-white rounded shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">订货会主单</h2>
          <button
            className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
            onClick={openAdd}
            data-ai-section-type="button"
          >
            <Plus size={16} />
            新增
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
          <input
            type="text"
            placeholder="搜索名称"
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
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button
            className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
            onClick={handleSearch}
            data-ai-section-type="button"
          >
            搜索
          </button>
          <button
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
            onClick={handleReset}
            data-ai-section-type="button"
          >
            重置
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 font-medium">
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  订货会编号
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  名称
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  年份
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  季节
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  开始日期
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  结束日期
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200">
                  状态
                </th>
                <th className="text-left px-4 py-3 border-b border-gray-200 w-56">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="text-center py-8 text-gray-400"
                  >
                    加载中...
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="text-center py-8 text-gray-400"
                  >
                    暂无数据
                  </td>
                </tr>
              ) : (
                list.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium">{item.showNo}</td>
                    <td className="px-4 py-3">{item.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.year || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {SEASON_OPTIONS.find((s) => s.value === item.season)
                        ?.label || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.startDate || '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.endDate || '-'}
                    </td>
                    <td className="px-4 py-3">{renderStatus(item.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.status === 'draft' && (
                          <>
                            <button
                              className="text-primary hover:text-blue-700 text-xs"
                              onClick={() => openEdit(item)}
                            >
                              编辑
                            </button>
                            <button
                              className="text-green-500 hover:text-green-700 text-xs flex items-center gap-0.5"
                              onClick={() => handleStart(item.id)}
                            >
                              <CalendarCheck size={12} />
                              开始
                            </button>
                            <button
                              className="text-red-500 hover:text-red-700 text-xs"
                              onClick={() => handleDelete(item.id)}
                            >
                              删除
                            </button>
                                                    <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
</>
                        )}
                        {item.status === 'ongoing' && (
                          <button
                            className="text-orange-500 hover:text-orange-700 text-xs flex items-center gap-0.5"
                            onClick={() => handleEnd(item.id)}
                          >
                            <CalendarX size={12} />
                            结束
                          </button>
                        )}
                        {item.status === 'ended' && (
                          <button
                            className="text-gray-500 hover:text-gray-700 text-xs flex items-center gap-0.5"
                            onClick={() => handleClose(item.id)}
                          >
                            <Lock size={12} />
                            关闭
                          </button>
                        )}
                      </div>
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
                        <option value="cancelled">已作废</option>
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
            <div className="bg-white rounded shadow-lg w-[600px] max-w-[95vw] max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
                <h3 className="text-lg font-medium">
                  {editingId ? '编辑订货会' : '新增订货会'}
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
                      订货会编号<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.showNo || ''}
                      onChange={(e) =>
                        setForm({ ...form, showNo: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      名称<span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.name || ''}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      年份
                    </label>
                    <input
                      type="text"
                      value={form.year || ''}
                      onChange={(e) =>
                        setForm({ ...form, year: e.target.value })
                      }
                      placeholder="如 2026"
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      季节
                    </label>
                    <select
                      value={form.season || ''}
                      onChange={(e) =>
                        setForm({ ...form, season: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="">请选择</option>
                      {SEASON_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      开始日期
                    </label>
                    <input
                      type="date"
                      value={form.startDate || ''}
                      onChange={(e) =>
                        setForm({ ...form, startDate: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">
                      结束日期
                    </label>
                    <input
                      type="date"
                      value={form.endDate || ''}
                      onChange={(e) =>
                        setForm({ ...form, endDate: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm text-gray-700 mb-1">
                      备注
                    </label>
                    <textarea
                      value={form.remark || ''}
                      onChange={(e) =>
                        setForm({ ...form, remark: e.target.value })
                      }
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
                  className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
                  onClick={handleSave}
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

export default TradeShowPage;
