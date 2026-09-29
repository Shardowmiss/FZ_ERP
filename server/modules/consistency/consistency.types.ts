/**
 * 主数据一致性校验 —— 类型定义
 *
 * 背景（评估 P2-3）：ERP 与 POS 共享同一 PostgreSQL 库，主数据（商品 sku /
 * 会员 member / 价格 price_list_item）由 ERP 持有，POS 通过 RealErpAdapter
 * 直读 ERP 表、并通过下行通道消费。这种“强 schema 耦合”意味着任何一侧的
 * 游离引用或主数据静默变更都会造成跨系统不一致。
 *
 * 本模块以“哈希对账”为核心：对每个主数据域，分别计算
 *   - sourceHash ：源（ERP 主表）指纹
 *   - consumerHash：消费侧（被交易/下游表实际引用的键集合）指纹
 * 并对每一侧做引用完整性（是否有指向不存在主数据的游离键）校验。
 * 结果落库 `consistency_check_log`，支持 latest / history 审计。
 */
export type ConsistencyDomain = 'product' | 'member' | 'price';
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ConsistencyCheckResult {
  domain: ConsistencyDomain;
  check: string;
  label: string;
  status: CheckStatus;
  /** 主数据总行数（源侧规模） */
  sourceCount: number;
  /** 消费侧被引用的去重键数 */
  dependentCount: number;
  /** 不一致条数（游离引用 / 重复数等） */
  mismatchCount: number;
  /** 不一致样本（最多 20 个键） */
  samples: string[];
  /** 源侧指纹 */
  sourceHash: string;
  /** 消费侧指纹 */
  consumerHash: string;
  detail: string;
}

export interface ConsistencyReportSummary {
  pass: number;
  warn: number;
  fail: number;
  mismatches: number;
}

export interface ConsistencyReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  overall: CheckStatus;
  sourceHashes: Partial<Record<ConsistencyDomain, string>>;
  results: ConsistencyCheckResult[];
  summary: ConsistencyReportSummary;
}

/** 单次运行的历史摘要（history 接口返回） */
export interface ConsistencyRunSummary {
  runId: string;
  runAt: string;
  overall: CheckStatus;
  checks: number;
  fails: number;
  warns: number;
  mismatches: number;
}
