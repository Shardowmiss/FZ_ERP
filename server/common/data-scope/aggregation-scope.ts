import { type SQL } from 'drizzle-orm';
import { RequestContext, ALL_SCOPE } from '../context/request-context';
import { buildDealerScopeCondition } from './dealer-scope';
import {
  salesOutbound,
  salesOrder,
  purchaseInbound,
  purchaseOrder,
  retailOrder,
  inventoryStock,
  inventoryTransfer,
  financePayment,
  financeReceipt,
  payable,
  receivable,
} from '@server/database/schema';

/**
 * 聚合/报表/看板/分析/财务端点的业务域。
 *
 * 这些端点聚合全量经营数据，在（多租户）受限用户视角下必须按经销商过滤，否则会向
 * 受限用户泄露其它经销商的经营/财务数据。各域的核心表与经销商的归属关系：
 * - sales / profit   ：sales_outbound / sales_order 经 customer_id → customer.partner_id
 * - purchase         ：purchase_inbound 经 supplier_id → supplier.partner_id
 * - retail           ：retail_order 经 store_id → store.dealer_id
 * - inventory        ：inventory_stock 经 warehouse_id → warehouse.dealer_id
 * - transfer         ：inventory_transfer 的 from/to 仓库任一归属即可见
 * - finPayment/payable：finance_payment / payable 经 supplier_id → supplier.partner_id
 * - finReceipt/receivable：finance_receipt / receivable 经 customer_id → customer.partner_id
 */
export type AggregationDomain =
  | 'sales'
  | 'purchase'
  | 'retail'
  | 'inventory'
  | 'transfer'
  | 'profit'
  | 'finPayment'
  | 'finReceipt'
  | 'payable'
  | 'receivable'
  | 'purchaseOrder';

/**
 * 返回当前请求作用域下、指定业务域的行级过滤片段（SQL）。
 *
 * - 返回 undefined → 不加限制（超管 / 单租户放行 / 非请求上下文，向后兼容）
 * - 返回 sql`1=0` → 已配置但无可见范围，聚合结果应为空集
 * - 返回子查询片段 → 仅可见所属经销商数据；dealerIds 由 drizzle 参数化绑定，无注入风险
 *
 * 调用方把返回值 AND 进各自查询的 WHERE 即可（drizzle 构建器用 and(..., cond)，
 * 原始 db.execute(sql`... WHERE ${clause} AND ${cond}`) 同样安全）。
 */
export function buildAggregationScope(domain: AggregationDomain): SQL | undefined {
  const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
  switch (domain) {
    case 'sales':
      return buildDealerScopeCondition(scope, { kind: 'viaCustomer', column: salesOutbound.customerId });
    case 'profit':
      return buildDealerScopeCondition(scope, { kind: 'viaCustomer', column: salesOrder.customerId });
    case 'purchase':
      return buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: purchaseInbound.supplierId });
    case 'retail':
      return buildDealerScopeCondition(scope, { kind: 'viaStore', column: retailOrder.storeId });
    case 'inventory':
      return buildDealerScopeCondition(scope, { kind: 'viaWarehouse', column: inventoryStock.warehouseId });
    case 'transfer':
      return buildDealerScopeCondition(scope, {
        kind: 'viaWarehouseEither',
        from: inventoryTransfer.fromWarehouseId,
        to: inventoryTransfer.toWarehouseId,
      });
    case 'finPayment':
    case 'payable':
      return buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: domain === 'finPayment' ? financePayment.supplierId : payable.supplierId });
    case 'finReceipt':
    case 'receivable':
      return buildDealerScopeCondition(scope, { kind: 'viaCustomer', column: domain === 'finReceipt' ? financeReceipt.customerId : receivable.customerId });
    case 'purchaseOrder':
      return buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: purchaseOrder.supplierId });
    default:
      return undefined;
  }
}
