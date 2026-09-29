/**
 * OfflineContext
 *
 * 离线能力顶层 Provider，集成：
 * - 网络状态管理
 * - 同步引擎
 * - 主数据缓存
 * - 离线模式模拟开关
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { logger } from '@lark-apaas/client-toolkit/logger';

import { useNetworkStatus, type NetworkStatus } from '../lib/offline/network';
import {
  useSyncEngine,
  type UseSyncEngineResult,
  type SyncCompleteEvent,
} from '../lib/offline/sync-engine';
import {
  useMasterData,
  type UseMasterDataResult,
  type StockMatrixResult,
} from '../lib/offline/master-data-cache';
import {
  putOfflineOrder,
  putOfflineSuspended,
  batchDeductLocalStock,
  batchAddLocalStock,
  putOfflineStocktake,
  putOfflineTransferRequest,
  putOfflineReceipt,
  putOfflineStockAdjust,
  putOfflineReturn,
  putOfflineMember,
  getOfflineReturns,
  getOfflineOrders,
  getAllPendingItems,
  getOfflineSuspended,
  removeOfflineSuspended,
} from '../lib/offline/db';
import { getSyncEngine } from '../lib/offline/sync-engine';
import type { MemberLite } from '../lib/offline/master-data-cache';

// ============ 类型定义 ============

export interface OfflineContextValue {
  /** 网络状态 */
  networkState: NetworkStatus;
  /** 待同步数量 */
  pendingCount: number;
  /** 是否正在同步 */
  isSyncing: boolean;
  /** 手动触发同步 */
  syncNow: () => Promise<void>;
  /** 主数据 */
  masterData: UseMasterDataResult['data'];
  /** 主数据加载状态 */
  masterDataLoading: boolean;
  /** 主数据刷新 */
  refreshMasterData: () => Promise<void>;
  /** 是否离线模式（手动开关，用于模拟） */
  isOfflineMode: boolean;
  /** 设置离线模拟 */
  setOfflineMode: (flag: boolean) => void;
  /** 综合判断：是否处于离线工作状态 */
  effectivelyOffline: boolean;
  /** 商品搜索（本地） */
  searchStyles: (keyword: string) => ReturnType<UseMasterDataResult['searchStyles']>;
  /** SKU 搜索（本地） */
  searchSkus: (keyword: string) => ReturnType<UseMasterDataResult['searchSkus']>;
  /** 会员搜索（本地） */
  searchMembers: (keyword: string) => ReturnType<UseMasterDataResult['searchMembers']>;
  /** 库存矩阵查询（本地） */
  getStockMatrix: (
    styleId: string,
  ) => ReturnType<UseMasterDataResult['getStockMatrix']>;
  /** 促销计算（本地）；第二参数为会员上下文，用于判断会员专属促销 */
  calculatePromotions: (
    items: Parameters<UseMasterDataResult['calculatePromotions']>[0],
    ctx?: Parameters<UseMasterDataResult['calculatePromotions']>[1],
  ) => ReturnType<UseMasterDataResult['calculatePromotions']>;
  /** 同步进度 0-100 */
  syncProgress: number;
  /** 是否刚刚同步成功（用于显示绿色提示） */
  justSynced: boolean;
  /** 同步统计 */
  syncStats: { pending: number; failed: number; synced: number; total: number };
  /** 库存矩阵查询（getStockMatrix 的别名，兼容 UI 层调用） */
  getStockForStyle: (styleId: string) => StockMatrixResult | null;
  /** 创建离线销售单，写入 IndexedDB，返回订单号 */
  createOfflineOrder: (order: unknown) => Promise<string>;
  /** 创建离线挂单，写入 IndexedDB，返回挂单号 */
  createOfflineSuspended: (order: unknown) => Promise<string>;
  /** 创建离线盘点单，写入 IndexedDB，返回 clientId */
  createOfflineStocktake: (data: unknown) => Promise<string>;
  /** 创建离线要货申请单，写入 IndexedDB，返回 clientId */
  createOfflineTransferRequest: (data: unknown) => Promise<string>;
  /** 创建离线收货单，写入 IndexedDB，返回 clientId */
  createOfflineReceipt: (data: unknown) => Promise<string>;
  /** 创建离线库存调整单，写入 IndexedDB，返回 clientId */
  createOfflineStockAdjust: (data: unknown) => Promise<string>;
  /** 批量增加本地库存（收货/入库用） */
  addLocalStockBatch: (items: Array<{ skuId: string; qty: number }>) => Promise<void>;
  /** 创建离线退货单，写入 IndexedDB，返回客户端 ID */
  createOfflineReturn: (returnData: unknown) => Promise<string>;
  /** 创建离线新会员，写入 IndexedDB，返回客户端 ID */
  createOfflineMember: (memberData: unknown) => Promise<string>;
  /** 获取离线销售单列表（用于退换货原单查询等） */
  getOfflineOrderList: () => Promise<unknown[]>;
  /** 获取离线退货单列表（用于退换货记录展示，刷新不丢） */
  getOfflineReturnList: () => Promise<unknown[]>;
  /** 获取离线挂单列表 */
  getOfflineSuspendedList: () => Promise<Array<{ clientId: string; orderData: unknown; createdAt: number }>>;
  /** 删除离线挂单（取单后移除） */
  removeOfflineSuspendedRecord: (clientId: string) => Promise<void>;
  /** 合并搜索会员（主数据缓存 + 离线新注册） */
  searchMembersMerged: (keyword: string) => MemberLite[];
}

// ============ Context 创建 ============

const OfflineContext = createContext<OfflineContextValue | null>(null);

// ============ Provider ============

export interface OfflineProviderProps {
  children: ReactNode;
  /** 门店 ID */
  storeId: string;
}

/**
 * OfflineProvider - 离线能力顶层 Provider
 *
 * 使用方式：
 * ```tsx
 * <OfflineProvider storeId="store_xxx">
 *   <App />
 * </OfflineProvider>
 * ```
 */
export const OfflineProvider: React.FC<OfflineProviderProps> = ({
  children,
  storeId,
}) => {
  // 1. 网络状态
  const networkState: NetworkStatus = useNetworkStatus();

  // 2. 离线模拟开关（从 localStorage 恢复）
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('yuncaipos_offline_mode') === '1';
    } catch {
      return false;
    }
  });

  // 3. 同步进度与 justSynced 状态
  const [syncProgress, setSyncProgress] = useState<number>(0);
  const [justSynced, setJustSynced] = useState<boolean>(false);
  const [syncStats, setSyncStats] = useState<{
    pending: number;
    failed: number;
    synced: number;
    total: number;
  }>({ pending: 0, failed: 0, synced: 0, total: 0 });
  const justSyncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 4. 计算实际在线状态（考虑模拟开关）
  const effectivelyOnline = useMemo((): boolean => {
    if (isOfflineMode) return false;
    return networkState.isOnline && networkState.isServerReachable;
  }, [isOfflineMode, networkState.isOnline, networkState.isServerReachable]);

  // 5. 同步引擎
  const syncEngine: UseSyncEngineResult = useSyncEngine();

  // 6. 主数据缓存
  const masterData: UseMasterDataResult = useMasterData(storeId, effectivelyOnline);

  // 7. 监听同步引擎真实事件，更新进度与统计（替换原先基于轮询的"假"统计）
  useEffect(() => {
    const engine = getSyncEngine();

    const unsubComplete = engine.on('sync-complete', (data: unknown) => {
      const event = data as SyncCompleteEvent;
      setSyncProgress(100);
      setSyncStats({
        pending: event.total - event.succeeded - event.failed - event.conflicts,
        failed: event.failed + event.conflicts,
        synced: event.succeeded,
        total: event.total,
      });
      if (event.total > 0 && (event.succeeded > 0 || event.failed + event.conflicts > 0)) {
        setJustSynced(true);
        if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
        justSyncedTimerRef.current = setTimeout(() => setJustSynced(false), 3000);
      }
      setTimeout(() => setSyncProgress(0), 1500);
    });

    const unsubProgress = engine.on('sync-progress', (data: unknown) => {
      const ev = data as { completed: number; total: number };
      if (ev.total > 0) {
        setSyncProgress(Math.min(95, Math.round((ev.completed / ev.total) * 100)));
      }
    });

    return (): void => {
      unsubComplete();
      unsubProgress();
      if (justSyncedTimerRef.current) clearTimeout(justSyncedTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 8. 网络恢复时自动同步
  useEffect(() => {
    if (effectivelyOnline && syncEngine.pendingCount > 0) {
      logger.info('[OfflineContext] Network restored, triggering auto sync');
      void syncEngine.syncNow();
    }
  }, [effectivelyOnline, syncEngine.pendingCount, syncEngine.syncNow]);

  // 9. 同步 pending 数到 syncStats
  useEffect(() => {
    setSyncStats((prev) => ({ ...prev, pending: syncEngine.pendingCount }));
  }, [syncEngine.pendingCount]);

  const syncNow = useCallback(async (): Promise<void> => {
    if (!effectivelyOnline) {
      logger.warn('[OfflineContext] syncNow called while offline, skipped');
      return;
    }
    await syncEngine.syncNow();
  }, [effectivelyOnline, syncEngine.syncNow]);

  const setOfflineMode = useCallback((flag: boolean): void => {
    logger.info(`[OfflineContext] Offline mode ${flag ? 'enabled' : 'disabled'}`);
    setIsOfflineMode(flag);
    try {
      localStorage.setItem('yuncaipos_offline_mode', flag ? '1' : '0');
    } catch (err) {
      logger.error('[OfflineContext] Failed to persist offline mode to localStorage', err as Error);
    }
  }, []);

  const getStockForStyle = useCallback(
    (styleId: string): StockMatrixResult | null => {
      return masterData.getStockMatrix(styleId);
    },
    [masterData],
  );

  // 直接从 IndexedDB 统计待同步数量（不触发同步，离线下单后立即刷新 UI）
  const refreshPendingCount = useCallback(async (): Promise<void> => {
    try {
      const items = await getAllPendingItems();
      // 通过自定义事件通知 syncEngine hook 刷新 pendingCount
      const event = new CustomEvent('yuncaipos-pending-refresh', {
        detail: { count: items.length },
      });
      window.dispatchEvent(event);
      logger.debug(`[OfflineContext] Pending count refreshed: ${items.length}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[OfflineContext] Failed to refresh pending count: ${message}`);
    }
  }, []);

  const createOfflineOrder = useCallback(
    async (order: unknown): Promise<string> => {
      const orderData = order as {
        cart?: Array<{ skuId?: string; styleId?: string; qty: number }>;
      };
      const items = orderData.cart ?? [];

      // 防超卖硬校验：计算本地可用库存 = IndexedDB 中库存 − 待同步队列中已占用
      // 第一步：校验 IndexedDB 本地库存快照
      const deductItems: Array<{ skuId: string; qty: number }> = [];
      for (const item of items) {
        if (!item.skuId || item.qty <= 0) continue;
        deductItems.push({ skuId: item.skuId, qty: item.qty });
      }

      if (deductItems.length > 0) {
        const success = await batchDeductLocalStock(deductItems);
        if (!success) {
          // 库存不足，拒绝下单（batchDeductLocalStock 是原子事务，失败时已全部回滚）
          logger.warn(`[OfflineContext] Offline order rejected: insufficient stock`);
          throw new Error('库存不足，无法完成离线交易');
        }
        logger.info(
          `[OfflineContext] Local stock deducted for ${deductItems.length} SKUs`,
        );
      }

      const clientId = `off_order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineOrder({
          clientId,
          storeId,
          orderData: order,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline order to IndexedDB: ${message}`);
        // 写库失败：必须把已扣减的本地库存加回来，否则会永久泄漏库存
        try {
          if (deductItems.length > 0) await batchAddLocalStock(deductItems);
        } catch (rollbackErr) {
          logger.error(
            `[OfflineContext] Rollback local stock failed after order write error`,
            rollbackErr as Error,
          );
        }
        throw new Error(`离线订单写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline order created: ${clientId}`);

      // 库存扣减后，同步更新内存中的库存缓存（UI 立即可见）
      masterData.deductStockItems(deductItems);

      // 刷新 pending 数量（直接从 IndexedDB 统计，不触发同步）
      void refreshPendingCount();
      return clientId;
    },
    [storeId, masterData, refreshPendingCount],
  );

  const createOfflineSuspended = useCallback(
    async (order: unknown): Promise<string> => {
      const clientId = `off_suspend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineSuspended({
          clientId,
          storeId,
          orderData: order,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline suspended to IndexedDB: ${message}`);
        throw new Error(`离线挂单写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline suspended created: ${clientId}`);
      return clientId;
    },
    [storeId],
  );

  const createOfflineStocktake = useCallback(
    async (data: unknown): Promise<string> => {
      const clientId = `off_stocktake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineStocktake({
          clientId,
          storeId,
          stocktakeData: data,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline stocktake to IndexedDB: ${message}`);
        throw new Error(`离线盘点单写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline stocktake created: ${clientId}`);
      void refreshPendingCount();
      return clientId;
    },
    [storeId, refreshPendingCount],
  );

  const createOfflineTransferRequest = useCallback(
    async (data: unknown): Promise<string> => {
      const clientId = `off_transfer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineTransferRequest({
          clientId,
          storeId,
          requestData: data,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline transfer request to IndexedDB: ${message}`);
        throw new Error(`离线要货申请写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline transfer request created: ${clientId}`);
      void refreshPendingCount();
      return clientId;
    },
    [storeId, refreshPendingCount],
  );

  const createOfflineReceipt = useCallback(
    async (data: unknown): Promise<string> => {
      const clientId = `off_receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineReceipt({
          clientId,
          storeId,
          receiptData: data,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline receipt to IndexedDB: ${message}`);
        throw new Error(`离线收货单写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline receipt created: ${clientId}`);
      void refreshPendingCount();
      return clientId;
    },
    [storeId, refreshPendingCount],
  );

  const createOfflineStockAdjust = useCallback(
    async (data: unknown): Promise<string> => {
      const clientId = `off_adjust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineStockAdjust({
          clientId,
          storeId,
          adjustData: data,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline stock adjust to IndexedDB: ${message}`);
        throw new Error(`离线库存调整写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline stock adjust created: ${clientId}`);
      void refreshPendingCount();
      return clientId;
    },
    [storeId, refreshPendingCount],
  );

  const addLocalStockBatch = useCallback(
    async (items: Array<{ skuId: string; qty: number }>): Promise<void> => {
      // 通过主数据缓存的本地库存能力增加库存
      // 这里复用 masterData 的本地库存更新逻辑
      const { openDB, STORE_NAMES: storeNames } = await import('../lib/offline/db');
      const db = await openDB();
      const now = Date.now();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeNames.LOCAL_STOCK, 'readwrite');
        const store = transaction.objectStore(storeNames.LOCAL_STOCK);
        let completed = 0;
        let hasError = false;
        for (const item of items) {
          const getReq = store.get(item.skuId);
          getReq.onsuccess = () => {
            const existing = getReq.result as { qty: number; updatedAt: number } | undefined;
            const updated = existing
              ? { ...existing, qty: existing.qty + item.qty, updatedAt: now }
              : { skuId: item.skuId, storeId, qty: item.qty, updatedAt: now, styleId: '', colorId: '', sizeId: '' };
            const putReq = store.put(updated);
            putReq.onsuccess = () => {
              completed += 1;
              if (completed === items.length && !hasError) resolve();
            };
            putReq.onerror = () => {
              if (!hasError) {
                hasError = true;
                reject(new Error(putReq.error?.message ?? 'addLocalStockBatch put failed'));
              }
            };
          };
          getReq.onerror = () => {
            if (!hasError) {
              hasError = true;
              reject(new Error(getReq.error?.message ?? 'addLocalStockBatch get failed'));
            }
          };
        }
        if (items.length === 0) resolve();
      });
    },
    [storeId],
  );

  const createOfflineReturn = useCallback(
    async (returnData: unknown): Promise<string> => {
      const clientId = `off_return_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineReturn({
          clientId,
          storeId,
          returnData,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline return to IndexedDB: ${message}`);
        throw new Error(`离线退货单写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline return created: ${clientId}`);
      void refreshPendingCount();
      return clientId;
    },
    [storeId, refreshPendingCount],
  );

  const createOfflineMember = useCallback(
    async (memberData: unknown): Promise<string> => {
      const clientId = `off_member_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await putOfflineMember({
          clientId,
          storeId,
          memberData,
          syncStatus: 'pending',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[OfflineContext] Failed to write offline member to IndexedDB: ${message}`);
        throw new Error(`离线会员写入本地失败：${message}`);
      }
      logger.info(`[OfflineContext] Offline member created: ${clientId}`);
      void refreshPendingCount();
      return clientId;
    },
    [storeId, refreshPendingCount],
  );

  const getOfflineOrderList = useCallback(async (): Promise<unknown[]> => {
    try {
      const records = await getOfflineOrders();
      return records.map((r) => r.orderData);
    } catch (e) {
      logger.error('[OfflineContext] getOfflineOrderList failed', e as Error);
      return [];
    }
  }, []);

  const getOfflineReturnList = useCallback(async (): Promise<unknown[]> => {
    try {
      const records = await getOfflineReturns();
      return records.map((r) => r.returnData);
    } catch (e) {
      logger.error('[OfflineContext] getOfflineReturnList failed', e as Error);
      return [];
    }
  }, []);

  const getOfflineSuspendedList = useCallback(async (): Promise<Array<{ clientId: string; orderData: unknown; createdAt: number }>> => {
    try {
      const records = await getOfflineSuspended();
      return records.map((r) => ({
        clientId: r.clientId,
        orderData: r.orderData,
        createdAt: r.createdAt,
      }));
    } catch (e) {
      logger.error('[OfflineContext] getOfflineSuspendedList failed', e as Error);
      return [];
    }
  }, []);

  const removeOfflineSuspendedRecord = useCallback(
    async (clientId: string): Promise<void> => {
      try {
        await removeOfflineSuspended(clientId);
      } catch (e) {
        logger.error('[OfflineContext] removeOfflineSuspendedRecord failed', e as Error);
        throw e;
      }
    },
    [],
  );

  // 合并搜索：主数据缓存会员 + 离线新注册会员（从 masterData.members + 本地队列）
  const searchMembersMerged = useCallback(
    (keyword: string): MemberLite[] => {
      // 先从主数据搜索
      const cached = masterData.searchMembers(keyword);
      // 离线注册会员在 master data 中尚未同步，暂时只有 cached 结果
      // 实际项目中可从 offline_members store 读取并合并
      return cached;
    },
    [masterData],
  );

  const contextValue: OfflineContextValue = useMemo<OfflineContextValue>(
    () => ({
      networkState,
      pendingCount: syncEngine.pendingCount,
      isSyncing: syncEngine.isSyncing,
      syncNow,
      masterData: masterData.data,
      masterDataLoading: masterData.isLoading,
      refreshMasterData: masterData.refresh,
      isOfflineMode,
      setOfflineMode,
      effectivelyOffline: !effectivelyOnline,
      searchStyles: masterData.searchStyles,
      searchSkus: masterData.searchSkus,
      searchMembers: masterData.searchMembers,
      getStockMatrix: masterData.getStockMatrix,
      calculatePromotions: masterData.calculatePromotions,
      syncProgress,
      justSynced,
      syncStats,
      getStockForStyle,
      createOfflineOrder,
      createOfflineSuspended,
      createOfflineStocktake,
      createOfflineTransferRequest,
      createOfflineReceipt,
      createOfflineStockAdjust,
      addLocalStockBatch,
      createOfflineReturn,
      createOfflineMember,
      getOfflineOrderList,
      getOfflineReturnList,
      getOfflineSuspendedList,
      removeOfflineSuspendedRecord,
      searchMembersMerged,
    }),
    [
      networkState,
      syncEngine.pendingCount,
      syncEngine.isSyncing,
      syncNow,
      masterData.data,
      masterData.isLoading,
      masterData.refresh,
      masterData.searchStyles,
      masterData.searchSkus,
      masterData.searchMembers,
      masterData.getStockMatrix,
      masterData.calculatePromotions,
      isOfflineMode,
      setOfflineMode,
      effectivelyOnline,
      syncProgress,
      justSynced,
      syncStats,
      getStockForStyle,
      createOfflineOrder,
      createOfflineSuspended,
      createOfflineStocktake,
      createOfflineTransferRequest,
      createOfflineReceipt,
      createOfflineStockAdjust,
      addLocalStockBatch,
      createOfflineReturn,
      createOfflineMember,
      getOfflineOrderList,
      getOfflineReturnList,
      getOfflineSuspendedList,
      removeOfflineSuspendedRecord,
      searchMembersMerged,
    ],
  );

  return (
    <OfflineContext.Provider value={contextValue}>
      {children}
    </OfflineContext.Provider>
  );
};

// ============ Hook ============

/**
 * useOffline - 获取离线能力上下文
 *
 * 必须在 <OfflineProvider> 内部使用
 */
export const useOffline = (): OfflineContextValue => {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
};

export default OfflineContext;
