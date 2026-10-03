/**
 * 透视分析引擎（Pivot Engine）
 *
 * Wave 4-D ①：把 report.service.ts 中 620+ 行的透视逻辑整体迁出为独立可测单元。
 * 迁出原则 —— **逐字搬运，零行为变更**：
 *   - SQL 文本、白名单、作用域条件、行/列/小计/总计的计算顺序与原实现完全一致；
 *   - 对外只暴露一个入口 `run(config): Promise<PivotResponse>`，类型与 @shared/api.interface 对齐；
 *   - 原 service 保留 `getPivotData()` 作为薄委托，controller 无需改动。
 * 行为锁定由 test/report-pivot.spec.ts（12 例真库护栏）保证：任何数字漂移都会立刻变红。
 */
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql, type SQL } from 'drizzle-orm';
import { escapeLike } from '@server/common/utils/escape-like';
import { resolveReportWindow, type ReportWindow } from '@server/common/report-window';
import { buildDealerScopeCondition } from '@server/common/data-scope/dealer-scope';
import { RequestContext, ALL_SCOPE } from '@server/common/context/request-context';
import type {
  PivotConfig,
  PivotDataSource,
  PivotResponse,
  PivotResultCell,
  PivotRow,
  PivotValueConfig,
} from '@shared/api.interface';

interface PivotFlatRow {
  [key: string]: string | number | null;
}

interface DataSourceBase {
  fromTable: string;
  joins: string;
  dateCol: string;
  statusCol: string;
  storeIdCol: string;
  aliasMap: Record<string, string>;
  valueColMap: Record<string, string>;
}

interface PivotFieldWhitelist {
  dimensions: Set<string>;
  measures: Set<string>;
}

const TIME_DIMENSIONS = ['date', 'year', 'month', 'quarter', 'week', 'day'];

function getDataSourceBase(dataSource: PivotDataSource): DataSourceBase {
  const empty: DataSourceBase = {
    fromTable: '',
    joins: '',
    dateCol: '',
    statusCol: '',
    storeIdCol: '',
    aliasMap: {},
    valueColMap: {},
  };

  switch (dataSource) {
    case 'purchase': {
      const base: DataSourceBase = { ...empty };
      base.fromTable = 'garment_purchase_inbound_sku gpis';
      base.joins = 'INNER JOIN garment_purchase_inbound gpi ON gpis.inbound_id = gpi.id LEFT JOIN style st ON gpis.style_id = st.id';
      base.dateCol = 'gpi.inbound_date';
      base.statusCol = 'gpi.status';
      base.aliasMap = {
        brand: 'st.brand',
        category: 'st.category',
        subCategory: 'st.sub_category',
        supplier: 'gpi.supplier_name',
        warehouse: 'gpi.warehouse_name',
        styleNo: 'gpis.style_no',
        styleName: 'st.name',
        color: 'gpis.color',
        size: 'gpis.size',
        inboundNo: 'gpi.inbound_no',
      };
      base.valueColMap = { quantity: 'gpis.quantity', amount: 'gpis.amount' };
      return base;
    }
    case 'inventory': {
      const base: DataSourceBase = { ...empty };
      base.fromTable = 'inventory_stock ist';
      base.joins = 'LEFT JOIN sku s ON ist.sku_id = s.id LEFT JOIN style st ON s.style_id = st.id';
      base.statusCol = '';
      base.aliasMap = {
        brand: 'st.brand',
        category: 'st.category',
        subCategory: 'st.sub_category',
        warehouse: 'ist.warehouse_name',
        styleNo: 'ist.style_no',
        styleName: 'st.name',
        color: 'ist.color',
        size: 'ist.size',
      };
      base.valueColMap = { quantity: 'ist.quantity' };
      return base;
    }
    case 'transfer': {
      const base: DataSourceBase = { ...empty };
      base.fromTable = 'inventory_transfer_item iti';
      base.joins = 'INNER JOIN inventory_transfer it ON iti.transfer_id = it.id LEFT JOIN sku s ON iti.sku_id = s.id LEFT JOIN style st ON s.style_id = st.id';
      base.dateCol = 'it.transfer_date';
      base.statusCol = 'it.status';
      base.aliasMap = {
        brand: 'st.brand',
        category: 'st.category',
        subCategory: 'st.sub_category',
        fromWarehouse: 'it.from_warehouse_name',
        toWarehouse: 'it.to_warehouse_name',
        styleNo: 'iti.item_code',
        styleName: 'st.name',
        color: 'iti.color',
        size: 'iti.size',
        transferNo: 'it.transfer_no',
      };
      base.valueColMap = { quantity: 'iti.quantity' };
      return base;
    }
    case 'sales':
    default:
      return empty;
  }
}

function getPivotFieldWhitelist(dataSource: PivotDataSource): PivotFieldWhitelist {
  const measures = new Set<string>();
  const ds = getDataSourceBase(dataSource);
  // 时间维度只对真正带时间列的数据源开放。`inventory_stock` 是库存快照表、没有时间列，
  // 此前 dateCol 为空会让 buildDimExpression 拼出 `date_trunc('month', )` ——
  // PG 直接报语法错误。这是既有缺陷（非法请求本应 400 却可能 500），在此从校验层拦住。
  const dimensions = new Set<string>(
    ds.dateCol || dataSource === 'sales' ? TIME_DIMENSIONS : [],
  );

  if (dataSource === 'sales') {
    // sales 数据源维度（出库 + 零售的并集）
    const salesDims = [
      'brand', 'category', 'subCategory', 'dealer', 'warehouse',
      'styleNo', 'styleName', 'color', 'size', 'outboundNo',
      'store',
    ];
    salesDims.forEach((d: string) => dimensions.add(d));
    // sales 数据源指标
    const salesMeasures = ['quantity', 'amount', 'cost', 'profit', 'discount', 'avgPrice'];
    salesMeasures.forEach((m: string) => measures.add(m));
    return { dimensions, measures };
  }

  // 维度：aliasMap 的 key
  Object.keys(ds.aliasMap).forEach((k: string) => dimensions.add(k));
  // 指标：valueColMap 的 key 加上通用计算指标
  Object.keys(ds.valueColMap).forEach((k: string) => measures.add(k));
  // 通用派生指标（基于 valueColMap 中的列计算得出）
  const derivedMeasures = ['cost', 'profit', 'discount', 'avgPrice'];
  derivedMeasures.forEach((m: string) => measures.add(m));

  return { dimensions, measures };
}

const VALID_DATA_SOURCES: PivotDataSource[] = ['sales', 'purchase', 'inventory', 'transfer'];

function validatePivotConfig(config: PivotConfig): void {
  const { dataSource, rows, cols, values, filters } = config;

  // 校验 dataSource
  if (!VALID_DATA_SOURCES.includes(dataSource)) {
    throw new BadRequestException('非法字段：dataSource');
  }

  const whitelist = getPivotFieldWhitelist(dataSource);

  // 校验维度字段（rows / cols / filters 的 key）
  const dimKeys = [
    ...rows,
    ...cols,
    ...(filters?.map((f: { key: string; values: string[] }) => f.key) ?? []),
  ];
  for (const key of dimKeys) {
    if (!whitelist.dimensions.has(key)) {
      throw new BadRequestException('非法字段');
    }
  }

  // 校验指标字段（values 的 key）
  for (const v of values) {
    if (!whitelist.measures.has(v.key)) {
      throw new BadRequestException('非法字段');
    }
  }
}

function getSalesDimColName(dim: string, source: 'outbound' | 'retail'): string | null {
  const outboundMap: Record<string, string> = {
    brand: 'st.brand',
    category: 'st.category',
    subCategory: 'st.sub_category',
    dealer: 'so.dealer_id',
    warehouse: 'so.warehouse_name',
    styleNo: 'soi.style_no',
    styleName: 'st.name',
    color: 'soi.color',
    size: 'soi.size',
    outboundNo: 'so.outbound_no',
  };
  const retailMap: Record<string, string> = {
    brand: 'st.brand',
    category: 'st.category',
    subCategory: 'st.sub_category',
    store: 'ro.store_name',
    styleNo: 'roi.style_no',
    styleName: 'st.name',
    color: 'roi.color',
    size: 'roi.size',
    outboundNo: 'ro.retail_no',
  };
  const map = source === 'outbound' ? outboundMap : retailMap;
  return map[dim] ?? null;
}

/** 聚合函数白名单：避免请求传入的 agg 经 sql.raw 注入任意 SQL。 */
const ALLOWED_AGG_FNS = new Set([
  'SUM',
  'AVG',
  'COUNT',
  'MIN',
  'MAX',
]);

@Injectable()
export class PivotEngineService {
  private readonly logger = new Logger(PivotEngineService.name);

  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async run(config: PivotConfig): Promise<PivotResponse> {
    validatePivotConfig(config);
    const { dataSource, rows, cols, values } = config;

    if (values.length === 0) {
      return {
        dataSource,
        rowFields: rows,
        colFields: cols,
        valueFields: [],
        colKeys: [],
        colLabels: [[]],
        rows: [],
        grandTotal: {},
        rowCount: 0,
      };
    }

    this.logger.log(
      `pivot query: dataSource=${dataSource}, rows=[${rows.join(',')}], cols=[${cols.join(',')}], values=[${values.map((v: PivotValueConfig) => `${v.key}:${v.agg}`).join(',')}]`,
    );

    const flatRows: PivotFlatRow[] = await this.executePivotQuery(config);

    // 收集列组合 (cols + values 笛卡尔积)
    const colKeySet = new Set<string>();
    const colKeyToLabel = new Map<string, string[]>();

    for (const row of flatRows) {
      const colDimVals: string[] = cols.map((c: string) => String(row[c] ?? ''));
      for (const v of values) {
        const vKey = this.valueKey(v);
        const keyParts = [...colDimVals, vKey];
        const colKey = keyParts.join('|');
        if (!colKeySet.has(colKey)) {
          colKeySet.add(colKey);
          colKeyToLabel.set(colKey, [...colDimVals, v.label]);
        }
      }
    }

    // 排序 colKeys：按 cols 字段顺序 + values 顺序
    const colKeys: string[] = Array.from(colKeySet).sort((a: string, b: string) => {
      const aParts = a.split('|');
      const bParts = b.split('|');
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
        const av = aParts[i] ?? '';
        const bv = bParts[i] ?? '';
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
      return 0;
    });

    const colLabels: string[][] = colKeys.map(
      (k: string) => colKeyToLabel.get(k) ?? k.split('|'),
    );

    const pivotRows: PivotRow[] = this.buildPivotRows(
      flatRows,
      rows,
      cols,
      values,
      colKeys,
    );

    const grandTotal: Record<string, PivotResultCell> = this.computeGrandTotal(
      flatRows,
      cols,
      values,
      colKeys,
    );

    return {
      dataSource,
      rowFields: rows,
      colFields: cols,
      valueFields: values,
      colKeys,
      colLabels,
      rows: pivotRows,
      grandTotal,
      rowCount: pivotRows.length,
    };
  }

  private valueKey(v: PivotValueConfig): string {
    return `${v.key}_${v.agg}`;
  }

  /**
   * 透视数据源对应的经销商作用域片段（基于动态 SQL 的表别名构造）。
   * 受限用户视角下，透视聚合必须按经销商过滤，否则泄露其它经销商数据。
   * dealerIds 由 drizzle 参数化绑定，无注入风险。
   */
  private buildPivotScope(dataSource: PivotDataSource): SQL | undefined {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    switch (dataSource) {
      case 'purchase':
        return buildDealerScopeCondition(scope, { kind: 'viaSupplier', column: sql`gpi.supplier_id` });
      case 'inventory':
        return buildDealerScopeCondition(scope, { kind: 'viaWarehouse', column: sql`ist.warehouse_id` });
      case 'transfer':
        return buildDealerScopeCondition(scope, {
          kind: 'viaWarehouseEither',
          from: sql`it.from_warehouse_id`,
          to: sql`it.to_warehouse_id`,
        });
      default:
        return undefined;
    }
  }

  /**
   * 执行动态 SQL 聚合查询，返回扁平结果
   */
  private async executePivotQuery(config: PivotConfig): Promise<PivotFlatRow[]> {
    const { dataSource, rows, cols, values, startDate, endDate, brand, storeIds, keyword, filters, allowFullRange } = config;
    const allDims: string[] = [...rows, ...cols];
    const maxRows = 500;

    // P1-c④ 时间窗一次性算好，sales 分支（UNION ALL 两段）与通用分支共用，避免口径分叉
    const win: ReportWindow | undefined = resolveReportWindow(
      { startDate, endDate, allowFullRange },
      this.logger,
    );

    if (dataSource === 'sales') {
      return this.executeSalesPivotQuery(allDims, values, win, brand, storeIds, keyword, filters, maxRows);
    }

    const ds = getDataSourceBase(dataSource);

    const dimSelects: SQL[] = [];
    const valSelects: SQL[] = [];
    const groupBys: SQL[] = [];

    for (const dim of allDims) {
      const dimExpr = this.buildDimExpression(dim, ds.dateCol, ds.aliasMap);
      dimSelects.push(sql`${dimExpr} as ${sql.identifier(dim)}`);
      groupBys.push(sql`${sql.identifier(dim)}`);
    }

    for (const v of values) {
      const valExpr = this.buildValueExpression(v, ds.valueColMap);
      const vKey = this.valueKey(v);
      valSelects.push(sql`${valExpr}::numeric as ${sql.identifier(vKey)}`);
    }

    const whereParts: SQL[] = [];

    if (ds.statusCol) {
      whereParts.push(sql`${sql.raw(ds.statusCol)} = 'approved'`);
    }
    // P1-c④ 强制时间窗：透视是全表 GROUP BY，无界时 `ORDER BY ... LIMIT ${maxRows}`
    // 也救不了——必须先把扫描范围限制在时间窗内。win 已在函数开头算好（sales 分支共用）。
    if (win && ds.dateCol) {
      whereParts.push(sql`${sql.raw(ds.dateCol)} >= ${win.start}`);
      whereParts.push(sql`${sql.raw(ds.dateCol)} < ${win.endExclusive}`);
    } else {
      if (startDate && ds.dateCol) {
        whereParts.push(sql`${sql.raw(ds.dateCol)} >= ${startDate}`);
      }
      if (endDate && ds.dateCol) {
        whereParts.push(sql`${sql.raw(ds.dateCol)} < ${endDate}`);
      }
    }
    if (brand) {
      const brandCol = ds.aliasMap.brand ?? 'brand';
      whereParts.push(sql`${sql.raw(brandCol)} = ${brand}`);
    }
    if (keyword) {
      const kw = `%${escapeLike(keyword)}%`;
      const styleNoCol = ds.aliasMap.styleNo ?? 'style_no';
      whereParts.push(sql`${sql.raw(styleNoCol)} ILIKE ${kw}`);
    }
    if (filters && filters.length > 0) {
      for (const f of filters) {
        if (f.values && f.values.length > 0) {
          const colName = ds.aliasMap[f.key];
          if (colName) {
            const placeholders = sql.join(
              f.values.map((v: string) => sql`${v}`),
              sql`, `,
            );
            whereParts.push(sql`COALESCE(${sql.raw(colName)}, '') IN (${placeholders})`);
          }
        }
      }
    }

    const pivotScope = this.buildPivotScope(dataSource);
    if (pivotScope) whereParts.push(pivotScope);

    const whereClause = whereParts.length > 0
      ? sql`WHERE ${sql.join(whereParts, sql` AND `)}`
      : sql``;

    const allSelects = sql.join([...dimSelects, ...valSelects], sql`, `);
    const orderByCols = rows.length > 0
      ? sql.join(rows.map((r: string) => sql`${sql.identifier(r)} ASC`), sql`, `)
      : sql`1 ASC`;
    const groupByClause = groupBys.length > 0
      ? sql`GROUP BY ${sql.raw(Array.from({ length: groupBys.length }, (_, i) => String(i + 1)).join(', '))}`
      : sql``;

    const query = sql`
      SELECT ${allSelects}
      FROM ${sql.raw(ds.fromTable)}
      ${sql.raw(ds.joins)}
      ${whereClause}
      ${groupByClause}
      ORDER BY ${orderByCols}
      LIMIT ${maxRows}
    `;

    const result = await this.db.execute(query) as unknown as Record<string, unknown>[];

    return result.map((row: Record<string, unknown>) => {
      const normalized: PivotFlatRow = {};
      for (const key of Object.keys(row)) {
        const val = row[key];
        const isValueCol = values.some((v: PivotValueConfig) => this.valueKey(v) === key);
        if (isValueCol) {
          normalized[key] = val !== null && val !== undefined ? Number(val) : null;
        } else {
          normalized[key] = val !== null && val !== undefined ? String(val) : '';
        }
      }
      return normalized;
    });
  }

  /**
   * Sales 数据源：UNION ALL 销售出库 + 零售订单
   */
  private async executeSalesPivotQuery(
    allDims: string[],
    values: PivotValueConfig[],
    win: ReportWindow | undefined,
    brand: string | undefined,
    storeIds: string[] | undefined,
    keyword: string | undefined,
    filters: { key: string; values: string[] }[] | undefined,
    maxRows: number,
  ): Promise<PivotFlatRow[]> {
    const scope = RequestContext.getDealerScope() ?? ALL_SCOPE;
    // 销售出库 part
    const salesDimSelects: SQL[] = [];
    const salesValSelects: SQL[] = [];
    const salesGroupBys: SQL[] = [];

    for (const dim of allDims) {
      const expr = this.buildSalesDimExpr(dim, 'outbound');
      salesDimSelects.push(sql`${expr} as ${sql.identifier(dim)}`);
      salesGroupBys.push(sql`${sql.identifier(dim)}`);
    }
    for (const v of values) {
      const expr = this.buildSalesValueExpr(v, 'outbound');
      const vKey = this.valueKey(v);
      salesValSelects.push(sql`${expr}::numeric as ${sql.identifier(vKey)}`);
    }

    const salesWhereParts: SQL[] = [sql`so.status IN ('booked', 'accepted')`];
    if (win) {
      salesWhereParts.push(sql`so.outbound_date >= ${win.start}`);
      salesWhereParts.push(sql`so.outbound_date < ${win.endExclusive}`);
    }
    if (brand) salesWhereParts.push(sql`st.brand = ${brand}`);
    if (keyword) {
      const kw = `%${escapeLike(keyword)}%`;
      salesWhereParts.push(sql`soi.style_no ILIKE ${kw}`);
    }
    if (filters) {
      for (const f of filters) {
        if (f.values && f.values.length > 0) {
          const col = getSalesDimColName(f.key, 'outbound');
          if (col) {
            const placeholders = sql.join(
              f.values.map((v: string) => sql`${v}`),
              sql`, `,
            );
            salesWhereParts.push(sql`COALESCE(${sql.raw(col)}, '') IN (${placeholders})`);
          }
        }
      }
    }
    const salesScope = buildDealerScopeCondition(scope, { kind: 'dealerColumn', column: sql`so.dealer_id` });
    if (salesScope) salesWhereParts.push(salesScope);
    const salesWhere = sql.join(salesWhereParts, sql` AND `);

    // 零售 part
    const retailDimSelects: SQL[] = [];
    const retailValSelects: SQL[] = [];

    for (const dim of allDims) {
      const expr = this.buildSalesDimExpr(dim, 'retail');
      retailDimSelects.push(sql`${expr} as ${sql.identifier(dim)}`);
    }
    for (const v of values) {
      const expr = this.buildSalesValueExpr(v, 'retail');
      const vKey = this.valueKey(v);
      retailValSelects.push(sql`${expr}::numeric as ${sql.identifier(vKey)}`);
    }

    const retailWhereParts: SQL[] = [sql`ro.status = 'approved'`];
    if (win) {
      retailWhereParts.push(sql`ro.sale_date >= ${win.start}`);
      retailWhereParts.push(sql`ro.sale_date < ${win.endExclusive}`);
    }
    if (brand) retailWhereParts.push(sql`st.brand = ${brand}`);
    if (storeIds && storeIds.length > 0) {
      const placeholders = sql.join(
        storeIds.map((id: string) => sql`${id}`),
        sql`, `,
      );
      retailWhereParts.push(sql`ro.store_id = ANY(ARRAY[${placeholders}]::uuid[])`);
    }
    if (keyword) {
      const kw = `%${escapeLike(keyword)}%`;
      retailWhereParts.push(sql`roi.style_no ILIKE ${kw}`);
    }
    if (filters) {
      for (const f of filters) {
        if (f.values && f.values.length > 0) {
          const col = getSalesDimColName(f.key, 'retail');
          if (col) {
            const placeholders = sql.join(
              f.values.map((v: string) => sql`${v}`),
              sql`, `,
            );
            retailWhereParts.push(sql`COALESCE(${sql.raw(col)}, '') IN (${placeholders})`);
          }
        }
      }
    }
    const retailScope = buildDealerScopeCondition(scope, { kind: 'viaStore', column: sql`ro.store_id` });
    if (retailScope) retailWhereParts.push(retailScope);
    const retailWhere = sql.join(retailWhereParts, sql` AND `);

    const salesSelects = sql.join([...salesDimSelects, ...salesValSelects], sql`, `);
    const retailSelects = sql.join([...retailDimSelects, ...retailValSelects], sql`, `);
    const groupBy = salesGroupBys.length > 0
      ? sql`GROUP BY ${sql.raw(Array.from({ length: salesGroupBys.length }, (_, i) => String(i + 1)).join(', '))}`
      : sql``;

    const orderByCols = allDims.length > 0
      ? sql.join(allDims.map((d: string) => sql`${sql.identifier(d)} ASC`), sql`, `)
      : sql`1 ASC`;

    const query = sql`
      SELECT * FROM (
        SELECT ${salesSelects}
        FROM sales_outbound_item soi
        INNER JOIN sales_outbound so ON soi.outbound_id = so.id
        LEFT JOIN sku s ON soi.sku_id = s.id
        LEFT JOIN style st ON s.style_id = st.id
        WHERE ${salesWhere}
        ${groupBy}
        UNION ALL
        SELECT ${retailSelects}
        FROM retail_order_item roi
        INNER JOIN retail_order ro ON roi.retail_id = ro.id
        LEFT JOIN sku s ON roi.sku_id = s.id
        LEFT JOIN style st ON s.style_id = st.id
        WHERE ${retailWhere}
        ${groupBy}
      ) combined
      ORDER BY ${orderByCols}
      LIMIT ${maxRows}
    `;

    const result = await this.db.execute(query) as unknown as Record<string, unknown>[];

    return result.map((row: Record<string, unknown>) => {
      const normalized: PivotFlatRow = {};
      for (const key of Object.keys(row)) {
        const val = row[key];
        const isValueCol = values.some((v: PivotValueConfig) => this.valueKey(v) === key);
        if (isValueCol) {
          normalized[key] = val !== null && val !== undefined ? Number(val) : null;
        } else {
          normalized[key] = val !== null && val !== undefined ? String(val) : '';
        }
      }
      return normalized;
    });
  }

  /**
   * 构建维度 SELECT 表达式（通用）
   */
  private buildDimExpression(
    dim: string,
    dateCol: string,
    aliasMap: Record<string, string>,
  ): SQL {
    if (dim === 'date') {
      return sql`${sql.raw(dateCol)}::text`;
    }
    if (dim === 'year') {
      return sql`EXTRACT(YEAR FROM ${sql.raw(dateCol)})::text`;
    }
    if (dim === 'month') {
      return sql`to_char(date_trunc('month', ${sql.raw(dateCol)}), 'YYYY-MM')`;
    }
    if (dim === 'quarter') {
      return sql`concat(EXTRACT(YEAR FROM ${sql.raw(dateCol)}), '-Q', EXTRACT(QUARTER FROM ${sql.raw(dateCol)}))`;
    }
    if (dim === 'week') {
      return sql`to_char(date_trunc('week', ${sql.raw(dateCol)}), 'YYYY-MM-DD')`;
    }
    if (dim === 'day') {
      return sql`to_char(${sql.raw(dateCol)}, 'YYYY-MM-DD')`;
    }
    const col = aliasMap[dim];
    if (col) {
      return sql`COALESCE(${sql.raw(col)}, '')::text`;
    }
    return sql`''::text`;
  }

  /**
   * 构建 sales 数据源的维度表达式
   */
  private buildSalesDimExpr(dim: string, source: 'outbound' | 'retail'): SQL {
    const dateCol = source === 'outbound' ? 'so.outbound_date' : 'ro.sale_date';

    if (dim === 'date') return sql`${sql.raw(dateCol)}::text`;
    if (dim === 'year') return sql`EXTRACT(YEAR FROM ${sql.raw(dateCol)})::text`;
    if (dim === 'month') return sql`to_char(date_trunc('month', ${sql.raw(dateCol)}), 'YYYY-MM')`;
    if (dim === 'quarter') return sql`concat(EXTRACT(YEAR FROM ${sql.raw(dateCol)}), '-Q', EXTRACT(QUARTER FROM ${sql.raw(dateCol)}))`;
    if (dim === 'week') return sql`to_char(date_trunc('week', ${sql.raw(dateCol)}), 'YYYY-MM-DD')`;
    if (dim === 'day') return sql`to_char(${sql.raw(dateCol)}, 'YYYY-MM-DD')`;

    const col = getSalesDimColName(dim, source);
    if (col) {
      return sql`COALESCE(${sql.raw(col)}, '')::text`;
    }
    return sql`''::text`;
  }

  /** 校验聚合函数名，合法则返回安全的 SQL 标识符片段，非法抛 BadRequestException */
  private safeAggFn(agg?: string): SQL {
    const fn = (agg ?? 'SUM').toUpperCase();
    if (!ALLOWED_AGG_FNS.has(fn)) {
      throw new BadRequestException(`不支持的聚合函数: ${fn}`);
    }
    return sql.raw(fn);
  }

  /**
   * 构建指标聚合表达式（通用）
   */
  private buildValueExpression(
    v: PivotValueConfig,
    valueColMap: Record<string, string>,
  ): SQL {
    const aggFn = this.safeAggFn(v.agg);

    if (v.key === 'quantity') {
      const col = valueColMap.quantity ?? 'quantity';
      return sql`${aggFn}(${sql.raw(col)}::numeric)`;
    }
    if (v.key === 'amount') {
      const col = valueColMap.amount ?? 'amount';
      return sql`${aggFn}(${sql.raw(col)}::numeric)`;
    }
    if (v.key === 'cost') {
      const col = valueColMap.cost ?? 'cost_amount';
      return sql`${aggFn}(COALESCE(${sql.raw(col)}::numeric, 0))`;
    }
    if (v.key === 'profit') {
      const amtCol = valueColMap.amount ?? 'amount';
      const costCol = valueColMap.cost ?? 'cost_amount';
      return sql`${aggFn}(${sql.raw(amtCol)}::numeric - COALESCE(${sql.raw(costCol)}::numeric, 0))`;
    }
    if (v.key === 'discount') {
      const tagCol = valueColMap.tagPrice;
      const qtyCol = valueColMap.quantity ?? 'quantity';
      const amtCol = valueColMap.amount ?? 'amount';
      if (tagCol) {
        return sql`${aggFn}(${sql.raw(tagCol)}::numeric * ${sql.raw(qtyCol)}::numeric - ${sql.raw(amtCol)}::numeric)`;
      }
      return sql`0::numeric`;
    }
    if (v.key === 'avgPrice') {
      const amtCol = valueColMap.amount ?? 'amount';
      const qtyCol = valueColMap.quantity ?? 'quantity';
      return sql`${aggFn}(${sql.raw(amtCol)}::numeric / NULLIF(${sql.raw(qtyCol)}::numeric, 0))`;
    }

    return sql`NULL::numeric`;
  }

  /**
   * 构建 sales 数据源的指标表达式
   */
  private buildSalesValueExpr(v: PivotValueConfig, source: 'outbound' | 'retail'): SQL {
    const aggFn = this.safeAggFn(v.agg);

    if (v.key === 'quantity') {
      const col = source === 'outbound' ? 'soi.quantity' : 'roi.quantity';
      return sql`${aggFn}(${sql.raw(col)}::numeric)`;
    }
    if (v.key === 'amount') {
      const col = source === 'outbound' ? 'soi.amount' : 'roi.line_amount';
      return sql`${aggFn}(${sql.raw(col)}::numeric)`;
    }
    if (v.key === 'cost') {
      if (source === 'outbound') {
        return sql`${aggFn}(COALESCE(soi.cost_amount::numeric, 0))`;
      }
      return sql`0::numeric`;
    }
    if (v.key === 'profit') {
      if (source === 'outbound') {
        return sql`${aggFn}(soi.amount::numeric - COALESCE(soi.cost_amount::numeric, 0))`;
      }
      return sql`${aggFn}(roi.line_amount::numeric)`;
    }
    if (v.key === 'discount') {
      if (source === 'retail') {
        return sql`${aggFn}(roi.tag_price::numeric * roi.quantity::numeric - roi.line_amount::numeric)`;
      }
      return sql`0::numeric`;
    }
    if (v.key === 'avgPrice') {
      const amtCol = source === 'outbound' ? 'soi.amount' : 'roi.line_amount';
      const qtyCol = source === 'outbound' ? 'soi.quantity' : 'roi.quantity';
      return sql`${aggFn}(${sql.raw(amtCol)}::numeric / NULLIF(${sql.raw(qtyCol)}::numeric, 0))`;
    }

    return sql`NULL::numeric`;
  }

  /**
   * 构建透视表行数据（含小计行）
   */
  private buildPivotRows(
    flatRows: PivotFlatRow[],
    rows: string[],
    cols: string[],
    values: PivotValueConfig[],
    colKeys: string[],
  ): PivotRow[] {
    const result: PivotRow[] = [];

    if (rows.length === 0) {
      const cells: Record<string, PivotResultCell> = {};
      for (const colKey of colKeys) {
        cells[colKey] = this.computeCell(flatRows, colKey, cols, values);
      }
      result.push({ rowValues: [], cells });
      return result;
    }

    this.buildGroupRows(flatRows, rows, 0, [], cols, values, colKeys, result);
    return result;
  }

  private buildGroupRows(
    data: PivotFlatRow[],
    rowFields: string[],
    depth: number,
    parentValues: string[],
    cols: string[],
    values: PivotValueConfig[],
    colKeys: string[],
    result: PivotRow[],
  ): void {
    if (data.length === 0) return;

    const field = rowFields[depth];
    const groups = new Map<string, PivotFlatRow[]>();

    for (const row of data) {
      const val = String(row[field] ?? '');
      if (!groups.has(val)) groups.set(val, []);
      groups.get(val)!.push(row);
    }

    const sortedKeys = Array.from(groups.keys()).sort();

    for (const key of sortedKeys) {
      const groupData = groups.get(key)!;
      const currentValues = [...parentValues, key];

      if (depth === rowFields.length - 1) {
        const cells: Record<string, PivotResultCell> = {};
        for (const colKey of colKeys) {
          cells[colKey] = this.computeCell(groupData, colKey, cols, values);
        }
        result.push({ rowValues: currentValues, cells });
      } else {
        this.buildGroupRows(groupData, rowFields, depth + 1, currentValues, cols, values, colKeys, result);
        // 小计行
        const subtotalCells: Record<string, PivotResultCell> = {};
        for (const colKey of colKeys) {
          subtotalCells[colKey] = this.computeCell(groupData, colKey, cols, values);
        }
        result.push({ rowValues: currentValues, cells: subtotalCells, isSubtotal: true });
      }
    }
  }

  /**
   * 对一组扁平行按 colKey 聚合成 cell
   */
  private computeCell(
    rows: PivotFlatRow[],
    colKey: string,
    cols: string[],
    values: PivotValueConfig[],
  ): PivotResultCell {
    const parts = colKey.split('|');
    const vKey = parts[parts.length - 1];
    const colDimValues = parts.slice(0, -1);

    const vConfig = values.find((v: PivotValueConfig) => this.valueKey(v) === vKey);
    if (!vConfig) return { value: null, formatted: '-' };

    // 筛选列维度匹配的行
    const filtered = rows.filter((row: PivotFlatRow) => {
      for (let i = 0; i < cols.length; i += 1) {
        const dimVal = String(row[cols[i]] ?? '');
        if (dimVal !== colDimValues[i]) return false;
      }
      return true;
    });

    return this.computeCellFromRows(filtered, vKey, vConfig.agg);
  }

  private computeCellFromRows(
    rows: PivotFlatRow[],
    vKey: string,
    agg: string,
  ): PivotResultCell {
    if (rows.length === 0) return { value: null, formatted: '-' };

    const nums: number[] = rows
      .map((r: PivotFlatRow) => r[vKey])
      .filter((v: string | number | null): v is number =>
        v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v)),
      );

    if (nums.length === 0) return { value: null, formatted: '-' };

    let result: number;
    switch (agg) {
      case 'sum':
        result = nums.reduce((acc: number, v: number) => acc + v, 0);
        break;
      case 'count':
        result = nums.length;
        break;
      case 'avg':
        result = nums.reduce((acc: number, v: number) => acc + v, 0) / nums.length;
        break;
      case 'max':
        result = Math.max(...nums);
        break;
      case 'min':
        result = Math.min(...nums);
        break;
      default:
        result = nums.reduce((acc: number, v: number) => acc + v, 0);
    }

    const rounded = Math.round(result * 100) / 100;
    return { value: rounded, formatted: this.formatNumber(rounded) };
  }

  private formatNumber(num: number | null): string {
    if (num === null || num === undefined || Number.isNaN(num)) return '-';
    return num.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private computeGrandTotal(
    flatRows: PivotFlatRow[],
    cols: string[],
    values: PivotValueConfig[],
    colKeys: string[],
  ): Record<string, PivotResultCell> {
    const grandTotal: Record<string, PivotResultCell> = {};
    for (const colKey of colKeys) {
      grandTotal[colKey] = this.computeCell(flatRows, colKey, cols, values);
    }
    return grandTotal;
  }
}
