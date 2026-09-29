function formatCsvField(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDateSuffix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function exportToCSV(
  filename: string,
  data: Array<Record<string, unknown>>,
  columns: Array<{ key: string; label: string }>
): void {
  const header = columns.map((c) => formatCsvField(c.label)).join(",");
  const rows = data.map((row) =>
    columns.map((c) => formatCsvField(row[c.key])).join(",")
  );
  const csv = "\uFEFF" + [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}_${formatDateSuffix()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTableToCSV<T extends Record<string, unknown>>(
  filename: string,
  items: T[],
  columnMap: Record<string, string>
): void {
  const columns = Object.entries(columnMap).map(([key, label]) => ({
    key,
    label,
  }));
  exportToCSV(filename, items, columns);
}
