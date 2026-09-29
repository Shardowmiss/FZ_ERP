import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { customer, supplier, warehouse } from '@server/database/schema';
import { RequestContext, ALL_SCOPE, type DealerScope } from '@server/common/context/request-context';

/**
 * 写入端行级权限校验所需的实体引用。
 *
 * 业务单据在 create/update 时总会引用至少一个维度实体（客户/供应商/仓库），
 * 这些实体的归属经销商即决定了该单据的“租户边界”。
 */
export interface WriteScopeRefs {
  customerId?: string | null;
  supplierId?: string | null;
  warehouseId?: string | null;
}

const LABEL: Record<'customer' | 'supplier' | 'warehouse', string> = {
  customer: '客户',
  supplier: '供应商',
  warehouse: '仓库',
};

/** 解析实体归属的经销商 ID（customer/supplier → partner_id，warehouse → dealer_id）；实体不存在返回 null。 */
async function resolveDealerId(
  db: PostgresJsDatabase,
  kind: 'customer' | 'supplier' | 'warehouse',
  value: string,
): Promise<string | null> {
  if (kind === 'customer') {
    const rows = await db
      .select({ id: customer.partnerId })
      .from(customer)
      .where(eq(customer.id, value));
    return rows[0]?.id ?? null;
  }
  if (kind === 'supplier') {
    const rows = await db
      .select({ id: supplier.partnerId })
      .from(supplier)
      .where(eq(supplier.id, value));
    return rows[0]?.id ?? null;
  }
  const rows = await db
    .select({ id: warehouse.dealerId })
    .from(warehouse)
    .where(eq(warehouse.id, value));
  return rows[0]?.id ?? null;
}

/**
 * 写入端行级权限校验（P0-S2 写越权硬化）。
 *
 * 在 create/update 真正写库前、且已确定 DTO 引用的实体 ID 后调用，校验被引用的
 * 客户/供应商/仓库所归属的经销商必须落在当前调用方作用域内：
 *
 * - 超管（scope.type === 'all'）放行；
 * - 受限作用域下，任一被引用实体不属于调用方经销商集合 → 抛 ForbiddenException
 *   （与读侧 `buildDealerScopeCondition` 返回 `1=0` 对称：默认拒绝）；
 * - 被引用实体本身不存在（查不到归属）→ 抛 BadRequestException（引用了无效 ID）。
 *
 * 与读侧共用同一套归属口径（customer/supplier → partner_id，warehouse → dealer_id），
 * 保证“能读到的实体才允许写入引用”，杜绝受限用户越权写/IDOR 写他人数据。
 */
export async function assertWriteWithinScope(
  db: PostgresJsDatabase,
  refs: WriteScopeRefs,
): Promise<void> {
  const scope: DealerScope = RequestContext.getDealerScope() ?? ALL_SCOPE;
  if (scope.type === 'all') return;

  const entries: Array<[keyof WriteScopeRefs, 'customer' | 'supplier' | 'warehouse']> = [];
  if (refs.customerId) entries.push(['customerId', 'customer']);
  if (refs.supplierId) entries.push(['supplierId', 'supplier']);
  if (refs.warehouseId) entries.push(['warehouseId', 'warehouse']);
  if (entries.length === 0) return;

  for (const [key, kind] of entries) {
    const value = refs[key] as string;
    const dealerId = await resolveDealerId(db, kind, value);
    if (dealerId === null) {
      throw new BadRequestException(`${LABEL[kind]}不存在或已删除`);
    }
    if (!scope.dealerIds.includes(dealerId)) {
      throw new ForbiddenException(
        `越权操作：该${LABEL[kind]}不属于当前账号可见的经销商范围`,
      );
    }
  }
}
