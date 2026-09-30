import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { analyticsApi } from '@client/src/api/analytics';
import type { LifecycleItem } from '@shared/api.interface';
import { errMsg } from '@/utils/errMsg';

const STATUS_LABEL: Record<string, string> = {
  introduction: '导入期',
  growth: '成长期',
  maturity: '成熟期',
  decline: '衰退期',
};
const VELOCITY_LABEL: Record<string, { text: string; cls: string }> = {
  hot: { text: '畅销', cls: 'bg-red-100 text-red-600' },
  normal: { text: '平销', cls: 'bg-blue-100 text-blue-600' },
  slow: { text: '动销慢', cls: 'bg-amber-100 text-amber-600' },
  dead: { text: '滞销', cls: 'bg-gray-200 text-gray-500' },
};

const LifecyclePage: React.FC = () => {
  const [list, setList] = useState<LifecycleItem[]>([]);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setList(await analyticsApi.lifecycle(days));
    } catch (e) {
      toast(errMsg(e, '加载失败'));
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [days]);

  const handleSet = async (styleNo: string, status: string) => {
    try {
      await analyticsApi.setLifecycle(styleNo, status);
      toast.success('已更新生命周期');
      load();
    } catch (e) {
      toast(errMsg(e, '更新失败'));
    }
  };

  return (
    <div className="p-5">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-800">商品企划生命周期</h1>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:border-primary"
          >
            <option value={30}>近30天动销</option>
            <option value={90}>近90天动销</option>
            <option value={180}>近180天动销</option>
          </select>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200 font-medium">
              <th className="px-3 py-2 text-left">款号</th>
              <th className="px-3 py-2 text-left">名称</th>
              <th className="px-3 py-2 text-left">类目</th>
              <th className="px-3 py-2 text-right">近{days}天销量</th>
              <th className="px-3 py-2 text-center">动销</th>
              <th className="px-3 py-2 text-center">生命周期</th>
              <th className="px-3 py-2 text-left">建议动作</th>
              <th className="px-3 py-2 text-center">调整</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">加载中...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={8} className="py-8 text-center text-gray-400">暂无数据</td></tr>
            ) : (
              list.map((it) => {
                const v = VELOCITY_LABEL[it.velocity] || VELOCITY_LABEL.normal;
                return (
                  <tr key={it.styleNo} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{it.styleNo}</td>
                    <td className="px-3 py-2 text-gray-700">{it.name}</td>
                    <td className="px-3 py-2 text-gray-600">{it.category || '-'}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{it.recentQty}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs ${v.cls}`}>{v.text}</span>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-700">
                      {STATUS_LABEL[it.lifecycleStatus] || it.lifecycleStatus}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{it.suggestedAction}</td>
                    <td className="px-3 py-2 text-center">
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) handleSet(it.styleNo, e.target.value); }}
                        className="px-2 py-1 border border-gray-300 rounded text-xs"
                      >
                        <option value="">设为...</option>
                        <option value="introduction">导入期</option>
                        <option value="growth">成长期</option>
                        <option value="maturity">成熟期</option>
                        <option value="decline">衰退期</option>
                      </select>
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

export default LifecyclePage;
