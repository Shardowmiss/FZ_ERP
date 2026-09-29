import React, { useState, useEffect } from 'react';
import SafeChart from '@client/src/components/SafeChart';
import {
  TrendingUp, ShoppingCart, Package, FileText, AlertTriangle,
} from 'lucide-react';
import { dashboardApi } from '@client/src/api/dashboard';
import type {
  DashboardStats,
  SalesTrendItem,
  TopStyleItem,
  InventoryWarningItem,
} from '@shared/api.interface';
import { toast } from 'sonner';

interface StatCardProps {
  icon: React.ReactNode;
  iconBg: string;
  value: string;
  label: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, iconBg, value, label }) => (
  <div className="bg-white rounded-lg p-5 flex items-center shadow-sm">
    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconBg}`}>
      {icon}
    </div>
    <div className="ml-4">
      <div className="text-2xl font-semibold text-gray-800">{value}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
    </div>
  </div>
);

const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [salesTrend, setSalesTrend] = useState<SalesTrendItem[]>([]);
  const [topStyles, setTopStyles] = useState<TopStyleItem[]>([]);
  const [warnings, setWarnings] = useState<InventoryWarningItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadAll = async (): Promise<void> => {
      try {
        const [s, t, top, w] = await Promise.all([
          dashboardApi.stats(),
          dashboardApi.salesTrend(),
          dashboardApi.topStyles(10),
          dashboardApi.warnings(10),
        ]);
        setStats(s);
        setSalesTrend(t);
        setTopStyles(top);
        setWarnings(w);
      } catch {
        toast('加载数据失败');
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, []);

  const lineOption = {
    tooltip: { trigger: 'axis' as const },
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    xAxis: {
      type: 'category' as const,
      data: salesTrend.map((item: SalesTrendItem) => item.date),
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { fontSize: 11 },
    },
    series: [{
      name: '销售额',
      type: 'line' as const,
      smooth: true,
      data: salesTrend.map((item: SalesTrendItem) => item.amount),
      areaStyle: { color: 'rgba(59, 130, 246, 0.15)' },
      lineStyle: { color: '#3b82f6', width: 2 },
      itemStyle: { color: '#3b82f6' },
    }],
  };

  const barOption = {
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    grid: { left: 100, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'value' as const, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: 'category' as const,
      data: [...topStyles].reverse().map((item: TopStyleItem) => item.styleNo),
      axisLabel: { fontSize: 11 },
    },
    series: [{
      name: '销量',
      type: 'bar' as const,
      data: [...topStyles].reverse().map((item: TopStyleItem) => item.quantity),
      itemStyle: { color: '#10b981', borderRadius: [0, 4, 4, 0] },
      barWidth: 16,
    }],
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">加载中...</div>;
  }

  return (
    <div className="space-y-5">
      {/* 统计卡片 */}
      <div className="grid grid-cols-5 gap-4">
        <StatCard
          icon={<TrendingUp className="text-white" size={24} />}
          iconBg="bg-blue-500"
          value={`¥ ${stats?.todaySales.toFixed(2) ?? '0.00'}`}
          label="今日销售额"
        />
        <StatCard
          icon={<ShoppingCart className="text-white" size={24} />}
          iconBg="bg-violet-500"
          value={`¥ ${stats?.todayRetail.toFixed(2) ?? '0.00'}`}
          label="今日零售额"
        />
        <StatCard
          icon={<Package className="text-white" size={24} />}
          iconBg="bg-emerald-500"
          value={String(stats?.todayOutboundCount ?? 0)}
          label="今日出库单量"
        />
        <StatCard
          icon={<FileText className="text-white" size={24} />}
          iconBg="bg-amber-500"
          value={String(stats?.totalSkuCount ?? 0)}
          label="库存SKU总数"
        />
        <StatCard
          icon={<AlertTriangle className="text-white" size={24} />}
          iconBg="bg-rose-500"
          value={String(stats?.pendingDocCount ?? 0)}
          label="待审单据数"
        />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white rounded-lg p-5 shadow-sm">
          <div className="text-base font-medium text-gray-800 mb-3">近30天销售趋势</div>
          <SafeChart option={lineOption} style={{ height: 280 }} />
        </div>
        <div className="bg-white rounded-lg p-5 shadow-sm">
          <div className="text-base font-medium text-gray-800 mb-3">畅销款TOP10</div>
          <SafeChart option={barOption} style={{ height: 280 }} />
        </div>
      </div>

      {/* 库存预警 */}
      <div className="bg-white rounded-lg p-5 shadow-sm">
        <div className="text-base font-medium text-gray-800 mb-3">库存预警</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="text-left py-2 px-3 font-medium">款号</th>
              <th className="text-left py-2 px-3 font-medium">颜色</th>
              <th className="text-left py-2 px-3 font-medium">尺码</th>
              <th className="text-left py-2 px-3 font-medium">仓库</th>
              <th className="text-right py-2 px-3 font-medium">现存量</th>
              <th className="text-right py-2 px-3 font-medium">安全库存下限</th>
              <th className="text-left py-2 px-3 font-medium">预警类型</th>
            </tr>
          </thead>
          <tbody>
            {warnings.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">暂无预警数据</td>
              </tr>
            ) : (
              warnings.map((item: InventoryWarningItem, idx: number) => {
                const isBelow = item.warningType === 'below_min';
                return (
                  <tr key={idx} className="border-b border-gray-100 h-10">
                    <td className={`py-2 px-3 ${isBelow ? 'text-red-500' : ''}`}>{item.styleNo}</td>
                    <td className={`py-2 px-3 ${isBelow ? 'text-red-500' : ''}`}>{item.color}</td>
                    <td className={`py-2 px-3 ${isBelow ? 'text-red-500' : ''}`}>{item.size}</td>
                    <td className={`py-2 px-3 ${isBelow ? 'text-red-500' : ''}`}>{item.warehouseName}</td>
                    <td className={`py-2 px-3 text-right ${isBelow ? 'text-red-500' : ''}`}>{item.quantity}</td>
                    <td className={`py-2 px-3 text-right ${isBelow ? 'text-red-500' : ''}`}>{item.safetyMin}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${isBelow ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
                        {isBelow ? '低于下限' : '高于上限'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DashboardPage;
