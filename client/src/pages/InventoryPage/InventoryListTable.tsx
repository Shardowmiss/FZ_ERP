/**
 * 列表表格已提升为通用组件 client/src/components/ListTable.tsx（补齐 loading/empty/error 三态）。
 * 此处保留转发导出，避免破坏既有引用；状态映射与时间格式化等工具仍在此维护。
 */
export { default } from '@client/src/components/ListTable';
export type { ListTableProps } from '@client/src/components/ListTable';

export const statusColorMap: Record<string, string> = {
  // 中文兼容
  已完成: 'bg-pos-ok-bg text-pos-ok',
  已入库: 'bg-pos-ok-bg text-pos-ok',
  待审批: 'bg-pos-warn-bg text-pos-warn',
  待收货: 'bg-pos-warn-bg text-pos-warn',
  处理中: 'bg-pos-info-bg text-pos-info',
  已拒绝: 'bg-pos-danger-bg text-pos-danger',
  进行中: 'bg-pos-info-bg text-pos-info',
  // 英文（后端实际返回）
  pending: 'bg-pos-warn-bg text-pos-warn',
  submitted: 'bg-pos-warn-bg text-pos-warn',
  draft: 'bg-pos-warn-bg text-pos-warn',
  received: 'bg-pos-ok-bg text-pos-ok',
  audited: 'bg-pos-ok-bg text-pos-ok',
  completed: 'bg-pos-ok-bg text-pos-ok',
  approved: 'bg-pos-ok-bg text-pos-ok',
  rejected: 'bg-pos-danger-bg text-pos-danger',
  processing: 'bg-pos-info-bg text-pos-info',
  cancelled: 'bg-pos-paper text-pos-ink-3',
};

export function getStatusClass(status: string): string {
  return `px-2 py-0.5 rounded-md font-medium ${statusColorMap[status] || 'bg-pos-paper text-pos-ink-3'}`;
}

export const statusLabelMap: Record<string, string> = {
  pending: '待收货',
  submitted: '待审批',
  draft: '草稿',
  received: '已入库',
  audited: '已审核',
  completed: '已完成',
  approved: '已审批',
  rejected: '已拒绝',
  processing: '处理中',
  cancelled: '已取消',
};

export function getStatusLabel(status: string): string {
  return statusLabelMap[status] || status;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}
