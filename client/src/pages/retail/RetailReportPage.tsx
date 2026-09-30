import React, { useState, useEffect } from 'react';
import SafeChart from '@client/src/components/SafeChart';
import {
  DollarSign, ShoppingBag, TrendingUp, Tag,
} from 'lucide-react';
import { retailApi } from '@client/src/api/retail';
import { baseApi } from '@client/src/api/base';
import type {
  RetailReportSummary,
  RetailStoreRankItem,
  RetailStyleTopItem,
  RetailPayMethodStat,
  RetailTrendItem,
} from '@shared/api.interface';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { CHART_PALETTE, CHART_PRIMARY, CHART_POSITIVE } from '@client/src/lib/chart-colors';
import { errMsg } from '@/utils/errMsg';

interface StoreOption {
  id: string;
  code: string;
  name: string;
  storeType: string;
}

const PAY_METHOD_LABELS: Record<string, string> = {
  cash: '现金',
  wechat: '微信',
  alipay: '支付宝',
  bank_card: '银行卡',
  member_balance: '会员余额',
};

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  value: string;
  label: string;
  sub?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, iconBg, value, label, sub }) => (
  <div className="bg-white rounded-lg p-5 flex items-center shadow-sm">
    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconBg}`}>
      {icon}
    </div>
    <div className="ml-4">
      <div className="text-2xl font-semibold text-gray-800">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  </div>
);

const RetailReportPage: React.FC = () => {
  const [summary, setSummary] = useState<RetailReportSummary | null>(null);
  const [storeRank, setStoreRank] = useState<RetailStoreRankItem[]>([]);
  const [styleTop, setStyleTop] = useState<RetailStyleTopItem[]>([]);
  const [payMethodStats, setPayMethodStats] = useState<RetailPayMethodStat[]>([]);
  const [trend, setTrend] = useState<RetailTrendItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [storeId, setStoreId] = useState('');
  const [storeOptions, setStoreOptions] = useState<StoreOption[]>([]);
  const [brand, setBrand] = useState('');
  const [brandOptions, setBrandOptions] = useState<{ attrCode: string; attrName: string }[]>([]);

  const fetchData = async (): Promise<void> => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
       if (storeId) params.storeId = storeId;
       if (brand) params.brand = brand;
      const res = await retailApi.reportSummary(params);
      setSummary(res.summary);
      setStoreRank(res.storeRank);
      setStyleTop(res.styleTop);
      setPayMethodStats(res.payMethodStats);
      setTrend(res.trend);
    } catch (e) {
      logger.error('加载报表失败', e);
      toast(errMsg(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const fetchStores = async (): Promise<void> => {
    try {
      const res = await baseApi.store.options();
      setStoreOptions(res as StoreOption[]);
    } catch (e) { logger.error('加载门店失败', e); }
  };

  const fetchBrands = async (): Promise<void> => {
    try {
      const res = await baseApi.styleAttribute.getAll('brand', true);
      setBrandOptions(res.map((b: any) => ({ attrCode: b.attrCode, attrName: b.attrName })));
    } catch (e) { logger.error('加载品牌失败', e); }
  };

  useEffect(() => {
    // 默认近30天
    const today = new Date();
    const past = new Date();
    past.setDate(today.getDate() - 29);
    setEndDate(today.toISOString().slice(0, 10));
    setStartDate(past.toISOString().slice(0, 10));
     fetchStores();
     fetchBrands();
  }, []);

  useEffect(() => {
    if (startDate && endDate) {
      fetchData();
    }
   }, [startDate, endDate, storeId, brand]);

  // 近30天销售趋势 - 折线图
  const trendOption = {
    tooltip: { trigger: 'axis' as const },
    legend: { data: ['销售额', '订单数'], top: 0, right: 10 },
    grid: { left: 50, right: 50, top: 40, bottom: 30 },
    xAxis: {
      type: 'category' as const,
      data: trend.map((item: RetailTrendItem) => item.date),
      axisLabel: { fontSize: 11 },
    },
    yAxis: [
      {
        type: 'value' as const,
        name: '销售额',
        axisLabel: { fontSize: 11 },
      },
      {
        type: 'value' as const,
        name: '订单数',
        axisLabel: { fontSize: 11 },
      },
    ],
    series: [
      {
        name: '销售额',
        type: 'line' as const,
        smooth: true,
        data: trend.map((item: RetailTrendItem) => item.amount),
        areaStyle: { color: 'rgba(59, 130, 246, 0.15)' },
        lineStyle: { color: CHART_PRIMARY, width: 2 },
        itemStyle: { color: CHART_PRIMARY },
        yAxisIndex: 0,
      },
      {
        name: '订单数',
        type: 'line' as const,
        smooth: true,
        data: trend.map((item: RetailTrendItem) => item.orderCount),
        lineStyle: { color: CHART_POSITIVE, width: 2 },
        itemStyle: { color: CHART_POSITIVE },
        yAxisIndex: 1,
      },
    ],
  };

  // 门店销售排行 - 横向柱状图
  const storeRankOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 100, right: 30, top: 20, bottom: 30 },
    xAxis: { type: 'value' as const, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'category' as const,
      data: [...storeRank].reverse().map((item: RetailStoreRankItem) => item.storeName),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      name: '销售额',
      type: 'bar' as const,
      data: [...storeRank].reverse().map((item: RetailStoreRankItem) => item.amount),
      itemStyle: { color: CHART_PRIMARY, borderRadius: [0, 4, 4, 0] },
      barWidth: 16,
    }],
  };

  // 支付方式占比 - 饼图
  const pieOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: ¥{c} ({d}%)' },
    legend: { bottom: 0, left: 'center', itemWidth: 10, itemHeight: 10 },
    series: [{
      name: '支付方式',
      type: 'pie' as const,
      radius: ['40%', '65%'],
      center: ['50%', '45%'],
      avoidLabelOverlap: false,
      label: { show: false },
      emphasis: {
        label: { show: true, fontSize: 12, fontWeight: 'bold' as const },
      },
      labelLine: { show: false },
      data: payMethodStats.map((item: RetailPayMethodStat) => ({
        name: PAY_METHOD_LABELS[item.method] || item.method,
        value: item.amount,
      })),
      color: CHART_PALETTE,
    }],
  };

  // 单品销量TOP10 - 柱状图
  const styleTopOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 90, right: 30, top: 20, bottom: 30 },
    xAxis: { type: 'value' as const, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'category' as const,
      data: [...styleTop].reverse().map((item: RetailStyleTopItem) => item.styleNo),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      name: '销量',
      type: 'bar' as const,
      data: [...styleTop].reverse().map((item: RetailStyleTopItem) => item.qty),
      itemStyle: { color: CHART_POSITIVE, borderRadius: [0, 4, 4, 0] },
      barWidth: 16,
    }],
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">加载中...</div>;
  }

  return (
    <div className="p-5 space-y-5">
      {/* 筛选区 */}
      <div className="bg-white rounded-lg p-5 shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
           <div className="flex flex-col">
             <label className="text-xs text-gray-500 mb-1">门店</label>
             <select
               value={storeId}
               onChange={(e) => setStoreId(e.target.value)}
               className="border border-gray-300 rounded px-3 py-1.5 text-sm w-40"
             >
               <option value="">全部门店</option>
               {storeOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
             </select>
           </div>
           <div className="flex flex-col">
             <label className="text-xs text-gray-500 mb-1">品牌</label>
             <select
               value={brand}
               onChange={(e) => setBrand(e.target.value)}
               className="border border-gray-300 rounded px-3 py-1.5 text-sm w-32"
             >
               <option value="">全部品牌</option>
               {brandOptions.map((b: { attrCode: string; attrName: string }) => (
                 <option key={b.attrCode} value={b.attrName}>{b.attrName}</option>
               ))}
             </select>
           </div>
          <button
            onClick={fetchData}
            className="bg-primary text-white px-4 py-1.5 rounded text-sm hover:bg-blue-600"
          >刷新</button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<DollarSign className="text-white" size={24} />}
          iconBg="bg-primary"
          value={`¥ ${summary?.totalAmount?.toFixed(2) ?? '0.00'}`}
          label="零售总额"
          sub={`${summary?.orderCount ?? 0} 笔订单`}
        />
        <StatCard
          icon={<ShoppingBag className="text-white" size={24} />}
          iconBg="bg-emerald-500"
          value={String(summary?.orderCount ?? 0)}
          label="订单数"
          sub={`${summary?.totalItemQty ?? 0} 件商品`}
        />
        <StatCard
          icon={<TrendingUp className="text-white" size={24} />}
          iconBg="bg-amber-500"
          value={`¥ ${summary?.avgOrderAmount?.toFixed(2) ?? '0.00'}`}
          label="客单价"
          sub="平均每单金额"
        />
        <StatCard
          icon={<Tag className="text-white" size={24} />}
          iconBg="bg-rose-500"
          value={`¥ ${summary?.avgItemPrice?.toFixed(2) ?? '0.00'}`}
          label="件单价"
          sub="平均每件价格"
        />
      </div>

      {/* 图表区 2x2 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <div className="text-base font-medium text-gray-800 mb-3">销售趋势</div>
          <SafeChart option={trendOption} style={{ height: 280 }} />
        </div>
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <div className="text-base font-medium text-gray-800 mb-3">门店销售排行</div>
          <SafeChart option={storeRankOption} style={{ height: 280 }} />
        </div>
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <div className="text-base font-medium text-gray-800 mb-3">支付方式占比</div>
          <SafeChart option={pieOption} style={{ height: 280 }} />
        </div>
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <div className="text-base font-medium text-gray-800 mb-3">单品销量TOP10</div>
          <SafeChart option={styleTopOption} style={{ height: 280 }} />
        </div>
      </div>
    </div>
  );
};

export default RetailReportPage;
