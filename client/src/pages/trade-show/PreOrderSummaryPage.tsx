import React, { useState, useEffect, useMemo } from 'react';
import { tradeShowApi, baseApi } from '@client/src/api';
import type {
  PreOrderSummary,
  PreOrderSkuSummary,
  PreOrderSkuSummaryItem,
} from '@shared/api.interface';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { errMsg } from '@/utils/errMsg';

const PreOrderSummaryPage: React.FC = () => {
  const [tradeShowOptions, setTradeShowOptions] = useState<
    { id: string; showNo: string; name: string; status: string }[]
  >([]);
  const [selectedTradeShow, setSelectedTradeShow] = useState('');
  const [summaryList, setSummaryList] = useState<PreOrderSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedStyleId, setExpandedStyleId] = useState<string | null>(null);
  const [skuSummary, setSkuSummary] = useState<PreOrderSkuSummary | null>(
    null,
  );
   const [loadingSku, setLoadingSku] = useState(false);
   const [brandFilter, setBrandFilter] = useState('');
   const [brandOptions, setBrandOptions] = useState<{ attrCode: string; attrName: string }[]>([]);

  const loadOptions = async () => {
    try {
      const opts = await tradeShowApi.options();
      setTradeShowOptions(opts);
      const ongoing = opts.find((o) => o.status === 'ongoing');
      if (ongoing) {
        setSelectedTradeShow(ongoing.id);
      } else if (opts.length > 0) {
        setSelectedTradeShow(opts[0].id);
      }
     } catch (e) {
       toast(errMsg(e, '加载订货会选项失败'));
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

  const loadSummary = async (tradeShowId: string) => {
    if (!tradeShowId) {
      setSummaryList([]);
      return;
    }
    setLoading(true);
    try {
       const data = await tradeShowApi.summary.byStyle(tradeShowId, { brand: brandFilter || undefined });
      setSummaryList(data);
    } catch (e) {
      toast(errMsg(e, '加载汇总失败'));
    } finally {
      setLoading(false);
    }
  };

   useEffect(() => {
     loadSummary(selectedTradeShow);
     setExpandedStyleId(null);
     setSkuSummary(null);
   }, [selectedTradeShow, brandFilter]);

  const allParties = useMemo(() => {
    const partyMap = new Map<string, { id: string; name: string; type: string }>();
    for (const s of summaryList) {
      for (const b of s.breakdown) {
        partyMap.set(b.partyId, {
          id: b.partyId,
          name: b.partyName,
          type: b.partyType,
        });
      }
    }
    return Array.from(partyMap.values());
  }, [summaryList]);

  const grandTotal = useMemo(
    () => summaryList.reduce((sum, s) => sum + s.totalQty, 0),
    [summaryList],
  );

  const handleExpand = async (styleId: string) => {
    if (expandedStyleId === styleId) {
      setExpandedStyleId(null);
      setSkuSummary(null);
      return;
    }
    setExpandedStyleId(styleId);
    setLoadingSku(true);
    try {
      const data = await tradeShowApi.summary.bySku(
        selectedTradeShow,
        styleId,
      );
      setSkuSummary(data);
    } catch (e) {
      toast(errMsg(e, '加载SKU汇总失败'));
    } finally {
      setLoadingSku(false);
    }
  };

  // SKU matrix computation
  const skuColors = useMemo(() => {
    if (!skuSummary) return [];
    return Array.from(new Set(skuSummary.items.map((i) => i.color)));
  }, [skuSummary]);

  const skuSizes = useMemo(() => {
    if (!skuSummary) return [];
    return Array.from(new Set(skuSummary.items.map((i) => i.size)));
  }, [skuSummary]);

  const getSkuItem = (
    color: string,
    size: string,
  ): PreOrderSkuSummaryItem | undefined => {
    if (!skuSummary) return undefined;
    return skuSummary.items.find(
      (it: PreOrderSkuSummaryItem) => it.color === color && it.size === size,
    );
  };

  const getPartyQty = (item: PreOrderSkuSummaryItem | undefined, partyId: string): number => {
    if (!item) return 0;
    const b = item.breakdown.find((x) => x.partyId === partyId);
    return b?.qty || 0;
  };

  return (
    <div className="p-5 bg-white rounded shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">预订汇总</h2>
        <div className="text-sm text-gray-500">
          总预订量：
          <span className="text-primary font-semibold ml-1">
            {grandTotal}
          </span>{' '}
          件
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-200 flex-wrap">
       <div className="flex items-center gap-2">
           <label className="text-sm text-gray-600">订货会：</label>
           <select
             value={selectedTradeShow}
             onChange={(e) => setSelectedTradeShow(e.target.value)}
             className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary min-w-[240px]"
           >
             <option value="">请选择订货会</option>
             {tradeShowOptions.map((t) => (
               <option key={t.id} value={t.id}>
                 {t.showNo} - {t.name}
               </option>
             ))}
           </select>
         </div>
         <div className="flex items-center gap-2">
           <label className="text-sm text-gray-600">品牌：</label>
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
         </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-gray-600 font-medium">
              <th className="text-left px-4 py-3 border-b border-gray-200 w-10"></th>
               <th className="text-left px-4 py-3 border-b border-gray-200">
                 款号
               </th>
               <th className="text-left px-4 py-3 border-b border-gray-200">
                 款名
               </th>
               <th className="text-left px-4 py-3 border-b border-gray-200">
                 品牌
               </th>
               <th className="text-right px-4 py-3 border-b border-gray-200">
                 总预订量
               </th>
              {allParties.map((p) => (
                <th
                  key={p.id}
                  className="text-right px-4 py-3 border-b border-gray-200"
                >
                  {p.name}
                  <span className="text-xs text-gray-400 ml-1">
                    ({p.type === 'dealer' ? '经销' : '直营'})
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                 <td
                   colSpan={5 + allParties.length}
                   className="text-center py-8 text-gray-400"
                 >
                  加载中...
                </td>
              </tr>
            ) : summaryList.length === 0 ? (
              <tr>
                 <td
                   colSpan={5 + allParties.length}
                   className="text-center py-8 text-gray-400"
                 >
                  {selectedTradeShow ? '暂无预订数据' : '请选择订货会'}
                </td>
              </tr>
            ) : (
              summaryList.map((item) => {
                const isExpanded = expandedStyleId === item.styleId;
                return (
                  <React.Fragment key={item.styleId}>
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-2 py-3 text-center">
                        <button
                          className="text-gray-400 hover:text-gray-600"
                          onClick={() => handleExpand(item.styleId)}
                        >
                          {isExpanded ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                      </td>
                       <td className="px-4 py-3 font-medium">{item.styleNo}</td>
                       <td className="px-4 py-3">{item.styleName}</td>
                       <td className="px-4 py-3 text-gray-500">{item.brand || '-'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {item.totalQty}
                      </td>
                      {allParties.map((p) => {
                        const b = item.breakdown.find(
                          (x) => x.partyId === p.id,
                        );
                        return (
                          <td
                            key={p.id}
                            className="px-4 py-3 text-right text-gray-600"
                          >
                            {b?.qty || 0}
                          </td>
                        );
                      })}
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-50">
                        <td
                          colSpan={4 + allParties.length}
                          className="px-8 py-4"
                        >
                          {loadingSku ? (
                            <div className="text-center text-gray-400 py-4">
                              加载中...
                            </div>
                          ) : skuSummary ? (
                            <div className="overflow-x-auto border border-gray-200 rounded bg-white">
                              <div className="px-3 py-2 bg-blue-50 border-b border-gray-200 text-sm font-medium text-gray-700">
                                SKU 矩阵汇总
                              </div>
                              <table className="w-full text-sm border-collapse">
                                <thead>
                                  <tr className="bg-gray-50 text-gray-600 font-medium">
                                    <th className="text-left px-3 py-2 border-b border-r border-gray-200 w-24">
                                      颜色 / 尺码
                                    </th>
                                    {skuSizes.map((size) => (
                                      <th
                                        key={size}
                                        className="text-center px-3 py-2 border-b border-r border-gray-200 w-20"
                                      >
                                        {size}
                                      </th>
                                    ))}
                                    <th className="text-center px-3 py-2 border-b border-gray-200 w-20 bg-blue-50">
                                      合计
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {skuColors.map((color) => {
                                    const rowTotal = skuSizes.reduce(
                                      (sum, s) =>
                                        sum +
                                        (getSkuItem(color, s)?.totalQty || 0),
                                      0,
                                    );
                                    return (
                                      <tr key={color} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 border-b border-r border-gray-200 font-medium text-gray-700 bg-gray-50">
                                          {color}
                                        </td>
                                        {skuSizes.map((size) => {
                                          const skuItem = getSkuItem(color, size);
                                          const total = skuItem?.totalQty || 0;
                                          const detail = skuItem?.breakdown || [];
                                          return (
                                            <td
                                              key={size}
                                              className="px-2 py-2 border-b border-r border-gray-200 text-center relative group"
                                              title={
                                                detail.length > 0
                                                  ? detail
                                                      .map(
                                                        (d) =>
                                                          `${d.partyName}: ${d.qty}`,
                                                      )
                                                      .join('\n')
                                                  : ''
                                              }
                                            >
                                              <span
                                                className={`${
                                                  total > 0
                                                    ? 'text-primary font-medium'
                                                    : 'text-gray-400'
                                                }`}
                                              >
                                                {total}
                                              </span>
                                            </td>
                                          );
                                        })}
                                        <td className="px-3 py-2 border-b border-gray-200 text-center font-medium text-primary bg-blue-50">
                                          {rowTotal}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-blue-50 font-medium">
                                    <td className="px-3 py-2 border-t border-r border-gray-200 text-gray-700">
                                      合计
                                    </td>
                                    {skuSizes.map((size) => {
                                      const colTotal = skuColors.reduce(
                                        (sum, c) =>
                                          sum +
                                          (getSkuItem(c, size)?.totalQty || 0),
                                        0,
                                      );
                                      return (
                                        <td
                                          key={size}
                                          className="px-3 py-2 border-t border-r border-gray-200 text-center text-primary"
                                        >
                                          {colTotal}
                                        </td>
                                      );
                                    })}
                                    <td className="px-3 py-2 border-t border-gray-200 text-center text-primary/90 text-base">
                                      {skuSummary.items.reduce(
                                        (sum, i) => sum + i.totalQty,
                                        0,
                                      )}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                              {allParties.length > 0 && (
                                <div className="px-3 py-2 border-t border-gray-200 text-xs text-gray-500">
                                  提示：鼠标悬停数量单元格可查看各预订方明细
                                </div>
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PreOrderSummaryPage;
