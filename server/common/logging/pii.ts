/**
 * 日志脱敏工具（P1-6 纵深防御）。
 *
 * 背景：本仓库 `logger.emitLog` 对任意 `extra` 对象原样序列化输出；
 * 全站"敏感信息先脱敏"此前只靠约定（开发者自己记得别打 password/phone）。
 * 一旦有人把整个 DTO / 请求体 / 第三方回参丢进日志，密码、手机号、令牌就会明文落盘。
 *
 * 本模块提供 `desensitize()`：在 `emitLog` 边界统一对**即将写出**的 every object
 * 递归遮蔽已知敏感键，使"误打敏感字段"不再泄漏。属纵深防御，业务代码零改造。
 */

/** 命中即整值遮蔽的敏感键（大小写不敏感，按子串匹配）。 */
const SENSITIVE_KEY_PATTERNS = [
  'password', 'passwd', 'pwd', 'secret', 'credential', 'token', 'authorization',
  'x-auth-token', 'cookie', 'set-cookie', 'csrf', 'apikey', 'api_key',
  'accesstoken', 'refreshtoken', 'idcard', 'id_card', 'idno', 'idnumber',
  'id_number', 'bankcard', 'bank_card', 'cardno', 'certno', 'cvv',
];

/** 命中即按手机号规则遮蔽的键。 */
const PHONE_KEYS = ['phone', 'mobile', 'tel', 'cellphone', 'contactphone'];

/** 命中即按证件号规则遮蔽的键。 */
const ID_CARD_KEYS = ['idcard', 'id_card', 'idno', 'idnumber', 'id_number', 'certno'];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

/** 通用字符串遮蔽：保留首尾少量字符，中间打码。 */
export function maskGeneric(v: string): string {
  if (v.length <= 2) return '***';
  if (v.length <= 6) return `${v.slice(0, 1)}***${v.slice(-1)}`;
  return `${v.slice(0, 2)}****${v.slice(-2)}`;
}

/** 手机号脱敏：保留前 3 后 4 位，其余以 * 代替；空值原样返回。 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const s = phone.trim();
  if (s.length <= 7) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 证件号脱敏：保留前 4 后 4 位，其余以 * 代替；空值原样返回。 */
export function maskIdCard(id?: string | null): string | null {
  if (!id) return id ?? null;
  const s = id.trim();
  if (s.length <= 8) return '********';
  return `${s.slice(0, 4)}**********${s.slice(-4)}`;
}

/**
 * 递归脱敏。对对象/数组深度遍历，按键名遮蔽敏感字段；不修改入参，返回新结构。
 * - 敏感键（password/token/secret/...）→ 整值打码
 * - phone/mobile 等 → 手机号掩码
 * - idCard/证件类 → 证件号掩码
 * - 其余对象/数组 → 继续递归
 * - 超过 6 层 → 截断，避免超深对象撑爆日志
 */
export function desensitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…(truncated)';
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => desensitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const kl = k.toLowerCase();
      if (isSensitiveKey(k)) {
        out[k] = typeof v === 'string' && v ? maskGeneric(v) : '***';
      } else if (PHONE_KEYS.some((p) => kl.includes(p))) {
        out[k] = maskPhone(typeof v === 'string' ? v : String(v ?? ''));
      } else if (ID_CARD_KEYS.some((p) => kl.includes(p))) {
        out[k] = maskIdCard(typeof v === 'string' ? v : String(v ?? ''));
      } else {
        out[k] = desensitize(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}
