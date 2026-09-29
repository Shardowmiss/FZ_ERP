/**
 * 主数据缓存管理
 *
 * 在线时从后端拉取主数据并写入 IndexedDB
 * 离线时从 IndexedDB 读取
 * 提供本地检索能力：商品、会员、库存、促销
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

import {
  getMasterData,
  putMasterData,
  getLocalStock,
  putLocalStockBatch,
  getLocalStockByStoreId,
  getSyncCursor,
  putSyncCursor,
  deleteMasterData,
  deleteLocalStock,
  type MasterDataRecord,
  type LocalStockRecord,
} from './db';
import {
  collectDeletions,
  isIncrementalSnapshot,
  masterDataParams,
  mergeSnapshot,
  nextCursor,
  normalizePromotion,
  shouldRebuildFromFull,
  toLocalStock,
  type MasterDataDeletions,
  type MasterDataSnapshotLike,
} from './sync-plan';

// 服务端回包的真实结构与 shared/api.interface.ts 的声明存在偏差
// （例如 promotions 实际下发的是 Promotion 结构），这里按运行时形态消费。
type SnapshotLike = MasterDataSnapshotLike;

// ============ 类型定义 ============

export interface MasterDataTypes {
  styles: StyleLite[];
  skus: SkuLite[];
  members: MemberLite[];
  stock: LocalStockRecord[];
  colors: ColorLite[];
  sizes: SizeLite[];
  promotions: PromotionLite[];
  store: StoreLite | null;
}

export interface StyleLite {
  id: string;
  name: string;
  category: string;
  tagPrice: number;
  status: string;
  colorIds: string[];
  sizeIds: string[];
}

export interface SkuLite {
  id: string;
  styleId: string;
  colorId: string;
  sizeId: string;
  barcode?: string;
  styleName?: string;
  colorName?: string;
  sizeName?: string;
  tagPrice?: number;
}

export interface MemberLite {
  id: string;
  name: string;
  phone: string;
  memberNo: string;
  level: string;
  points: number;
}

export interface ColorLite {
  id: string;
  name: string;
  hex: string;
}

export interface SizeLite {
  id: string;
  name?: string;
  sortOrder: number;
}

export interface PromotionLite {
  id: string;
  name: string;
  type: 'discount' | 'fullReduce' | 'gift' | 'coupon';
  priority: number;
  startAt: number;
  endAt: number;
  conditions: PromotionCondition[];
  benefits: PromotionBenefit[];
  status: string;
  /** 仅会员可用（来自服务端 isMemberOnly） */
  memberOnly?: boolean;
}

export interface PromotionCondition {
  type: 'amount' | 'qty' | 'style' | 'category';
  value: number | string[];
}

export interface PromotionBenefit {
  type: 'discountPercent' | 'discountAmount' | 'gift' | 'points';
  value: number | string;
}

export interface StoreLite {
  id: string;
  name: string;
  storeNo: string;
  address?: string;
  phone?: string;
}

export interface MasterDataState {
  styles: StyleLite[];
  skus: SkuLite[];
  members: MemberLite[];
  colors: ColorLite[];
  sizes: SizeLite[];
  promotions: PromotionLite[];
  store: StoreLite | null;
  stock: LocalStockRecord[];
  version: string;
  lastUpdated: number;
}

export interface UseMasterDataResult {
  data: MasterDataState;
  isLoading: boolean;
  error: string | null;
  /** 刷新主数据；force=true 时忽略本地游标强制全量（默认走 since 增量） */
  refresh: (force?: boolean) => Promise<void>;
  searchStyles: (keyword: string) => StyleLite[];
  searchSkus: (keyword: string) => SkuLite[];
  searchMembers: (keyword: string) => MemberLite[];
  getStockMatrix: (styleId: string) => StockMatrixResult | null;
  /** ctx.isMember 用于判断会员专属促销是否可以参与 */
  calculatePromotions: (
    items: CartItem[],
    ctx?: { isMember?: boolean },
  ) => PromotionCalcResult;
  /** 同步扣减内存中的库存（离线下单后调用，配合 IndexedDB 扣减使用） */
  deductStockItems: (items: Array<{ skuId: string; qty: number }>) => void;
}

export interface StockMatrixResult {
  styleId: string;
  styleName: string;
  colors: ColorLite[];
  sizes: SizeLite[];
  matrix: Record<string, Record<string, number>>; // colorId -> sizeId -> qty
  totalQty: number;
}

export interface CartItem {
  skuId: string;
  styleId: string;
  qty: number;
  unitPrice: number;
}

export interface PromotionCalcResult {
  totalDiscount: number;
  applicablePromotions: Array<{
    promotionId: string;
    promotionName: string;
    discountAmount: number;
  }>;
}

// ============ 常量 ============

const MASTER_DATA_ENDPOINT = '/api/offline-sync/master-data';
const MASTER_DATA_TYPES = [
  'styles',
  'skus',
  'members',
  'colors',
  'sizes',
  'promotions',
  'store',
  'stock',
] as const;

const DEFAULT_STATE: MasterDataState = {
  styles: [],
  skus: [],
  members: [],
  colors: [],
  sizes: [],
  promotions: [],
  store: null,
  stock: [],
  version: '',
  lastUpdated: 0,
};

// ============ 工具函数 ============

/**
 * 消费删除通知：主数据按 id 从 master_data 记录里剔除，库存按 skuId 从 local_stock 删除。
 *
 * 调用方已保证 `deletions` 只含非空条目（collectDeletions 的行为），
 * 这里仍做一次空值兜底——万一上层传了空数组也不会误删本地数据。
 */
const MASTER_DATA_DELETION_TYPES = [
  'colors',
  'sizes',
  'styles',
  'skus',
  'promotions',
  'members',
] as const;

export const applyMasterDataDeletions = async (
  deletions: MasterDataDeletions,
): Promise<void> => {
  const jobs: Promise<void>[] = [];
  for (const type of MASTER_DATA_DELETION_TYPES) {
    const ids = deletions[type];
    if (ids && ids.length > 0) jobs.push(deleteMasterData(type, ids));
  }
  const stockIds = deletions.stock;
  if (stockIds && stockIds.length > 0) jobs.push(deleteLocalStock(stockIds));
  if (jobs.length > 0) await Promise.all(jobs);
};

/**
 * 检查字符串是否包含关键词（不区分大小写）
 */
const matchesKeyword = (text: string, keyword: string): boolean => {
  if (!keyword) return true;
  return text.toLowerCase().includes(keyword.toLowerCase());
};

// ============ Hook ============

/**
 * 主数据缓存 Hook
 *
 * - 在线时从后端拉取，写入 IndexedDB
 * - 离线时从 IndexedDB 读取
 * - 提供本地检索能力
 */
export const useMasterData = (
  storeId: string,
  isOnline: boolean,
): UseMasterDataResult => {
  const [data, setData] = useState<MasterDataState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const dataRef = useRef<MasterDataState>(data);
  dataRef.current = data;

  // 构建索引以加速搜索
  const skuIndexRef = useRef<Map<string, SkuLite>>(new Map());
  const styleIndexRef = useRef<Map<string, StyleLite>>(new Map());
  const memberIndexRef = useRef<{
    byPhone: Map<string, MemberLite>;
    byMemberNo: Map<string, MemberLite>;
  }>({ byPhone: new Map(), byMemberNo: new Map() });
  const stockByStyleRef = useRef<Map<string, LocalStockRecord[]>>(new Map());

  // 刷新索引
  const rebuildIndexes = useCallback((state: MasterDataState): void => {
    // SKU 索引
    const skuMap = new Map<string, SkuLite>();
    for (const sku of state.skus) {
      skuMap.set(sku.id, sku);
    }
    skuIndexRef.current = skuMap;

    // 款式索引
    const styleMap = new Map<string, StyleLite>();
    for (const style of state.styles) {
      styleMap.set(style.id, style);
    }
    styleIndexRef.current = styleMap;

    // 会员索引
    const byPhone = new Map<string, MemberLite>();
    const byMemberNo = new Map<string, MemberLite>();
    for (const member of state.members) {
      if (member.phone) byPhone.set(member.phone, member);
      if (member.memberNo) byMemberNo.set(member.memberNo, member);
    }
    memberIndexRef.current = { byPhone, byMemberNo };

    // 库存索引（按 styleId 分组）
    const stockByStyle = new Map<string, LocalStockRecord[]>();
    for (const rec of state.stock) {
      const arr = stockByStyle.get(rec.styleId);
      if (arr) {
        arr.push(rec);
      } else {
        stockByStyle.set(rec.styleId, [rec]);
      }
    }
    stockByStyleRef.current = stockByStyle;
  }, []);

  /**
   * 从 IndexedDB 加载本地主数据
   */
  const loadFromLocal = useCallback(async (): Promise<MasterDataState> => {
    const state: MasterDataState = { ...DEFAULT_STATE };
    let latestSyncedAt = 0;
    let latestVersion = '';

    for (const type of MASTER_DATA_TYPES) {
      try {
        if (type === 'stock') {
          // 库存数据单独存储在 local_stock store
          const stockRecords: LocalStockRecord[] = await getLocalStockByStoreId(storeId);
          state.stock = stockRecords;
          if (stockRecords.length > 0) {
            const latestUpdated = Math.max(
              ...stockRecords.map((r: LocalStockRecord) => r.updatedAt),
            );
            if (latestUpdated > latestSyncedAt) {
              latestSyncedAt = latestUpdated;
            }
          }
        } else {
          const record: MasterDataRecord | undefined = await getMasterData(type);
          if (record) {
            if (type === 'store') {
              state.store = record.data as StoreLite | null;
            } else {
              (state[type as keyof MasterDataState] as unknown) = record.data;
            }
            if (record.syncedAt > latestSyncedAt) {
              latestSyncedAt = record.syncedAt;
              latestVersion = record.version;
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[MasterData] Failed to load ${type} from local: ${message}`);
      }
    }

    state.lastUpdated = latestSyncedAt;
    state.version = latestVersion;

    return state;
  }, [storeId]);

  /**
   * 从后端拉取最新主数据（P-1：带游标增量）
   *
   * 全量 / 增量的判定：
   * - 本地无游标、或调用方强制、或距上次同步超过 MAX_INCREMENTAL_GAP_MS → 全量；
   * - 否则带 since 拉增量；若响应缺 snapshotAt（接口契约变更/被代理改写），
   *   按全量处理，绝不把「缺字段的响应」当成增量，否则会漏数据。
   *
   * 游标推进时机：所有分片写库成功后才写入游标。拉取失败却推进游标 =
   * 这段时间的变更被永久跳过。
   */
  const fetchFromServer = useCallback(
    async (force = false): Promise<MasterDataState> => {
      const now = Date.now();
      const stored = await getSyncCursor(storeId);
      const rebuild = force || shouldRebuildFromFull(stored, now);
      const cursor = rebuild ? null : stored;

      const response = await axiosForBackend.get(MASTER_DATA_ENDPOINT, {
        params: masterDataParams(storeId, cursor),
        timeout: 30_000,
      });

      const snapshot = response.data as unknown as SnapshotLike;
      const incremental = cursor !== null && isIncrementalSnapshot(snapshot);

      // 增量合并以「当前内存态」为底，全量则用快照整体覆盖
      const state = mergeSnapshot(dataRef.current, snapshot, {
        mode: incremental ? 'incremental' : 'full',
        storeId,
        version: snapshot.version,
        lastUpdated: now,
      });

      // 写入 IndexedDB
      const writePromises: Promise<void>[] = [];
      for (const type of MASTER_DATA_TYPES) {
        const typeData = snapshot[type as keyof SnapshotLike];
        if (type === 'stock') {
          // 库存数据单独写入 local_stock store
          const stockItems = toLocalStock((snapshot.stock ?? []) as unknown[], storeId);
          writePromises.push(putLocalStockBatch(stockItems));
        } else {
          writePromises.push(
            putMasterData(type, typeData, snapshot.version ?? '', storeId),
          );
        }
      }

      await Promise.all(writePromises);

      // P-1 补：把服务端下发的「删除通知」落库。
      // 顺序很关键——先删后推进游标：若删除落库失败，本轮就不推进游标，
      // 下一轮会带着同一个 since 重放该窗口，服务端会再次下发这些删除，从而自愈。
      const deletions = incremental ? collectDeletions(snapshot) : {};
      let deletionsApplied = true;
      if (Object.keys(deletions).length > 0) {
        try {
          await applyMasterDataDeletions(deletions);
        } catch (err) {
          deletionsApplied = false;
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[MasterData] 删除通知落库失败，本轮暂不推进游标: ${message}`);
        }
      }

      if (deletionsApplied && (cursor === null || incremental) && snapshot.snapshotAt) {
        await putSyncCursor(storeId, nextCursor(snapshot.snapshotAt, now));
      }

      logger.info(
        `[MasterData] ${incremental ? 'Incremental' : 'Full'} master data fetched ` +
          `${incremental ? `since=${cursor?.since}` : ''}` +
          `${Object.keys(deletions).length > 0 ? ` deleted=${JSON.stringify(deletions)}` : ''}`,
      );

      return state;
    },
    [storeId],
  );

  /**
   * 刷新主数据
   *
   * @param force true 时忽略本地游标强制全量（后台主管选择「立即全量刷新」的场景）
   *
   * 竞态防护：storeId/isOnline 变化会触发多次 refresh，在线刷新是异步的，
   * 若后发先至会把旧快照写回并覆盖新数据。这里用单调递增序号丢弃过期结果。
   */
  const refreshSeqRef = useRef<number>(0);

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const seq = ++refreshSeqRef.current;
      setIsLoading(true);
      setError(null);

      const applyIfCurrent = (next: MasterDataState): void => {
        if (seq !== refreshSeqRef.current) return;
        setData(next);
        rebuildIndexes(next);
      };

      try {
        if (isOnline) {
          // 在线：先拉后端，失败回退本地
          try {
            const serverData = await fetchFromServer(force);
            applyIfCurrent(serverData);
            logger.info('[MasterData] Refreshed from server');
          } catch (serverErr) {
            const serverMsg =
              serverErr instanceof Error ? serverErr.message : String(serverErr);
            logger.warn(
              `[MasterData] Failed to fetch from server, falling back to local: ${serverMsg}`,
            );
            const localData = await loadFromLocal();
            applyIfCurrent(localData);
            setError(serverMsg);
          }
        } else {
          // 离线：直接读本地（只读分支无竞态，但同样走 applyIfCurrent 保持一致）
          const localData = await loadFromLocal();
          applyIfCurrent(localData);
          logger.info('[MasterData] Loaded from local (offline mode)');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[MasterData] Refresh failed: ${message}`);
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [isOnline, fetchFromServer, loadFromLocal, rebuildIndexes],
  );

  // 初始加载
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, isOnline]);

  // ============ 检索函数 ============

  /**
   * 搜索款式（按名称/编号/品类）
   */
  const searchStyles = useCallback(
    (keyword: string): StyleLite[] => {
      if (!keyword) return dataRef.current.styles.slice(0, 50);

      const kw = keyword.toLowerCase();
      const results: StyleLite[] = [];

      for (const style of dataRef.current.styles) {
        if (
          style.name.toLowerCase().includes(kw) ||
          style.id.toLowerCase().includes(kw) ||
          style.category.toLowerCase().includes(kw)
        ) {
          results.push(style);
          if (results.length >= 50) break;
        }
      }

      return results;
    },
    [],
  );

  /**
   * 搜索 SKU（按条码/款号/颜色/尺码）
   */
  const searchSkus = useCallback(
    (keyword: string): SkuLite[] => {
      if (!keyword) return dataRef.current.skus.slice(0, 50);

      const kw = keyword.toLowerCase();
      const results: SkuLite[] = [];

      for (const sku of dataRef.current.skus) {
        const matches =
          (sku.barcode && sku.barcode.toLowerCase().includes(kw)) ||
          sku.id.toLowerCase().includes(kw) ||
          sku.styleId.toLowerCase().includes(kw) ||
          (sku.styleName && sku.styleName.toLowerCase().includes(kw)) ||
          (sku.colorName && sku.colorName.toLowerCase().includes(kw)) ||
          sku.sizeId.toLowerCase().includes(kw);

        if (matches) {
          results.push(sku);
          if (results.length >= 50) break;
        }
      }

      return results;
    },
    [],
  );

  /**
   * 搜索会员（按手机号/会员号/姓名）
   */
  const searchMembers = useCallback(
    (keyword: string): MemberLite[] => {
      if (!keyword) return dataRef.current.members.slice(0, 20);

      // 精确匹配优先
      const { byPhone, byMemberNo } = memberIndexRef.current;
      const exactMatch = byPhone.get(keyword) || byMemberNo.get(keyword);
      if (exactMatch) {
        return [exactMatch];
      }

      const kw = keyword.toLowerCase();
      const results: MemberLite[] = [];

      for (const member of dataRef.current.members) {
        if (
          matchesKeyword(member.phone, kw) ||
          matchesKeyword(member.memberNo, kw) ||
          matchesKeyword(member.name, kw)
        ) {
          results.push(member);
          if (results.length >= 20) break;
        }
      }

      return results;
    },
    [],
  );

  /**
   * 查询某款式的库存矩阵
   */
  const getStockMatrix = useCallback(
    (styleId: string): StockMatrixResult | null => {
      const style = styleIndexRef.current.get(styleId);
      if (!style) return null;

      const state = dataRef.current;
      const colors = state.colors.filter((c: ColorLite) =>
        style.colorIds.includes(c.id),
      );
      const sizes = state.sizes
        .filter((s: SizeLite) => style.sizeIds.includes(s.id))
        .sort((a: SizeLite, b: SizeLite) => a.sortOrder - b.sortOrder);

      const matrix: Record<string, Record<string, number>> = {};
      let totalQty = 0;

      for (const color of colors) {
        matrix[color.id] = {};
        for (const size of sizes) {
          matrix[color.id][size.id] = 0;
        }
      }

      // 从 SKU 列表找对应 SKU，再查库存
      for (const sku of state.skus) {
        if (sku.styleId !== styleId) continue;
        // 查本地库存
        // 注意：这里用同步内存查找，库存数据应也在 master data state 中
        // 但由于库存数据量大，单独存在 local_stock store
        // 这里做简化：如果已有 stock 数据则使用，否则返回 0
        const stockItems = stockByStyleRef.current.get(styleId);
        if (stockItems) {
          const stock = stockItems.find(
            (s: LocalStockRecord) =>
              s.colorId === sku.colorId && s.sizeId === sku.sizeId,
          );
          if (stock) {
            if (!matrix[sku.colorId]) matrix[sku.colorId] = {};
            matrix[sku.colorId][sku.sizeId] = stock.qty;
            totalQty += stock.qty;
          }
        }
      }

      return {
        styleId,
        styleName: style.name,
        colors,
        sizes,
        matrix,
        totalQty,
      };
    },
    [],
  );

  /**
   * 本地促销计算（简化版）
   * 支持：满减、折扣、指定款/品类门槛、会员专享
   */
  const calculatePromotions = useCallback(
    (
      items: CartItem[],
      ctx?: { isMember?: boolean },
    ): PromotionCalcResult => {
      const result: PromotionCalcResult = {
        totalDiscount: 0,
        applicablePromotions: [],
      };

      if (items.length === 0) return result;

      const totalAmount = items.reduce(
        (sum: number, item: CartItem) => sum + item.unitPrice * item.qty,
        0,
      );
      const totalQty = items.reduce(
        (sum: number, item: CartItem) => sum + item.qty,
        0,
      );

      const now = Date.now();
      const activePromotions = dataRef.current.promotions.filter(
        (p: PromotionLite) =>
          p.status === 'active' && now >= p.startAt && now <= p.endAt,
      );

      // 按优先级排序（数值越小优先级越高）
      activePromotions.sort(
        (a: PromotionLite, b: PromotionLite) => a.priority - b.priority,
      );

      let remainingAmount = totalAmount;

      for (const promo of activePromotions) {
        // 会员专享：非会员直接跳过
        if (promo.memberOnly && !ctx?.isMember) continue;

        let isApplicable = true;
        let discountAmount = 0;

        for (const condition of promo.conditions) {
          if (condition.type === 'amount') {
            if (remainingAmount < (condition.value as number)) {
              isApplicable = false;
              break;
            }
          } else if (condition.type === 'qty') {
            if (totalQty < (condition.value as number)) {
              isApplicable = false;
              break;
            }
          } else if (condition.type === 'style') {
            const ids = condition.value as string[];
            if (!items.some((it) => ids.includes(it.styleId))) {
              isApplicable = false;
              break;
            }
          } else if (condition.type === 'category') {
            // 本地引擎暂无品类信息，按"满足"处理（best-effort）
          }
        }

        if (!isApplicable) continue;

        // 计算优惠
        for (const benefit of promo.benefits) {
          if (benefit.type === 'discountAmount') {
            discountAmount += benefit.value as number;
          } else if (benefit.type === 'discountPercent') {
            discountAmount += remainingAmount * ((benefit.value as number) / 100);
          }
        }

        if (discountAmount > 0) {
          const applied = Math.min(discountAmount, remainingAmount);
          result.applicablePromotions.push({
            promotionId: promo.id,
            promotionName: promo.name,
            discountAmount: applied,
          });
          result.totalDiscount += applied;
          remainingAmount = Math.max(0, remainingAmount - applied);
        }
      }

      return result;
    },
    [],
  );

  /**
   * 同步扣减内存中的库存（离线下单后调用）
   * 注意：调用方需保证 IndexedDB 已先行扣减，此方法仅更新内存状态以保持 UI 一致
   */
  const deductStockItems = useCallback(
    (items: Array<{ skuId: string; qty: number }>): void => {
      setData((prev: MasterDataState): MasterDataState => {
        const stockMap = new Map<string, LocalStockRecord>();
        for (const rec of prev.stock) {
          stockMap.set(rec.skuId, rec);
        }
        let changed = false;
        for (const item of items) {
          const rec = stockMap.get(item.skuId);
          if (rec && rec.qty >= item.qty) {
            stockMap.set(item.skuId, {
              ...rec,
              qty: rec.qty - item.qty,
              updatedAt: Date.now(),
            });
            changed = true;
          }
        }
        if (!changed) return prev;
        const newStock: LocalStockRecord[] = Array.from(stockMap.values());
        const newState: MasterDataState = { ...prev, stock: newStock };
        // 同步更新内存索引
        const stockByStyle = new Map<string, LocalStockRecord[]>();
        for (const rec of newStock) {
          const arr = stockByStyle.get(rec.styleId);
          if (arr) {
            arr.push(rec);
          } else {
            stockByStyle.set(rec.styleId, [rec]);
          }
        }
        stockByStyleRef.current = stockByStyle;
        return newState;
      });
    },
    [],
  );

  return {
    data,
    isLoading,
    error,
    refresh,
    searchStyles,
    searchSkus,
    searchMembers,
    getStockMatrix,
    calculatePromotions,
    deductStockItems,
  };
};

// ============ 单条库存查询工具 ============

/**
 * 直接从 IndexedDB 查询单个 SKU 库存（不经过 Hook）
 */
export const getSkuStock = async (skuId: string): Promise<number> => {
  try {
    const stock = await getLocalStock(skuId);
    return stock?.qty ?? 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[MasterData] getSkuStock failed: ${message}`);
    return 0;
  }
};
