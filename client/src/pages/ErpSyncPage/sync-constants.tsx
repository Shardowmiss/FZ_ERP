import {
  Package, Tag, Zap, Users, Truck, Database,
  CheckCircle2, AlertCircle, Clock, RefreshCw, XCircle,
} from 'lucide-react';
import type { ErpSyncStatus } from '@shared/api.interface';

export const downTypeIconMap: Record<string, React.ComponentType<{ size?: number }>> = {
  goods: Package,
  price: Tag,
  promotion: Zap,
  member: Users,
  transfer: Truck,
  stock: Database,
};

export const downTypeNameMap: Record<string, string> = {
  goods: '商品主数据',
  price: '价格数据',
  promotion: '促销活动',
  member: '会员数据',
  transfer: '调拨单',
  stock: '库存数据',
};

export const upTypeNameMap: Record<string, string> = {
  retail: '零售单',
  return: '退货单',
  check: '盘点单',
  requisition: '要货申请',
  memberRegister: '新会员注册',
  dailyClosing: '日结数据',
};

export const apiInterfaces = [
  { name: '商品主数据查询', path: '/api/v1/goods/list', method: 'GET', direction: '下行', desc: '按增量拉取ERP款色码主数据', status: '正常' },
  { name: '价格数据查询', path: '/api/v1/price/list', method: 'GET', direction: '下行', desc: '获取指定门店的零售价/会员价', status: '正常' },
  { name: '促销活动查询', path: '/api/v1/promotion/list', method: 'GET', direction: '下行', desc: '下载生效中的促销规则和优惠组合', status: '正常' },
  { name: '会员信息查询', path: '/api/v1/member/query', method: 'GET', direction: '下行', desc: '按手机号/会员ID查询会员档案', status: '正常' },
  { name: '库存数据查询', path: '/api/v1/stock/query', method: 'GET', direction: '下行', desc: '获取实时库存与在途数量', status: '正常' },
  { name: '调拨单查询', path: '/api/v1/transfer/list', method: 'GET', direction: '下行', desc: '下载门店调拨入库通知单', status: '正常' },
  { name: '零售单上传', path: '/api/v1/retail/upload', method: 'POST', direction: '上行', desc: '上传门店零售销售单据', status: '正常' },
  { name: '退货单上传', path: '/api/v1/return/upload', method: 'POST', direction: '上行', desc: '上传门店退货退款单据', status: '正常' },
  { name: '盘点单上传', path: '/api/v1/check/upload', method: 'POST', direction: '上行', desc: '上传门店盘点盈亏结果', status: '正常' },
  { name: '要货申请上传', path: '/api/v1/requisition/upload', method: 'POST', direction: '上行', desc: '提交门店要货申请单', status: '正常' },
  { name: '新会员上传', path: '/api/v1/member/register', method: 'POST', direction: '上行', desc: '上传新注册会员信息', status: '正常' },
  { name: '日结数据上传', path: '/api/v1/daily-closing/upload', method: 'POST', direction: '上行', desc: '上传门店每日日结汇总', status: '正常' },
  { name: '离线批量重放', path: '/api/offline-sync/sync/batch', method: 'POST', direction: '上行', desc: '幂等键 clientId，支持 sale_order/return_order/member/stock_adjust/stocktake/transfer_request 等实体批量重放，冲突返回 conflictType 字段', status: '正常' },
  { name: '主数据快照', path: '/api/offline-sync/master-data', method: 'GET', direction: '下行', desc: '下载全量主数据快照（商品/价格/促销/会员/库存）用于离线初始化', status: '正常' },
];

export function formatDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const statusIconMap: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={16} className="text-pos-ok" />,
  syncing: <RefreshCw size={16} className="text-pos-accent animate-spin" />,
  pending: <Clock size={16} className="text-pos-ink-3" />,
  warning: <AlertCircle size={16} className="text-pos-warn" />,
  failed: <XCircle size={16} className="text-pos-danger" />,
};

export const statusTextMap: Record<string, string> = {
  success: '同步成功',
  syncing: '同步中',
  pending: '待同步',
  warning: '延迟警告',
  failed: '同步失败',
};

export function mapStatus(s: string): string {
  const lower = s.toLowerCase();
  if (lower.includes('success') || lower === 'ok') return 'success';
  if (lower.includes('sync') || lower.includes('ing') || lower === 'running') return 'syncing';
  if (lower.includes('warn') || lower.includes('delay') || lower === 'delayed') return 'warning';
  if (lower.includes('fail') || lower.includes('error')) return 'failed';
  if (lower.includes('pend')) return 'pending';
  return 'success';
}

export function getTaskName(dataType: string): string {
  return downTypeNameMap[dataType] ?? upTypeNameMap[dataType] ?? dataType;
}

export interface DownCardProps {
  item: ErpSyncStatus;
  onSync: (type: string) => void;
  syncing: boolean;
}
