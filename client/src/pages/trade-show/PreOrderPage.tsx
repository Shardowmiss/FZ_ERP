import React, { useState, useEffect } from 'react';
import { tradeShowApi, baseApi } from '@client/src/api';
import type { PreOrder, PaginationResult } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@lark-apaas/client-toolkit';
import { Eye, Send, Check, XCircle, Printer } from 'lucide-react';
import { PrintDialog } from '@client/src/components/print/PrintDialog';
import { SkuDocPrintContent } from '@client/src/components/print/DocPrintContent';
import type { SkuMatrixItem } from '@client/src/components/print/SkuMatrixTable';
import PreOrderDialog from './PreOrderDialog';
import { errMsg } from '@/utils/errMsg';

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: '草稿', className: 'bg-gray-100 text-gray-500' },
  submitted: { label: '已提交', className: 'bg-blue-100 text-blue-700' },
  confirmed: { label: '已确认', className: 'bg-green-100 text-green-700' },
  rejected: { label: '已驳回', className: 'bg-red-100 text-red-700' },
};

const SUBMITTER_TYPE_MAP: Record<
  string,
  { label: string; className: string }
> = {
  dealer: { label: '经销商', className: 'bg-purple-100 text-purple-700' },
  store: { label: '直营店', className: 'bg-cyan-100 text-cyan-700' },
};

const PreOrderPage: React.FC = () => {
  const [list, setList] = useState<PreOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const [tradeShowFilter, setTradeShowFilter] = useState('');
  const [submitterTypeFilter, setSubmitterTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [keyword, setKeyword] = useState('');

  const [searchTradeShow, setSearchTradeShow] = useState('');
  const [searchSubmitterType, setSearchSubmitterType] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchStyle, setSearchStyle] = useState('');
  const [searchBrand, setSearchBrand] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');

  const [tradeShowOptions, setTradeShowOptions] = useState<
    { id: string; showNo: string; name: string; status: string }[]
  >([]);
  const [styleOptions, setStyleOptions] = useState<
    { id: string; styleNo: string; name: string }[]
  >([]);
  const [brandOptions, setBrandOptions] = useState<{ attrCode: string; attrName: string }[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentItem, setCurrentItem] = useState<PreOrder | undefined>(
    undefined,
  );

  // 打印状态
  const [printOpen, setPrintOpen] = useState(false);
  const [printItems, setPrintItems] = useState<SkuMatrixItem[]>([]);
  const [printDocNo, setPrintDocNo] = useState('');
  const [printDocDate, setPrintDocDate] = useState('');
  const [printPartnerName, setPrintPartnerName] = useState('');
  const [printRemark, setPrintRemark] = useState('');
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
      const res: PaginationResult<PreOrder> =
        await tradeShowApi.preOrder.list({
          page,
          pageSize,
          tradeShowId: searchTradeShow || undefined,
          submitterType: searchSubmitterType || undefined,
          status: searchStatus || undefined,
           styleId: searchStyle || undefined,
           keyword: searchKeyword || undefined,
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
     } catch (e) {
       toast(errMsg(e, '加载品牌失败'));
     }
   };

   useEffect(() => {
     loadOptions();
     loadBrands();
   }, []);

  useEffect(() => {
    fetchData();
   }, [
     page,
     pageSize,
     searchTradeShow,
     searchSubmitterType,
     searchStatus,
     searchStyle,
     searchBrand,
     searchKeyword,
   ]);

   const handleSearch = () => {
     setPage(1);
     setSearchTradeShow(tradeShowFilter);
     setSearchSubmitterType(submitterTypeFilter);
     setSearchStatus(statusFilter);
     setSearchStyle(styleFilter);
     setSearchBrand(brandFilter);
     setSearchKeyword(keyword);
   };

   const handleReset = () => {
     setTradeShowFilter('');
     setSubmitterTypeFilter('');
     setStatusFilter('');
     setStyleFilter('');
     setBrandFilter('');
     setKeyword('');
     setPage(1);
     setSearchTradeShow('');
     setSearchSubmitterType('');
     setSearchStatus('');
     setSearchStyle('');
     setSearchBrand('');
     setSearchKeyword('');
   };

  const openAdd = () => {
    setEditingId(null);
    setViewMode(false);
    setCurrentItem(undefined);
    setDialogOpen(true);
  };

  const openEdit = (item: PreOrder) => {
    setEditingId(item.id);
    setViewMode(false);
    setCurrentItem(item);
    setDialogOpen(true);
  };

  const openView = (item: PreOrder) => {
    setEditingId(item.id);
    setViewMode(true);
    setCurrentItem(item);
    setDialogOpen(true);
  };

  const openPrint = async (item: PreOrder) => {
    try {
      const detail = await tradeShowApi.preOrder.get(item.id);
      const skuItems: SkuMatrixItem[] = (detail.items || []).map((it: any) => ({
        styleNo: detail.styleNo || '',
        styleName: detail.styleName,
        color: it.color || '',
        size: it.size || '',
        quantity: it.qty || 0,
      }));
      setPrintItems(skuItems);
      setPrintDocNo(detail.preOrderNo);
      setPrintDocDate((detail.submitDate || detail.createdAt)?.slice(0, 10) || '');
      const partnerName = detail.submitterType === 'dealer'
        ? detail.dealerName || ''
        : detail.storeName || '';
      setPrintPartnerName(partnerName);
      setPrintRemark(detail.remark || '');
      setPrintOpen(true);
    } catch (e) {
      toast(errMsg(e, '加载打印数据失败'));
    }
  };

  const handleSave = async (data: any) => {
    if (editingId) {
      await tradeShowApi.preOrder.update(editingId, data);
    } else {
      await tradeShowApi.preOrder.create(data);
    }
    setDialogOpen(false);
    fetchData();
    toast('保存成功');
  };

  const handleSubmit = async (id: string) => {
    if (!(await showConfirm('确定要提交该预订单吗？'))) return;
    try {
      await tradeShowApi.preOrder.submit(id);
      fetchData();
      toast('提交成功');
    } catch (e) {
      toast(errMsg(e, '提交失败'));
    }
  };

  const handleConfirm = async (id: string) => {
    if (!(await showConfirm('确定要确认该预订单吗？'))) return;
    try {
      await tradeShowApi.preOrder.confirm(id);
      fetchData();
      toast('确认成功');
    } catch (e) {
      toast(errMsg(e, '确认失败'));
    }
  };

  const handleReject = async (id: string) => {
    if (!(await showConfirm('确定要驳回该预订单吗？'))) return;
    try {
      await tradeShowApi.preOrder.reject(id);
      fetchData();
      toast('已驳回');
    } catch (e) {
      toast(errMsg(e, '操作失败'));
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

  const renderSubmitterType = (type: string) => {
    const cfg = SUBMITTER_TYPE_MAP[type];
    if (!cfg) return null;
    return (
      <span
        className={`inline-block px-1.5 py-0.5 text-xs rounded ${cfg.className}`}
      >
        {cfg.label}
      </span>
    );
  };

  const handleVoid = async (id: string): Promise<void> => {
    if (!await showConfirm('确定作废该单据吗？作废后不可恢复')) return;
    try {
      await tradeShowApi.preOrder.void(id);
      toast('作废成功');
      fetchData();
    } catch (e) {
      toast(errMsg(e, '作废失败'));
    }
  };

  return (
    <div className="p-5 bg-white rounded shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">预订单</h2>
        <button
          className="px-4 py-2 bg-primary text-white text-sm rounded hover:bg-blue-600 transition-colors"
          onClick={openAdd}
          data-ai-section-type="button"
        >
          新增
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
        <select
          value={tradeShowFilter}
          onChange={(e) => setTradeShowFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[180px]"
        >
          <option value="">全部订货会</option>
          {tradeShowOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.showNo} - {t.name}
            </option>
          ))}
        </select>
        <select
          value={submitterTypeFilter}
          onChange={(e) => setSubmitterTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
        >
          <option value="">全部类型</option>
          <option value="dealer">经销商</option>
          <option value="store">直营店</option>
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
         <select
           value={styleFilter}
           onChange={(e) => setStyleFilter(e.target.value)}
           className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[180px]"
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
           className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[140px]"
         >
           <option value="">全部品牌</option>
           {brandOptions.map((b: { attrCode: string; attrName: string }) => (
             <option key={b.attrCode} value={b.attrName}>{b.attrName}</option>
           ))}
         </select>
        <input
          type="text"
          placeholder="搜索单号"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded text-sm w-48 focus:outline-none focus:border-primary"
        />
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
                预订单号
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                订货会
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                提交方
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                款号
              </th>
              <th className="text-left px-4 py-3 border-b border-gray-200">
                预订总量
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
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  加载中...
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              list.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-200 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium">{item.preOrderNo}</td>
                  <td className="px-4 py-3">{item.tradeShowName}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {item.submitterType === 'dealer'
                        ? item.dealerName
                        : item.storeName}
                      {renderSubmitterType(item.submitterType)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {item.styleNo || '-'}
                  </td>
                  <td className="px-4 py-3 font-medium text-blue-600">
                    {item.totalQty}
                  </td>
                  <td className="px-4 py-3">{renderStatus(item.status)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        className="text-gray-500 hover:text-gray-700 text-xs flex items-center gap-0.5"
                        onClick={() => openView(item)}
                      >
                        <Eye size={12} />
                        明细
                      </button>
                      <button
                        className="text-primary hover:text-blue-700 text-xs flex items-center gap-0.5"
                        onClick={() => openPrint(item)}
                      >
                        <Printer size={12} />
                        打印
                      </button>
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
                            onClick={() => handleSubmit(item.id)}
                          >
                            <Send size={12} />
                            提交
                          </button>
                          <button onClick={() => handleVoid(item.id)} className="text-red-500 hover:text-red-600">作废</button>
                        </>
                      )}
                      {item.status === 'submitted' && (
                        <>
                          <button
                            className="text-green-500 hover:text-green-700 text-xs flex items-center gap-0.5"
                            onClick={() => handleConfirm(item.id)}
                          >
                            <Check size={12} />
                            确认
                          </button>
                          <button
                            className="text-red-500 hover:text-red-700 text-xs flex items-center gap-0.5"
                            onClick={() => handleReject(item.id)}
                          >
                            <XCircle size={12} />
                            驳回
                          </button>
                        </>
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

      <PreOrderDialog
        open={dialogOpen}
        viewMode={viewMode}
        editingId={editingId}
        tradeShowOptions={tradeShowOptions}
        styleOptions={styleOptions}
        initialData={currentItem}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        onPrint={() => currentItem && openPrint(currentItem)}
      />

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title="订货会预订单"
        landscape={showAllSizes || true}
        showAllSizesToggle={true}
        showAllSizes={showAllSizes}
        onShowAllSizesChange={handleShowAllSizesChange}
      >
        <SkuDocPrintContent
          docType="订货会预订单"
          docNo={printDocNo}
          docDate={printDocDate}
          partnerLabel={currentItem?.submitterType === 'dealer' ? '经销商' : '门店'}
          partnerName={printPartnerName}
          remark={printRemark}
          items={printItems}
          showAllSizes={showAllSizes}
          allSizesByStyle={allSizesByStyle}
        />
      </PrintDialog>
    </div>
  );
};

export default PreOrderPage;
