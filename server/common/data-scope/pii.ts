import { RequestContext, ALL_SCOPE, type DealerScope } from '@server/common/context/request-context';
import { decryptField } from '@server/common/crypto/field-encryption';

/**
 * 会员 PII 脱敏（P1 · member 品牌级全局下的可见性控制）。
 *
 * 会员是品牌级全局实体（一个会员可跨多个经销商的门店消费），不能按 dealer 加列隔离，
 * 否则会破坏跨经销商会员模型。本模块在“受限（经销商级）作用域”下，对会员的手机号 /
 * 生日等敏感字段脱敏，避免经销商级后台账号 dumping 全品牌会员隐私；超管（全量作用域）
 * 原样返回。
 */

/** 当前是否处于受限（非超管 / 非全量）作用域。 */
export function isRestrictedScope(): boolean {
  const scope: DealerScope = RequestContext.getDealerScope() ?? ALL_SCOPE;
  return scope.type !== 'all';
}

/** 手机号脱敏：保留前 3 后 4 位，其余以 * 代替；空值原样返回。 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const s = phone.trim();
  if (s.length <= 7) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

/** 生日脱敏：受限作用域下不直接暴露完整生日，仅以掩码占位。 */
export function maskBirthday(birthday?: string | null): string | null {
  return birthday ? '****-**-**' : null;
}

export interface MemberPii {
  phone?: string | null;
  birthday?: string | null;
}

/**
 * 对单条会员记录的敏感字段脱敏（仅受限作用域生效；超管原样返回明文）。
 *
 * P0-2：phone 现已加密存储，必须先 decryptField 还原明文，再做脱敏/原样返回。
 *   · 超管/全量作用域：解密后原样返回（否则超管也只见密文）。
 *   · 受限作用域：解密后再脱敏。
 * decryptField 对存量明文/空值向后兼容（原样返回），过渡期安全。
 */
export function maskMemberPii<T extends MemberPii>(row: T): T {
  if (!isRestrictedScope()) {
    return { ...row, phone: decryptField(row.phone) };
  }
  const phonePlain = decryptField(row.phone);
  return { ...row, phone: maskPhone(phonePlain), birthday: maskBirthday(row.birthday) };
}
