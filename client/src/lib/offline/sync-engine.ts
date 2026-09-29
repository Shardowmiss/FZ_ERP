/**
 * 同步引擎
 *
 * 负责将本地 IndexedDB 中的 pending 数据批量同步到后端，
 * 并处理同步结果、冲突、自动重试等逻辑。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import {
  getAllPendingItems,
  getAllItemsByStatus,
  resetItemForRetry,
  updateOfflineSyncStatus,
  addSyncLog,
  STORE_NAMES,
  type PendingItem,
  type SyncStatus,
} from './db';

// ============ 类型定义 ============

export interface OfflineSyncResult {
  /** 实体类型: order, return, member, stockAdjust */
  entityType: string;
  /** 客户端 ID */
  clientId: string;
  /** 同步结果状态 */
  status: 'success' | 'failed' | 'conflict';
  /** 服务端生成的实体 ID（成功时） */
  serverEntityId?: string;
  /** 错误信息 */
  errorMessage?: string;
  /** 冲突时的服务端数据快照 */
  serverData?: unknown;
}

export interface SyncBatchRequest {
  items: Array<{
    entityType: string;
    clientId: string;
    entityData: unknown;
    storeId: string;
  }>;
}

export interface SyncBatchResponse {
  results: OfflineSyncResult[];
}

export type SyncEventName = 'sync-progress' | 'sync-complete' | 'sync-conflict' | 'sync-error';

export interface SyncProgressEvent {
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
}

export interface SyncCompleteEvent {
  total: number;
  succeeded: number;
  failed: number;
  conflicts: number;
}

export interface SyncConflictEvent {
  entityType: string;
  clientId: string;
  serverData?: unknown;
}

type SyncCallback<T = unknown> = (data: T) => void;

// ============ 常量 ============

const SYNC_BATCH_ENDPOINT = '/api/offline-sync/sync/batch';
const AUTO_SYNC_INTERVAL = 60_000; // 自动同步间隔：60 秒
const MAX_RETRY_COUNT = 5; // 最大重试次数
// P1-6：单批发送上限。过大（数百上千单）会让一个 HTTP 请求占用过久、
// 且服务端令牌桶失去意义；过小则请求数爆炸。50 在「请求数」与「单批耗时」间取平衡。
const SYNC_BATCH_SIZE = 50;

// ============ 实体类型 -> store 映射 ============

const ENTITY_STORE_MAP: Record<string, string> = {
  order: STORE_NAMES.OFFLINE_ORDERS,
  return: STORE_NAMES.OFFLINE_RETURNS,
  member: STORE_NAMES.OFFLINE_MEMBERS,
  stockAdjust: STORE_NAMES.OFFLINE_STOCK_ADJUST,
  stocktake: STORE_NAMES.OFFLINE_STOCKTAKES,
  transferRequest: STORE_NAMES.OFFLINE_TRANSFER_REQUESTS,
  receipt: STORE_NAMES.OFFLINE_RECEIPTS,
};

// 内部 entityType -> 服务端 entityType 映射
const ENTITY_TYPE_SERVER_MAP: Record<string, string> = {
  order: 'sale_order',
  return: 'return_order',
  member: 'member',
  stockAdjust: 'stock_adjust',
  stocktake: 'stocktake',
  transferRequest: 'transfer_request',
  receipt: 'receipt',
  suspended: 'suspended_order',
};

// P1-6：纯函数分片（客户端专用，不依赖服务端 batch 模块）
function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error('chunk size must be a positive integer');
  }
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// ============ SyncEngine 类 ============

export class SyncEngine {
  private isSyncing = false;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private isAutoSyncRunning = false;
  private listeners = new Map<SyncEventName, Set<SyncCallback>>();

  /**
   * 同步所有 pending 项到后端
   */
  async syncAllPending(): Promise<SyncCompleteEvent> {
    if (this.isSyncing) {
      logger.debug('[SyncEngine] Sync already in progress, skipping');
      return { total: 0, succeeded: 0, failed: 0, conflicts: 0 };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      // 1. 获取所有待同步项
      const pendingItems: PendingItem[] = await getAllPendingItems();

      if (pendingItems.length === 0) {
        logger.debug('[SyncEngine] No pending items to sync');
        this.emit('sync-complete', { total: 0, succeeded: 0, failed: 0, conflicts: 0 });
        return { total: 0, succeeded: 0, failed: 0, conflicts: 0 };
      }

      logger.info(`[SyncEngine] Starting sync for ${pendingItems.length} pending items`);

      // 2. 分离「超过最大重试次数」的死信项 → 转入待处理工作台
      //    （P1-4 修复：原实现只是静默跳过，单据永远停在 pending，等于丢单）
      const deadLetterItems: PendingItem[] = pendingItems.filter(
        (item: PendingItem) => item.retryCount >= MAX_RETRY_COUNT,
      );
      if (deadLetterItems.length > 0) {
        await this.markDeadLetter(deadLetterItems);
      }

      const itemsToSync: PendingItem[] = pendingItems.filter(
        (item: PendingItem) => item.retryCount < MAX_RETRY_COUNT,
      );

      if (itemsToSync.length === 0) {
        logger.warn('[SyncEngine] All pending items exceeded max retry count');
        this.emit('sync-complete', {
          total: pendingItems.length,
          succeeded: 0,
          failed: pendingItems.length,
          conflicts: 0,
        });
        return {
          total: pendingItems.length,
          succeeded: 0,
          failed: pendingItems.length,
          conflicts: 0,
        };
      }

      // 3. 先标记为 syncing
      for (const item of itemsToSync) {
        const storeName = ENTITY_STORE_MAP[item.entityType];
        if (storeName) {
          try {
            await updateOfflineSyncStatus(item.clientId, storeName, 'syncing');
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[SyncEngine] Failed to mark syncing for ${item.clientId}: ${message}`);
          }
        }
      }

      // 4. 分片发送（P1-6：每批 ≤ SYNC_BATCH_SIZE，顺序发送，逐批 ack）
      // 单批过大（数百上千单）会让一个 HTTP 请求占用过久、且服务端令牌桶失去意义；
      // 分片后每片独立返回该片的逐条结果（clientId + success），天然「流式 ack」：
      // 断网/崩溃仅丢未发片，已发片已落库且不重放（clientId 幂等）。
      const fallbackStoreId: string = itemsToSync[0]?.storeId ?? '';
      const batches: PendingItem[][] = chunkArray(itemsToSync, SYNC_BATCH_SIZE);
      const allResults: OfflineSyncResult[] = [];
      let batchFailed = false;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchStoreId: string = batch[0]?.storeId ?? fallbackStoreId;
        try {
          const batchResults = await this.sendBatch(batch, batchStoreId);
          allResults.push(...batchResults);
          // 每片完成即本地落库（流式 ack 的客户端侧体现），崩溃也不丢已确认项
          await this.processSyncResults(batchResults);

          this.emit('sync-progress', {
            total: itemsToSync.length,
            completed: allResults.length,
            succeeded: allResults.filter((r) => r.status === 'success').length,
            failed: allResults.filter((r) => r.status === 'failed').length,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(
            `[SyncEngine] Batch ${i + 1}/${batches.length} failed: ${message}`,
          );
          // 本批及之后未发的项重置为 pending，等待下次自动同步
          // （已发片由服务端 clientId 幂等保证不重复落库，无需处理）
          const unsent: PendingItem[] = batches.slice(i).flat();
          await this.resetItemsToPending(unsent, message);
          batchFailed = true;
          break;
        }
      }

      if (allResults.length === 0 && batchFailed) {
        // 首批即失败：项已全部重置为 pending，按错误路径上报，不抛异常（finally 释放锁）
        this.emit('sync-error', {
          message: '离线同步首批失败，已重置为 pending 等待重试',
        });
        return {
          total: itemsToSync.length,
          succeeded: 0,
          failed: itemsToSync.length,
          conflicts: 0,
        };
      }

      // 5. 统计（聚合全部已确认结果）
      let succeeded = 0;
      let failed = 0;
      let conflicts = 0;

      for (const result of allResults) {
        if (result.status === 'success') {
          succeeded += 1;
        } else if (result.status === 'conflict') {
          conflicts += 1;
        } else {
          failed += 1;
        }
      }

      const completeEvent: SyncCompleteEvent = {
        total: itemsToSync.length,
        succeeded,
        failed,
        conflicts,
      };

      this.emit('sync-complete', completeEvent);

      const duration = Date.now() - startTime;
      logger.info(
        `[SyncEngine] Sync completed: ${succeeded} succeeded, ${failed} failed, ${conflicts} conflicts in ${duration}ms`,
      );

      return completeEvent;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[SyncEngine] Sync failed: ${message}`);

      // 网络错误：把 syncing 状态的项改回 pending，等下次重试
      try {
        const pendingItems: PendingItem[] = await getAllPendingItems();
        // 这里只处理 syncing 状态的，因为 getAllPendingItems 只返回 pending
        // 需要额外查 syncing 状态的项
        const syncingStores = [
          STORE_NAMES.OFFLINE_ORDERS,
          STORE_NAMES.OFFLINE_RETURNS,
          STORE_NAMES.OFFLINE_MEMBERS,
          STORE_NAMES.OFFLINE_STOCK_ADJUST,
          STORE_NAMES.OFFLINE_STOCKTAKES,
          STORE_NAMES.OFFLINE_TRANSFER_REQUESTS,
          STORE_NAMES.OFFLINE_RECEIPTS,
        ];
        for (const storeName of syncingStores) {
          await this.resetSyncingToPending(storeName, message);
        }
      } catch (resetErr) {
        const resetMsg = resetErr instanceof Error ? resetErr.message : String(resetErr);
        logger.error(`[SyncEngine] Failed to reset syncing status: ${resetMsg}`);
      }

      this.emit('sync-error', { message });

      return { total: 0, succeeded: 0, failed: 0, conflicts: 0 };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 处理同步结果，更新本地 IndexedDB 状态
   */
  async processSyncResults(results: OfflineSyncResult[]): Promise<void> {
    for (const result of results) {
      const storeName = ENTITY_STORE_MAP[result.entityType];
      if (!storeName) {
        logger.warn(`[SyncEngine] Unknown entity type: ${result.entityType}`);
        continue;
      }

      const status: SyncStatus =
        result.status === 'success'
          ? 'synced'
          : result.status === 'conflict'
            ? 'conflict'
            : 'failed';

      try {
        await updateOfflineSyncStatus(
          result.clientId,
          storeName,
          status,
          result.errorMessage,
          result.serverEntityId,
        );

        // 写同步日志
        await addSyncLog({
          type: 'push',
          entityType: result.entityType,
          clientId: result.clientId,
          status: result.status,
          errorMessage: result.errorMessage,
          timestamp: Date.now(),
        });

        // 冲突事件
        if (result.status === 'conflict') {
          this.handleConflict(result);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `[SyncEngine] Failed to update status for ${result.clientId}: ${message}`,
        );
      }
    }
  }

  /**
   * 将超过最大重试次数的项标记为死信（failed），使其从 pending 池移出，
   * 并在「待处理」工作台中可见、可人工重提（P1-4）
   */
  private async markDeadLetter(items: PendingItem[]): Promise<void> {
    const reason = `已重试 ${MAX_RETRY_COUNT} 次仍失败，已转入待处理工作台，请人工核对后重提`;
    for (const item of items) {
      const storeName = ENTITY_STORE_MAP[item.entityType];
      if (!storeName) continue;
      try {
        await updateOfflineSyncStatus(item.clientId, storeName, 'failed', reason);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[SyncEngine] Failed to mark dead letter ${item.clientId}: ${message}`);
      }
    }
    logger.warn(`[SyncEngine] ${items.length} 项转为死信，等待人工处理`);
  }

  /**
   * P1-6：发送单个分片到服务端，解析响应并转换为内部 OfflineSyncResult[]。
   */
  private async sendBatch(
    batch: PendingItem[],
    storeId: string,
  ): Promise<OfflineSyncResult[]> {
    const requestBody = {
      storeId,
      items: batch.map((item: PendingItem) => ({
        entityType: ENTITY_TYPE_SERVER_MAP[item.entityType] ?? item.entityType,
        clientId: item.clientId,
        entityData: item.entityData,
        storeId: item.storeId,
      })),
    };

    const response = await axiosForBackend.post(SYNC_BATCH_ENDPOINT, requestBody, {
      timeout: 30_000,
    });

    const responseData = response.data;
    // 兼容两种返回格式：数组 或 { results: [...] }
    const rawResults: Array<Record<string, unknown>> = Array.isArray(responseData)
      ? (responseData as Array<Record<string, unknown>>)
      : ((responseData as { results?: Array<Record<string, unknown>> }).results ?? []);

    const clientIdToEntityType = new Map<string, string>();
    for (const item of batch) {
      clientIdToEntityType.set(item.clientId, item.entityType);
    }

    return rawResults.map((item: Record<string, unknown>) => {
      const clientId = String(item.clientId ?? '');
      const isSuccess = item.success === true;
      const conflict = item.conflictType !== undefined && item.conflictType !== null;
      const internalEntityType = clientIdToEntityType.get(clientId) ?? 'order';
      return {
        entityType: internalEntityType,
        clientId,
        status: conflict ? 'conflict' : isSuccess ? 'success' : 'failed',
        serverEntityId: item.serverEntityId as string | undefined,
        errorMessage: item.errorMessage as string | undefined,
        serverData: item.serverData,
      };
    });
  }

  /**
   * P1-6：将未确认的分片项重置为 pending，使其进入下次自动同步。
   * 已发片由服务端幂等（clientId）保证不重复落库，无需处理。
   */
  private async resetItemsToPending(
    items: PendingItem[],
    errorMessage: string,
  ): Promise<void> {
    for (const item of items) {
      const storeName = ENTITY_STORE_MAP[item.entityType];
      if (!storeName) continue;
      try {
        await updateOfflineSyncStatus(item.clientId, storeName, 'pending', errorMessage);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          `[SyncEngine] resetItemsToPending failed for ${item.clientId}: ${message}`,
        );
      }
    }
  }

  /**
   * 获取死信（failed）项列表，供「待处理」工作台展示
   */
  async getDeadLetterItems(): Promise<PendingItem[]> {
    return getAllItemsByStatus('failed');
  }

  /**
   * 人工重提：将指定项重置为 pending 并清零重试次数，使其重新进入同步队列
   */
  async retryItem(clientId: string, entityType: string): Promise<void> {
    await resetItemForRetry(clientId, entityType);
    logger.info(`[SyncEngine] Item re-queued for retry: ${entityType}/${clientId}`);
  }

  /**
   * 处理同步冲突
   */
  handleConflict(result: OfflineSyncResult): void {
    logger.warn(
      `[SyncEngine] Conflict detected: ${result.entityType}/${result.clientId}`,
    );
    this.emit('sync-conflict', {
      entityType: result.entityType,
      clientId: result.clientId,
      serverData: result.serverData,
    } as SyncConflictEvent);
  }

  /**
   * 启动自动同步
   */
  startAutoSync(): void {
    if (this.isAutoSyncRunning) {
      return;
    }
    this.isAutoSyncRunning = true;
    logger.info('[SyncEngine] Auto sync started');

    // 启动后立即执行一次
    void this.syncAllPending();

    // 定时执行
    this.autoSyncTimer = setInterval(() => {
      void this.syncAllPending();
    }, AUTO_SYNC_INTERVAL);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    this.isAutoSyncRunning = false;
    logger.info('[SyncEngine] Auto sync stopped');
  }

  /**
   * 事件订阅
   */
  on<T = unknown>(event: SyncEventName, callback: SyncCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set.add(callback as SyncCallback<any>);

    // 返回取消订阅函数
    return (): void => {
      const currentSet = this.listeners.get(event);
      if (currentSet) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentSet.delete(callback as SyncCallback<any>);
      }
    };
  }

  /**
   * 触发事件
   */
  private emit(event: SyncEventName, data: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[SyncEngine] Listener error for ${event}: ${message}`);
        }
      }
    }
  }

  /**
   * 将指定 store 中 syncing 状态的项重置为 pending
   * （网络错误导致同步中断时调用）
   */
  private async resetSyncingToPending(
    storeName: string,
    errorMessage: string,
  ): Promise<void> {
    // 使用 getAll + 过滤 + 批量更新的方式
    // 这里用 db.ts 中没有暴露 getAllByIndex，直接通过事务处理
    // 简化：通过 openDB 直接操作
    try {
      const { openDB: openDbFn } = await import('./db');
      const db = await openDbFn();
      return new Promise<void>((resolve) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const index = store.index('by_status');
        const request = index.openCursor(IDBKeyRange.only('syncing'));

        request.onsuccess = (): void => {
          const cursor = request.result;
          if (cursor) {
            const record = cursor.value;
            cursor.update({
              ...record,
              syncStatus: 'pending',
              errorMessage,
              updatedAt: Date.now(),
              retryCount: (record.retryCount ?? 0) + 1,
            });
            cursor.continue();
          } else {
            resolve();
          }
        };

        request.onerror = (): void => {
          const error = request.error?.message ?? 'Unknown error';
          logger.error(`[SyncEngine] resetSyncingToPending cursor error: ${error}`);
          resolve();
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[SyncEngine] resetSyncingToPending failed: ${message}`);
    }
  }

  /**
   * 获取当前是否正在同步
   */
  getIsSyncing(): boolean {
    return this.isSyncing;
  }
}

// ============ 单例 ============

let syncEngineInstance: SyncEngine | null = null;

/**
 * 获取 SyncEngine 单例
 */
export const getSyncEngine = (): SyncEngine => {
  if (!syncEngineInstance) {
    syncEngineInstance = new SyncEngine();
  }
  return syncEngineInstance;
};

// ============ React Hook ============

export interface UseSyncEngineResult {
  isSyncing: boolean;
  pendingCount: number;
  syncNow: () => Promise<void>;
  startAutoSync: () => void;
  stopAutoSync: () => void;
}

/**
 * SyncEngine React Hook
 */
export const useSyncEngine = (): UseSyncEngineResult => {
  const engineRef = useRef<SyncEngine>(getSyncEngine());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);

  /** 手动触发同步 */
  const syncNow = useCallback(async (): Promise<void> => {
    const engine = engineRef.current;
    setIsSyncing(true);
    try {
      await engine.syncAllPending();
    } finally {
      setIsSyncing(false);
      // 同步后刷新 pending 数量
      try {
        const items = await getAllPendingItems();
        setPendingCount(items.length);
      } catch {
        // 忽略计数错误
      }
    }
  }, []);

  const startAutoSync = useCallback((): void => {
    engineRef.current.startAutoSync();
  }, []);

  const stopAutoSync = useCallback((): void => {
    engineRef.current.stopAutoSync();
  }, []);

  // 初始加载 pending 数量
  useEffect(() => {
    let mounted = true;
    const loadPendingCount = async (): Promise<void> => {
      try {
        const items = await getAllPendingItems();
        if (mounted) {
          setPendingCount(items.length);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[useSyncEngine] Failed to load pending count: ${message}`);
      }
    };
    void loadPendingCount();

    // 监听 sync-complete 事件刷新 pending 数量
    const engine = engineRef.current;
    const unsubscribe = engine.on('sync-complete', () => {
      void loadPendingCount();
    });

    // 监听外部主动刷新 pending 数量的事件（离线下单后立即刷新 UI）
    const handlePendingRefresh = (): void => {
      void loadPendingCount();
    };
    window.addEventListener('yuncaipos-pending-refresh', handlePendingRefresh);

    return (): void => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('yuncaipos-pending-refresh', handlePendingRefresh);
    };
  }, []);

  return {
    isSyncing,
    pendingCount,
    syncNow,
    startAutoSync,
    stopAutoSync,
  };
};
