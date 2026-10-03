import React, { useState, useEffect } from 'react';
import SafeChart from '@client/src/components/SafeChart';
import { toast } from 'sonner';
import { analyticsApi } from '@client/src/api/analytics';
import type { BiResult } from '@shared/api.interface';
import { CHART_PRIMARY, CHART_POSITIVE } from '@client/src/lib/chart-colors';
import { errMsg } from '@/utils/errMsg';

const DIMS: { value: string; label: string }[] = [
  { value: 'style', label: '按款号' },
  { value: 'category', label: '按类目' },
  { value: 'warehouse', label: '按仓库' },
  { value: 'dealer', label: '按经销商' },
  { value: 'month', label: '按月份' },
];

const BIPage: React.FC = () => {
  const [dim, setDim] = useState('category');
  const [metric, setMetric] = useState('amount');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [primary, setPrimary] = useState<BiResult | null>(null);
  const [drillDim, setDrillDim] = useState('style');
  const [drill, setDrill] = useState<BiResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await analyticsApi.bi(dim, metric, from || undefined, to || undefined);
      setPrimary(r);
    } catch (e) {
      toast(errMsg(e, '查询失败'));
    }
    setLoading(false);
  };

  const loadDrill = async () => {
    try {
      const r = await analyticsApi.bi(drillDim, metric, from || undefined, to || undefined);
      setDrill(r);
    } catch (e) {
      toast(errMsg(e, '下钻失败'));
    }
  };

  useEffect(() => {
    load();
  }, [dim, metric, from, to]);

  useEffect(() => {
    loadDrill();
  }, [drillDim, metric, from, to]);

  const buildOption = (data: BiResult, isDrill: boolean) => ({
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 120, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'value' as const },
    yAxis: {
      type: 'category' as const,
      data: [...data.rows].reverse().map((r) => r.dimValue),
      axisLabel: { fontSize: 10 },
    },
    series: [{
      type: 'bar' as const,
      data: [...data.rows].reverse().map((r) => (metric === 'quantity' ? r.quantity : r.amount)),
      itemStyle: { color: isDrill ? CHART_POSITIVE : CHART_PRIMARY, borderRadius: [0, 4, 4, 0] },
      barWidth: 14,
    }],
  });

  const renderTable = (data: BiResult | null) => (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-medium">
          <th className="px-3 py-2 text-left">维度值</th>
          <th className="px-3 py-2 text-right">销售额</th>
          <th className="px-3 py-2 text-right">销量</th>
        </tr>
      </thead>
      <tbody>
        {!data || data.rows.length === 0 ? (
          <tr><td colSpan={3} className="py-6 text-center text-gray-400">暂无数据</td></tr>
        ) : (
          data.rows.map((r) => (
            <tr key={r.dimValue} className="border-b border-gray-100">
              <td className="px-3 py-2 text-gray-700">{r.dimValue}</td>
              <td className="px-3 py-2 text-right text-gray-700">{r.amount.toFixed(2)}</td>
              <td className="px-3 py-2 text-right text-gray-600">{r.quantity.toFixed(0)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <div className="p-5 space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <h1 className="text-xl font-semibold text-gray-800 mb-4">自助 BI 钻取分析</h1>
        <div className="flex flex-wrap gap-3 items-end">
          <select value={dim} onChange={(e) => setDim(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary">
            {DIMS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary">
            <option value="amount">按销售额</option>
            <option value="quantity">按销量</option>
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
          <span className="text-gray-400">至</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border border-gray-300 rounded text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="text-base font-medium text-gray-800 mb-3">主维度：{DIMS.find((d) => d.value === dim)?.label}</div>
          {loading ? <div className="text-gray-400 py-10 text-center">加载中...</div> : (
            <SafeChart option={buildOption(primary as BiResult, false)} style={{ height: 360 }} />
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="text-base font-medium text-gray-800">下钻维度</div>
            <select value={drillDim} onChange={(e) => setDrillDim(e.target.value)} className="px-2 py-1 border border-gray-300 rounded text-xs">
              {DIMS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <SafeChart option={buildOption(drill as BiResult, true)} style={{ height: 360 }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-5">{renderTable(primary)}</div>
        <div className="bg-white rounded-lg shadow-sm p-5">{renderTable(drill)}</div>
      </div>
    </div>
  );
};

export default BIPage;
