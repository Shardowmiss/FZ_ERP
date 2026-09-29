export function validateDateRange(
  startDate?: string,
  endDate?: string
): string | null {
  if (startDate && endDate && startDate > endDate) {
    return "开始日期不能晚于结束日期";
  }
  return null;
}
