import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { posOperationLog } from '@server/database/schema';

/**
 * P0-2：统一的操作审计工具。
 *
 * 在关键写操作（销售/退货/储值/库存调整/日结/ERP 开关等）后调用，
 * 写入 `pos_operation_log`，满足「关键操作可追溯」的合规要求。
 *
 * 设计原则：
 * - 审计失败仅告警、绝不阻断主流程（避免审计组件故障拖垮业务）。
 * - storeId / employeeId 优先取自**服务端已认证的登录主体**，避免被客户端伪造。
 * - 与软删除拦截器无关（pos_operation_log 无 deletedAt 列）。
 */

export interface AuditInput {
  /** 业务归属门店；写接口应来自服务端权威推导（P0-1），而非客户端下发 */
  storeId?: string | null;
  /** 操作人员工 ID；来自认证主体，可能为空（本地/离线兼容） */
  employeeId?: string | null;
  /** 业务域，如 sales / returns / members / shift / stock / erp / master-data */
  module: string;
  /** 动作，如 create / create_return / recharge / execute_eod / sync_downstream */
  action: string;
  /** 业务单号或对象标识，便于定位 */
  targetNo?: string;
  /** 结构化上下文，会被 JSON 序列化入库 */
  content?: Record<string, unknown> | string;
}

/** 向 pos_operation_log 写入一条审计记录（失败仅告警）。 */
export async function auditAction(
  db: PostgresJsDatabase,
  input: AuditInput,
): Promise<void> {
  try {
    await db.insert(posOperationLog).values({
      storeId: input.storeId ?? null,
      employeeId: input.employeeId ?? null,
      module: input.module,
      action: input.action,
      targetNo: input.targetNo ?? null,
      content: input.content ? JSON.stringify(input.content) : null,
    });
  } catch (e) {
    // 审计写入失败不应影响主流程
    console.warn(
      `[audit] 操作日志写入失败 ${input.module}/${input.action} (${input.targetNo ?? ''}): ${String(e)}`,
    );
  }
}

/** 从请求中解析操作人员工 ID：兼容 POS 本地登录（req.posUser）与平台 SSO（req.userContext）。 */
export function operatorIdFromReq(req: {
  posUser?: { employeeId?: string } | null;
  userContext?: { employeeId?: string; userId?: string } | null;
} | null | undefined): string | null {
  return (
    req?.posUser?.employeeId ??
    req?.userContext?.employeeId ??
    req?.userContext?.userId ??
    null
  );
}

/** 从请求中解析操作人归属门店：用于列表查询强制过滤（配合 P0-1）。 */
export function storeIdFromReq(req: {
  posUser?: { storeId?: string | null } | null;
  userContext?: { storeId?: string | null } | null;
} | null | undefined): string | null {
  return req?.posUser?.storeId ?? req?.userContext?.storeId ?? null;
}
