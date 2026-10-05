import { StatusBadge, type StatusTone } from '@client/src/components/ui/status-badge';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { retailApi } from '@client/src/api/retail';
import { baseApi } from '@client/src/api/base';
import type {
  RetailReturn,
  PaginationResult,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { Plus, Search, Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import { errMsg } from '@/utils/errMsg';
import { useDefaultDocDate } from '@client/src/hooks/useDefaultDocDate';

const RETURN_STATUS_MAP: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: '待退款', tone: 'warn' },
  refunded: { label: '已退款', tone: 'ok' },
  cancelled: { label: '已取消', tone: 'neutral' },
};

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

export default function RetailReturnPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromOrderId = searchParams.get('fromOrder') || '';

  const [list, setList] = useState<RetailReturn[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  const [filterStoreId, setFilterStoreId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');

  // 单据默认查询窗口（近 N 天，来自系统参数 defaultDocQueryDays）
  const { startDate: defaultDocStart, endDate: defaultDocEnd } = useDefaultDocDate();
  const [filterDocStart, setFilterDocStart] = useState(defaultDocStart);
  const [filterDocEnd, setFilterDocEnd] = useState(defaultDocEnd);
  const [filterReturnStart, setFilterReturnStart] = useState('');
  const [filterReturnEnd, setFilterReturnEnd] = useState('');

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
      if (filterStatus) params.status = filterStatus;
      if (filterKeyword) params.keyword = filterKeyword;
      if (filterDocStart) params.docStartDate = filterDocStart;
      if (filterDocEnd) params.docEndDate = filterDocEnd;
      if (filterReturnStart) params.startDate = filterReturnStart;
      if (filterReturnEnd) params.endDate = filterReturnEnd;
      const res: PaginationResult<RetailReturn> = await retailApi.returnList(params);
      setList(res.items);
      setTotal(res.total);
    } catch (e) {
      logger.error('加载退货单列表失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
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
    // If fromOrder is set, auto-open the create page
    if (fromOrderId) {
      navigate(`/retail/return/new?fromOrder=${fromOrderId}`, { replace: true });
    }
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
    setFilterStatus('');
    setFilterKeyword('');
    setFilterDocStart(defaultDocStart);
    setFilterDocEnd(defaultDocEnd);
    setFilterReturnStart('');
    setFilterReturnEnd('');
    setPage(1);
    setTimeout(fetchList, 0);
  };

  const openCreate = (): void => {
    navigate('/retail/return/new');
  };

  const openView = (id: string): void => {
    navigate(`/retail/return/${id}/edit?view=1`);
  };

  const openPrint = async (item: RetailReturn): Promise<void> => {
    try {
      const detail: RetailReturn = await retailApi.returnGet(item.id);
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: any) => ({
        styleNo: it.skuCode,
        color: it.color || '',
        size: it.size || '',
        quantity: it.quantity,
      }));
      setPrintItems(skuItems);
      setPrintDocNo(detail.returnNo);
      setPrintDocDate(detail.returnDate?.slice(0, 10) || '');
      setPrintPartnerName(detail.storeName);
      setPrintTotalAmount(detail.totalAmount);
      setPrintRemark(detail.remark || '');
      setPrintOpen(true);
    } catch (e) {
      logger.error('加载打印数据失败', e);
      toast(errMsg(e, '加载打印数据失败'));
    }
  };

  const handleRefund = async (id: string): Promise<void> => {
    if (!await showConfirm('确认退款？退款后退货单状态变为已退款。')) return;
    try {
      await retailApi.returnRefund(id);
      toast('退款成功');
      fetchList();
    } catch (e) {
      logger.error('退款失败', e);
      toast(errMsg(e, '退款失败'));
    }
  };

  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await retailApi.returnVoid(id);
      toast('作废成功');
      fetchList();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">零售退货单</h1>
        <button
          onClick={openCreate}
          className="bg-primary text-white px-4 py-2 rounded text-sm hover:bg-primary flex items-center gap-2"
        >
          <Plus size={16} />
          新增退货
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
          <label className="text-xs text-gray-500 mb-1">状态</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
          >
            <option value="">全部</option>
            {Object.entries(RETURN_STATUS_MAP).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">单据日期</label>
          <div className="flex items-center gap-1">
            <input type="date" value={filterDocStart} onChange={(e) => setFilterDocStart(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            <span className="text-gray-400">至</span>
            <input type="date" value={filterDocEnd} onChange={(e) => setFilterDocEnd(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">退货日期</label>
          <div className="flex items-center gap-1">
            <input type="date" value={filterReturnStart} onChange={(e) => setFilterReturnStart(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
            <span className="text-gray-400">至</span>
            <input type="date" value={filterReturnEnd} onChange={(e) => setFilterReturnEnd(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm" />
          </div>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-500 mb-1">关键字</label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              placeholder="退货单号/原单号"
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
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">退货单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">原零售单号</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">门店</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">退货日期</th>
              <th className="text-right px-4 py-2.5 font-medium text-gray-600">退款金额</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">状态</th>
              <th className="text-left px-4 py-2.5 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="text-center py-8 text-gray-400">加载中...</td></tr>}
            {!loading && list.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">暂无数据</td></tr>}
            {!loading && list.map((item: RetailReturn) => {
              const st = RETURN_STATUS_MAP[item.status] || { label: item.status, tone: 'neutral' };
              return (
                <tr key={item.id} className="border-b border-gray-100 hover:bg-gray-50 h-10">
                  <td className="px-4 font-medium">{item.returnNo}</td>
                  <td className="px-4">{item.originalRetailNo}</td>
                  <td className="px-4">{item.storeName}</td>
                  <td className="px-4">{item.returnDate?.slice(0, 10) || item.createdAt?.slice(0, 10)}</td>
                  <td className="px-4 text-right text-red-600">-¥{item.totalAmount?.toFixed(2)}</td>
                  <td className="px-4">
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </td>
                  <td className="px-4 space-x-2">
                    <button onClick={() => openView(item.id)} className="text-primary hover:underline">查看</button>
                    <button onClick={() => openPrint(item)} className="text-gray-500 hover:underline inline-flex items-center gap-0.5">
                      <Printer size={12} />打印
                    </button>
                    {item.status === 'draft' && (
                      <>
                        <button onClick={() => handleRefund(item.id)} className="text-green-500 hover:underline">审核退款</button>
                        <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:underline">作废</button>
                      </>
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
        title="零售退货单"
        landscape={showAllSizes || true}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="零售退货单"
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
