import React, { useState, useEffect } from 'react';
import SafeChart from '@client/src/components/SafeChart';
import { toast } from 'sonner';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { analyticsApi } from '@client/src/api/analytics';
import type { ForecastResult, Sku } from '@shared/api.interface';

const ForecastPage: React.FC = () => {
  const [skuOptions, setSkuOptions] = useState<Sku[]>([]);
  const [skuId, setSkuId] = useState('');
  const [horizon, setHorizon] = useState(3);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSkus();
  }, []);

  const loadSkus = async () => {
    try {
      const r = await axiosForBackend.get('/api/base/sku/list', { params: { pageSize: 200 } });
      setSkuOptions(r.data?.items || []);
    } catch {
      toast('加载SKU失败');
    }
  };

  const handleForecast = async () => {
    if (!skuId) {
      toast('请选择SKU');
      return;
    }
    setLoading(true);
    try {
      const r = await analyticsApi.forecast(skuId, horizon);
      setResult(r);
    } catch {
      toast('预测失败');
    }
    setLoading(false);
  };

  const months = result ? [...result.history.map((h) => h.month), ...result.forecast.map((f) => f.month)] : [];
  const histData = result
    ? [...result.history.map((h) => h.qty), ...result.forecast.map(() => null as unknown as number)]
    : [];
  const foreData = result
    ? [...result.history.map(() => null as unknown as number), ...result.forecast.map((f) => f.qty)]
    : [];

  const option = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['历史销量', '预测销量'] },
    grid: { left: 50, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'category' as const, data: months, axisLabel: { fontSize: 10, rotate: 45 } },
    yAxis: { type: 'value' as const },
    series: [
      { name: '历史销量', type: 'line' as const, data: histData, itemStyle: { color: '#3b82f6' }, lineStyle: { width: 2 } },
      { name: '预测销量', type: 'line' as const, data: foreData, itemStyle: { color: '#f59e0b' }, lineStyle: { type: 'dashed' as const, width: 2 } },
    ],
  };

  return (
    <div className="p-5 space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">AI 销量预测</h1>
        <div className="flex flex-wrap gap-3 items-end">
          <select
            value={skuId}
            onChange={(e) => setSkuId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded text-sm w-64 focus:outline-none focus:border-blue-500"
          >
            <option value="">选择SKU</option>
            {skuOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.skuCode}（{s.styleNo}/{s.color}/{s.size}）</option>
            ))}
          </select>
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-500"
          >
            <option value={3}>预测3个月</option>
            <option value={6}>预测6个月</option>
            <option value={12}>预测12个月</option>
          </select>
          <button
            onClick={handleForecast}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? '预测中...' : '开始预测'}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '月均销量', value: result.avgMonthly.toFixed(1) },
              { label: '趋势(月)', value: (result.trend >= 0 ? '+' : '') + result.trend.toFixed(1) },
              { label: '首月预测', value: (result.forecast[0]?.qty ?? 0).toFixed(0) },
              { label: '建议补货量', value: String(result.recommendedStock) },
            ].map((c) => (
              <div key={c.label} className="bg-white rounded-lg shadow-sm p-4">
                <div className="text-2xl font-semibold text-gray-800">{c.value}</div>
                <div className="text-sm text-gray-500 mt-1">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-base font-medium text-gray-800 mb-3">
              销量趋势与预测（{result.skuCode}）
            </div>
            <SafeChart option={option} style={{ height: 360 }} />
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="text-base font-medium text-gray-800 mb-3">预测明细</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <th className="px-4 py-2 text-left">月份</th>
                  <th className="px-4 py-2 text-right">预测销量</th>
                  <th className="px-4 py-2 text-right">区间下限</th>
                  <th className="px-4 py-2 text-right">区间上限</th>
                </tr>
              </thead>
              <tbody>
                {result.forecast.map((f) => (
                  <tr key={f.month} className="border-b border-gray-100">
                    <td className="px-4 py-2">{f.month}</td>
                    <td className="px-4 py-2 text-right">{f.qty.toFixed(0)}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{(f.lower ?? 0).toFixed(0)}</td>
                    <td className="px-4 py-2 text-right text-gray-500">{(f.upper ?? 0).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default ForecastPage;
