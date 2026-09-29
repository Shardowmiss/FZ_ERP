import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { TableContainer } from '@client/src/components/ui/table-container';
import { errMsg } from '@/utils/errMsg';
import { request } from '@client/src/api/request';

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
  dealerId: string | null;
  warehouseId: string | null;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface CalcItem {
  skuId: string;
  skuCode: string;
  styleNo: string;
  color: string;
  size: string;
  recentSalesQty: number;
  dailyAvg: number;
  currentStock: number;
  inTransitQty: number;
  safetyStock: number;
  suggestedRaw: number;
  suggestedQty: number;
}

interface CalcResult {
  items: CalcItem[];
  dataAsOf: string | null;
  daysStale: number | null;
  freshnessAlert: boolean;
  salesStoreCount: number;
}

const ReplenishPlanPage: React.FC = () => {
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [storeId, setStoreId] = useState('');
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');

  // 计算参数
  const [n, setN] = useState(30);
  const [expectedDays, setExpectedDays] = useState(14);
  const [leadTimeDays, setLeadTimeDays] = useState(3);
  const [safetyDays, setSafetyDays] = useState(2);
  const [caseQty, setCaseQty] = useState(12);
  const [useForecast, setUseForecast] = useState(false);

  const [items, setItems] = useState<CalcItem[]>([]);
  const [calcLoading, setCalcLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ docType: string; docNo: string } | null>(null);
  const [storeTypeLabel, setStoreTypeLabel] = useState('');
  const [freshness, setFreshness] = useState<{
    dataAsOf: string | null;
    daysStale: number | null;
    freshnessAlert: boolean;
    salesStoreCount: number;
  } | null>(null);

  useEffect(() => {
    loadStores();
    loadWarehouses();
  }, []);

  const loadStores = async () => {
    try {
      const res = await request<StoreOption[]>('/api/base/store/options', 'GET');
      setStores(res || []);
    } catch (error) {
      toast.error(errMsg(error, '加载门店失败'));
    }
  };

  const loadWarehouses = async () => {
    try {
      const res = await request<WarehouseOption[]>('/api/base/warehouse/options', 'GET');
      setWarehouses(res || []);
      // 默认选主仓（type='main'）
      const main = (res || []).find((w) => w.type === 'main');
      if (main) setSourceWarehouseId(main.id);
    } catch (error) {
      toast.error(errMsg(error, '加载仓库失败'));
    }
  };

  const onStoreChange = (id: string) => {
    setStoreId(id);
    const s = stores.find((x) => x.id === id);
    if (s) setStoreTypeLabel(s.storeType === 'franchise' ? '经销商（将生成销售单）' : '直营店（将生成调拨单）');
  };

  const handleCalc = async () => {
    if (!storeId) {
      toast.error('请先选择门店');
      return;
    }
    setCalcLoading(true);
    setResult(null);
    try {
      const res = await request<CalcResult>('/api/inventory/replenish-plan/calc', 'POST', {
        storeId,
        n,
        expectedDays,
        leadTimeDays,
        safetyDays,
        caseQty,
        useForecast,
      });
      setItems(res?.items || []);
      setFreshness({
        dataAsOf: res?.dataAsOf ?? null,
        daysStale: res?.daysStale ?? null,
        freshnessAlert: !!res?.freshnessAlert,
        salesStoreCount: res?.salesStoreCount ?? 0,
      });
      if (!res || !res.items || res.items.length === 0)
        toast('该门店近 N 天无销售数据或无可计算 SKU');
    } catch (error) {
      toast.error(errMsg(error, '计算失败'));
    }
    setCalcLoading(false);
  };

  const handleGenerate = async () => {
    const sel = items.filter((it) => it.suggestedQty > 0);
    if (sel.length === 0) {
      toast.error('没有可生成的补货明细（建议量均为 0）');
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const res = await request<{ planNo: string; docType: string; docNo: string; docId: string; itemCount: number }>(
        '/api/inventory/replenish-plan/generate',
        'POST',
        {
          storeId,
          sourceWarehouseId: sourceWarehouseId || undefined,
          items: sel.map((it) => ({ skuId: it.skuId, suggestedQty: it.suggestedQty })),
          remark: '渠道铺货-手动生成',
        },
      );
      setResult({ docType: res.docType, docNo: res.docNo });
      toast.success(`已生成${res.docType === 'transfer' ? '调拨单' : '销售订单'} ${res.docNo}（草稿）`);
    } catch (error) {
      toast.error(errMsg(error, '生成失败'));
    }
    setGenerating(false);
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">渠道铺货 · 补货计划</h1>
          <span className="text-sm text-gray-400">按近 N 天销量 + 预计天数计算铺货量，并生成原始单据</span>
        </div>

        {/* 参数区 */}
        <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gray-50 rounded items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">门店 / 渠道 *</label>
            <select
              value={storeId}
              onChange={(e) => onStoreChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500 min-w-[200px]"
            >
              <option value="">请选择门店</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.storeType === 'franchise' ? '经销商' : '直营店'}）
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">发货仓（调拨源）</label>
            <select
              value={sourceWarehouseId}
              onChange={(e) => setSourceWarehouseId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">系统默认主仓</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <NumberField label="近 N 天" value={n} onChange={setN} />
          <NumberField label="预计销售天数" value={expectedDays} onChange={setExpectedDays} />
          <NumberField label="提前期(天)" value={leadTimeDays} onChange={setLeadTimeDays} />
          <NumberField label="安全天数" value={safetyDays} onChange={setSafetyDays} />
          <NumberField label="箱规/起订量" value={caseQty} onChange={setCaseQty} />
          <label className="flex items-center gap-2 text-sm text-gray-700 mt-1">
            <input
              type="checkbox"
              checked={useForecast}
              onChange={(e) => setUseForecast(e.target.checked)}
            />
            使用销量预测（趋势+季节，P2-2）
          </label>
          <button
            onClick={handleCalc}
            disabled={calcLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {calcLoading ? '计算中...' : '计算建议量'}
          </button>
        </div>

        {storeId && (
          <div className="mb-3 text-sm text-gray-500">
            当前门店类型：<span className="font-medium text-gray-700">{storeTypeLabel}</span>
          </div>
        )}

        {freshness && (
          <div
            className={`mb-3 p-3 rounded text-sm ${
              freshness.freshnessAlert
                ? 'bg-amber-50 border border-amber-300 text-amber-800'
                : 'bg-blue-50 border border-blue-200 text-blue-700'
            }`}
          >
            <b>数据截至时间：</b>
            {freshness.dataAsOf ?? '无有效销售数据'}
            {freshness.daysStale != null && `（距今 ${freshness.daysStale} 天）`}　|
            <b>近 {n} 天有销量门店：</b>
            {freshness.salesStoreCount} 家
            {freshness.freshnessAlert && (
              <span className="ml-2 font-semibold">
                ⚠ 销量数据时效不足，建议量仅供参考，请核实数据源后再生成单据
              </span>
            )}
          </div>
        )}

        {result && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
            已生成单据：{result.docType === 'transfer' ? '调拨单' : '销售订单'} <b>{result.docNo}</b>（草稿状态，可在对应单据页审核）
          </div>
        )}

        <TableContainer>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                <th className="px-4 py-3 text-left">SKU编码</th>
                <th className="px-4 py-3 text-left">款号</th>
                <th className="px-4 py-3 text-left">颜色</th>
                <th className="px-4 py-3 text-left">尺码</th>
                <th className="px-4 py-3 text-right">近N天销量</th>
                <th className="px-4 py-3 text-right">日均销量</th>
                <th className="px-4 py-3 text-right">当前库存</th>
                <th className="px-4 py-3 text-right">在途</th>
                <th className="px-4 py-3 text-right">安全库存</th>
                <th className="px-4 py-3 text-right">建议铺货量</th>
              </tr>
            </thead>
            <tbody>
              {calcLoading ? (
                <tr><td colSpan={10} className="py-8 text-center text-gray-400">计算中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={10} className="py-8 text-center text-gray-400">请选择门店并计算建议量</td></tr>
              ) : (
                items.map((it) => (
                  <tr key={it.skuId} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{it.skuCode}</td>
                    <td className="px-4 py-3 text-gray-700">{it.styleNo}</td>
                    <td className="px-4 py-3 text-gray-600">{it.color}</td>
                    <td className="px-4 py-3 text-gray-600">{it.size}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(it.recentSalesQty).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(it.dailyAvg).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(it.currentStock).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{Number(it.inTransitQty).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{Number(it.safetyStock).toFixed(2)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${it.suggestedQty > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {it.suggestedQty}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableContainer>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleGenerate}
            disabled={generating || items.filter((i) => i.suggestedQty > 0).length === 0}
            className="px-5 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            {generating ? '生成中...' : '生成单据（草稿）'}
          </button>
        </div>
      </div>
    </div>
  );
};

const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
}> = ({ label, value, onChange }) => (
  <div>
    <label className="block text-xs text-gray-500 mb-1">{label}</label>
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="px-3 py-2 border border-gray-300 rounded text-sm w-24 focus:outline-none focus:border-blue-500"
    />
  </div>
);

export default ReplenishPlanPage;
