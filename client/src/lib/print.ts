/**
 * 通用打印工具（P1-7）
 *
 * 通过隐藏 iframe 承载一段完整 HTML 并调用其 print()，
 * 避免依赖当前页面的 Tailwind 样式，保证打印结果稳定。
 */
export function printHtmlDocument(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();

  const doPrint = (): void => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    }
  };

  if (doc.readyState === 'complete') {
    setTimeout(doPrint, 200);
  } else {
    iframe.onload = () => setTimeout(doPrint, 200);
  }
}

/** 触发浏览器下载（CSV / 文本导出用） */
export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8;'): void {
  // 加 BOM，避免 Excel 打开 CSV 中文乱码
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
