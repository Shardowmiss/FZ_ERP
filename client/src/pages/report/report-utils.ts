export function formatAmount(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '0.00';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatQty(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '0';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

export function formatDiscount(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return '-';
  return (value * 100).toFixed(1) + '%';
}
