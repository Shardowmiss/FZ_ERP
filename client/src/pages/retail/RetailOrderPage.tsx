import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';
import { useNavigate } from 'react-router-dom';
import { retailApi } from '@client/src/api/retail';
import { baseApi } from '@client/src/api/base';
import type {
  RetailOrder,
  RetailOrderItem,
  PaginationResult,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import {
  Plus, Search, Printer,
} from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '草稿', tone: 'neutral' },
  settled: { label: '已结算', tone: 'ok' },
  returned: { label: '已退货', tone: 'danger' },
  cancelled: { label: '已作废', tone: 'danger' },
};

const SOURCE_MAP: Record<string, string> = {
  store_pos: '门店POS',
  hq_manual: '总部代开',
  mini_program: '小程序商城',
};

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

export default function RetailOrderPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<RetailOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [filterStoreId, setFilterStoreId] = useState('');
  const def = useDefaultDocDate();
  const [filterStartDate, setFilterStartDate] = useState(def.startDate);
  const [filterEndDate, setFilterEndDate] = useState(def.endDate);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);

  // 打印状态
  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printTotalAmount, setPrintTotalAmount] = useState<number | undefined>(undefined);
  const [printRemark, setPrintRemark] = useState('');
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

  const totalPages = Math.ceil(total / pageSize);

  const fetchList = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        pageSize,
      };
      if (filterStoreId) params.storeId = filterStoreId;
      if (filterStartDate) params.startDate = filterStartDate;
      if (filterEndDate) params.endDate = filterEndDate;
      if (filterStatus) params.status = filterStatus;
      if (filterKeyword) params.keyword = filterKeyword;
      const res: PaginationResult<RetailOrder> = await retailApi.list(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载零售单列表失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleVoid = async (id: string): Promise<void> => {
    if (!(await showConfirm('确定作废该单据吗？作废后不可恢复'))) return;
    try {
      await retailApi.void(id);
      toast.success('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };

  useEffect(() => {
    const loadStores = async (): Promise<void> => {
      try {
        const res = await baseApi.store.options();
        setStoreOptions(res as StoreOption[]);
      } catch (e) { logger.error('加载门店失败', e); }
    };
    loadStores();
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const loadAllSizesByStyle = async (styleNos: string[]): Promise<Record<string, string[]>> => {
    const result: Record<string, string[]> = {};
    try {
      const allStylesRes = await baseApi.style.list({ page: 1, pageSize: 1000 });
      const sizeGroupMap = new Map<string, string>();
      for (const s of allStylesRes.items) {
        if (styleNos.includes(s.styleNo)) {
          sizeGroupMap.set(s.styleNo, s.sizeGroupId);
        }
      }
      const sizeGroupIds = Array.from(new Set(sizeGroupMap.values()));
      const sizesByGroup: Record<string, string[]> = {};
      for (const gid of sizeGroupIds) {
        try {
          const sg = await baseApi.sizeGroup.get(gid);
          sizesByGroup[gid] = sg.sizes;
        } catch (e) {
          sizesByGroup[gid] = [];
        }
      }
      for (const [styleNo, gid] of sizeGroupMap.entries()) {
        result[styleNo] = sizesByGroup[gid] || [];
      }
    } catch (e) {
      // 失败则返回空
    }
    return result;
  };

  const handleShowAllSizesChange = async (checked: boolean) => {
    setShowAllSizes(checked);
    if (checked) {
      const styleNos = Array.from(new Set(printItems.map((it: SkuMatrixItem) => it.styleNo)));
      const sizes = await loadAllSizesByStyle(styleNos);
      setAllSizesByStyle(sizes);
    } else {
      setAllSizesByStyle({});
    }
  };

  const handleSearch = (): void => {
    setPage(1);
    fetchList();
  };

  const handleReset = (): void => {
    setFilterStoreId('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterStatus('');
    setFilterKeyword('');
    setPage(1);
    setTimeout(fetchList, 0);
  };

  const openCreate = (): void => {
    navigate('/retail/order/new');
  };

  const openView = (id: string): void => {
    navigate(`/retail/order/${id}/edit?mode=view`);
  };

  const openSettle = (id: string): void => {
    navigate(`/retail/order/${id}/edit?mode=settle`);
  };

  const openReturn = (id: string): void => {
    navigate(`/retail/return?fromOrder=${id}`);
  };

  const openPrint = async (item: RetailOrder): Promise<void> => {
    try {
      const detail: RetailOrder = await retailApi.get(item.id);
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: RetailOrderItem) => ({
        styleNo: it.styleNo,
        color: it.color || '',
        size: it.size || '',
        quantity: it.quantity,
      }));
      setPrintItems(skuItems);
      setPrintDocNo(detail.retailNo);
      setPrintDocDate(detail.saleDate?.slice(0, 10) || '');
      setPrintPartnerName(detail.storeName);
      setPrintTotalAmount(detail.totalAmount);
      setPrintRemark(detail.remark || '');
      setPrintOpen(true);
    } catch (e) {
      logger.error('加载打印数据失败', e);
      toast(errMsg(e, '加载打印数据失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">零售单</h1>
        <button
          onClick={openCreate}
          className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-primary flex items-center gap-2"
        >
          <Plus size={16} />
          新增零售单
        </button>
      </div>

      <div className="bg-white rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">门店</label>
          <select
            value={filterStoreId}
            onChange={(e) => setFilterStoreId(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
          >
            <option value="">全部</option>
            {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">开始日期</label>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">结束日期</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">状态</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
          >
            <option value="">全部</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">关键字</label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              placeholder="零售单号"
              className="border border-gray-300 rounded pl-7 pr-3 py-1.5 text-sm w-44"
            />
          </div>
        </div>
        <button
          onClick={handleSearch}
          className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-primary"
        >查询</button>
        <button
          onClick={handleReset}
          className="bg-gray-100 text-gray-600 px-4 py-1.5 rounded text-sm hover:bg-gray-200"
        >重置</button>
      </div>

      <div className="bg-white rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">零售单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">门店</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">销售日期</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">来源</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">商品数</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">总金额</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">应收</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">实收</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: RetailOrder) => {
              const st = STATUS_MAP[item.status] || { label: item.status, tone: 'neutral' };
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4 font-medium">{item.retailNo}</td>
                  <td className="px-4">{item.storeName}</td>
                  <td className="px-4">{item.saleDate?.slice(0, 10) || item.createdAt?.slice(0, 10)}</td>
                  <td className="px-4">{SOURCE_MAP[item.source] || item.source}</td>
                  <td className="px-4">{item.itemCount}</td>
                  <td className="px-4 text-right">¥{item.totalAmount?.toFixed(2)}</td>
                  <td className="px-4 text-right">¥{item.receivableAmount?.toFixed(2)}</td>
                  <td className="px-4 text-right">¥{item.receivedAmount?.toFixed(2)}</td>
                  <td className="px-4">
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </td>
                  <td className="px-4 space-x-2">
                    <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                    <button onClick={() => openPrint(item)} className="text-gray-500 hover:underline inline-flex items-center gap-0.5">
                      <Printer size={12} />打印
                    </button>
                    {item.status === 'draft' && (
                      <button onClick={() => openSettle(item.id)} className="text-green-500 hover:underline">结算</button>
                    )}
                    {item.status === 'draft' && (
                      <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:underline">作废</button>
                    )}
                    {item.status === 'settled' && (
                      <button onClick={() => openReturn(item.id)} className="text-amber-600 hover:underline">退货</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
          <span className="text-sm text-gray-500">共 {total} 条</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
            >上一页</button>
            <span className="text-sm">{page} / {totalPages || 1}</span>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 border border-gray-300 rounded text-sm disabled:opacity-50"
            >下一页</button>
          </div>
        </div>
      </div>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="零售单"
        landscape={showAllSizes || true}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="零售单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel="门店"
          partnerName={printPartnerName}
          totalAmount={printTotalAmount}
          remark={printRemark}
          items={printItems}
          showAllSizes={showAllSizes}
          allSizesByStyle={allSizesByStyle}
        />
      </PrintDialog>
    </div>
  );
}
