import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { systemApi } from '@client/src/api/system';
import type { OperationLog, PaginationResult } from '@shared/api.interface';
import { TableContainer } from '@client/src/components/ui/table-container';
import { DataPagination } from '@client/src/components/ui/pagination';

const moduleOptions = [
  { value: '', label: '全部模块' },
  { value: 'base', label: '基础档案' },
  { value: 'purchase', label: '采购' },
  { value: 'sales', label: '销售' },
  { value: 'inventory', label: '库存' },
  { value: 'production', label: '生产' },
  { value: 'finance', label: '财务' },
  { value: 'system', label: '系统' },
];

const typeOptions = [
  { value: '', label: '全部类型' },
  { value: 'create', label: '新增' },
  { value: 'update', label: '编辑' },
  { value: 'delete', label: '删除' },
  { value: 'approve', label: '审核' },
  { value: 'unapprove', label: '弃审' },
];

const OperationLogPage: React.FC = () => {
  const [list, setList] = useState<OperationLog[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const [loading, setLoading] = useState<boolean>(false);

  const [filterModule, setFilterModule] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterStartDate, setFilterStartDate] = useState<string>('');
  const [filterEndDate, setFilterEndDate] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: {
        page: number;
        pageSize: number;
        module?: string;
        operationType?: string;
        userId?: string;
        startDate?: string;
        endDate?: string;
        keyword?: string;
      } = { page, pageSize };
      if (filterModule) params.module = filterModule;
      if (filterType) params.operationType = filterType;
      if (filterUser) params.userId = filterUser;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (keyword) params.keyword = keyword;
      const res: PaginationResult<OperationLog> = await systemApi.operationLog.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch {
      toast.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [page, pageSize, filterModule, filterType, filterUser, filterStartDate, filterEndDate, keyword]);

  const handlePageSizeChange = (size: number): void => {
    setPageSize(size);
    setPage(1);
  };

  const handleSearch = (): void => {
    setPage(1);
    fetchList();
  };

  const handleReset = (): void => {
    setFilterModule('');
    setFilterType('');
    setFilterUser('');
    setFilterStartDate('');
    setFilterEndDate('');
    setKeyword('');
    setPage(1);
  };

  const formatTime = (dateStr: string): string => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const getModuleLabel = (mod?: string): string => {
    if (!mod) return '-';
    const found = moduleOptions.find((m) => m.value === mod);
    return found?.label ?? mod;
  };

  const getTypeLabel = (typ?: string): string => {
    if (!typ) return '-';
    const found = typeOptions.find((t) => t.value === typ);
    return found?.label ?? typ;
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-semibold text-gray-800">操作日志</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-gray-600">操作用户：</span>
            <input
              type="text"
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              placeholder="用户名/ID"
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500 w-36"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">操作模块：</span>
            <select
              value={filterModule}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterModule(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              {moduleOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">操作类型：</span>
            <select
              value={filterType}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilterType(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            >
              {typeOptions.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-600">时间：</span>
            <input
              type="date"
              value={filterStartDate}
              onChange={(e) => setFilterStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
            <span className="text-gray-400">~</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={(e) => setFilterEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setKeyword(e.target.value)}
                placeholder="搜索操作对象/内容"
                className="border border-gray-300 rounded pl-7 pr-2 py-1 text-sm focus:outline-none focus:border-blue-500 w-48"
              />
            </div>
          </div>
          <button
            onClick={handleSearch}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
          >
            <Search size={14} /> 查询
          </button>
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            重置
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-5">
        <TableContainer>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-600 bg-gray-50">
                <th className="text-left py-2.5 px-4 font-medium w-44">操作时间</th>
                <th className="text-left py-2.5 px-4 font-medium w-28">操作用户</th>
                <th className="text-left py-2.5 px-4 font-medium w-24">操作模块</th>
                <th className="text-left py-2.5 px-4 font-medium w-20">操作类型</th>
                <th className="text-left py-2.5 px-4 font-medium w-40">操作对象</th>
                <th className="text-left py-2.5 px-4 font-medium">操作内容摘要</th>
                <th className="text-left py-2.5 px-4 font-medium w-32">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">加载中...</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-gray-400">暂无数据</td></tr>
              ) : (
                list.map((item: OperationLog) => (
                  <tr key={item.id} className="border-b border-gray-100 h-10 hover:bg-gray-50">
                    <td className="py-2 px-4 text-gray-500 whitespace-nowrap">{formatTime(item.operationTime)}</td>
                    <td className="py-2 px-4 text-gray-800">{item.userName ?? item.userId ?? '-'}</td>
                    <td className="py-2 px-4 text-gray-600">{getModuleLabel(item.module)}</td>
                    <td className="py-2 px-4">
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600">
                        {getTypeLabel(item.operationType)}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-gray-700 truncate max-w-[160px]" title={item.objectName ?? ''}>
                      {item.objectName ?? '-'}
                    </td>
                    <td className="py-2 px-4 text-gray-600 truncate max-w-[360px]" title={item.summary ?? ''}>
                      {item.summary ?? '-'}
                    </td>
                    <td className="py-2 px-4 text-gray-500 font-mono text-xs">{item.ip ?? '-'}</td>
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
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </div>
  );
};

export default OperationLogPage;
