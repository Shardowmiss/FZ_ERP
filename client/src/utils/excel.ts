/**
 * 极简 xlsx 读写工具（零额外依赖）。
 *
 * 约束背景：本工程 npm broker 拒绝安装 xlsx / SheetJS，而客户端需要「Excel 格式」的
 * 模板下载 + 上传解析。因此基于已装依赖 fflate(zip 编解码) + 浏览器原生 DOMParser
 * 手写最小可用 OOXML 读写，仅覆盖「模板生成 + 受控模板解析」场景。
 *
 * 读：支持 inlineStr（本工具生成）/ sharedStrings（真实 Excel 写出，最常见）/ 数字 / 布尔 / 公式字符串。
 * 写：一律 inlineStr（避免 sharedStrings 复杂度），数字按数值写入。
 * 只取 workbook 中第一个 sheet。
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Excel 列字母(A,B,...,Z,AA) -> 0 基索引 */
function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

/** 0 基索引 -> Excel 列字母 */
function indexToCol(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 拼接一个 XML 节点下所有 <t> 后代的文本（处理 rich text 多 <r><t> 与 inlineStr） */
function extractText(node: Element): string {
  const ts = node.getElementsByTagName('t');
  let s = '';
  for (let i = 0; i < ts.length; i++) {
    s += ts[i].textContent || '';
  }
  return s;
}

function getFirstByTag(el: Element, tag: string): Element | null {
  const list = el.getElementsByTagName(tag);
  return list.length ? list[0] : null;
}

function parseSheetXml(xml: string): string[][] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = doc.getElementsByTagName('row');
  const result: string[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].getElementsByTagName('c');
    const rowMap: Record<number, string> = {};
    let maxCol = -1;
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      const ref = cell.getAttribute('r') || '';
      const letters = ref.replace(/[0-9]/g, '');
      const colIdx = letters ? colToIndex(letters) : c;
      const t = cell.getAttribute('t');
      let val = '';
      if (t === 'inlineStr') {
        val = extractText(cell);
      } else if (t === 's') {
        const v = getFirstByTag(cell, 'v');
        if (v && v.textContent) {
          const idx = parseInt(v.textContent, 10);
          val = Number.isFinite(idx) && (globalThis as any).__sharedStrings && (globalThis as any).__sharedStrings[idx] != null
            ? (globalThis as any).__sharedStrings[idx]
            : '';
        }
      } else if (t === 'str') {
        const v = getFirstByTag(cell, 'v');
        val = v ? v.textContent || '' : '';
      } else if (t === 'b') {
        const v = getFirstByTag(cell, 'v');
        val = v ? (v.textContent === '1' ? 'TRUE' : 'FALSE') : '';
      } else {
        // 数字或类型缺省
        const v = getFirstByTag(cell, 'v');
        val = v ? v.textContent || '' : '';
      }
      rowMap[colIdx] = val;
      if (colIdx > maxCol) maxCol = colIdx;
    }
    const arr: string[] = [];
    for (let i = 0; i <= maxCol; i++) arr.push(rowMap[i] ?? '');
    result.push(arr);
  }
  return result;
}

function findFile(files: Record<string, Uint8Array>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(files).find((k) => k.toLowerCase() === lower);
}

function findByPattern(files: Record<string, Uint8Array>, re: RegExp): string | undefined {
  return Object.keys(files).find((k) => re.test(k));
}

/**
 * 解析 xlsx ArrayBuffer 为二维字符串数组（行 x 列）。
 * 数字单元格返回其字符串表示，空单元格返回 ''。
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const files = unzipSync(new Uint8Array(buffer));

  // 1) sharedStrings（真实 Excel 最常见）
  const ssKey = findFile(files, 'xl/sharedStrings.xml');
  const shared: string[] = [];
  if (ssKey) {
    const doc = new DOMParser().parseFromString(strFromU8(files[ssKey]), 'application/xml');
    const sis = doc.getElementsByTagName('si');
    for (let i = 0; i < sis.length; i++) shared.push(extractText(sis[i]));
  }
  (globalThis as any).__sharedStrings = shared;

  // 2) workbook + rels 定位第一个 sheet 文件
  let sheetFile = 'xl/worksheets/sheet1.xml';
  const wbKey = findFile(files, 'xl/workbook.xml');
  if (wbKey) {
    const wbDoc = new DOMParser().parseFromString(strFromU8(files[wbKey]), 'application/xml');
    const sheets = wbDoc.getElementsByTagName('sheet');
    if (sheets.length) {
      const rid = sheets[0].getAttributeNS(R_NS, 'id') || sheets[0].getAttribute('r:id');
      if (rid) {
        const relsKey = findFile(files, 'xl/_rels/workbook.xml.rels');
        if (relsKey) {
          const relsDoc = new DOMParser().parseFromString(strFromU8(files[relsKey]), 'application/xml');
          const rels = relsDoc.getElementsByTagName('Relationship');
          for (let i = 0; i < rels.length; i++) {
            if (rels[i].getAttribute('Id') === rid) {
              const target = rels[i].getAttribute('Target') || '';
              sheetFile = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
              break;
            }
          }
        }
      }
    }
  }

  const sheetKey =
    findFile(files, sheetFile) || findByPattern(files, /xl\/worksheets\/sheet\d+\.xml$/i);
  if (!sheetKey) {
    delete (globalThis as any).__sharedStrings;
    throw new Error('Excel 文件中未找到工作表');
  }
  const result = parseSheetXml(strFromU8(files[sheetKey]));
  delete (globalThis as any).__sharedStrings;
  return result;
}

/** 读取本地 Excel 文件并解析为二维字符串数组 */
export async function parseXlsxFile(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  return parseXlsx(buf);
}

/** 把二维数据(含表头)打包为 xlsx 字节流 */
export function buildXlsx(rows: (string | number)[][]): Uint8Array {
  const sheetRows = rows
    .map((row, ri) => {
      const cells = row
        .map((cell, ci) => {
          const ref = `${indexToCol(ci)}${ri + 1}`;
          const raw = cell === null || cell === undefined ? '' : String(cell);
          const isNum = raw !== '' && /^-?\d+(\.\d+)?$/.test(raw);
          if (isNum) {
            return `<c r="${ref}"><v>${escapeXml(raw)}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(raw)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${MAIN_NS}" xmlns:r="${R_NS}">
<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${MAIN_NS}"><sheetData>${sheetRows}</sheetData></worksheet>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rootRels),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
      'xl/worksheets/sheet1.xml': strToU8(worksheet),
    },
    { level: 6 },
  );
}

/** 生成并下载 xlsx 文件 */
export function downloadXlsx(rows: (string | number)[][], filename: string): void {
  const bytes = buildXlsx(rows);
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
