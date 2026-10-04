/**
 * 列表表格已提升为通用组件 client/src/components/ListTable.tsx（补齐 loading/empty/error 三态）。
 * 此处保留转发导出，避免破坏既有引用；状态映射与时间格式化等工具仍在此维护。
 */
export { default } from '@client/src/components/ListTable';
export type { ListTableProps } from '@client/src/components/ListTable';

// P0-4：色彩令牌统一收敛到 StatusTone，与 client/src/components/ui/status-badge 同源
const TONE_PILL: Record<string, string> = {
  ok: 'bg-pos-ok-bg text-pos-ok',
  warn: 'bg-pos-warn-bg text-pos-warn',
  danger: 'bg-pos-danger-bg text-pos-danger',
  info: 'bg-pos-info-bg text-pos-info',
  neutral: 'bg-pos-paper text-pos-ink-2',
};

export const statusColorMap: Record<string, string> = {
  // 中文兼容
  已完成: TONE_PILL.ok,
  已入库: TONE_PILL.ok,
  待审批: TONE_PILL.warn,
  待收货: TONE_PILL.warn,
  处理中: TONE_PILL.info,
  已拒绝: TONE_PILL.danger,
  进行中: TONE_PILL.info,
  // 英文（后端实际返回）
  pending: TONE_PILL.warn,
  submitted: TONE_PILL.warn,
  draft: TONE_PILL.warn,
  received: TONE_PILL.ok,
  audited: TONE_PILL.ok,
  completed: TONE_PILL.ok,
  approved: TONE_PILL.ok,
  rejected: TONE_PILL.danger,
  processing: TONE_PILL.info,
  cancelled: TONE_PILL.neutral,
};

export function getStatusClass(status: string): string {
  return `px-2 py-0.5 rounded-md font-medium ${statusColorMap[status] || TONE_PILL.neutral}`;
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
