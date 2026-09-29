/**
 * 安全读取 timestamptz custom type 值。
 * schema 中 customTimestamptz.fromDriver 未处理 null，
 * new Date(null) 会返回 1970-01-01，这里兜底为 null。
 */
export function safeDate(value: Date | null | undefined): Date | null {
  if (value == null) return null;
  return value;
}

/**
 * 将 Date 安全转为 ISO string，null 返回 null。
 * service 层向接口输出时间字段时统一使用。
 */
export function dateToIso(value: Date | null | undefined): string | null {
  if (value == null) return null;
  return value.toISOString();
}

/**
 * 安全读取 user_profile custom type 值。
 * schema 中 userProfile.fromDriver 对 null 会调用 slice(null) 抛错，
 * 这里在查询结果使用前兜底。
 */
export function safeUserProfile(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value;
}

/**
 * 安全读取 file_attachment custom type 值。
 */
export function safeFileAttachment<T>(value: T | null | undefined): T | null {
  if (value == null) return null;
  return value;
}
