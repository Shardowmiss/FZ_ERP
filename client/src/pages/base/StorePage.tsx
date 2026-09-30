import React, { useState, useEffect } from 'react';
import { Download } from 'lucide-react';
import { baseApi } from '@client/src/api';
import type { Store, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { TableContainer, DataPagination } from '@client/src/components/ui';
import { errMsg } from '@/utils/errMsg';

interface OptionItem {
  id: string;
  code: string;
  name: string;
}

interface WarehouseOption extends OptionItem {
  type: string;
}

const StorePage: React.FC = () => {
  const [list, setList] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchType, setSearchType] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Store>>({
    code: '',
    name: '',
    storeType: 'direct',
    dealerId: '',
    warehouseId: '',
    contactPerson: '',
    phone: '',
    address: '',
    status: 'active',
    remark: '',
  });
  const [dealerOptions, setDealerOptions] = useState<OptionItem[]>([]);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<Store> = await baseApi.store.list({
        page,
        pageSize,
        keyword: searchKeyword || undefined,
        storeType: searchType || undefined,
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

  const fetchOptions = async () => {
    try {
      const [dealers, warehouses] = await Promise.all([
        baseApi.dealer.options() as Promise<OptionItem[]>,
        baseApi.warehouse.options() as Promise<WarehouseOption[]>,
      ]);
      setDealerOptions(dealers);
      setWarehouseOptions(warehouses);
    } catch (e) {
      // options load failure is non-critical
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchKeyword, searchType, searchStatus]);

  const handleSearch = () => {
    setPage(1);
    setSearchKeyword(keyword);
    setSearchType(typeFilter);
    setSearchStatus(statusFilter);
  };

  const handleReset = () => {
    setKeyword('');
    setTypeFilter('');
    setStatusFilter('');
    setPage(1);
    setSearchKeyword('');
    setSearchType('');
    setSearchStatus('');
  };

  const openAdd = () => {
    setEditingId(null);
    setForm({
      code: '',
      name: '',
      storeType: 'direct',
      dealerId: '',
      warehouseId: '',
      contactPerson: '',
      phone: '',
      address: '',
      status: 'active',
      remark: '',
    });
    fetchOptions();
    setDialogOpen(true);
  };

  const openEdit = (item: Store) => {
    setEditingId(item.id);
    setForm({ ...item });
    fetchOptions();
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.code?.trim()) { toast('请输入门店编码'); return; }
    if (!form.name?.trim()) { toast('请输入门店名称'); return; }
    if (form.storeType === 'dealer' && !form.dealerId) {
      toast('请选择所属经销商');
      return;
    }
    try {
      if (editingId) {
        await baseApi.store.update(editingId, form);
      } else {
        await baseApi.store.create(form);
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '保存失败'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm('确定要删除吗？')) return;
    try {
      await baseApi.store.remove(id);
      fetchData();
    } catch (e) {
      toast(errMsg(e, '删除失败'));
    }
  };

  const handleExport = () => {
    toast('导出功能开发中');
  };

  const renderStoreType = (type: string) => {
    if (type === 'direct') return '直营店';
    if (type === 'dealer') return '经销商门店';
    return type;
  };

  const renderStatus = (status: string) => {
    if (status === 'active') {
      return <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">营业</span>;
    }
    return <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">停业</span>;
  };

  const getDealerName = (dealerId?: string) => {
    if (!dealerId) return '-';
    const d = dealerOptions.find((o: OptionItem) => o.id === dealerId);
    return d ? d.name : '-';
  };

  const isDealerStore = form.storeType === 'dealer';

  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">门店管理</h2>
        <div className="flex items-center gap-2">
          <button
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
            onClick={handleExport}
          >
            <Download size={16} /> 导出
          </button>
          <button
            className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
            onClick={openAdd}
          >
            + 新增门店
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <input
          type="text"
          placeholder="搜索编码/名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-60 focus:outline-none focus:border-primary"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部类型</option>
          <option value="direct">直营店</option>
          <option value="dealer">经销商门店</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部状态</option>
          <option value="active">营业</option>
          <option value="inactive">停业</option>
        </select>
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
              <th className="text-left px-4 py-3 border-b border-gray-200">门店编码</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">门店名称</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">门店类型</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">所属经销商</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">联系人</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">电话</th>
              <th className="text-left px-4 py-3 border-b border-gray-200">地址</th>
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
                  <td className="px-4 py-3 text-gray-600">{renderStoreType(item.storeType)}</td>
                  <td className="px-4 py-3 text-gray-600">{getDealerName(item.dealerId)}</td>
                  <td className="px-4 py-3 text-gray-600">{item.contactPerson || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.phone || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{item.address || '-'}</td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
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
          <div className="bg-white rounded shadow-lg w-[600px] max-w-[95vw] max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">{editingId ? '编辑门店' : '新增门店'}</h3>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={() => setDialogOpen(false)}>×</button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-1">门店编码<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.code || ''}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">门店名称<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name || ''}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">门店类型<span className="text-red-500">*</span></label>
                  <select
                    value={form.storeType || 'direct'}
                    onChange={(e) => setForm({ ...form, storeType: e.target.value, dealerId: e.target.value === 'dealer' ? form.dealerId : '' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="direct">直营店</option>
                    <option value="dealer">经销商门店</option>
                  </select>
                </div>
                {isDealerStore && (
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">所属经销商<span className="text-red-500">*</span></label>
                    <select
                      value={form.dealerId || ''}
                      onChange={(e) => setForm({ ...form, dealerId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                    >
                      <option value="">请选择经销商</option>
                      {dealerOptions.map((d: OptionItem) => (
                        <option key={d.id} value={d.id}>{d.code} - {d.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm text-gray-700 mb-1">所属仓库</label>
                  <select
                    value={form.warehouseId || ''}
                    onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="">请选择仓库</option>
                    {warehouseOptions.map((w: WarehouseOption) => (
                      <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">联系人</label>
                  <input
                    type="text"
                    value={form.contactPerson || ''}
                    onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">电话</label>
                  <input
                    type="text"
                    value={form.phone || ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-700 mb-1">地址</label>
                  <input
                    type="text"
                    value={form.address || ''}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-1">状态</label>
                  <select
                    value={form.status || 'active'}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  >
                    <option value="active">营业</option>
                    <option value="inactive">停业</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm text-gray-700 mb-1">备注</label>
                  <textarea
                    value={form.remark || ''}
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

export default StorePage;
