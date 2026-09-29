/**
 * 会员 PII 脱敏（P1-b · POS 端隐私合规）。
 *
 * POS 是门店收银终端，会员手机号属于个人敏感信息。此前会员接口、零售单 / 退货单
 * 响应均明文回显 `phone`，存在隐私合规风险与批量 dump 隐患。本模块统一对手机号
 * 脱敏，与 ERP 端 `maskMemberPii`（erp_source/server/common/data-scope/pii.ts）保持
 * 一致的掩码规则（保留前 3 后 4，其余以 * 代替），便于两端对齐审计。
 *
 * 注意：以下路径是「内部同步 / 上行 ERP」，不应脱敏（接收方 ERP 需真实号码）：
 *   - erp-integration 适配器（推送至 ERP 的 payload）
 *   - offline-sync 下发至离线客户端的主数据（门店本地搜索依赖明文号码）
 * 故本工具仅用于「HTTP 响应返回给请求方」的会员手机号。
 */

/** 手机号脱敏：保留前 3 后 4 位，其余以 * 代替；空值原样返回。 */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return phone ?? null;
  const s = phone.trim();
  if (s.length <= 7) return '****';
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}
