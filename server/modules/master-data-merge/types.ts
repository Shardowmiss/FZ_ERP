import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';

/** 可合并的主数据实体类型（3b/3c 落地 style / customer；store 留待后续谨慎评估） */
export type MergeEntityType = 'style' | 'customer';

/**
 * 单个依赖改指配置：某张从属于主数据的业务表，合并时需把指向被合并方的行改指到 survivor。
 * - table   : drizzle 表对象（如 sku）
 * - idKey   : 指向主实体的 id 列属性名（如 'styleId' / 'customerId'）
 * - codeKey : 与主实体同义的展示列属性名（如 'styleNo' / 'customerName'），可选
 */
export interface MergeDepConfig {
  table: any; // PgTable
  idKey: string;
  codeKey?: string;
}

/**
 * 某个主数据实体的合并配置（配置驱动，新增实体只需在此登记 + 迁移加打标列）。
 */
export interface MergeEntityConfig {
  type: MergeEntityType;
  table: any; // PgTable
  /** 业务唯一键属性名（用于日志），如 'styleNo' / 'code' */
  codeKey: string;
  /** 写入到 dependent 展示列的取值属性名（如 'styleNo' / 'name'） */
  displayKey: string;
  /** 被合并方打标列属性名（'mergedInto'） */
  mergedIntoKey: string;
  /** 合并时间列属性名（'mergedAt'） */
  mergedAtKey: string;
  /** 需要改指的依赖表清单 */
  deps: MergeDepConfig[];
  /**
   * 实体特定预校验（合并执行前、事务内调用）。
   * 例如 style：sku 有唯一键 (style_id,color_id,size_id)，改指前校验被合并款的 sku
   * 是否与 survivor 撞色尺码，避免违反唯一约束导致整批回滚。可选。
   */
  preMergeValidation?: (
    tx: PostgresJsTransaction<any, any> | PostgresJsDatabase,
    survivorId: string,
    mergedId: string,
  ) => Promise<void>;
}

export interface MergeRequest {
  entityType: MergeEntityType;
  survivorId: string;
  mergedIds: string[];
  reason?: string;
  /** 操作人（由控制器从登录态注入） */
  operator?: string;
}

export interface MergeResult {
  entityType: MergeEntityType;
  runId: string;
  survivorId: string;
  mergedCount: number;
  logs: { mergedId: string; logId: string }[];
}
