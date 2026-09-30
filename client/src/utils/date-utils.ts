export function validateDateRange(
  startDate?: string,
  endDate?: string
): string | null {
  if (startDate && endDate && startDate > endDate) {
    return "开始日期不能晚于结束日期";
  }
  return null;
}

/** 将 Date 格式化为本地时区的 YYYY-MM-DD（避免 toISOString 的 UTC 偏移导致差一天）。 */
export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 计算「最近 N 天」日期窗（含今天）。
 * - endDate = 今天
 * - startDate = 今天往前推 (days-1) 天（days=1 时即仅今天）
 * 返回 YYYY-MM-DD 字符串，供日期筛选 <input type="date"> 与后端日期参数直接使用。
 */
export function defaultDateWindow(days: number): { startDate: string; endDate: string } {
  const n = Number.isFinite(days) && days > 0 ? Math.floor(days) : 90;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (n - 1));
  return { startDate: toLocalDateStr(start), endDate: toLocalDateStr(end) };
}

