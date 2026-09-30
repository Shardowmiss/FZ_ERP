import React, { useState, useEffect } from 'react';
import { tradeShowApi, baseApi } from '@client/src/api';
import type { AllocationOrder, AllocationItem, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { Eye, Check, Plus, Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import AllocationDetailDialog from './AllocationDetailDialog';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-500' },
  approved: { label: '已审核', className: 'bg-green-100 text-green-700' },
};

const AllocationPage: React.FC = () => {
  const [list, setList] = useState<AllocationOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [tradeShowFilter, setTradeShowFilter] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [searchTradeShow, setSearchTradeShow] = useState('');
  const [searchStyle, setSearchStyle] = useState('');
  const [searchBrand, setSearchBrand] = useState('');
  const [searchStatus, setSearchStatus] = useState('');

  const [tradeShowOptions, setTradeShowOptions] = useState<
    { id: string; showNo: string; name: string; status: string }[]
  >([]);
  const [styleOptions, setStyleOptions] = useState<
    { id: string; styleNo: string; name: string }[]
  >([]);
  const [brandOptions, setBrandOptions] = useState<{ attrCode: string; attrName: string }[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createTradeShowId, setCreateTradeShowId] = useState('');
  const [createStyleId, setCreateStyleId] = useState('');
  const [createTotalQty, setCreateTotalQty] = useState<number>(0);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<AllocationOrder | null>(
    null,
  );

  // 打印状态
  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [allSizesByStyle, setAllSizesByStyle] = useState<Record<string, string[]>>({});

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const res: PaginationResult<AllocationOrder> =
        await tradeShowApi.allocation.list({
          page,
          pageSize,
           tradeShowId: searchTradeShow || undefined,
           styleId: searchStyle || undefined,
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

  const loadOptions = async () => {
    try {
      const [ts, st] = await Promise.all([
        tradeShowApi.options(),
        baseApi.style.options(),
      ]);
      setTradeShowOptions(ts);
      setStyleOptions(st);
    } catch (e) {
      toast(errMsg(e, '加载选项失败'));
    }
  };

  const loadBrands = async () => {
    try {
      const res = await baseApi.styleAttribute.getAll('brand', true);
      setBrandOptions(res.map((b: any) => ({ attrCode: b.attrCode, attrName: b.attrName })));
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    loadOptions();
    loadBrands();
  }, []);

  useEffect(() => {
    fetchData();
  }, [page, pageSize, searchTradeShow, searchStyle, searchBrand, searchStatus]);

  const handleSearch = () => {
    setPage(1);
    setSearchTradeShow(tradeShowFilter);
    setSearchStyle(styleFilter);
    setSearchBrand(brandFilter);
    setSearchStatus(statusFilter);
  };

  const handleReset = () => {
    setTradeShowFilter('');
    setStyleFilter('');
    setBrandFilter('');
    setStatusFilter('');
    setPage(1);
    setSearchTradeShow('');
    setSearchStyle('');
    setSearchBrand('');
    setSearchStatus('');
  };

  const openCreate = () => {
    setCreateTradeShowId('');
    setCreateStyleId('');
    setCreateTotalQty(0);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!createTradeShowId) {
      toast('请选择订货会');
      return;
    }
    if (!createStyleId) {
      toast('请选择款号');
      return;
    }
    if (!createTotalQty || createTotalQty <= 0) {
      toast('请输入有效的总到货数量');
      return;
    }
    try {
      await tradeShowApi.allocation.create({
        tradeShowId: createTradeShowId,
        styleId: createStyleId,
        totalArrivedQty: createTotalQty,
      });
      setCreateOpen(false);
      fetchData();
      toast('创建成功，已自动生成配货明细');
    } catch (e) {
      toast(errMsg(e, '创建失败'));
    }
  };

  const openDetail = (item: AllocationOrder) => {
    setDetailOrder(item);
    setDetailOpen(true);
  };

  const openPrint = async (item: AllocationOrder) => {
    try {
      const detail = await tradeShowApi.allocation.get(item.id);
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: AllocationItem) => ({
        styleNo: detail.styleNo || '',
        styleName: detail.styleName,
        color: it.color || '',
        size: it.size || '',
        quantity: it.allocatedQty || 0,
      }));
      setPrintItems(skuItems);
      setPrintDocNo(detail.allocationNo);
      setPrintOpen(true);
    } catch (e) {
      toast(errMsg(e, '加载打印数据失败'));
    }
  };

  const handleApprove = async (id: string) => {
    if (
      !(await showConfirm(
        '确定要审核该配货单吗？审核后将生成下游单据，不可修改。',
      ))
    )
      return;
    try {
      await tradeShowApi.allocation.approve(id);
      fetchData();
      toast('审核成功，已生成下游单据');
    } catch (e) {
      toast(errMsg(e, '审核失败'));
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const renderStatus = (status: string) => {
    const cfg = STATUS_MAP[status] || STATUS_MAP.draft;
    return (
      <span
        className={`inline-block px-2 py-0.5 text-xs rounded ${cfg.className}`}
      >
        {cfg.label}
      </span>
    );
  };

  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await tradeShowApi.allocation.void(id);
      toast('作废成功');
      fetchData();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };

  return (
    <div className="p-5 bg-white rounded shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">配货管理</h2>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
          onClick={openCreate}
          data-ai-section-type="button"
        >
          <Plus size={16} />
          新建配货单
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <select
          value={tradeShowFilter}
          onChange={(e) => setTradeShowFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[200px]"
        >
          <option value="">全部订货会</option>
          {tradeShowOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.showNo} - {t.name}
            </option>
          ))}
        </select>
         <select
           value={styleFilter}
           onChange={(e) => setStyleFilter(e.target.value)}
           className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[200px]"
         >
           <option value="">全部款号</option>
           {styleOptions.map((s) => (
             <option key={s.id} value={s.id}>
               {s.styleNo} - {s.name}
             </option>
           ))}
         </select>
         <select
           value={brandFilter}
           onChange={(e) => setBrandFilter(e.target.value)}
           className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[160px]"
         >
           <option value="">全部品牌</option>
           {brandOptions.map((b: { attrCode: string; attrName: string }) => (
             <option key={b.attrCode} value={b.attrName}>{b.attrName}</option>
           ))}
         </select>
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
                配货单号
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                订货会
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                款号
              </th>
              <th className="text-right px-4 py-3 border-b border-gray-200">
                总到货量
              </th>
              <th className="text-right px-4 py-3 border-b border-gray-200">
                已分配量
              </th>
              <th className="text-right px-4 py-3 border-b border-gray-200">
                剩余可分配
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                状态
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200 w-40">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item) => {
                const remaining =
                  item.totalArrivedQty - item.totalAllocatedQty;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-gray-200 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-medium">
                      {item.allocationNo}
                    </td>
                    <td className="px-4 py-3">{item.tradeShowName}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.styleNo} - {item.styleName}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {item.totalArrivedQty}
                    </td>
                    <td className="px-4 py-3 text-right text-green-600 font-medium">
                      {item.totalAllocatedQty}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {remaining}
                    </td>
                    <td className="px-4 py-3">{renderStatus(item.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          className="text-primary hover:text-blue-700 text-xs flex items-center gap-0.5"
                          onClick={() => openDetail(item)}
                        >
                          <Eye size={12} />
                          明细
                        </button>
                        <button
                          className="text-gray-500 hover:text-gray-700 text-xs flex items-center gap-0.5"
                          onClick={() => openPrint(item)}
                        >
                          <Printer size={12} />
                          打印
                        </button>
                        {item.status === 'draft' && (
                          <>
                            <button
                              className="text-green-500 hover:text-green-700 text-xs flex items-center gap-0.5"
                              onClick={() => handleApprove(item.id)}
                            >
                              <Check size={12} />
                              审核
                            </button>
                            <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
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

      {/* 新建弹窗 */}
      {createOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded shadow-lg w-[500px] max-w-[95vw]">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">新建配货单</h3>
              <button
                className="text-gray-400 hover:text-gray-600 text-xl"
                onClick={() => setCreateOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-1">
                  订货会<span className="text-red-500">*</span>
                </label>
                <select
                  value={createTradeShowId}
                  onChange={(e) => setCreateTradeShowId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                >
                  <option value="">请选择订货会</option>
                  {tradeShowOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.showNo} - {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">
                  款号<span className="text-red-500">*</span>
                </label>
                <select
                  value={createStyleId}
                  onChange={(e) => setCreateStyleId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                >
                  <option value="">请选择款号</option>
                  {styleOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.styleNo} - {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-1">
                  总到货数量<span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={createTotalQty}
                  onChange={(e) =>
                    setCreateTotalQty(Number(e.target.value) || 0)
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
                  placeholder="请输入总到货数量"
                />
              </div>
              <div className="text-xs text-gray-500 bg-blue-50 p-3 rounded">
                提示：创建后将自动拉取该款号的所有已确认预订单，生成配货明细。
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-200">
              <button
                className="px-4 py-2 bg-gray-100 text-gray-700 text-sm rounded hover:bg-gray-200 transition-colors"
                onClick={() => setCreateOpen(false)}
              >
                取消
              </button>
              <button
                className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
                onClick={handleCreate}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <AllocationDetailDialog
        open={detailOpen}
        order={detailOrder}
        onClose={() => setDetailOpen(false)}
        onSaved={fetchData}
        onApproved={fetchData}
        onPrint={() => detailOrder && openPrint(detailOrder)}
      />

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="配货单"
        landscape={showAllSizes || true}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="配货单"
          docNo={printDocNo}
          docDate=""
          items={printItems}
          showAllSizes={showAllSizes}
          allSizesByStyle={allSizesByStyle}
        />
      </PrintDialog>
    </div>
  );
};

export default AllocationPage;
