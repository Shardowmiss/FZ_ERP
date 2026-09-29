/**
 * 门店设置本地持久化。
 *
 * 服务端目前只提供设置的只读接口（无设置表、无写入端点），
 * 因此这里把「小票模板 / 积分规则 / 支付方式开关 / 员工状态覆盖」
 * 落到 localStorage，保证刷新后仍在，而不是像之前那样用定时器伪造保存成功。
 *
 * 后续服务端补上 pos_settings 表后，只需把 read/write 换成接口调用即可。
 */

const KEY = 'yuncaipos_settings_v1';

export interface LocalSettings {
  receipt?: {
    title: string;
    welcome: string;
    printQr: boolean;
    returnTip: string;
  };
  points?: {
    pointsPerYuan: number;
    pointsPerDollar: number;
    birthdayDouble: boolean;
    validMonths: number;
  };
  /** 支付方式开关的本地覆盖：code -> enabled */
  paymentEnabled?: Record<string, boolean>;
  /** 员工启停的本地覆盖：id -> status */
  employeeStatus?: Record<string, string>;
  /** 门店资料本地覆盖 */
  store?: {
    name: string;
    code: string;
    address: string;
    phone: string;
    manager: string;
    openDate: string;
  };
}

export function readLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LocalSettings) : {};
  } catch {
    return {};
  }
}

export function writeLocalSettings(patch: LocalSettings): LocalSettings {
  const next: LocalSettings = { ...readLocalSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 隐私模式下写入失败不阻断操作 */
  }
  return next;
}

/** 合并读取：把本地覆盖应用到服务端返回的数据上 */
export function applyPaymentOverrides<T extends { code: string; enabled?: boolean }>(
  list: T[],
): T[] {
  const overrides = readLocalSettings().paymentEnabled;
  if (!overrides) return list;
  return list.map((x) =>
    overrides[x.code] === undefined ? x : { ...x, enabled: overrides[x.code] },
  );
}

export function applyEmployeeOverrides<T extends { id: string; status?: string }>(
  list: T[],
): T[] {
  const overrides = readLocalSettings().employeeStatus;
  if (!overrides) return list;
  return list.map((x) =>
    overrides[x.id] === undefined ? x : { ...x, status: overrides[x.id] },
  );
}
