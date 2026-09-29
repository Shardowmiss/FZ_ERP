import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { uniqueCodeApi, type UniqueCodeTrace as UniqueCodeTraceData, type UniqueCodeTraceEvent } from '@client/src/api/uniqueCode';

/** 方向 → 颜色（用于时间线视觉区分） */
const DIR_COLOR: Record<string, string> = {
  入: '#16a34a', // 绿：入库 / 退货回库
  出: '#dc2626', // 红：出库（防串货重点）
  核: '#2563eb', // 蓝：结算核销
  退: '#9333ea', // 紫：退货动作
};

const STATUS_COLOR: Record<string, string> = {
  in_stock: '#16a34a',
  out: '#dc2626',
  sold: '#2563eb',
  returned: '#9333ea',
};

function fmt(t?: string | null): string {
  if (!t) return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t as string;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function EventNode({ e }: { e: UniqueCodeTraceEvent }) {
  const color = DIR_COLOR[e.direction] ?? '#475569';
  return (
    <div style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          marginTop: 6,
          background: color,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge style={{ background: color, color: '#fff' }}>{e.direction}</Badge>
          <strong>{e.eventType}</strong>
          <span style={{ color: '#666' }}>
            {e.docTypeName} · {e.docNo ?? e.docId}
          </span>
          {e.crossesChannel && (
            <Badge style={{ background: '#dc2626', color: '#fff' }}>串货嫌疑</Badge>
          )}
        </div>
        <div style={{ color: '#555', fontSize: 12, marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>仓库：{e.warehouseName ?? e.warehouseId ?? '—'}</span>
          <span>时间：{fmt(e.scanAt)}</span>
          {e.operatorId && <span>操作人：{e.operatorId}</span>}
          {(e.styleNo || e.color || e.size) && (
            <span>
              款色码：{e.styleNo}/{e.color}/{e.size}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export interface UniqueCodeTraceProps {
  /** 预填的唯一码；提供后自动查询 */
  code?: string;
  /** 紧凑模式（嵌入抽屉/弹窗，不渲染检索框） */
  compact?: boolean;
}

/**
 * 唯一码溯源组件：输入唯一码 → 展示当前状态卡 + 历史出入库时间线 + CSV 导出。
 * 直接调用 /api/unique-code/trace 与 /trace-export。
 */
export const UniqueCodeTrace: React.FC<UniqueCodeTraceProps> = ({ code: initCode, compact }) => {
  const [code, setCode] = useState(initCode ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<UniqueCodeTraceData | null>(null);

  const doQuery = useMemo(
    () => async (c: string) => {
      const v = (c || '').trim();
      if (!v) {
        setError('请输入唯一码');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const r = await uniqueCodeApi.trace(v);
        setTrace(r);
        if (!r.enabled) setError('唯一码功能未启用，无溯源数据');
        else if (!r.current && r.eventCount === 0) setError('未找到该唯一码的任何记录');
      } catch (e: any) {
        setError(e?.message ?? '查询失败');
        setTrace(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (initCode) doQuery(initCode);
  }, [initCode, doQuery]);

  const c = trace?.current;

  return (
    <div>
      {!compact && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            placeholder="输入唯一码，如 GM26000001"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doQuery(code);
            }}
          />
          <Button onClick={() => doQuery(code)} disabled={loading}>
            {loading ? '查询中…' : '溯源'}
          </Button>
        </div>
      )}

      {error && (
        <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 8 }}>{error}</div>
      )}

      {c && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            background: '#fafafa',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <strong style={{ fontSize: 16 }}>{trace?.uniqueCode}</strong>
            <Badge style={{ background: STATUS_COLOR[c.status] ?? '#475569', color: '#fff' }}>
              {c.statusLabel}
            </Badge>
            <span style={{ color: '#666' }}>
              {c.styleNo}/{c.color}/{c.size}
            </span>
            {trace?.channelCrossingSuspect && (
              <Badge style={{ background: '#dc2626', color: '#fff' }}>⚠ 串货嫌疑</Badge>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
            <div>当前仓库：{c.warehouseName ?? '—'}</div>
            <div>入库来源：{c.inboundDocTypeName ?? '—'} {c.inboundDocNo ?? c.inboundDocId ?? ''}</div>
            <div>入库时间：{fmt(c.inboundAt)}</div>
            <div>出库来源：{c.outboundDocTypeName ?? '—'} {c.outboundDocNo ?? c.outboundDocId ?? ''}</div>
            <div>出库时间：{fmt(c.outboundAt)}</div>
            <div>
              <a style={{ color: '#2563eb' }} href={uniqueCodeApi.traceExportUrl(trace!.uniqueCode)}>
                导出 CSV
              </a>
            </div>
          </div>
        </div>
      )}

      {trace && trace.eventCount > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            历史出入库流水（按时间升序，共 {trace.eventCount} 条）
          </div>
          {trace.events.map((e) => (
            <EventNode key={e.seq} e={e} />
          ))}
        </div>
      )}
    </div>
  );
};

export default UniqueCodeTrace;
