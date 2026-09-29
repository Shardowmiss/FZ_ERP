/**
 * 日志脱敏工具（P1-6 纵深防御）。
 *
 * 背景：本系统 `logger.emitLog` 对任意 `extra` 对象原样序列化。一旦有人把整包
 * DTO / 请求体 / 登录参数丢进日志，password / phone / idCard / token 等敏感字段会
 * 明文落盘。此前仅靠"约定别打敏感字段"——属于**无强制力的约定**，迟早泄漏。
 *
 * 本模块提供 `desensitize()`：对对象**递归**遮蔽已知敏感键，让 `emitLog` 在序列化前
 * 先过一道边界。敏感键清单与 ERP 侧 `common/data-scope/pii.ts`（接口响应脱敏）对齐，
 * 但本工具作用于「日志」这一独立面。
 */

/** 敏感键（小写匹配）。命中即遮蔽为 '***'。 */
const SENSITIVE_KEYS = new Set<string>([
  'password',
  'pwd',
  'passwd',
  'credential',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'x-auth-token',
  'cookie',
  'idcard',
  'id_card',
  'idno',
  'idnumber',
  'id_number',
  'phone',
  'mobile',
  'tel',
  'bankcard',
  'bank_card',
  'cardno',
  'cvv',
  'paypwd',
  'pay_password',
]);

/** 主键正则（命中整值也遮蔽，用于兜底身份证/手机/卡号这类值）。 */
const SENSITIVE_VALUE_RE = /(^\d{15,19}$)|(^\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dxX]$)/;

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  // 前缀匹配 passwordHash / tokenXxx 之类
  if (k.includes('password') || k.includes('token') || k.includes('secret') || k.includes('credential')) {
    return true;
  }
  return SENSITIVE_KEYS.has(k);
}

function maskScalar(value: unknown): unknown {
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE_RE.test(value)) return '***';
    return value;
  }
  return value;
}

/**
 * 递归脱敏：遍历对象/数组，命中敏感键的**标量**值替换为 '***'；
 * 非敏感键继续向下递归，保留结构。循环引用以 WeakSet 兜底防止死循环。
 */
export function desensitize<T>(input: T, seen = new WeakSet<object>()): T {
  if (input === null || input === undefined) return input;

  if (Array.isArray(input)) {
    return input.map((item) => desensitize(item, seen)) as unknown as T;
  }

  if (typeof input === 'object') {
    // 循环引用兜底
    if (seen.has(input as object)) return '[Circular]' as unknown as T;
    seen.add(input as object);

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = '***';
        continue;
      }
      // 值本身也可能命中（身份证/手机号这类裸值），对标量再遮一遍
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[key] = maskScalar(value);
      } else {
        out[key] = desensitize(value, seen);
      }
    }
    return out as unknown as T;
  }

  // 标量直接返回
  return maskScalar(input) as unknown as T;
}
