/**
 * 查询性能审计（P1-c⑤ 查询审计）。
 *
 * 与 `audit.interceptor` / `audit.decorator`（业务操作审计：谁改了哪张单据）**不是一回事**。
 * 这里是**性能审计**：在"允许审计"的运行模式下，对给定 drizzle 查询跑一次
 * `EXPLAIN (FORMAT JSON)`，递归扫描执行计划，捕获：
 *   · Seq Scan（全表顺序扫描）—— 通常是缺索引 / 缺时间窗导致；
 *   · 计划 Total Cost 超过阈值。
 * 命中即结构化 WARN 落日志（含关系名、cost、估算行数），便于在报表/分析类接口上线前发现
 * 无界扫描，与「强制时间窗」(report-window) 形成双层防护。
 *
 * 实现要点（拒绝假绿 / 零风险默认）：
 *   · 仅当 `process.env.QUERY_AUDIT === '1'` 才真正执行 EXPLAIN；否则本函数直接返回，
 *     对正常请求路径**零开销、零副作用**（不动 SQL、不抛错、不拖慢）。
 *   · EXPLAIN 只生成计划、不执行数据，因此把参数按类型安全内联为 SQL 字面量后单参数
 *     `db.execute(sql.raw(...))` 即可，完全兼容本项目 `db.execute(sql\`...\`)` 既有签名
 *     （避免依赖 `execute` 第二参数，保证可编译、可移植）。
 *   · 整段包在 try/catch 内；任何异常（含 EXPLAIN 失败、类型漂移）只记 debug，绝不上抛到业务请求。
 *   · 默认 `SEQ_SCAN_COST_THRESHOLD = 100000`（即 10 万 cost，约等于对百万行级表的全扫量级）。
 *
 * 注意：EXPLAIN 依赖真实数据库连接，且需要 `QUERY_AUDIT=1` 才触发。本模块在 erp_db 离线时
 * 仅能做类型检查/编译验证，运行时行为需在数据库在线环境手动开启开关复核。
 */

import { Logger } from '@nestjs/common';
import { type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';

/** 是否启用查询审计（默认关闭，零开销）。 */
const QUERY_AUDIT_ENABLED = process.env.QUERY_AUDIT === '1';

/** Seq Scan 计划的 cost 告警阈值（超过即视为需要关注的全扫量级）。 */
const SEQ_SCAN_COST_THRESHOLD = Number.parseInt(
  process.env.SEQ_SCAN_COST_THRESHOLD ?? '100000',
  10,
) || 100000;

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  Plans?: PlanNode[];
}

interface ExplainRow {
  'QUERY PLAN'?: PlanNode[];
}

/** 将参数按类型安全格式化为 SQL 字面量（用于 EXPLAIN 内联，不执行数据）。 */
function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
  // 字符串：转义单引号并包引号
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** 把 `$1..$n` 占位符替换为安全内联的字面量（兼容多位数、避开 `$$` 美元引用）。 */
function inlineParams(rawSql: string, params: unknown[]): string {
  return rawSql.replace(/(?<!\$)\$(\d+)/g, (_m, idx: string) => {
    const i = Number.parseInt(idx, 10) - 1;
    return toSqlLiteral(params[i]);
  });
}

/**
 * 对一条 drizzle 查询做执行计划审计（opt-in，默认 no-op）。
 *
 * @param db    注入的 DRIZZLE_DATABASE（postgres-js 驱动）
 * @param query 已构建的 drizzle 查询对象（需支持 `.toSQL()`，且在 EXPLAIN 之外仍可被正常执行）
 * @param label 业务标签（如 'purchase-report'），用于日志定位
 * @param logger 模块 Logger
 */
export async function auditQueryPlan(
  db: PostgresJsDatabase,
  query: { toSQL: () => { sql: string; params: unknown[] } },
  label: string,
  logger?: Logger,
): Promise<void> {
  if (!QUERY_AUDIT_ENABLED) return;
  const log = logger ?? new Logger(`QueryAudit:${label}`);
  try {
    const compiled = query.toSQL();
    if (!compiled?.sql) return;

    const explainSql = sql.raw(
      `EXPLAIN (FORMAT JSON) ${inlineParams(compiled.sql, compiled.params ?? [])}`,
    );
    const rows = (await db.execute(explainSql)) as unknown as ExplainRow[] | undefined;
    const plan = rows?.[0]?.['QUERY PLAN']?.[0];
    if (!plan) return;

    const hits: string[] = [];
    walkPlan(plan, hits);
    if (hits.length > 0) {
      log.warn(`[query-audit] 标签=${label} 执行计划命中关注项：\n${hits.join('\n')}`);
    }
  } catch (e) {
    log.debug?.(`[query-audit] 标签=${label} 审计跳过（EXPLAIN 不可用或非致命错误）：${String(e)}`);
  }
}

/** 递归遍历计划树，收集 Seq Scan / 超阈值 cost。 */
function walkPlan(node: PlanNode, hits: string[]): void {
  if (!node) return;
  const cost = node['Total Cost'] ?? 0;
  const rel = node['Relation Name'] ?? '?';
  if (node['Node Type'] === 'Seq Scan') {
    hits.push(`  · Seq Scan on ${rel} (cost=${cost}, estRows=${node['Plan Rows'] ?? '?'})`);
  }
  if (cost > SEQ_SCAN_COST_THRESHOLD) {
    hits.push(`  · 高 Cost 节点 ${node['Node Type'] ?? '?'} on ${rel} (cost=${cost})`);
  }
  node.Plans?.forEach((child) => walkPlan(child, hits));
}
