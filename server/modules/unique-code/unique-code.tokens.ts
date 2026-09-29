/**
 * 唯一码引擎的共享契约层：配置键、状态字典与纯函数工具。
 *
 * 从 unique-code.service.ts 拆分出来，供 ①~⑥ 各子域服务共同引用，
 * 保证「一处定义、处处一致」——避免拆分后各文件各自复制一份字面量。
 */

/* ----------------------------- 配置键 ----------------------------- */

export const K_ENABLED = 'UNIQUE_CODE_ENABLED';
export const K_ENABLED_OLD = 'HANGTAG_UNIQUE_CODE_ENABLED';
export const K_PREFIX = 'UNIQUE_CODE_PREFIX';
export const K_CHECKSUM = 'UNIQUE_CODE_CHECKSUM';
export const K_ARCHIVE_DAYS = 'UNIQUE_CODE_ARCHIVE_DAYS';

/* ----------------------------- 状态字典 ----------------------------- */

export type UcStatus = 'in_stock' | 'out' | 'sold' | 'returned';

/** 扫码动作 → 中文名称（用于溯源时间线展示） */
export const SCAN_TYPE_LABEL: Record<string, string> = {
  inbound: '入库登记',
  outbound: '出库',
  sold: '结算核销',
  returned: '退货回库',
};

/** 单据类型 → 中文名称（用于溯源/报表展示） */
export const DOC_TYPE_LABEL: Record<string, string> = {
  purchase_inbound: '采购入库单',
  sales_outbound: '销售出库单',
  retail: '零售单',
  sales_return: '销售退货单',
  transfer: '调拨单',
  stocktake: '盘点单',
};

/** 件级状态 → 中文名称 */
export const STATUS_LABEL: Record<string, string> = {
  in_stock: '在库可用',
  out: '已出库未核销',
  sold: '已售核销',
  returned: '退回在库',
};

/** 扫码动作 → 出入方向（用于溯源时间线视觉区分） */
export function directionOf(scanType: string): '入' | '出' | '核' | '退' {
  switch (scanType) {
    case 'inbound':
      return '入';
    case 'outbound':
      return '出';
    case 'sold':
      return '核';
    case 'returned':
      return '退';
    default:
      return '出';
  }
}

/* ----------------------------- 解析结果类型 ----------------------------- */

export interface ParseTagResult {
  styleNo: string;
  color: string;
  size: string;
  uniqueCode?: string;
  skuId?: string;
  matched: boolean;
  message?: string;
}

export type ScanResult =
  | {
      ok: true;
      data: {
        uniqueCode: string;
        skuId: string;
        styleNo: string;
        color: string;
        size: string;
      };
    }
  | {
      ok: false;
      reason:
        | 'disabled'
        | 'not_in_stock'
        | 'not_available'
        | 'wrong_warehouse'
        | 'style_mismatch'
        | 'already_scanned'
        | 'missing_unique_code'
        | 'bad_checksum';
      message: string;
    };

/* ============================ 防伪工具 ============================ */

/**
 * 校验位：前缀/年份/补零数字 各数位之和 mod 10（单字符 0-9）。
 * 仅当启用校验位时附加在唯一码末尾，用于降低"错扫一位"导致的串货误判。
 */
export function checksumDigit(body: string): string {
  let sum = 0;
  for (const ch of body) {
    if (ch >= '0' && ch <= '9') sum += Number(ch);
  }
  return String(sum % 10);
}

/** 构建完整唯一码：前缀(品牌码+年份) + 补零数字 + [校验位] */
export function buildUniqueCode(
  n: number,
  length: number,
  prefix: string | null,
  withChecksum: boolean,
): string {
  let body = String(n).padStart(Math.max(1, length), '0');
  if (prefix) body = prefix + body;
  if (withChecksum) body = body + checksumDigit(body);
  return body;
}

/** 从完整唯一码还原数字部分（剥离前缀与校验位） */
export function extractNumeric(
  fullCode: string,
  prefix: string | null,
  withChecksum: boolean,
): number {
  let s = fullCode;
  if (withChecksum) s = s.slice(0, -1);
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length);
  return parseInt(s, 10);
}

/** 校验位合法性（启用校验位时调用） */
export function validateChecksum(fullCode: string): boolean {
  if (fullCode.length < 2) return false;
  const body = fullCode.slice(0, -1);
  const check = fullCode.slice(-1);
  return checksumDigit(body) === check;
}
