import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import {
  type CheckStatus,
  type ConsistencyCheckResult,
  type ConsistencyDomain,
  type ConsistencyReport,
  type ConsistencyReportSummary,
  type ConsistencyRunSummary,
} from './consistency.types';

/**
 * 主数据一致性校验服务（P2-3）。
 *
 * 全部校验走**原生 SQL**（单语句聚合），不依赖 drizzle 实体映射，便于在不
 * 重新 `nest build` 的前提下直接落到已编译的 dist 运行；同时逻辑与库结构
 * 强绑定、可读、可复核（trust-but-verify）。
 *
 * 三域五检：
 *  商品 product     : cross_ref_integrity  —— retail_order_item / sales_order_item /
 *                                              inventory_stock 引用的 sku_id 必须存在
 *  会员 member      : cross_ref_integrity  —— retail_order.member_id 必须存在
 *                     duplicate_phone       —— 会员手机号重复（数据质量，warn）
 *  价格 price       : cross_ref_integrity  —— price_list_item.sku_id 必须存在
 *                     orphan_price_list     —— price_list_item.price_list_id 必须存在
 */
@Injectable()
export class ConsistencyService {
  private readonly logger = new Logger(ConsistencyService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  // ---------------------------------------------------------------------------
  // 校验规格
  // ---------------------------------------------------------------------------

  /** 各域的“消费侧去重键”子查询（取被引用主数据键，统一转 text 比较，规避 uuid/varchar 类型差） */
  private readonly consumerSubquery: Record<string, string> = {
    product: `
      SELECT DISTINCT sku_id::text AS sid
      FROM retail_order_item WHERE sku_id IS NOT NULL
      UNION
      SELECT DISTINCT sku_id::text FROM sales_order_item WHERE sku_id IS NOT NULL
      UNION
      SELECT DISTINCT sku_id::text FROM inventory_stock WHERE sku_id IS NOT NULL`,
    member: `
      SELECT DISTINCT member_id::text AS sid
      FROM retail_order WHERE member_id IS NOT NULL`,
    priceSku: `
      SELECT DISTINCT sku_id::text AS sid
      FROM price_list_item WHERE sku_id IS NOT NULL`,
    priceList: `
      SELECT DISTINCT price_list_id::text AS sid
      FROM price_list_item WHERE price_list_id IS NOT NULL`,
  };

  /** 游离引用判定：引用键不在目标主表内（sid 为消费侧 CTE 的关联列） */
  private readonly notExists: Record<string, string> = {
    product: `sku s WHERE s.id::text = sid`,
    member: `member m WHERE m.id::text = sid`,
    priceSku: `sku s WHERE s.id::text = sid`,
    priceList: `price_list l WHERE l.id::text = sid`,
  };

  /** 源（主数据）行数 + 指纹 SQL */
  private readonly sourceSql: Record<ConsistencyDomain, string> = {
    product: `SELECT count(*)::int AS c,
                     COALESCE(md5(string_agg(concat(id::text,':',coalesce(sku_code,''),':',coalesce(style_no,''),':',coalesce(_updated_at::text,'')),'|' ORDER BY id)),'0') AS h
              FROM sku`,
    member: `SELECT count(*)::int AS c,
                    COALESCE(md5(string_agg(concat(id::text,':',coalesce(phone,''),':',coalesce(level,''),':',coalesce(_updated_at::text,'')),'|' ORDER BY id)),'0') AS h
             FROM member`,
    price: `SELECT count(*)::int AS c,
                   COALESCE(md5(string_agg(concat(id::text,':',coalesce(sku_id::text,''),':',coalesce(price::text,''),':',coalesce(_updated_at::text,'')),'|' ORDER BY id)),'0') AS h
            FROM price_list_item`,
  };

  // ---------------------------------------------------------------------------
  // 公开 API
  // ---------------------------------------------------------------------------

  /** 触发一次全量校验并落库，返回报告。供 controller 的 run 与 scheduler 调用。 */
  async runManual(): Promise<ConsistencyReport> {
    const startedAt = new Date().toISOString();
    const runId = `consistency-${startedAt.replace(/[:.]/g, '-')}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const results = await Promise.all([
      this.checkCrossRef('product', 'product.cross_ref_integrity', '商品跨系统引用完整性（POS/交易→ERP sku）', 'product', 'fail'),
      this.checkCrossRef('member', 'member.cross_ref_integrity', '会员跨系统引用完整性（零售单→ERP member）', 'member', 'fail'),
      this.checkDuplicatePhone(),
      this.checkCrossRef('price', 'price.cross_ref_integrity', '价格跨系统引用完整性（价目表明细→ERP sku）', 'priceSku', 'fail'),
      this.checkCrossRef('price', 'price.orphan_price_list', '价目表明细价目表外键完整性（→price_list）', 'priceList', 'fail'),
    ]);

    const summary = this.summarize(results);
    const overall: CheckStatus = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';
    const sourceHashes: Partial<Record<ConsistencyDomain, string>> = {};
    for (const r of results) {
      if (r.sourceHash && r.sourceHash !== '0') sourceHashes[r.domain] = r.sourceHash;
    }
    const finishedAt = new Date().toISOString();

    const report: ConsistencyReport = {
      runId,
      startedAt,
      finishedAt,
      overall,
      sourceHashes,
      results,
      summary,
    };

    try {
      await this.persist(runId, startedAt, results);
    } catch (e: any) {
      this.logger.error(`一致性校验结果落库失败: ${e?.message}`, e?.stack);
    }
    this.logger.log(
      `一致性校验完成 run=${runId} overall=${overall} pass=${summary.pass} warn=${summary.warn} fail=${summary.fail}`,
    );
    return report;
  }

  /** 最近一次运行报告（无数据返回 null） */
  async latest(): Promise<ConsistencyReport | null> {
    const rows = (await this.db.execute(sql.raw(`
      SELECT * FROM consistency_check_log
      WHERE run_id = (SELECT run_id FROM consistency_check_log ORDER BY _run_at DESC LIMIT 1)
      ORDER BY domain, check_key
    `))) as any[];
    if (!rows.length) return null;
    return this.rowsToReport(rows);
  }

  /** 历史运行摘要 */
  async history(limit = 20): Promise<ConsistencyRunSummary[]> {
    const rows = (await this.db.execute(sql.raw(`
      SELECT run_id,
             max(_run_at)::text AS run_at,
             count(*)::int AS checks,
             COALESCE(sum((status='fail')::int),0)::int AS fails,
             COALESCE(sum((status='warn')::int),0)::int AS warns,
             COALESCE(sum(mismatch_count),0)::int AS mismatches
      FROM consistency_check_log
      GROUP BY run_id
      ORDER BY max(_run_at) DESC
      LIMIT ${Math.max(1, Math.min(100, limit))}
    `))) as any[];
    return rows.map((r) => ({
      runId: r.run_id,
      runAt: r.run_at,
      overall: (r.fails > 0 ? 'fail' : r.warns > 0 ? 'warn' : 'pass') as CheckStatus,
      checks: Number(r.checks),
      fails: Number(r.fails),
      warns: Number(r.warns),
      mismatches: Number(r.mismatches),
    }));
  }

  // ---------------------------------------------------------------------------
  // 单个校验实现
  // ---------------------------------------------------------------------------

  /** 跨系统引用完整性：消费侧键集合 vs 源主数据，统计游离键 + 双方指纹。 */
  private async checkCrossRef(
    domain: ConsistencyDomain,
    check: string,
    label: string,
    consumerKey: 'product' | 'member' | 'priceSku' | 'priceList',
    severity: 'fail' | 'warn',
  ): Promise<ConsistencyCheckResult> {
    const src = (await this.db.execute(sql.raw(this.sourceSql[domain]))) as any[];
    const sourceCount = Number(src[0]?.c ?? 0);
    const sourceHash = String(src[0]?.h ?? '0');

    const consumer = this.consumerSubquery[consumerKey];
    const notExists = this.notExists[consumerKey];
    // 消费侧键集合 consumer；其中命中不到源主数据的部分为 orphan（游离键）。
    const orphanCte = `WITH consumer AS (${consumer}), orphan AS (SELECT sid FROM consumer WHERE NOT EXISTS (SELECT 1 FROM ${notExists}))`;

    const countSamples = (await this.db.execute(sql.raw(`
      ${orphanCte}
      SELECT
        (SELECT count(*)::int FROM orphan) AS c,
        COALESCE((SELECT array_agg(sid ORDER BY sid) FROM (SELECT sid FROM orphan LIMIT 20) d), array[]::text[]) AS samples
    `))) as any[];
    const mismatchCount = Number(countSamples[0]?.c ?? 0);
    const samples = this.asStringArray(countSamples[0]?.samples);

    const consumerHashRows = (await this.db.execute(sql.raw(`
      SELECT COALESCE(md5(string_agg(sid,'|' ORDER BY sid)),'0') AS h
      FROM (${consumer}) t
    `))) as any[];
    const consumerHash = String(consumerHashRows[0]?.h ?? '0');
    const dependentCount = await this.consumerDistinctCount(consumer);

    const status: CheckStatus = mismatchCount > 0 ? severity : 'pass';
    const detail =
      mismatchCount > 0
        ? `${label}：发现 ${mismatchCount} 个指向不存在主数据的游离键`
        : `${label}：消费侧键全部命中源主数据（${consumerHash === '0' ? '无引用' : '一致'}）`;

    return {
      domain,
      check,
      label,
      status,
      sourceCount,
      dependentCount,
      mismatchCount,
      samples: samples.slice(0, 20),
      sourceHash,
      consumerHash,
      detail,
    };
  }

  /** 会员手机号重复（数据质量，warn） */
  private async checkDuplicatePhone(): Promise<ConsistencyCheckResult> {
    const src = (await this.db.execute(sql.raw(this.sourceSql.member))) as any[];
    const sourceCount = Number(src[0]?.c ?? 0);
    const sourceHash = String(src[0]?.h ?? '0');

    const dup = (await this.db.execute(sql.raw(`
      WITH d AS (
        SELECT id, phone FROM member
        WHERE phone IS NOT NULL AND phone <> ''
          AND EXISTS (SELECT 1 FROM member m2 WHERE m2.phone = member.phone AND m2.id <> member.id)
      )
      SELECT
        (SELECT count(*)::int FROM d) AS c,
        COALESCE((SELECT array_agg(phone ORDER BY phone) FROM (SELECT DISTINCT phone FROM d LIMIT 20) p), array[]::text[]) AS samples
    `))) as any[];
    const mismatchCount = Number(dup[0]?.c ?? 0);
    const samples = this.asStringArray(dup[0]?.samples);

    const status: CheckStatus = mismatchCount > 0 ? 'warn' : 'pass';
    const detail =
      mismatchCount > 0
        ? `会员手机号重复（数据质量）：${mismatchCount} 条会员记录手机号与他人重复`
        : '会员手机号无重复';

    return {
      domain: 'member',
      check: 'member.duplicate_phone',
      label: '会员手机号重复（数据质量）',
      status,
      sourceCount,
      dependentCount: 0,
      mismatchCount,
      samples: samples.slice(0, 20),
      sourceHash,
      consumerHash: '',
      detail,
    };
  }

  // ---------------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------------

  private async consumerDistinctCount(orphan: string): Promise<number> {
    const r = (await this.db.execute(sql.raw(`SELECT count(*)::int AS c FROM (${orphan}) t`))) as any[];
    return Number(r[0]?.c ?? 0);
  }

  private asStringArray(v: unknown): string[] {
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === 'string' && v.length) {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? p.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private summarize(results: ConsistencyCheckResult[]): ConsistencyReportSummary {
    const s: ConsistencyReportSummary = { pass: 0, warn: 0, fail: 0, mismatches: 0 };
    for (const r of results) {
      if (r.status === 'pass') s.pass++;
      else if (r.status === 'warn') s.warn++;
      else s.fail++;
      s.mismatches += r.mismatchCount;
    }
    return s;
  }

  private async persist(runId: string, runAt: string, results: ConsistencyCheckResult[]): Promise<void> {
    for (const r of results) {
      await this.db.execute(sql`
        INSERT INTO consistency_check_log
          (run_id, _run_at, domain, check_key, label, status, source_count, dependent_count, mismatch_count, samples, source_hash, consumer_hash, detail)
        VALUES
          (${runId}, ${runAt}::timestamptz, ${r.domain}, ${r.check}, ${r.label}, ${r.status},
           ${r.sourceCount}, ${r.dependentCount}, ${r.mismatchCount},
           ${JSON.stringify(r.samples)}::jsonb, ${r.sourceHash}, ${r.consumerHash}, ${r.detail})
      `);
    }
  }

  private rowsToReport(rows: any[]): ConsistencyReport {
    const results: ConsistencyCheckResult[] = rows.map((r) => ({
      domain: r.domain,
      check: r.check_key,
      label: r.label,
      status: r.status,
      sourceCount: Number(r.source_count),
      dependentCount: Number(r.dependent_count),
      mismatchCount: Number(r.mismatch_count),
      samples: this.asStringArray(r.samples),
      sourceHash: r.source_hash ?? '0',
      consumerHash: r.consumer_hash ?? '',
      detail: r.detail ?? '',
    }));
    const summary = this.summarize(results);
    const overall: CheckStatus = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';
    const sourceHashes: Partial<Record<ConsistencyDomain, string>> = {};
    for (const r of results) {
      if (r.sourceHash && r.sourceHash !== '0') sourceHashes[r.domain] = r.sourceHash;
    }
    return {
      runId: rows[0].run_id,
      startedAt: rows[0]._run_at,
      finishedAt: rows[0]._run_at,
      overall,
      sourceHashes,
      results,
      summary,
    };
  }
}
