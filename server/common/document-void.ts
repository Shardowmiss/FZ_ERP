import { eq } from 'drizzle-orm';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

export interface VoidDocOptions {
  /** 草稿态取值，默认 'draft'（部分单据枚举值可能不同，如采购订单用 PurchaseOrderStatus.DRAFT） */
  draftValue?: string;
  /** 作废终态取值，默认 'cancelled' */
  cancelledValue?: string;
  notFoundMsg?: string;
  guardMsg?: string;
}

/**
 * 通用"作废"逻辑（软作废）：
 *  - 仅「草稿态」可作废，其余状态（含已审核/已记账/已验收/已完成）一律拒绝；
 *  - 作废为终态 cancelled，保留单据记录与业务流水，不可逆（不提供取消作废）；
 *  - 不改写任何库存/应收/应付等已过账数据。
 *
 * 入参 table 需包含 id 与 status 两列（本系统所有业务单据均满足）。
 * 由于各表 drizzle 类型不一，此处用宽松类型以适配全部单据，tsconfig 已关闭 strict。
 */
export async function voidDraftDocument(
  db: any,
  table: any,
  id: string,
  opts: VoidDocOptions = {},
): Promise<void> {
  const draftValue = opts.draftValue ?? 'draft';
  const cancelledValue = opts.cancelledValue ?? 'cancelled';

  const rows = await db.select().from(table).where(eq(table.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new NotFoundException(opts.notFoundMsg ?? '单据不存在');
  }
  if (row.status !== draftValue) {
    throw new BadRequestException(
      opts.guardMsg ?? '仅草稿状态的单据才能作废',
    );
  }
  await db
    .update(table)
    .set({ status: cancelledValue })
    .where(eq(table.id, id));
}
