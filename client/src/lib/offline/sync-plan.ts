/**
 * 主数据同步计划（纯函数，无平台依赖）
 *
 * P-1：把「客户端永远全量拉取」改成「首屏全量 + 后续按 since 增量」。
 *
 * 背景与问题
 * ----------
 * 服务端 `OfflineSyncService.getMasterData(storeId, since)` 早已实现增量过滤
 * （条件为 `updatedAt > since`），但客户端 `fetchFromServer` 从不传 `since`，
 * 于是每次联网刷新都把 styles/skus/members/stock 全表重拉一遍：
 *   - 门店维度 SKU×颜色×尺码的库存可达 10 万级，首屏 JSON 数 MB；
 *   - 收银员每隔几十秒触发一次 refresh 就有一次全量，弱网/SIM 卡上直接卡死；
 *   - 服务端增量能力成为死代码，没有任何收益。
 *
 * 为什么游标用服务端的 snapshotAt 而不是客户端 Date.now()
 * ------------------------------------------------------
 * 收银机（尤其是安卓 low-end）系统时钟常见漂移：客户端时钟快 => since 落在未来
 * => `updatedAt > since` 恒不成立 => 该时间窗内的主数据变更被永久漏掉，且没有
 * 任何报错。用服务端返回的 `snapshotAt` 做游标，时间线以服务端为准，天然免疫
 * 客户端时钟问题。
 *
 * 为什么还要回退 1 秒（CURSOR_BACKTRACK_MS）
 * ----------------------------------------
 * 服务端过滤用的是严格大于 `sinceDate`。若游标直接等于 snapshotAt，理论上存在
 * 「恰好在快照时刻提交的记录」被边界切掉的风险。宁可多拉（本地按 id 合并是幂
 * 等的），不可漏拉。故游标 = snapshotAt - 1s。
 *
 * 增量策略
 * --------
 * 增量响应只包含「updatedAt > since」的行，因此：
 *   ✅ 更新/新增：按 id 覆盖，幂等；
 *   ✅ 删除/失效：服务端改用「宽口径水位扫描 + 内存分区」，把「只置了 deletedAt
 *      或流转了 status」的行也一并放进回包的 `deleted` 字段（见 collectDeletions）。
 *   ⚠️ 若某次响应漏带删除通知，本地会残留一行 —— 但不会整类清空。
 *
 * 本文件不依赖 React / IndexedDB / axios，便于单元测试。
 */

import type { LocalStockRecord } from './db';
import type { MasterDataState, PromotionLite } from './master-data-cache';

// ============ 常量 ============

/** master_data store 内用于存放同步游标的记录 key（不参与业务主数据读取） */
export const SYNC_META_TYPE = '__sync_meta__';

/**
 * 游标回退量：多拉最近 1 秒内的数据，规避服务端「严格大于」的边界风险。
 * 代价是幂等重放，收益是零漏拉。
 */
export const CURSOR_BACKTRACK_MS = 1000;

/**
 * 增量间隔上限：距上次同步超过 7 天强制回退全量。
 * 时钟漂移、设备长期离线、手工改库都可能导致 since 窗口内的记录不可预期，
 * 此时全量重拉反而是更安全的选择。
 */
export const MAX_INCREMENTAL_GAP_MS = 7 * 24 * 60 * 60 * 1000;

// ============ 类型 ============

/** 同步游标：决定下一次请求带什么 since、以及是否需要退回全量 */
export interface MasterDataCursor {
  /** 下一次拉取要带的服务端时间游标（ISO 字符串） */
  since: string;
  /** 上一次成功落库的服务端快照时间（ISO 字符串） */
  snapshotAt: string;
  /** 上一次的拉取模式 */
  mode: 'full' | 'incremental';
  /** 游标写入时间（客户端毫秒），用于判断增量间隔是否超上限 */
  recordedAt: number;
}

/** 服务端快照的宽松形态 */
export interface MasterDataSnapshotLike {
  version?: string;
  snapshotAt?: string;
  colors?: unknown[];
  sizes?: unknown[];
  styles?: unknown[];
  skus?: unknown[];
  promotions?: unknown[];
  members?: unknown[];
  stock?: unknown[];
  store?: unknown;
  /** P-1 补：删除通知（墓碑）。全量快照不带。 */
  deleted?: {
    colors?: unknown;
    sizes?: unknown;
    styles?: unknown;
    skus?: unknown;
    promotions?: unknown;
    members?: unknown;
    stock?: unknown;
  };
}

/** 归一化后的删除通知：只含非空的实体类型 -> id 列表 */
export interface MasterDataDeletions {
  colors?: string[];
  sizes?: string[];
  styles?: string[];
  skus?: string[];
  promotions?: string[];
  members?: string[];
  stock?: string[];
}

/** 从快照中抽取删除通知。空数组 / 缺字段一律视为「本轮无删除」。 */
export const collectDeletions = (snapshot: MasterDataSnapshotLike): MasterDataDeletions => {
  const d = snapshot.deleted;
  if (!d) return {};
  const out: MasterDataDeletions = {};
  const pick = (key: keyof MasterDataDeletions, raw: unknown): void => {
    if (!Array.isArray(raw)) return;
    const ids = raw
      .map((v) => (typeof v === 'string' ? v : String((asRecord(v).id ?? ''))))
      .filter((v) => v.length > 0);
    if (ids.length > 0) out[key] = ids;
  };
  pick('colors', d.colors);
  pick('sizes', d.sizes);
  pick('styles', d.styles);
  pick('skus', d.skus);
  pick('promotions', d.promotions);
  pick('members', d.members);
  pick('stock', d.stock);
  return out;
};

// ============ 纯函数 ============

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/**
 * 把服务端快照（可能是增量、也可能是全量）转换为本地促销引擎使用的结构。
 *
 * 注意 P0-6 的历史包袱：服务端下发的是 Promotion 结构
 * （startDate/endDate/threshold/discountType/discountValue/applyScope），
 * 而本地促销引擎期望 startAt/endAt（毫秒时间戳）+ conditions/benefits。
 * 不做这层转换会导致 `now >= p.startAt` 恒为 false，离线促销永远不生效。
 */
export const normalizePromotion = (p: Record<string, unknown>): PromotionLite => {
  const startAt = p.startDate ? new Date(String(p.startDate)).getTime() : 0;
  const endAt = p.endDate ? new Date(String(p.endDate)).getTime() : 0;

  const conditions: PromotionLite['conditions'] = [];
  const applyScope = p.applyScope as string | undefined;
  const scopeIds = (p.scopeIds as string[] | undefined) ?? [];
  if (applyScope && applyScope !== 'all' && scopeIds.length > 0) {
    conditions.push({
      type: applyScope === 'style' ? 'style' : 'category',
      value: scopeIds,
    });
  } else {
    // 无适用范围门槛，始终满足
    conditions.push({ type: 'amount', value: 0 });
  }
  if (p.type === 'fullReduce' && typeof p.threshold === 'number') {
    conditions.push({ type: 'amount', value: p.threshold });
  }

  const benefits: PromotionLite['benefits'] = [];
  const discountType = p.discountType as string | undefined;
  if (discountType === 'percent' && typeof p.discountValue === 'number') {
    benefits.push({ type: 'discountPercent', value: p.discountValue });
  } else if (discountType === 'amount' && typeof p.discountValue === 'number') {
    benefits.push({ type: 'discountAmount', value: p.discountValue });
  }

  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    type: (p.type as PromotionLite['type']) ?? 'discount',
    priority: typeof p.priority === 'number' ? p.priority : 0,
    startAt,
    endAt,
    conditions,
    benefits,
    status: String(p.status ?? 'active'),
    memberOnly: p.isMemberOnly === true,
  };
};

/** 库存行 -> 本地库存记录（storeId 缺失时用当前门店兜底） */
export const toLocalStockRecord = (raw: unknown, storeId: string): LocalStockRecord => {
  const s = asRecord(raw);
  return {
    skuId: String(s.skuId ?? ''),
    storeId: String(s.storeId ?? storeId),
    styleId: String(s.styleId ?? ''),
    colorId: String(s.colorId ?? ''),
    sizeId: String(s.sizeId ?? ''),
    qty: typeof s.qty === 'number' ? s.qty : 0,
    updatedAt: s.updatedAt ? new Date(String(s.updatedAt)).getTime() : Date.now(),
  };
};

/** 快照里的 stock -> LocalStockRecord[] */
export const toLocalStock = (rows: unknown[], storeId: string): LocalStockRecord[] =>
  (rows ?? []).map((r) => toLocalStockRecord(r, storeId));

/**
 * 判断快照是否可被当作「增量响应」消费。
 * 判定依据：确实带了 since 命中，且服务端回包携带了可信的 snapshotAt。
 * 若回包缺 snapshotAt，说明接口行为变了，宁可当全量处理。
 */
export const isIncrementalSnapshot = (
  snapshot: MasterDataSnapshotLike,
): boolean => {
  const at = snapshot.snapshotAt ? new Date(snapshot.snapshotAt).getTime() : NaN;
  return Number.isFinite(at) && at > 0;
};

/**
 * 由一次成功拉取推导出下一次的游标。
 * @param snapshotAt 服务端快照时间（ISO）。以服务端时间线为准，规避客户端时钟漂移。
 * @param now 当前客户端时间（毫秒），用于计算增量间隔
 */
export const nextCursor = (
  snapshotAt: string,
  now: number,
): MasterDataCursor => {
  const raw = new Date(snapshotAt).getTime();
  const safe = Number.isFinite(raw) ? raw : now;
  return {
    since: new Date(Math.max(0, safe - CURSOR_BACKTRACK_MS)).toISOString(),
    snapshotAt: new Date(safe).toISOString(),
    mode: 'incremental',
    recordedAt: now,
  };
};

/**
 * 游标是否太旧、需要退回全量。
 */
export const shouldRebuildFromFull = (cursor: MasterDataCursor | null, now: number): boolean => {
  if (!cursor || !cursor.recordedAt) return true;
  return now - cursor.recordedAt > MAX_INCREMENTAL_GAP_MS;
};

/**
 * 构造 master-data 请求参数。
 * - 首次同步 / 强制全量：不带 since，走全量；
 * - 增量：带 since。
 */
export const masterDataParams = (
  storeId: string,
  cursor: MasterDataCursor | null,
): { storeId: string; since?: string } => {
  if (!cursor || !cursor.since) return { storeId };
  return { storeId, since: cursor.since };
};

/**
 * 合并快照到当前本地状态。
 *
 * - `mode: 'full'`    → 整体替换（首次同步 / 强制全量兜底）
 * - `mode: 'incremental'` → 按 id 覆盖合并；
 *   空数组不得清空已有数据（否则一次「无变更」的响应会把收银界面清空）；
 *   prev 中存在而本次未下发的条目一律保留；
 *   快照里 `deleted` 非空的实体类型按 id 剔除（删除优先于同轮内的覆盖）。
 */
/** 把服务端回包的行数组按本地实体类型解释（运行时才校验，此处仅做类型收敛） */
const rows = <T>(list: unknown[] | undefined): T[] => (list ?? []) as unknown as T[];

export const mergeSnapshot = (
  prev: MasterDataState,
  snapshot: MasterDataSnapshotLike,
  options: { mode: 'full' | 'incremental'; storeId: string; version?: string; lastUpdated?: number },
): MasterDataState => {
  const styles = rows<MasterDataState['styles'][number]>(snapshot.styles);
  const skus = rows<MasterDataState['skus'][number]>(snapshot.skus);
  const members = rows<MasterDataState['members'][number]>(snapshot.members);
  const colors = rows<MasterDataState['colors'][number]>(snapshot.colors);
  const sizes = rows<MasterDataState['sizes'][number]>(snapshot.sizes);
  const promos = snapshot.promotions ?? [];
  const stock = toLocalStock(snapshot.stock ?? [], options.storeId);
  const store = (snapshot.store ?? null) as unknown as MasterDataState['store'];

  if (options.mode === 'full') {
    return {
      styles,
      skus,
      members,
      colors,
      sizes,
      promotions: promos.map((p) => normalizePromotion(asRecord(p))),
      store,
      stock,
      version: snapshot.version ?? options.version ?? '',
      lastUpdated: options.lastUpdated ?? Date.now(),
    };
  }

  // ---- 增量合并 ----
  const byId = <T extends { id: string }>(list: T[], incoming: T[]): T[] => {
    if (incoming.length === 0) return list;
    const map = new Map<string, T>();
    for (const it of list) map.set(it.id, it);
    for (const it of incoming) map.set(it.id, it);
    return Array.from(map.values());
  };

  const mergedStyles = byId(prev.styles, styles);
  const mergedSkus = byId(prev.skus, skus);
  const mergedMembers = byId(prev.members, members);
  const mergedColors = byId(prev.colors, colors);
  const mergedSizes = byId(prev.sizes, sizes);
  const mergedPromos = byId(
    prev.promotions,
    promos.map((p) => normalizePromotion(asRecord(p))),
  );

  // 库存按 skuId 去重覆盖（一个 SKU 一行），空增量不得清空本地扣减结果
  const stockMap = new Map<string, LocalStockRecord>();
  for (const rec of prev.stock) stockMap.set(rec.skuId, rec);
  for (const rec of stock) stockMap.set(rec.skuId, rec);
  // 无新增/变更时直接沿用上一个数组引用，避免每次空同步都重建百万级数组
  const mergedStock = stock.length === 0 ? prev.stock : Array.from(stockMap.values());

  // 应用删除通知：只对「本轮确有删除」的类型生效，空数组/缺字段不清空本地。
  // 注意顺序：先按 id 覆盖合并（新增/更新），再剔除失效 id，保证「同一轮里
  // 既更新又被删」时以删除为准（业务上失效优先于内容）。
  const del = collectDeletions(snapshot);
  const omitIds = <T extends { id: string }>(list: T[], ids?: string[]): T[] =>
    !ids || ids.length === 0 ? list : list.filter((it) => !ids.includes(it.id));
  const omitSkuIds = (list: LocalStockRecord[], ids?: string[]): LocalStockRecord[] =>
    !ids || ids.length === 0 ? list : list.filter((it) => !ids.includes(it.skuId));

  return {
    styles: omitIds(mergedStyles, del.styles),
    skus: omitIds(mergedSkus, del.skus),
    members: omitIds(mergedMembers, del.members),
    colors: omitIds(mergedColors, del.colors),
    sizes: omitIds(mergedSizes, del.sizes),
    promotions: omitIds(mergedPromos, del.promotions),
    store: store ?? prev.store,
    stock: omitSkuIds(mergedStock, del.stock),
    version: snapshot.version ?? prev.version,
    lastUpdated: options.lastUpdated ?? Date.now(),
  };
};
