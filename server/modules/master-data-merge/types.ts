import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase, PostgresJsTransaction } from 'drizzle-orm/postgres-js';

/** 可合并的主数据实体类型（3b/3c 落地 style；store / customer 已移除） */
export type MergeEntityType = 'style';

/** 查重分组依据（归一名称 / 归一电话） */
export type MergeCandidateKeyType = 'name' | 'phone';

/**
 * 查重候选配置：SQL 侧归一表达式（与 service 内 JS 侧归一函数必须严格同构，
 * 否则会出现「SQL 判为重复、JS 分不到同组」的静默漏组）。
 */
export interface MergeCandidateConfig {
  /** 归一名称表达式：去空白 + 转小写 */
  nameExpr: SQL<string>;
  /** 归一电话表达式：仅保留数字，长度 < 7 视为无效（避免短号/区号误并） */
  phoneExpr?: SQL<string>;
}

/**
 * 单个依赖改指配置：某张从属于主数据的业务表，合并时需把指向被合并方的行改指到 survivor。
 * - table   : drizzle 表对象（如 sku）
 * - idKey   : 指向主实体的 id 列属性名（如 'styleId' / 'dealerId'）
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
  /** 查重候选配置（不配置 ⇒ 该实体暂不支持候选发现接口） */
  candidate?: MergeCandidateConfig;
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

/** 候选组内单条主数据（relatedCount 用于帮运营判断谁是 survivor） */
export interface MergeCandidateMember {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  /** 关联业务单据数（依赖表行数合计）；运营据此判断保留哪条 */
  relatedCount: number;
  /** 组内推荐 survivor（关联单据最多；并列取编码较小者） */
  suggested: boolean;
}

/** 一个疑似重复组（同归一名称 或 同归一电话，且成员数 >= 2） */
export interface MergeCandidateGroup {
  keyType: MergeCandidateKeyType;
  /** 归一后的分组键（展示用；电话键已截断，不泄露完整号码） */
  key: string;
  memberCount: number;
  members: MergeCandidateMember[];
}

/**
 * 合并审计日志行（master_data_merge_log）。供「合并审计」页展示与整批回滚。
 * - 一行 = 一个被合并方的一次合并（同一次合并的多个被合并方共享 runId，可整批回滚）。
 * - reversedAt 非空 ⇒ 已回滚（解标，依赖保持归属 survivor）。
 */
export interface MergeLog {
  id: string;
  entityType: MergeEntityType;
  runId: string;
  survivorId: string;
  /** 保留方展示名（style=styleNo / customer=name），便于运营辨识 */
  survivorName: string | null;
  mergedId: string;
  /** 被合并方业务编码（style=styleNo / customer=code） */
  mergedCode: string | null;
  /** 被合并方展示名（style=styleNo / customer=name） */
  mergedName: string | null;
  reason: string | null;
  operator: string | null;
  /** 回滚时间（ISO 字符串），null = 有效 */
  reversedAt: string | null;
  createdAt: string;
}

/** listLogs 过滤项 */
export interface ListMergeLogsOptions {
  /** true=仅已回滚 / false=仅有效 / undefined=全部 */
  reversed?: boolean;
  limit?: number;
}
