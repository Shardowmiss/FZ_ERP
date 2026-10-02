import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  style,
  customer,
  sku,
  bom,
  productionWorkOrder,
  garmentPurchaseOrderSku,
  garmentPurchaseInboundSku,
  garmentPurchaseReturnSku,
  preOrder,
  salesReconciliation,
  financeReceipt,
  salesReturn,
  salesOutbound,
  receivable,
  salesOrder,
} from '@server/database/schema';
import type { MergeEntityConfig } from './types';

/**
 * 通用主数据合并实体配置（3b/3c）。
 *
 * 设计要点（与 P0-3 会员合并保持一致、但更简单的子集）：
 *   · 被合并方**绝不删除**（style/customer 的从表外键均为 RESTRICT/NO ACTION，删除被 FK 阻止；
 *     且历史业务依赖这些主数据，删除破坏历史）—— 合并只改指依赖行到 survivor + 打标(mergedInto/mergedAt)。
 *   · style/customer **无资金/积分列**，合并不涉及资金迁移（比 member 简单、更安全的子集）。
 *   · 依赖改指范围 = 实时从属于该主数据的业务表（sku/bom/工单/采购明细/配货/预购 等；
 *     客户侧 = 对账/收款/退货/出库/应收/订单）。历史交易行项目（retail_order_item 等仅存 style_no
 *     字符串副本）**不**改指，因其是历史快照，且一致性校验域(product/member/price)不覆盖
 *     style/customer，不会引起误报。
 *   · 回滚 = 解除打标（不回指历史归属，与 member 一致：survivor 已拥有的依赖归属保持不变，避免误伤
 *     survivor 合并后自身产生的业务记录）。
 */
export const MERGE_ENTITY_CONFIGS: Record<string, MergeEntityConfig> = {
  style: {
    type: 'style',
    table: style,
    codeKey: 'styleNo',
    displayKey: 'styleNo',
    mergedIntoKey: 'mergedInto',
    mergedAtKey: 'mergedAt',
    // ⚠️ 依赖只能是「直接带 style_id 列」的表。allocation_item / pre_order_item 经 sku_id
    // 间接归属款式，sku 改指后它们自然转属 survivor，故**不**在此列出（它们无 style_id
    // 列，强行列入会让 merge 生成 style_id=undefined 的坏 SQL，运行时直接崩）。
    deps: [
      { table: sku, idKey: 'styleId', codeKey: 'styleNo' },
      { table: bom, idKey: 'styleId', codeKey: 'styleNo' },
      { table: productionWorkOrder, idKey: 'styleId', codeKey: 'styleNo' },
      { table: garmentPurchaseOrderSku, idKey: 'styleId', codeKey: 'styleNo' },
      { table: garmentPurchaseInboundSku, idKey: 'styleId', codeKey: 'styleNo' },
      { table: garmentPurchaseReturnSku, idKey: 'styleId', codeKey: 'styleNo' },
      { table: preOrder, idKey: 'styleId', codeKey: 'styleNo' },
    ],
    // style 特有：sku 唯一键 (style_id, color_id, size_id)，改指前校验被合并款的 sku 是否与 survivor 撞色尺码
    preMergeValidation: async (tx, survivorId, mergedId) => {
      const rows = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sku)
        .where(
          and(
            eq(sku.styleId, mergedId),
            sql`exists (select 1 from ${sku} s2 where s2.style_id = ${survivorId} and s2.color_id = ${sku}.color_id and s2.size_id = ${sku}.size_id)`,
          ),
        );
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) {
        throw new BadRequestException(
          `款式合并冲突：被合并款存在 ${n} 个与存活款相同 (颜色,尺码) 的 SKU，请先处理 SKU 冲突（否则会违反 sku 唯一键）`,
        );
      }
    },
    // 查重候选：款名归一（去空白+小写）。款号 style_no 唯一，按款名去重更贴合运营重复建档场景。
    candidate: {
      nameExpr: sql<string>`lower(regexp_replace(coalesce(${style.name}, ''), '[[:space:]]+', '', 'g'))`,
    },
  },
  customer: {
    type: 'customer',
    table: customer,
    codeKey: 'code',
    displayKey: 'name',
    mergedIntoKey: 'mergedInto',
    mergedAtKey: 'mergedAt',
    deps: [
      { table: salesReconciliation, idKey: 'customerId', codeKey: 'customerName' },
      { table: financeReceipt, idKey: 'customerId', codeKey: 'customerName' },
      { table: salesReturn, idKey: 'customerId', codeKey: 'customerName' },
      { table: salesOutbound, idKey: 'customerId', codeKey: 'customerName' },
      { table: receivable, idKey: 'customerId', codeKey: 'customerName' },
      { table: salesOrder, idKey: 'customerId', codeKey: 'customerName' },
    ],
    // 查重候选（MVP）：名称归一（去空白+小写）/ 电话归一（仅数字且 >=7 位，避免短号误并）。
    // ⚠️ 这两个表达式必须与 service 内 JS 侧归一函数严格同构，否则会静默漏组。
    candidate: {
      nameExpr: sql<string>`lower(regexp_replace(coalesce(${customer.name}, ''), '[[:space:]]+', '', 'g'))`,
      phoneExpr: sql<string>`case when length(regexp_replace(coalesce(${customer.phone}, ''), '[^0-9]', '', 'g')) >= 7 then regexp_replace(coalesce(${customer.phone}, ''), '[^0-9]', '', 'g') else null end`,
    },
  },
};

export function getMergeConfig(type: string): MergeEntityConfig {
  const cfg = MERGE_ENTITY_CONFIGS[type];
  if (!cfg) throw new BadRequestException(`不支持的主数据合并类型：${type}`);
  return cfg;
}
