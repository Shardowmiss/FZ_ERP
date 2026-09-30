import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { uniqueCodeApi, type PublicTrace } from '@client/src/api/uniqueCode';
import { Card, CardContent, CardHeader, CardTitle } from '@client/src/components/ui/card';
import { Badge } from '@client/src/components/ui/badge';
import { CHART_PRIMARY } from '@client/src/lib/chart-colors';

/* ------------------------------------------------------------------ *
 * 公开溯源页（消费者 / 门店扫码直达，无需登录）
 *
 * 路由：/trace/:code
 * 数据：GET /api/trace-public/:code（后端已剥离操作人 / 内部单号等内部字段）
 *
 * 说明：本页独立于后台 ProtectedRoute，面向终端消费者；
 * 仅展示"消费者应看"的信息（款色码 / 当前状态 / 采购入库仓 / 当前仓 /
 * 是否串货嫌疑 / 简化时间线），不含任何内部操作员与内部单据信息。
 * ------------------------------------------------------------------ */

const DIRECTION_LABEL: Record<string, string> = {
  '入': '入库',
  '出': '出库',
  '核': '核销',
  '退': '退货',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  inbound: '采购 / 调拨入库',
  outbound: '销售出库',
  sold: '门店结算',
  returned: '退货回库',
};

function fmtTime(s: string): string {
  if (!s) return '-';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const UniqueCodePublicTracePage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const decoded = code ? decodeURIComponent(code) : '';
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!decoded) {
      setLoading(false);
      setError('缺少唯一码参数');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    uniqueCodeApi
      .publicTrace(decoded)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        logger.error('公开溯源查询失败', e);
        setError(e?.response?.data?.message || '查询失败，请稍后重试');
        toast.error('溯源查询失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '32px 16px',
        fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>商品溯源</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            扫码查询该件商品的流转记录
          </div>
        </div>

        {loading && (
          <Card>
            <CardContent style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
              正在查询…
            </CardContent>
          </Card>
        )}

        {!loading && error && (
          <Card>
            <CardContent style={{ padding: 24, textAlign: 'center', color: '#dc2626' }}>
              {error}
            </CardContent>
          </Card>
        )}

        {!loading && !error && data && !data.found && (
          <Card>
            <CardContent style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🔍</div>
              <div style={{ fontWeight: 600, color: '#0f172a' }}>未查询到该唯一码</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
                码号：{data.uniqueCode || decoded}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                该码尚未登记入库，或为非本系统发行的吊牌。
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && !error && data && data.found && (
          <Card>
            <CardHeader style={{ paddingBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <CardTitle style={{ fontSize: 18 }}>溯源结果</CardTitle>
                <Badge variant={data.authentic ? 'default' : 'secondary'}>
                  {data.authentic ? '验真通过' : '无法验真'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent style={{ paddingTop: 0 }} className="space-y-3">
              {/* 基础信息 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 14 }}>
                <div style={{ color: '#64748b' }}>唯一码</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{data.uniqueCode}</div>
                <div style={{ color: '#64748b' }}>款 / 色 / 码</div>
                <div>
                  {[data.styleNo, data.color, data.size].filter(Boolean).join(' / ') || '-'}
                </div>
                <div style={{ color: '#64748b' }}>当前状态</div>
                <div>{data.currentStatusLabel || '-'}</div>
                <div style={{ color: '#64748b' }}>采购入库仓</div>
                <div>{data.purchaseOriginWarehouseName || '—'}</div>
                <div style={{ color: '#64748b' }}>当前所在仓</div>
                <div>{data.currentWarehouseName || '—'}</div>
              </div>

              {data.channelCrossingSuspect && (
                <div
                  style={{
                    marginTop: 4,
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: 13,
                  }}
                >
                  ⚠️ 该商品疑似发生跨渠道串货，记录供品牌方核查。
                </div>
              )}

              {/* 时间线 */}
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
                  流转记录（{data.eventCount} 条）
                </div>
                {data.events.length === 0 && (
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>暂无流转记录</div>
                )}
                <div style={{ position: 'relative', paddingLeft: 16 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 5,
                      top: 4,
                      bottom: 4,
                      width: 2,
                      background: '#e2e8f0',
                    }}
                  />
                  {data.events.map((ev, i) => (
                    <div key={i} style={{ position: 'relative', paddingBottom: 14 }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: -16,
                          top: 4,
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: CHART_PRIMARY,
                          border: '2px solid #fff',
                          boxShadow: '0 0 0 1px #bfdbfe',
                        }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 14 }}>
                          {EVENT_TYPE_LABEL[ev.eventType] || ev.eventType}
                        </span>
                        <Badge variant="outline">{DIRECTION_LABEL[ev.direction] || ev.direction}</Badge>
                        {ev.warehouseName && (
                          <span style={{ fontSize: 13, color: '#64748b' }}>{ev.warehouseName}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                        {fmtTime(ev.scanAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
                本页仅展示消费者可见的溯源信息，不含任何内部操作员与内部单据数据。
              </div>
            </CardContent>
          </Card>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#cbd5e1', marginTop: 16 }}>
          Powered by ERP 唯一码溯源
        </div>
      </div>
    </div>
  );
};

export default UniqueCodePublicTracePage;
