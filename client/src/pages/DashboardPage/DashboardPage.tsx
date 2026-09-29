import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp, ShoppingCart, DollarSign, Users, Tag,
  BarChart3, Award, PieChart, Shirt, ChevronRight
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { logger } from '@lark-apaas/client-toolkit/logger';
import * as dashboardApi from '@client/src/api/dashboard';
import type {
  TodayKpi,
  SalesTrendPoint,
  TopStyleItem,
  EmployeeRankingItem,
  CategorySalesItem,
} from '@shared/api.interface';

type Period = 'today' | 'week' | 'month';

const PERIOD_LABELS: Record<Period, string> = {
  today: '今日',
  week: '本周',
  month: '本月',
};

function buildDateRange(period: Period): { startDate: string; endDate: string; granularity: 'hour' | 'day' } {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  let startDate = endDate;
  let granularity: 'hour' | 'day' = 'day';

  if (period === 'today') {
    startDate = endDate;
    granularity = 'hour';
  } else if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    startDate = d.toISOString().slice(0, 10);
    granularity = 'day';
  } else if (period === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate = d.toISOString().slice(0, 10);
    granularity = 'day';
  }

  return { startDate, endDate, granularity };
}

const PIE_COLORS = ['#C4532F', '#2E4A5E', '#B8A07E', '#3A7D5A', '#C08A2D'];

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('today');
  const [kpi, setKpi] = useState<TodayKpi | null>(null);
  const [trend, setTrend] = useState<SalesTrendPoint[]>([]);
  const [topProducts, setTopProducts] = useState<TopStyleItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeRankingItem[]>([]);
  const [categories, setCategories] = useState<CategorySalesItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { startDate, endDate, granularity } = buildDateRange(period);
    setLoading(true);

    const fetchAll = async (): Promise<void> => {
      try {
        const [kpiRes, trendRes, topRes, empRes, catRes] = await Promise.all([
          dashboardApi.getTodayStats(),
          dashboardApi.getSalesTrend({ startDate, endDate, granularity }),
          dashboardApi.getTopStyles(5),
          dashboardApi.getEmployeeRanking(5),
          dashboardApi.getCategorySales(),
        ]);
        setKpi(kpiRes);
        setTrend(trendRes);
        setTopProducts(topRes);
        setEmployees(empRes);
        setCategories(catRes.slice(0, 5));
      } catch (error) {
        logger.error('Dashboard fetch failed', error as Error);
      } finally {
        setLoading(false);
      }
    };

    void fetchAll();
  }, [period]);

  const kpiCards = useMemo(() => {
    const growth = kpi?.comparedYesterday?.growthRate ?? 0;
    const positive = growth >= 0;
    const trendText = `${positive ? '+' : ''}${growth.toFixed(1)}%`;
    return [
      { label: '销售额', value: kpi ? kpi.totalSales.toLocaleString() : '0', unit: '元', trend: trendText, positive, icon: DollarSign },
      { label: '单数', value: kpi ? String(kpi.orderCount) : '0', unit: '单', trend: trendText, positive, icon: ShoppingCart },
      { label: '客单价', value: kpi ? kpi.avgTicket.toFixed(1) : '0', unit: '元', trend: trendText, positive, icon: TrendingUp },
      { label: '连带率', value: kpi ? kpi.attachRate.toFixed(2) : '0', unit: '件/单', trend: trendText, positive, icon: Tag },
      { label: '会员占比', value: kpi ? (kpi.memberSaleRatio * 100).toFixed(1) : '0', unit: '%', trend: trendText, positive, icon: Users },
    ];
  }, [kpi]);

  const trendOption: EChartsOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: trend.map((t: SalesTrendPoint) => t.period),
      boundaryGap: false,
      axisLabel: { color: '#5A6A78' },
      axisLine: { lineStyle: { color: '#E8E4DA' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#5A6A78' },
      splitLine: { lineStyle: { color: '#E8E4DA', type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        data: trend.map((t: SalesTrendPoint) => t.sales),
        areaStyle: { color: '#C4532F', opacity: 0.15 },
        lineStyle: { color: '#C4532F', width: 2 },
        itemStyle: { color: '#C4532F' },
        symbol: 'circle',
        symbolSize: 6,
      },
    ],
  }), [trend]);

  const pieOption: EChartsOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item' },
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { color: '#5A6A78' },
    },
    color: PIE_COLORS,
    series: [
      {
        type: 'pie',
        radius: ['50%', '75%'],
        center: ['50%', '45%'],
        data: categories.map((c: CategorySalesItem) => ({
          name: c.category,
          value: c.salesAmount,
        })),
        label: { show: false },
        emphasis: { label: { show: false } },
      },
    ],
  }), [categories]);

  const renderRankBadge = (rank: number) => {
    const cls = rank === 1
      ? 'bg-pos-warn-bg text-pos-warn'
      : rank === 2
      ? 'bg-pos-paper text-pos-ink-2'
      : rank === 3
      ? 'bg-pos-warn-bg/60 text-pos-warn'
      : 'bg-pos-paper text-pos-ink-3';
    return (
      <span className={`inline-flex w-5 h-5 rounded items-center justify-center text-xs font-bold ${cls}`}>
        {rank}
      </span>
    );
  };

  if (loading && !kpi) {
    return (
      <div className="h-full flex flex-col bg-pos-paper">
        <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-lg font-semibold text-pos-ink">店长看板</h1>
            <p className="text-xs text-pos-ink-3 mt-0.5">决策 / 店长看板</p>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-pos-ink-3">加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-pos-paper">
      <header className="px-5 py-4 bg-white border-b border-pos-line flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-pos-ink">店长看板</h1>
          <p className="text-xs text-pos-ink-3 mt-0.5">决策 / 店长看板</p>
        </div>
        <div className="flex items-center gap-1 bg-pos-paper rounded-lg p-1">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                period === p ? 'bg-white text-pos-ink font-medium shadow-sm' : 'text-pos-ink-3 hover:text-pos-ink'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-5 gap-4" data-ai-section-type="card-stat">
          {kpiCards.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="bg-white rounded-xl border border-pos-line shadow-sm p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-pos-accent-light flex items-center justify-center text-pos-accent">
                    <Icon size={18} />
                  </div>
                  <span className={`text-xs font-medium ${item.positive ? 'text-pos-ok' : 'text-pos-danger'}`}>
                    {item.trend}
                  </span>
                </div>
                <div className="text-xs text-pos-ink-3 mb-1">{item.label}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-pos-ink tabular-nums">{item.value}</span>
                  <span className="text-xs text-pos-ink-3">{item.unit}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 bg-white rounded-xl border border-pos-line shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-pos-ink flex items-center gap-2">
                <BarChart3 size={16} className="text-pos-accent" />
                销售趋势
              </h3>
              <span className="text-xs text-pos-ink-3">{PERIOD_LABELS[period]}</span>
            </div>
            {trend.length > 0 ? (
              <ReactECharts option={trendOption} className="h-[300px]" />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-sm text-pos-ink-3">
                暂无数据
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-pos-line shadow-sm p-5">
            <h3 className="text-sm font-medium text-pos-ink flex items-center gap-2 mb-4">
              <PieChart size={16} className="text-pos-accent" />
              品类构成
            </h3>
            {categories.length > 0 ? (
              <ReactECharts option={pieOption} className="h-[300px]" />
            ) : (
              <div className="h-[300px] flex items-center justify-center text-sm text-pos-ink-3">
                暂无数据
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
              <h3 className="text-sm font-medium text-pos-ink flex items-center gap-2">
                <Shirt size={16} className="text-pos-accent" />
                畅销款 TOP5
              </h3>
              <button className="text-xs text-pos-accent hover:text-[#A8401F] flex items-center gap-0.5">
                全部 <ChevronRight size={12} />
              </button>
            </div>
            {topProducts.length > 0 ? (
              <table className="w-full text-sm">
                  <thead className="bg-pos-paper">
                    <tr>
                      <th className="text-center font-semibold text-pos-ink px-3 py-2 w-10">排名</th>
                      <th className="text-left font-semibold text-pos-ink px-2 py-2">款号/品名</th>
                      <th className="text-right font-semibold text-pos-ink px-3 py-2 w-16">销量</th>
                      <th className="text-right font-semibold text-pos-ink px-4 py-2 w-24">销售额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p: TopStyleItem) => (
                      <tr key={p.styleId} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
                      <td className="px-3 py-2.5 text-center">{renderRankBadge(p.rank)}</td>
                      <td className="px-2 py-2.5">
                        <div className="font-medium text-pos-ink text-sm">{p.styleName}</div>
                        <div className="text-xs text-pos-ink-3">{p.styleId}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-pos-ink tabular-nums">{p.qty}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-pos-accent tabular-nums">
                        ¥{p.amount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-12 text-center text-sm text-pos-ink-3">暂无数据</div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
              <h3 className="text-sm font-medium text-pos-ink flex items-center gap-2">
                <Award size={16} className="text-pos-accent" />
                导购业绩排行
              </h3>
              <button className="text-xs text-pos-accent hover:text-[#A8401F] flex items-center gap-0.5">
                全部 <ChevronRight size={12} />
              </button>
            </div>
            {employees.length > 0 ? (
              <table className="w-full text-sm">
                  <thead className="bg-pos-paper">
                    <tr>
                      <th className="text-center font-semibold text-pos-ink px-3 py-2 w-10">排名</th>
                      <th className="text-left font-semibold text-pos-ink px-2 py-2">姓名</th>
                      <th className="text-right font-semibold text-pos-ink px-3 py-2 w-16">单数</th>
                      <th className="text-right font-semibold text-pos-ink px-4 py-2 w-24">业绩</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e: EmployeeRankingItem) => (
                      <tr key={e.employeeId} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
                      <td className="px-3 py-2.5 text-center">{renderRankBadge(e.rank)}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-pos-accent-light flex items-center justify-center text-pos-accent text-xs font-medium">
                            {e.employeeName.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-pos-ink text-sm">{e.employeeName}</div>
                            <div className="text-xs text-pos-ink-3">{e.role}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-pos-ink tabular-nums">{e.orderCount}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-pos-accent tabular-nums">
                        ¥{e.salesAmount.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-12 text-center text-sm text-pos-ink-3">暂无数据</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
