import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import {
  monthClose,
  sku,
  style,
  warehouse,
  salesOrder,
  salesOrderItem,
  salesReturnItem,
  retailOrder,
  retailOrderItem,
  inventoryStock,
  inventoryFlow,
  garmentPurchaseOrderSku,
  garmentPurchaseInboundSku,
  omniOrderItem,
  allocationItem,
  member,
  memberPoint,
  uniqueCodeStock,
  docUniqueCode,
} from '@server/database/schema';

/**
 * 系统运维模块 —— 数据质量校验引擎
 *
 * 目标：让运维人员能够手动触发"批量数据校验"，发现系统中潜藏的数据问题，
 * 并一键生成可下载的校验报告（CSV）。
 *
 * 已实现的校验项（checker）：
 *  1. ORPHAN_SKU           商品在业务数据中存在，但商品资源(SKU/款式)已被删除或停用
 *  2. INVENTORY_RECONCILE  当前库存 ≠ 最近一次月结期末 + 月结后至今的进出流水
 *  3. LOW_SALE_PRICE       销售/零售价格过低（低于吊牌价一定比例或低于成本价）
 *  4. BULK_PURCHASE        同一顾客/会员在短期内大量购买
 *  5. MEMBER_POINTS        会员积分与积分流水累计不一致
 *  6. NEGATIVE_STOCK       库存出现负数
 *  7. UNIQUE_CODE_RECONCILE 唯一码库存与扫码流水对账（状态机/孤儿/缺登记）
 *
 * 设计说明：
 *  - 所有 checker 都是只读查询，绝不修改业务数据，可安全反复执行。
 *  - 校验阈值（低价比例、短期窗口、大量购买阈值等）可通过 runValidation 入参覆盖。
 *  - 报告以结构化对象返回，并可序列化为 CSV 供下载。
 */

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  /** 所属校验项代码 */
  checkCode: string;
  /** 所属校验项名称 */
  checkName: string;
  /** 严重级别 */
  severity: Severity;
  /** 业务对象类型（表名/概念） */
  entity: string;
  /** 业务对象标识（如 skuId / 仓库+sku 复合 / 会员ID） */
  entityId: string;
  /** 关联单据号（若有） */
  bizNo?: string;
  /** 期望值（文本） */
  expected?: string;
  /** 实际值（文本） */
  actual?: string;
  /** 问题描述（面向运维人员） */
  description: string;
}

export interface CheckResult {
  code: string;
  name: string;
  description: string;
  severity: Severity;
  issueCount: number;
  issues: ValidationIssue[];
}

export interface ValidationReport {
  generatedAt: string;
  referenceMonth: string | null;
  params: ValidationParams;
  totalIssues: number;
  bySeverity: { error: number; warning: number; info: number };
  checks: CheckResult[];
}

export interface ValidationParams {
  /** 低价判定：成交价低于吊牌价的比例阈值（<= 该比例视为过低），默认 0.5 */
  lowPriceRatio: number;
  /** 短期大量购买的统计窗口（天），默认 7 */
  bulkWindowDays: number;
  /** 短期大量购买的数量阈值，默认 100 件 */
  bulkQtyThreshold: number;
  /** 短期大量购买的金额阈值，默认 100000 元 */
  bulkAmountThreshold: number;
  /** 仅运行指定的校验项代码；为空表示运行全部 */
  checks: string[];
}

export const DEFAULT_PARAMS: ValidationParams = {
  lowPriceRatio: 0.5,
  bulkWindowDays: 7,
  bulkQtyThreshold: 100,
  bulkAmountThreshold: 100000,
  checks: [],
};

export interface CheckMeta {
  code: string;
  name: string;
  description: string;
  severity: Severity;
}

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /** 返回全部可用校验项元数据 */
  getChecks(): CheckMeta[] {
    return ALL_CHECKS;
  }

  /**
   * 运行数据校验，返回结构化报告。
   * @param partial 覆盖默认阈值 / 指定校验项
   */
  async runValidation(partial?: Partial<ValidationParams>): Promise<ValidationReport> {
    const params: ValidationParams = { ...DEFAULT_PARAMS, ...(partial ?? {}) };

    // 最近一次已月结月份（用于库存对账的期末基准）
    const refRows = await this.db
      .select({ month: monthClose.month })
      .from(monthClose)
      .where(sql`${monthClose.status} = 'closed'`)
      .orderBy(sql`${monthClose.month} DESC`)
      .limit(1);
    const referenceMonth = refRows.length > 0 ? refRows[0].month : null;

    // 待运行的校验项
    const runCodes =
      params.checks && params.checks.length > 0
        ? params.checks.filter((c) => ALL_CHECKS.some((m) => m.code === c))
        : ALL_CHECKS.map((m) => m.code);

    const checks: CheckResult[] = [];
    for (const meta of ALL_CHECKS) {
      if (!runCodes.includes(meta.code)) continue;
      let issues: ValidationIssue[] = [];
      try {
        issues = await this.runOne(meta.code, params);
      } catch (err: any) {
        this.logger.error(`校验项 ${meta.code} 执行失败：${err?.message ?? err}`, err?.stack);
        issues = [
          {
            checkCode: meta.code,
            checkName: meta.name,
            severity: 'error',
            entity: 'system',
            entityId: meta.code,
            description: `校验项执行异常：${err?.message ?? err}`,
          },
        ];
      }
      checks.push({
        code: meta.code,
        name: meta.name,
        description: meta.description,
        severity: meta.severity,
        issueCount: issues.length,
        issues,
      });
    }

    const bySeverity = { error: 0, warning: 0, info: 0 };
    let total = 0;
    for (const c of checks) {
      for (const i of c.issues) {
        bySeverity[i.severity]++;
        total++;
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      referenceMonth,
      params,
      totalIssues: total,
      bySeverity,
      checks,
    };
  }

  /* ============================ 内部：分发 ============================ */

  private async runOne(code: string, params: ValidationParams): Promise<ValidationIssue[]> {
    switch (code) {
      case 'ORPHAN_SKU':
        return this.checkOrphanSku();
      case 'INVENTORY_RECONCILE':
        return this.checkInventoryReconcile();
      case 'LOW_SALE_PRICE':
        return this.checkLowSalePrice(params.lowPriceRatio);
      case 'BULK_PURCHASE':
        return this.checkBulkPurchase(params);
      case 'MEMBER_POINTS':
        return this.checkMemberPoints();
      case 'NEGATIVE_STOCK':
        return this.checkNegativeStock();
      case 'UNIQUE_CODE_RECONCILE':
        return this.checkUniqueCodeReconcile();
      case 'UNIQUE_CODE_AGG_RECONCILE':
        return this.checkUniqueCodeAggReconcile();
      default:
        return [];
    }
  }

  /* ============================ 校验器实现 ============================ */

  /**
   * 校验项 1：商品在业务数据中存在，但资源(SKU/款式)已被删除或停用。
   * 收集所有业务表中引用到的 sku_id，反查 sku / style，标记缺失或停用。
   */
  private async checkOrphanSku(): Promise<ValidationIssue[]> {
    const rows = (await this.db.execute(sql`
      WITH refs AS (
        SELECT sku_id, 'sales_order_item' AS src FROM sales_order_item WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'sales_return_item' FROM sales_return_item WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'retail_order_item' FROM retail_order_item WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'inventory_stock' FROM inventory_stock WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'inventory_flow' FROM inventory_flow WHERE sku_id IS NOT NULL AND item_type = 'sku'
        UNION ALL SELECT sku_id, 'garment_purchase_order_sku' FROM garment_purchase_order_sku WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'garment_purchase_inbound_sku' FROM garment_purchase_inbound_sku WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'omni_order_item' FROM omni_order_item WHERE sku_id IS NOT NULL
        UNION ALL SELECT sku_id, 'allocation_item' FROM allocation_item WHERE sku_id IS NOT NULL
      )
      SELECT
        r.sku_id,
        s.sku_code,
        s.status AS sku_status,
        st.style_no,
        st.status AS style_status,
        COUNT(*) FILTER (WHERE r.src = 'sales_order_item') AS c_soi,
        COUNT(*) FILTER (WHERE r.src = 'sales_return_item') AS c_sri,
        COUNT(*) FILTER (WHERE r.src = 'retail_order_item') AS c_roi,
        COUNT(*) FILTER (WHERE r.src = 'inventory_stock') AS c_stock,
        COUNT(*) FILTER (WHERE r.src = 'inventory_flow') AS c_flow,
        COUNT(*) FILTER (WHERE r.src = 'garment_purchase_order_sku') AS c_pos,
        COUNT(*) FILTER (WHERE r.src = 'garment_purchase_inbound_sku') AS c_pis,
        COUNT(*) FILTER (WHERE r.src = 'omni_order_item') AS c_omni,
        COUNT(*) FILTER (WHERE r.src = 'allocation_item') AS c_alloc
      FROM refs r
      LEFT JOIN sku s ON s.id = r.sku_id
      LEFT JOIN style st ON st.id = s.style_id
      GROUP BY r.sku_id, s.sku_code, s.status, st.style_no, st.status
      HAVING s.sku_code IS NULL
         OR s.status <> 'active'
         OR st.style_no IS NULL
         OR st.status <> 'active'
      LIMIT 5000
    `)) as any[];

    const issues: ValidationIssue[] = [];
    for (const r of rows) {
      const skuCode = r.sku_code ?? '(缺失)';
      let desc = '';
      let severity: Severity = 'error';
      if (r.sku_id == null || r.sku_code == null) {
        desc = `业务数据中引用了不存在的 SKU(id=${r.sku_id})，商品资源已被删除`;
      } else if (r.style_no == null) {
        desc = `SKU ${skuCode} 关联的款式资源已被删除（款式缺失）`;
      } else if (r.sku_status !== 'active' && r.style_status !== 'active') {
        desc = `SKU ${skuCode} 与款式 ${r.style_no} 均已停用/删除`;
      } else if (r.sku_status !== 'active') {
        desc = `SKU ${skuCode} 已停用（status=${r.sku_status}），但仍存在于业务单据中`;
      } else {
        desc = `SKU ${skuCode} 所属款式 ${r.style_no} 已停用（status=${r.style_status}）`;
        severity = 'warning';
      }
      const refCount =
        Number(r.c_soi) + Number(r.c_sri) + Number(r.c_roi) + Number(r.c_stock) +
        Number(r.c_flow) + Number(r.c_pos) + Number(r.c_pis) + Number(r.c_omni) + Number(r.c_alloc);
      issues.push({
        checkCode: 'ORPHAN_SKU',
        checkName: '商品资源缺失/停用',
        severity,
        entity: 'sku',
        entityId: String(r.sku_id),
        expected: 'SKU 与款式均存在且为 active',
        actual: `sku_status=${r.sku_status ?? '缺失'}, style_status=${r.style_status ?? '缺失'}`,
        description: `${desc}；业务侧被引用 ${refCount} 次`,
      });
    }
    return issues;
  }

  /**
   * 校验项 2：当前库存 ≠ 最近一次月结期末 + 月结后至今的进出流水。
   * 以最近已月结月份为基准，recompute 每个 (sku, 仓库) 的期望库存并与 inventory_stock 比对。
   */
  private async checkInventoryReconcile(): Promise<ValidationIssue[]> {
    const rows = (await this.db.execute(sql`
      WITH latest AS (
        SELECT month FROM month_close WHERE status = 'closed' ORDER BY month DESC LIMIT 1
      ),
      close_end AS (
        SELECT COALESCE(
          (date_trunc('month', ((SELECT month FROM latest) || '-01')::date) + interval '1 month')::timestamp,
          '1970-01-01'::timestamp
        ) AS ce
      ),
      flows AS (
        SELECT
          sku_id,
          warehouse_id,
          COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END)
                   FILTER (WHERE _created_at < (SELECT ce FROM close_end)), 0) AS pre,
          COALESCE(SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END)
                   FILTER (WHERE _created_at >= (SELECT ce FROM close_end)), 0) AS post
        FROM inventory_flow
        WHERE item_type = 'sku' AND sku_id IS NOT NULL
        GROUP BY sku_id, warehouse_id
      ),
      stocks AS (
        SELECT sku_id, warehouse_id, quantity AS actual FROM inventory_stock
      )
      SELECT
        COALESCE(f.sku_id, s.sku_id) AS sku_id,
        COALESCE(f.warehouse_id, s.warehouse_id) AS warehouse_id,
        sk.sku_code,
        w.name AS warehouse_name,
        (COALESCE(f.pre, 0) + COALESCE(f.post, 0)) AS expected,
        COALESCE(s.actual, 0) AS actual,
        (COALESCE(f.pre, 0) + COALESCE(f.post, 0) - COALESCE(s.actual, 0)) AS diff,
        COALESCE(f.pre, 0) AS pre_close,
        COALESCE(f.post, 0) AS post_close
      FROM flows f
      FULL OUTER JOIN stocks s
        ON f.sku_id = s.sku_id AND f.warehouse_id = s.warehouse_id
      LEFT JOIN sku sk ON sk.id = COALESCE(f.sku_id, s.sku_id)
      LEFT JOIN warehouse w ON w.id = COALESCE(f.warehouse_id, s.warehouse_id)
      WHERE (COALESCE(f.pre, 0) + COALESCE(f.post, 0)) <> COALESCE(s.actual, 0)
      LIMIT 5000
    `)) as any[];

    const issues: ValidationIssue[] = [];
    for (const r of rows) {
      const skuCode = r.sku_code ?? '(未知SKU)';
      const whName = r.warehouse_name ?? '(未知仓库)';
      const expected = Number(r.expected);
      const actual = Number(r.actual);
      const pre = Number(r.pre_close);
      const post = Number(r.post_close);
      const hasFlow = r.pre_close != null || r.post_close != null;
      const hasStock = r.actual != null;
      let desc: string;
      if (hasFlow && !hasStock) {
        desc = `${whName} 的 ${skuCode} 仅有进出流水而无库存台账记录`;
      } else if (!hasFlow && hasStock) {
        desc = `${whName} 的 ${skuCode} 存在库存台账但无任何进出流水（期初未入账）`;
      } else {
        desc = `${whName} 的 ${skuCode} 当前库存与"月结期末 + 月结后进出"不符`;
      }
      issues.push({
        checkCode: 'INVENTORY_RECONCILE',
        checkName: '库存与月结+流水不一致',
        severity: 'error',
        entity: 'inventory_stock',
        entityId: `${r.sku_id}|${r.warehouse_id}`,
        bizNo: whName,
        expected: `月结期末(${pre}) + 月结后进出(${post}) = ${expected}`,
        actual: `库存台账 = ${actual}`,
        description: `${desc}；差异 ${actual - expected}`,
      });
    }
    return issues;
  }

  /**
   * 校验项 3：销售/零售价格过低。
   * 销售单(已记账)明细价、零售单(已结算)成交价，低于吊牌价*比例 或 低于成本价，视为异常低价。
   */
  private async checkLowSalePrice(ratio: number): Promise<ValidationIssue[]> {
    const rows = (await this.db.execute(sql`
      SELECT
        'sales' AS src,
        so.order_no AS biz_no,
        i.sku_id,
        i.sku_code,
        i.price AS deal_price,
        s.tag_price,
        s.cost_price,
        so.customer_name
      FROM sales_order_item i
      JOIN sales_order so ON so.id = i.order_id
      LEFT JOIN sku s ON s.id = i.sku_id
      WHERE so.status = 'booked'
        AND s.id IS NOT NULL
        AND (
          i.price <= 0
          OR i.price < (s.tag_price * ${ratio})
          OR i.price < s.cost_price
        )
      LIMIT 3000
    `)) as any[];

    const retailRows = (await this.db.execute(sql`
      SELECT
        'retail' AS src,
        ro.retail_no AS biz_no,
        i.sku_id,
        i.sku_code,
        i.deal_price,
        s.tag_price,
        s.cost_price,
        ro.store_name AS customer_name
      FROM retail_order_item i
      JOIN retail_order ro ON ro.id = i.retail_id
      LEFT JOIN sku s ON s.id = i.sku_id
      WHERE ro.status = 'settled'
        AND s.id IS NOT NULL
        AND (
          i.deal_price <= 0
          OR i.deal_price < (s.tag_price * ${ratio})
          OR i.deal_price < s.cost_price
        )
      LIMIT 3000
    `)) as any[];

    const issues: ValidationIssue[] = [];
    const push = (r: any) => {
      const deal = Number(r.deal_price);
      const tag = r.tag_price != null ? Number(r.tag_price) : null;
      const cost = r.cost_price != null ? Number(r.cost_price) : null;
      let reason = '';
      if (deal <= 0) reason = '成交价为 0 或负数';
      else if (tag != null && deal < tag * ratio) reason = `低于吊牌价${Math.round(ratio * 100)}%（吊牌价${tag}）`;
      else if (cost != null && deal < cost) reason = `低于成本价（成本价${cost}）`;
      if (!reason) return;
      issues.push({
        checkCode: 'LOW_SALE_PRICE',
        checkName: '销售价格过低',
        severity: 'warning',
        entity: 'sales_order_item',
        entityId: String(r.sku_id),
        bizNo: r.biz_no,
        expected: `成交价 >= max(吊牌价*${ratio}, 成本价)`,
        actual: `成交价=${deal}`,
        description: `单据 ${r.biz_no} 的 SKU ${r.sku_code} ${reason}；对手方：${r.customer_name ?? ''}`,
      });
    };
    rows.forEach(push);
    retailRows.forEach(push);
    return issues;
  }

  /**
   * 校验项 4：同一顾客/会员在短期内大量购买。
   * 销售单(按 customer) 与 零售单(按 member) 在窗口期内累计数量/金额超阈值。
   */
  private async checkBulkPurchase(params: ValidationParams): Promise<ValidationIssue[]> {
    const { bulkWindowDays, bulkQtyThreshold, bulkAmountThreshold } = params;

    const salesRows = (await this.db.execute(sql`
      SELECT
        so.dealer_id AS party_id,
        so.customer_name AS party_name,
        'dealer' AS party_type,
        COUNT(DISTINCT so.id) AS order_count,
        COALESCE(SUM(soi.quantity), 0) AS total_qty,
        COALESCE(SUM(soi.amount), 0) AS total_amount
      FROM sales_order so
      JOIN sales_order_item soi ON soi.order_id = so.id
      WHERE so.status = 'booked'
        AND so.order_date >= (CURRENT_DATE - (${bulkWindowDays}) * interval '1 day')
      GROUP BY so.dealer_id, so.customer_name
      HAVING COALESCE(SUM(soi.quantity), 0) > ${bulkQtyThreshold}
          OR COALESCE(SUM(soi.amount), 0) > ${bulkAmountThreshold}
      LIMIT 2000
    `)) as any[];

    const retailRows = (await this.db.execute(sql`
      SELECT
        ro.member_id AS party_id,
        m.name AS party_name,
        'member' AS party_type,
        COUNT(DISTINCT ro.id) AS order_count,
        COALESCE(SUM(roi.quantity), 0) AS total_qty,
        COALESCE(SUM(roi.line_amount), 0) AS total_amount
      FROM retail_order ro
      JOIN retail_order_item roi ON roi.retail_id = ro.id
      LEFT JOIN member m ON m.id = ro.member_id
      WHERE ro.status = 'settled'
        AND ro.sale_date >= (CURRENT_DATE - (${bulkWindowDays}) * interval '1 day')
        AND ro.member_id IS NOT NULL
      GROUP BY ro.member_id, m.name
      HAVING COALESCE(SUM(roi.quantity), 0) > ${bulkQtyThreshold}
          OR COALESCE(SUM(roi.line_amount), 0) > ${bulkAmountThreshold}
      LIMIT 2000
    `)) as any[];

    const issues: ValidationIssue[] = [];
    const push = (r: any) => {
      const qty = Number(r.total_qty);
      const amt = Number(r.total_amount);
      const hit = qty > bulkQtyThreshold ? `数量${qty}件` : `金额${amt}元`;
      issues.push({
        checkCode: 'BULK_PURCHASE',
        checkName: '短期大量购买',
        severity: 'warning',
        entity: r.party_type === 'member' ? 'member' : 'dealer',
        entityId: String(r.party_id),
        expected: `窗口${bulkWindowDays}天内 数量<=${bulkQtyThreshold} 且 金额<=${bulkAmountThreshold}`,
        actual: `${hit}（${r.order_count}单）`,
        description: `${r.party_type === 'member' ? '会员' : '经销商'} ${r.party_name ?? r.party_id} 在最近 ${bulkWindowDays} 天内累计购买 ${qty} 件 / ${amt} 元，超阈值`,
      });
    };
    salesRows.forEach(push);
    retailRows.forEach(push);
    return issues;
  }

  /**
   * 校验项 5：会员积分与积分流水累计不一致。
   * member.points 应等于 member_point.change_value 的累计和。
   */
  private async checkMemberPoints(): Promise<ValidationIssue[]> {
    const rows = (await this.db.execute(sql`
      SELECT
        m.id AS member_id,
        m.member_no,
        m.name,
        m.points AS stored_points,
        m.order_count AS stored_order_count,
        COALESCE(SUM(mp.change_value), 0) AS computed_points,
        COUNT(mp.id) FILTER (WHERE mp.change_type = 'earn') AS earn_count,
        COUNT(mp.id) FILTER (WHERE mp.change_type = 'redeem') AS redeem_count
      FROM member m
      LEFT JOIN member_point mp ON mp.member_id = m.id
      GROUP BY m.id, m.member_no, m.name, m.points, m.order_count
      HAVING m.points <> COALESCE(SUM(mp.change_value), 0)
          OR m.points < 0
      LIMIT 5000
    `)) as any[];

    const issues: ValidationIssue[] = [];
    for (const r of rows) {
      const stored = Number(r.stored_points);
      const computed = Number(r.computed_points);
      const reason = stored < 0 ? '积分出现负数' : '积分与流水累计不一致';
      issues.push({
        checkCode: 'MEMBER_POINTS',
        checkName: '会员积分不正确',
        severity: 'error',
        entity: 'member',
        entityId: String(r.member_id),
        bizNo: r.member_no,
        expected: `累计流水 = ${computed}`,
        actual: `账户积分 = ${stored}`,
        description: `会员 ${r.name ?? ''}(${r.member_no}) ${reason}；获得${r.earn_count}次/兑换${r.redeem_count}次`,
      });
    }
    return issues;
  }

  /**
   * 校验项 6：库存出现负数。
   */
  private async checkNegativeStock(): Promise<ValidationIssue[]> {
    const rows = (await this.db.execute(sql`
      SELECT s.sku_id, s.warehouse_id, sk.sku_code, w.warehouse_name, s.quantity
      FROM inventory_stock s
      LEFT JOIN sku sk ON sk.id = s.sku_id
      LEFT JOIN warehouse w ON w.id = s.warehouse_id
      WHERE s.quantity < 0
      LIMIT 5000
    `)) as any[];

    return rows.map((r: any) => ({
      checkCode: 'NEGATIVE_STOCK',
      checkName: '负库存',
      severity: 'error' as Severity,
      entity: 'inventory_stock',
      entityId: `${r.sku_id}|${r.warehouse_id}`,
      bizNo: r.warehouse_name ?? '',
      expected: '>= 0',
      actual: `=${Number(r.quantity)}`,
      description: `仓库 ${r.warehouse_name ?? ''} 的 SKU ${r.sku_code ?? ''} 库存为 ${Number(r.quantity)}（负数）`,
    }));
  }

  /**
   * 校验项 7：唯一码库存与扫码流水对账。
   * 检测 unique_code_stock（件级库存权威源）与 doc_unique_code（扫码流水）之间的不一致：
   *  (a) 库存行缺少入库登记（分配了码却从未入库）；
   *  (b) 出库/核销/退货流水缺少对应库存行（孤儿流水）；
   *  (c) 状态机矛盾：库存 in_stock 却存在出库流水；或状态为 out/sold 却无出库流水。
   * 这些不一致会直接误导防串货/防错发判断，需优先修复。
   */
  private async checkUniqueCodeReconcile(): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // (a) 库存行缺入库登记
    const missingInbound = (await this.db.execute(sql`
      SELECT ucs.unique_code, ucs.sku_id, ucs.style_no, ucs.warehouse_id, ucs.status
      FROM unique_code_stock ucs
      LEFT JOIN doc_unique_code d
        ON d.unique_code = ucs.unique_code AND d.scan_type = 'inbound'
      WHERE d.id IS NULL
      LIMIT 2000
    `)) as any[];
    for (const r of missingInbound) {
      issues.push({
        checkCode: 'UNIQUE_CODE_RECONCILE',
        checkName: '唯一码缺入库登记',
        severity: 'error',
        entity: 'unique_code_stock',
        entityId: String(r.unique_code),
        expected: '存在 inbound 登记流水',
        actual: '无入库登记',
        description: `唯一码 ${r.unique_code}(${r.style_no ?? ''}) 在库存表中存在，但从未有任何入库(inbound)扫码登记`,
      });
    }

    // (b) 出库/核销/退货流水缺库存行（孤儿流水）
    const orphanFlow = (await this.db.execute(sql`
      SELECT d.unique_code, d.doc_type, d.doc_id, d.scan_type
      FROM doc_unique_code d
      LEFT JOIN unique_code_stock ucs ON ucs.unique_code = d.unique_code
      WHERE d.scan_type IN ('outbound', 'sold', 'returned') AND ucs.id IS NULL
      LIMIT 2000
    `)) as any[];
    for (const r of orphanFlow) {
      issues.push({
        checkCode: 'UNIQUE_CODE_RECONCILE',
        checkName: '唯一码流水孤儿',
        severity: 'error',
        entity: 'doc_unique_code',
        entityId: String(r.unique_code),
        bizNo: `${r.doc_type}/${r.doc_id}`,
        expected: '存在对应库存行',
        actual: '无库存行',
        description: `唯一码 ${r.unique_code} 存在 ${r.scan_type} 流水(单据 ${r.doc_type}/${r.doc_id})，但库存表中无对应记录`,
      });
    }

    // (c1) 库存 in_stock 却存在「未退货」的出库流水（状态未推进/矛盾）
    //     排除：已有 returned 流水（已合法退货回库，出库为历史）
    const stuckInStock = (await this.db.execute(sql`
      SELECT ucs.unique_code, ucs.style_no, ucs.warehouse_id
      FROM unique_code_stock ucs
      WHERE ucs.status = 'in_stock'
        AND EXISTS (
          SELECT 1 FROM doc_unique_code d
          WHERE d.unique_code = ucs.unique_code AND d.scan_type = 'outbound'
        )
        AND NOT EXISTS (
          SELECT 1 FROM doc_unique_code d
          WHERE d.unique_code = ucs.unique_code AND d.scan_type = 'returned'
        )
      LIMIT 2000
    `)) as any[];
    for (const r of stuckInStock) {
      issues.push({
        checkCode: 'UNIQUE_CODE_RECONCILE',
        checkName: '唯一码状态矛盾',
        severity: 'error',
        entity: 'unique_code_stock',
        entityId: String(r.unique_code),
        expected: 'status=out/sold（已出库）',
        actual: 'status=in_stock 但已有出库流水',
        description: `唯一码 ${r.unique_code}(${r.style_no ?? ''}) 状态仍为在库(in_stock)，却已存在出库扫码流水，状态机未推进`,
      });
    }

    // (c2) 库存 out/sold 却无出库流水（状态无依据）
    const noOutFlow = (await this.db.execute(sql`
      SELECT ucs.unique_code, ucs.style_no, ucs.status
      FROM unique_code_stock ucs
      WHERE ucs.status IN ('out', 'sold')
        AND NOT EXISTS (
          SELECT 1 FROM doc_unique_code d
          WHERE d.unique_code = ucs.unique_code AND d.scan_type = 'outbound'
        )
      LIMIT 2000
    `)) as any[];
    for (const r of noOutFlow) {
      issues.push({
        checkCode: 'UNIQUE_CODE_RECONCILE',
        checkName: '唯一码状态矛盾',
        severity: 'error',
        entity: 'unique_code_stock',
        entityId: String(r.unique_code),
        expected: '存在 outbound 流水',
        actual: `status=${r.status} 但无出库流水`,
        description: `唯一码 ${r.unique_code}(${r.style_no ?? ''}) 状态为 ${r.status}，但找不到任何出库(outbound)扫码流水，状态无依据`,
      });
    }

    return issues;
  }

  /**
   * 校验项 8：件级在库数 与 聚合库存(inventory_stock)对账。
   * 仅在唯一码启用时生效。将 unique_code_stock(status=in_stock) 按 (sku_id, 仓库) 汇总件数，
   * 与 inventory_stock.quantity 比对，发现漂移（件级账与聚合账不一致）即告警。
   * 不一致会误导防串货/防错发——件级说在库 N 件但聚合账只有 M 件，或反之。
   */
  private async checkUniqueCodeAggReconcile(): Promise<ValidationIssue[]> {
    const en = (await this.db.execute(sql`
      SELECT config_value FROM system_config WHERE config_key = 'UNIQUE_CODE_ENABLED' LIMIT 1
    `)) as any[];
    if (!en.length || en[0].config_value !== 'true') {
      return [];
    }
    const rows = (await this.db.execute(sql`
      WITH uc AS (
        SELECT sku_id, warehouse_id, COUNT(*)::int AS uc_cnt
        FROM unique_code_stock
        WHERE status = 'in_stock'
        GROUP BY sku_id, warehouse_id
      ),
      stock AS (
        SELECT sku_id, warehouse_id, COALESCE(quantity, 0)::numeric AS qty
        FROM inventory_stock
      )
      SELECT
        COALESCE(u.sku_id, s.sku_id) AS sku_id,
        COALESCE(u.warehouse_id, s.warehouse_id) AS warehouse_id,
        sk.sku_code,
        w.name AS warehouse_name,
        COALESCE(u.uc_cnt, 0) AS uc_cnt,
        COALESCE(s.qty, 0) AS agg_qty,
        (COALESCE(u.uc_cnt, 0) - COALESCE(s.qty, 0)) AS diff
      FROM uc u
      FULL OUTER JOIN stock s
        ON u.sku_id = s.sku_id AND u.warehouse_id = s.warehouse_id
      LEFT JOIN sku sk ON sk.id = COALESCE(u.sku_id, s.sku_id)
      LEFT JOIN warehouse w ON w.id = COALESCE(u.warehouse_id, s.warehouse_id)
      WHERE COALESCE(u.uc_cnt, 0) <> COALESCE(s.qty, 0)
      LIMIT 5000
    `)) as any[];

    const issues: ValidationIssue[] = [];
    for (const r of rows) {
      const uc = Number(r.uc_cnt);
      const agg = Number(r.agg_qty);
      const diff = Number(r.diff);
      const skuCode = r.sku_code ?? '(未知SKU)';
      const whName = r.warehouse_name ?? '(未知仓库)';
      const hasUc = r.uc_cnt != null;
      const hasStock = r.agg_qty != null;
      let desc: string;
      if (hasUc && !hasStock) {
        desc = `${whName} 的 ${skuCode} 件级在库 ${uc} 件，但聚合库存台账无记录`;
      } else if (!hasUc && hasStock) {
        desc = `${whName} 的 ${skuCode} 聚合库存 ${agg} 件，但件级在库记录为 0（未登记唯一码）`;
      } else {
        desc = `${whName} 的 ${skuCode} 件级在库与聚合库存不符`;
      }
      issues.push({
        checkCode: 'UNIQUE_CODE_AGG_RECONCILE',
        checkName: '件级在库与聚合库存不一致',
        severity: 'error',
        entity: 'unique_code_stock/inventory_stock',
        entityId: `${r.sku_id}|${r.warehouse_id}`,
        bizNo: whName,
        expected: `件级在库 = ${uc}`,
        actual: `聚合库存 = ${agg}`,
        description: `${desc}；差异 ${diff}`,
      });
    }
    return issues;
  }

  /* ============================ 报告序列化 ============================ */

  /** 将报告序列化为带 BOM 的 CSV（Excel 友好），返回字符串。 */
  toCsv(report: ValidationReport): string {
    const header = [
      '校验项代码',
      '校验项名称',
      '严重级别',
      '业务对象',
      '对象标识',
      '单据号',
      '期望值',
      '实际值',
      '问题描述',
    ];
    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines: string[] = [];
    lines.push('\uFEFF' + header.join(','));

    // 概览行（以注释形式放在报告开头，便于运维快速浏览）
    lines.push(`# 生成时间,${report.generatedAt}`);
    lines.push(`# 月结基准月,${report.referenceMonth ?? '无(自建账起)'}`);
    lines.push(`# 问题总数,${report.totalIssues}`);
    lines.push(`# 错误/${report.bySeverity.error},警告/${report.bySeverity.warning},提示/${report.bySeverity.info}`);
    lines.push('#');

    for (const c of report.checks) {
      if (c.issueCount === 0) {
        lines.push(`# [通过] ${c.code} - ${c.name}（无异常）`);
        continue;
      }
      for (const i of c.issues) {
        lines.push(
          [
            i.checkCode,
            i.checkName,
            i.severity,
            i.entity,
            i.entityId,
            i.bizNo ?? '',
            i.expected ?? '',
            i.actual ?? '',
            i.description,
          ]
            .map(esc)
            .join(','),
        );
      }
    }
    return lines.join('\r\n');
  }
}

export const ALL_CHECKS: CheckMeta[] = [
  {
    code: 'ORPHAN_SKU',
    name: '商品资源缺失/停用',
    description: '业务单据中引用的商品(SKU/款式)已被删除或停用，可能导致统计/展示异常。',
    severity: 'error',
  },
  {
    code: 'INVENTORY_RECONCILE',
    name: '库存与月结+流水不一致',
    description: '当前库存台账与"最近月结期末 + 月结后进出流水"累加结果不相等，库存数据失真。',
    severity: 'error',
  },
  {
    code: 'LOW_SALE_PRICE',
    name: '销售价格过低',
    description: '销售/零售成交价低于吊牌价一定比例或低于成本价，疑似定价错误或刷单。',
    severity: 'warning',
  },
  {
    code: 'BULK_PURCHASE',
    name: '短期大量购买',
    description: '同一客户/会员在短期内(默认7天)累计购买数量或金额超过阈值，疑似异常囤货或刷单。',
    severity: 'warning',
  },
  {
    code: 'MEMBER_POINTS',
    name: '会员积分不正确',
    description: '会员账户积分与积分流水累计和(获得-兑换)不一致，或积分出现负数。',
    severity: 'error',
  },
  {
    code: 'NEGATIVE_STOCK',
    name: '负库存',
    description: '库存台账出现负数，通常为出入库不同步或越库发货导致。',
    severity: 'error',
  },
  {
    code: 'UNIQUE_CODE_RECONCILE',
    name: '唯一码库存与流水对账',
    description: '件级库存(unique_code_stock)与扫码流水(doc_unique_code)不一致：缺入库登记、孤儿流水、状态机矛盾，会误导防串货判断。',
    severity: 'error',
  },
  {
    code: 'UNIQUE_CODE_AGG_RECONCILE',
    name: '件级在库与聚合库存不一致',
    description: '唯一码启用时，件级在库数(unique_code_stock, status=in_stock) 与 聚合库存(inventory_stock.quantity) 按 (sku,仓库) 不等，件级账与聚合账失真。',
    severity: 'error',
  },
];
