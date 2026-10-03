import { sql, type Column, type SQL } from 'drizzle-orm';
import type { DealerScope } from '../context/request-context';

/**
 * 经销商隔离的关联路径描述。
 *
 * 核心单据表（sales_order / sales_outbound / sales_return / receivable / finance_receipt /
 * sales_reconciliation）现已直连 dealerId 列（客户主数据已移除，经销商即业务归属方）：
 * - dealerColumn：表自身带 dealerId 列，直接 IN 过滤
 * - viaSupplier：purchase_order.supplier_id → supplier.partner_id
 * - viaWarehouse：inventory_*.warehouse_id → warehouse.dealer_id
 * - viaWarehouseEither：调拨单的 from/to 仓库任一归属该经销商即可见
 * - viaStore：门店零售/退货单 store_id → store.dealer_id
 * - unscoped：该单据已无经销商归属列，不加行级限制（全量可见）
 */
export type DealerPath =
  | { kind: 'dealerColumn'; column: SQL | Column }
  | { kind: 'viaSupplier'; column: SQL | Column }
  | { kind: 'viaWarehouse'; column: SQL | Column }
  | { kind: 'viaWarehouseEither'; from: SQL | Column; to: SQL | Column }
  | { kind: 'viaStore'; column: SQL | Column }
  | { kind: 'unscoped' };

function idList(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/** 构造“主表列 IN (SELECT id FROM 关联表 WHERE 外键 IN (ids))”的子查询条件。 */
function viaLookup(column: SQL | Column, table: string, fk: string, ids: string[]): SQL {
  return sql`${column} IN (
    SELECT ${sql.identifier('id')}
    FROM ${sql.identifier(table)}
    WHERE ${sql.identifier(fk)} IN (${idList(ids)})
  )`;
}

/**
 * 根据经销商作用域与关联路径，构造行级过滤条件。
 *
 * 返回：
 * - undefined → 不加限制（全量可见）
 * - sql`1=0`  → 任何行都不匹配（已配置但无可见范围，等价拒绝）
 * - 子查询条件 → 仅可见指定经销商的数据
 */
export function buildDealerScopeCondition(
  scope: DealerScope,
  path: DealerPath,
): SQL | undefined {
  // 全量可见：不加任何限制
  if (scope.type === 'all') return undefined;
  // 已配置但无可见经销商：返回永假条件，确保查不到任何跨租户数据
  if (scope.dealerIds.length === 0) return sql`1=0`;

  switch (path.kind) {
    case 'dealerColumn':
      return sql`${path.column} IN (${idList(scope.dealerIds)})`;
    case 'viaSupplier':
      return viaLookup(path.column, 'supplier', 'partner_id', scope.dealerIds);
    case 'viaWarehouse':
      return viaLookup(path.column, 'warehouse', 'dealer_id', scope.dealerIds);
    case 'viaWarehouseEither': {
      const list = idList(scope.dealerIds);
      return sql`(
        ${path.from} IN (
          SELECT ${sql.identifier('id')} FROM ${sql.identifier('warehouse')}
          WHERE ${sql.identifier('dealer_id')} IN (${list})
        )
        OR ${path.to} IN (
          SELECT ${sql.identifier('id')} FROM ${sql.identifier('warehouse')}
          WHERE ${sql.identifier('dealer_id')} IN (${list})
        )
      )`;
    }
    case 'viaStore':
      return viaLookup(path.column, 'store', 'dealer_id', scope.dealerIds);
    case 'unscoped':
      // 该单据已无经销商归属列：不加行级限制，全量可见。
      return undefined;
    default:
      return undefined;
  }
}
