import React, { useState, useEffect } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { errMsg } from '@/utils/errMsg';

interface LookupResult {
  found: boolean;
  skuId?: string;
  skuCode?: string;
  styleNo?: string;
  color?: string;
  size?: string;
  warehouseName?: string;
  bookQty?: number;
}

interface ScanItem {
  barcode: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  bookQty: number;
  actualQty: number;
  batchNo: string;
}

const MobileStocktakePage: React.FC = () => {
  const [warehouseOptions, setWarehouseOptions] = useState<{ id: string; code: string; name: string }[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [actualQty, setActualQty] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [items, setItems] = useState<ScanItem[]>([]);
  const [stocktakeDate, setStocktakeDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [barcodeInputRef, setBarcodeInputRef] = useState<HTMLInputElement | null>(null);

  useEffect(() => {
    loadWarehouses();
  }, []);

  const loadWarehouses = async () => {
    try {
      const res = await axiosForBackend.get('/api/base/warehouse/options');
      const opts = res.data || [];
      setWarehouseOptions(opts);
      if (opts.length > 0) setWarehouseId(opts[0].id);
    } catch (error) {
      logger.error('加载仓库失败', error);
    }
  };

  const handleLookup = async () => {
    if (!barcode) {
      toast('请扫描或输入条码');
      return;
    }
    if (!warehouseId) {
      toast('请选择仓库');
      return;
    }
    try {
      const res = await axiosForBackend.post('/api/inventory/mobile/lookup', {
        barcode,
        warehouseId,
      });
      const data = res.data as LookupResult;
      if (!data.found) {
        toast('条码未匹配到SKU');
        setLookup(null);
        return;
      }
      setLookup(data);
      setActualQty(String(data.bookQty ?? 0));
      setBatchNo('');
    } catch (error) {
      logger.error('查询失败', error);
      toast(errMsg(error, '查询失败'));
    }
  };

  const handleAdd = () => {
    if (!lookup || !lookup.found) {
      toast('请先扫码查询');
      return;
    }
    const qty = Number(actualQty);
    if (isNaN(qty)) {
      toast('实盘数量必须为数字');
      return;
    }
    const existing = items.find((it) => it.barcode === barcode);
    if (existing) {
      setItems(items.map((it) => (it.barcode === barcode ? { ...it, actualQty: qty, batchNo } : it)));
      toast('已更新该SKU实盘数量');
    } else {
      setItems([
        ...items,
        {
          barcode,
          skuCode: lookup.skuCode || '',
          styleNo: lookup.styleNo || '',
          color: lookup.color || '',
          size: lookup.size || '',
          bookQty: lookup.bookQty ?? 0,
          actualQty: qty,
          batchNo,
        },
      ]);
    }
    setBarcode('');
    setLookup(null);
    setActualQty('');
    setBatchNo('');
    if (barcodeInputRef) barcodeInputRef.focus();
  };

  const handleRemove = (bc: string) => {
    setItems(items.filter((it) => it.barcode !== bc));
  };

  const handleSubmit = async () => {
    if (items.length === 0) {
      toast('盘点明细为空');
      return;
    }
    setSubmitting(true);
    try {
      const res = await axiosForBackend.post('/api/inventory/mobile/stocktake', {
        warehouseId,
        stocktakeDate,
        items: items.map((it) => ({
          barcode: it.barcode,
          actualQty: it.actualQty,
          batchNo: it.batchNo || undefined,
        })),
      });
      toast.success(`盘点单 ${res.data.stocktakeNo} 已提交，共 ${res.data.itemCount} 项`);
      setItems([]);
    } catch (error) {
      logger.error('提交失败', error);
      toast(errMsg(error, '提交失败'));
    }
    setSubmitting(false);
  };

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-1">移动盘点 (PDA)</h1>
        <p className="text-xs text-gray-400 mb-4">扫码查询库存 → 录入实盘数量 → 提交生成盘点单草稿</p>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">仓库</label>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value="">请选择仓库</option>
            {warehouseOptions.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">盘点日期</label>
          <input
            type="date"
            value={stocktakeDate}
            onChange={(e) => setStocktakeDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          />
        </div>

        <div className="flex gap-2 mb-4">
          <input
            ref={(el) => setBarcodeInputRef(el)}
            type="text"
            placeholder="扫描或输入条码"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
            className="flex-1 px-3 py-3 border border-gray-300 rounded text-base focus:outline-none focus:border-primary"
          />
          <button
            onClick={handleLookup}
            className="px-4 py-3 bg-primary text-white rounded text-sm hover:bg-primary"
          >
            查询
          </button>
        </div>

        {lookup && lookup.found && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded">
            <div className="text-sm text-gray-700 mb-2">
              <span className="font-medium">{lookup.skuCode}</span>
              <span className="text-gray-500"> {lookup.styleNo}/{lookup.color}/{lookup.size}</span>
            </div>
            <div className="text-xs text-gray-500 mb-2">
              账面数量：<span className="font-medium text-gray-700">{Number(lookup.bookQty ?? 0).toFixed(3)}</span>
              （{lookup.warehouseName}）
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="实盘数量"
                value={actualQty}
                onChange={(e) => setActualQty(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded text-base focus:outline-none focus:border-primary"
              />
              <input
                type="text"
                placeholder="批次号(可选)"
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                className="w-36 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
              />
              <button
                onClick={handleAdd}
                className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              >
                加入
              </button>
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium text-gray-700">盘点明细 ({items.length})</h2>
            <button
              onClick={handleSubmit}
              disabled={submitting || items.length === 0}
              className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? '提交中...' : '提交盘点单'}
            </button>
          </div>
          {items.length === 0 ? (
            <div className="py-6 text-center text-gray-400 text-sm border border-dashed border-gray-200 rounded">
              暂无盘点明细
            </div>
          ) : (
            <div className="border border-gray-200 rounded divide-y divide-gray-100">
              {items.map((it) => {
                const diff = it.actualQty - it.bookQty;
                return (
                  <div key={it.barcode} className="p-3 flex items-center justify-between">
                    <div className="text-sm">
                      <div className="text-gray-700">
                        <span className="font-mono text-xs">{it.barcode}</span> {it.skuCode}
                      </div>
                      <div className="text-xs text-gray-500">
                        实盘 {it.actualQty.toFixed(3)} / 账面 {it.bookQty.toFixed(3)}
                        <span className={diff === 0 ? 'text-gray-400' : diff > 0 ? 'text-green-600' : 'text-red-600'}>
                          {' '}({diff >= 0 ? '+' : ''}{diff.toFixed(3)})
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(it.barcode)}
                      className="text-red-500 text-xs px-2 py-1"
                    >
                      移除
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileStocktakePage;
