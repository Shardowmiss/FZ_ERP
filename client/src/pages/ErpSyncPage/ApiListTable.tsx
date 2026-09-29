import { CheckCircle2 } from 'lucide-react';
import { apiInterfaces } from './sync-constants';

export default function ApiListTable() {
  return (
    <div className="bg-white rounded-xl border border-pos-line shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-pos-line flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-pos-ink">接口清单</span>
          <span className="text-xs text-pos-ink-3 ml-2">共 {apiInterfaces.length} 个接口</span>
        </div>
        <div className="text-xs text-pos-ink-3">
          下行 6 · 上行 6
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-pos-paper">
          <tr>
            <th className="text-left font-semibold text-pos-ink px-4 py-2.5">接口名称</th>
            <th className="text-left font-semibold text-pos-ink px-4 py-2.5">接口地址</th>
            <th className="text-center font-semibold text-pos-ink px-4 py-2.5">方法</th>
            <th className="text-center font-semibold text-pos-ink px-4 py-2.5">方向</th>
            <th className="text-left font-semibold text-pos-ink px-4 py-2.5">用途说明</th>
            <th className="text-center font-semibold text-pos-ink px-4 py-2.5">状态</th>
          </tr>
        </thead>
        <tbody>
          {apiInterfaces.map((api, idx) => (
            <tr key={idx} className="border-b border-pos-line-soft last:border-0 hover:bg-pos-accent-light/50">
              <td className="px-4 py-2.5 font-medium text-pos-ink">{api.name}</td>
              <td className="px-4 py-2.5 text-pos-ink-3 font-mono text-xs">{api.path}</td>
              <td className="px-4 py-2.5 text-center">
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                  api.method === 'GET'
                    ? 'bg-pos-ok-bg text-pos-ok'
                    : 'bg-pos-accent-light text-pos-accent'
                }`}>
                  {api.method}
                </span>
              </td>
              <td className="px-4 py-2.5 text-center">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  api.direction === '下行'
                    ? 'bg-pos-accent-light text-pos-accent'
                    : 'bg-pos-info-bg text-pos-info'
                }`}>
                  {api.direction}
                </span>
              </td>
              <td className="px-4 py-2.5 text-pos-ink-2 text-xs">{api.desc}</td>
              <td className="px-4 py-2.5 text-center">
                <span className="text-xs text-pos-ok flex items-center justify-center gap-1">
                  <CheckCircle2 size={12} /> {api.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
