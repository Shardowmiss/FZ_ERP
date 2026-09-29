/**
 * IndexedDB 本地数据库封装
 * 数据库名: yuncaipos-offline
 * 版本: 1
 *
 * 所有数据按 storeId 隔离（门店维度）
 */

import { logger } from '@lark-apaas/client-toolkit/logger';
import { splitIntoChunks, DEFAULT_WRITE_CHUNK_SIZE as LOCAL_STOCK_CHUNK_SIZE } from './chunk';
import { SYNC_META_TYPE, type MasterDataCursor } from './sync-plan';

// ============ 常量 ============

const DB_NAME = 'yuncaipos-offline';
const DB_VERSION = 1;

/** Object Store 名称 */
export const STORE_NAMES = {
  MASTER_DATA: 'master_data',
  OFFLINE_ORDERS: 'offline_orders',
  OFFLINE_RETURNS: 'offline_returns',
  OFFLINE_MEMBERS: 'offline_members',
  OFFLINE_STOCK_ADJUST: 'offline_stock_adjust',
  OFFLINE_STOCKTAKES: 'offline_stocktakes',
  OFFLINE_TRANSFER_REQUESTS: 'offline_transfer_requests',
  OFFLINE_RECEIPTS: 'offline_receipts',
  OFFLINE_SUSPENDED: 'offline_suspended',
  LOCAL_STOCK: 'local_stock',
  SYNC_LOG: 'sync_log',
} as const;

/** 同步状态 */
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

// ============ 类型定义 ============

export interface MasterDataRecord {
  /** 数据类型: styles, skus, members, stock, colors, sizes, promotions, store */
  type: string;
  /** 门店ID */
  storeId: string;
  /** 数据内容 */
  data: unknown;
  /** 数据版本号 */
  version: string;
  /** 同步时间戳 */
  syncedAt: number;
}

export interface OfflineEntityRecord {
  /** 客户端唯一 ID */
  clientId: string;
  /** 门店 ID */
  storeId: string;
  /** 同步状态 */
  syncStatus: SyncStatus;
  /** 创建时间戳 */
  createdAt: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 同步错误信息 */
  errorMessage?: string;
  /** 服务端生成的实体 ID（同步成功后回填） */
  serverEntityId?: string;
  /** 重试次数 */
  retryCount?: number;
}

export interface OfflineOrderRecord extends OfflineEntityRecord {
  /** 销售单数据 */
  orderData: unknown;
}

export interface OfflineReturnRecord extends OfflineEntityRecord {
  /** 退货单数据 */
  returnData: unknown;
}

export interface OfflineMemberRecord extends OfflineEntityRecord {
  /** 会员数据 */
  memberData: unknown;
}

export interface OfflineStockAdjustRecord extends OfflineEntityRecord {
  /** 库存调整数据 */
  adjustData: unknown;
  /** 业务子类型: stocktake / transfer_request / receipt / adjust */
  entityType?: string;
}

export interface OfflineStocktakeRecord extends OfflineEntityRecord {
  /** 盘点单数据 */
  stocktakeData: unknown;
}

export interface OfflineTransferRequestRecord extends OfflineEntityRecord {
  /** 要货申请单数据 */
  requestData: unknown;
}

export interface OfflineReceiptRecord extends OfflineEntityRecord {
  /** 收货单数据 */
  receiptData: unknown;
}

export interface OfflineSuspendedRecord extends OfflineEntityRecord {
  /** 挂单数据 */
  orderData: unknown;
}

export interface LocalStockRecord {
  /** SKU ID */
  skuId: string;
  /** 门店 ID */
  storeId: string;
  /** 款式 ID */
  styleId: string;
  /** 颜色 ID */
  colorId: string;
  /** 尺码 ID */
  sizeId: string;
  /** 库存数量 */
  qty: number;
  /** 最后更新时间戳 */
  updatedAt: number;
}

export interface SyncLogRecord {
  /** 自增 ID */
  id?: number;
  /** 同步类型 */
  type: 'push' | 'pull';
  /** 实体类型 */
  entityType: string;
  /** 客户端 ID */
  clientId?: string;
  /** 同步结果 */
  status: 'success' | 'failed' | 'conflict';
  /** 错误信息 */
  errorMessage?: string;
  /** 同步时间戳 */
  timestamp: number;
}

export interface PendingItem<T = unknown> {
  entityType: string;
  clientId: string;
  entityData: T;
  storeId: string;
  retryCount: number;
}

// ============ 数据库实例管理 ============

let dbInstance: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

/**
 * 打开或创建 IndexedDB 数据库
 */
export const openDB = (): Promise<IDBDatabase> => {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (openPromise) {
    return openPromise;
  }

  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const request: IDBOpenDBRequest = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (): void => {
        const error = request.error?.message ?? 'Unknown IndexedDB error';
        logger.error(`[OfflineDB] Failed to open database: ${error}`);
        openPromise = null;
        reject(new Error(error));
      };

      request.onsuccess = (): void => {
        dbInstance = request.result;

        dbInstance.onversionchange = (): void => {
          dbInstance?.close();
          dbInstance = null;
          openPromise = null;
          logger.warn('[OfflineDB] Database version changed, connection closed');
        };

        dbInstance.onclose = (): void => {
          dbInstance = null;
          openPromise = null;
          logger.warn('[OfflineDB] Database connection closed');
        };

        resolve(dbInstance);
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent): void => {
        const db: IDBDatabase = (event.target as IDBOpenDBRequest).result;
        initStores(db);
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[OfflineDB] Open database exception: ${message}`);
      openPromise = null;
      reject(err);
    }
  });

  return openPromise;
};

/**
 * 初始化 Object Stores
 */
const initStores = (db: IDBDatabase): void => {
  // 主数据缓存
  if (!db.objectStoreNames.contains(STORE_NAMES.MASTER_DATA)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.MASTER_DATA, {
      keyPath: 'type',
    });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线销售单
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_ORDERS)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_ORDERS, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线退货单
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_RETURNS)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_RETURNS, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线新会员
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_MEMBERS)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_MEMBERS, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线库存调整
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_STOCK_ADJUST)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_STOCK_ADJUST, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线盘点单
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_STOCKTAKES)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_STOCKTAKES, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线要货申请单
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_TRANSFER_REQUESTS)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_TRANSFER_REQUESTS, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线收货单
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_RECEIPTS)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_RECEIPTS, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 离线挂单
  if (!db.objectStoreNames.contains(STORE_NAMES.OFFLINE_SUSPENDED)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.OFFLINE_SUSPENDED, {
      keyPath: 'clientId',
    });
    store.createIndex('by_createdAt', 'createdAt', { unique: false });
    store.createIndex('by_status', 'syncStatus', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 本地库存快照
  if (!db.objectStoreNames.contains(STORE_NAMES.LOCAL_STOCK)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.LOCAL_STOCK, {
      keyPath: 'skuId',
    });
    store.createIndex('by_styleId', 'styleId', { unique: false });
    store.createIndex('by_storeId', 'storeId', { unique: false });
  }

  // 同步日志
  if (!db.objectStoreNames.contains(STORE_NAMES.SYNC_LOG)) {
    const store: IDBObjectStore = db.createObjectStore(STORE_NAMES.SYNC_LOG, {
      keyPath: 'id',
      autoIncrement: true,
    });
    store.createIndex('by_timestamp', 'timestamp', { unique: false });
    store.createIndex('by_entityType', 'entityType', { unique: false });
  }
};

// ============ 通用工具 ============

/**
 * 在指定 store 上执行 put 操作
 */
const putRecord = async <T>(storeName: string, record: T): Promise<void> => {
  const db: IDBDatabase = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(storeName, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(storeName);
    const request: IDBRequest = store.put(record);

    request.onsuccess = (): void => resolve();
    request.onerror = (): void => {
      const error = request.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] putRecord ${storeName} failed: ${error}`);
      reject(new Error(error));
    };
    transaction.onerror = (): void => {
      const error = transaction.error?.message ?? 'Transaction error';
      logger.error(`[OfflineDB] Transaction error on ${storeName}: ${error}`);
      reject(new Error(error));
    };
  });
};

/**
 * 按 key 获取单条记录
 */
const getRecord = async <T>(storeName: string, key: string): Promise<T | undefined> => {
  const db: IDBDatabase = await openDB();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(storeName, 'readonly');
    const store: IDBObjectStore = transaction.objectStore(storeName);
    const request: IDBRequest = store.get(key);

    request.onsuccess = (): void => resolve(request.result as T | undefined);
    request.onerror = (): void => {
      const error = request.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] getRecord ${storeName}/${key} failed: ${error}`);
      reject(new Error(error));
    };
  });
};

/**
 * 按索引获取记录列表
 */
const getByIndex = async <T>(
  storeName: string,
  indexName: string,
  value: string | number,
): Promise<T[]> => {
  const db: IDBDatabase = await openDB();
  return new Promise<T[]>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(storeName, 'readonly');
    const store: IDBObjectStore = transaction.objectStore(storeName);
    const index: IDBIndex = store.index(indexName);
    const request: IDBRequest = index.getAll(IDBKeyRange.only(value));

    request.onsuccess = (): void => resolve((request.result as T[]) ?? []);
    request.onerror = (): void => {
      const error = request.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] getByIndex ${storeName}/${indexName} failed: ${error}`);
      reject(new Error(error));
    };
  });
};

/**
 * 获取 store 中所有记录
 */
const getAllRecords = async <T>(storeName: string): Promise<T[]> => {
  const db: IDBDatabase = await openDB();
  return new Promise<T[]>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(storeName, 'readonly');
    const store: IDBObjectStore = transaction.objectStore(storeName);
    const request: IDBRequest = store.getAll();

    request.onsuccess = (): void => resolve((request.result as T[]) ?? []);
    request.onerror = (): void => {
      const error = request.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] getAllRecords ${storeName} failed: ${error}`);
      reject(new Error(error));
    };
  });
};

/**
 * 删除记录
 */
const deleteRecord = async (storeName: string, key: string): Promise<void> => {
  const db: IDBDatabase = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(storeName, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(storeName);
    const request: IDBRequest = store.delete(key);

    request.onsuccess = (): void => resolve();
    request.onerror = (): void => {
      const error = request.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] deleteRecord ${storeName}/${key} failed: ${error}`);
      reject(new Error(error));
    };
  });
};

// ============ 主数据 ============

/**
 * 写入主数据缓存
 */
export const putMasterData = async (
  type: string,
  data: unknown,
  version: string,
  storeId: string,
): Promise<void> => {
  const record: MasterDataRecord = {
    type,
    storeId,
    data,
    version,
    syncedAt: Date.now(),
  };
  await putRecord(STORE_NAMES.MASTER_DATA, record);
};

/**
 * 读取主数据缓存
 */
export const getMasterData = async (type: string): Promise<MasterDataRecord | undefined> => {
  return getRecord<MasterDataRecord>(STORE_NAMES.MASTER_DATA, type);
};

/**
 * P-1 补：按 id 剔除主数据里的若干条目（消费服务端下发的删除通知）。
 *
 * 只在服务端给出的删除列表非空时调用——空列表/absent 表示「本轮无删除」，
 * 调用它反而会把本地数据清空，属于最严重的同步事故。
 */
export const deleteMasterData = async (
  type: string,
  ids: readonly string[],
): Promise<void> => {
  if (ids.length === 0) return;
  const record = await getRecord<MasterDataRecord>(STORE_NAMES.MASTER_DATA, type);
  if (!record || !Array.isArray(record.data)) return;

  const drop = new Set(ids.map(String));
  const next = (record.data as unknown[]).filter(
    (item) => typeof item === 'object' && item !== null && drop.has(String((item as { id?: unknown }).id ?? '')),
  );
  // 一条都没命中说明本地本就没有这些 id，不写回（避免无谓的 IO）
  if (next.length === (record.data as unknown[]).length) return;

  await putRecord(STORE_NAMES.MASTER_DATA, {
    ...record,
    data: next,
    syncedAt: Date.now(),
  });
};

/**
 * P-1 补：删除本地库存记录（stock 以 skuId 为键）。
 */
export const deleteLocalStock = async (skuIds: readonly string[]): Promise<void> => {
  if (skuIds.length === 0) return;
  if (skuIds.some((id) => !id)) {
    logger.warn('[OfflineDB] deleteLocalStock 收到空 skuId，已跳过');
    return;
  }
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(STORE_NAMES.LOCAL_STOCK, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(STORE_NAMES.LOCAL_STOCK);

    let completed = 0;
    for (const skuId of skuIds) {
      const request: IDBRequest = store.delete(skuId);
      request.onsuccess = (): void => {
        completed += 1;
        if (completed === skuIds.length) resolve();
      };
      request.onerror = (): void => {
        reject(new Error(request.error?.message ?? 'delete failed'));
      };
    }

    if (skuIds.length === 0) resolve();
    transaction.onabort = (): void => reject(new Error('Transaction aborted'));
    transaction.onerror = (): void =>
      reject(new Error(transaction.error?.message ?? 'Transaction error'));
  });
};

// ============ 主数据同步游标（P-1 增量同步） ============

/**
 * master_data store 里专门存放同步游标的记录。
 * 复用 master_data 而非新建 store，避免为一条元数据引入一次 IndexedDB 版本升级
 * （版本升级在低配安卓机上出现过连接失败，见 onupgradeneeded 无版本迁移的写法）。
 */
export interface SyncCursorRecord extends MasterDataRecord {
  type: typeof SYNC_META_TYPE;
  data: MasterDataCursor;
}

/**
 * 读取本店的增量同步游标。
 * @returns 从未同步过时返回 null（调用方据此走全量）
 */
export const getSyncCursor = async (storeId: string): Promise<MasterDataCursor | null> => {
  try {
    const record = await getRecord<SyncCursorRecord>(
      STORE_NAMES.MASTER_DATA,
      SYNC_META_TYPE,
    );
    if (!record || record.storeId !== storeId) return null;
    const cursor = record.data;
    if (!cursor || typeof cursor.since !== 'string' || !cursor.since) return null;
    return cursor;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[OfflineDB] getSyncCursor failed: ${message}`);
    return null;
  }
};

/**
 * 持久化增量同步游标。
 * 只在「增量已成功落库」后调用——若拉取失败却推进了游标，这段时间的变更会被永久跳过。
 */
export const putSyncCursor = async (
  storeId: string,
  cursor: MasterDataCursor,
): Promise<void> => {
  const record: SyncCursorRecord = {
    type: SYNC_META_TYPE,
    storeId,
    data: cursor,
    version: '',
    syncedAt: Date.now(),
  };
  await putRecord(STORE_NAMES.MASTER_DATA, record);
};

// ============ 离线销售单 ============

/**
 * 写入离线销售单
 */
export const putOfflineOrder = async (
  order: Omit<OfflineOrderRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineOrderRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineOrderRecord = {
    ...order,
    syncStatus: order.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_ORDERS, record);
};

/**
 * 获取离线销售单列表
 * @param status 可选，按同步状态过滤
 */
export const getOfflineOrders = async (status?: string): Promise<OfflineOrderRecord[]> => {
  if (status) {
    return getByIndex<OfflineOrderRecord>(STORE_NAMES.OFFLINE_ORDERS, 'by_status', status);
  }
  return getAllRecords<OfflineOrderRecord>(STORE_NAMES.OFFLINE_ORDERS);
};

// ============ 离线退货单 ============

/**
 * 写入离线退货单
 */
export const putOfflineReturn = async (
  ret: Omit<OfflineReturnRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineReturnRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineReturnRecord = {
    ...ret,
    syncStatus: ret.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_RETURNS, record);
};

/**
 * 读取全部离线退货单（用于退换货页"退货记录"在离线模式下刷新不丢）
 */
export const getOfflineReturns = async (): Promise<OfflineReturnRecord[]> => {
  const db: IDBDatabase = await openDB();
  return new Promise<OfflineReturnRecord[]>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(STORE_NAMES.OFFLINE_RETURNS, 'readonly');
    const store: IDBObjectStore = transaction.objectStore(STORE_NAMES.OFFLINE_RETURNS);
    const request: IDBRequest = store.getAll();
    request.onsuccess = (): void => {
      resolve((request.result as OfflineReturnRecord[]) ?? []);
    };
    request.onerror = (): void => {
      const error = request.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] getOfflineReturns failed: ${error}`);
      reject(new Error(error));
    };
  });
};

// ============ 离线新会员 ============

/**
 * 写入离线新会员
 */
export const putOfflineMember = async (
  member: Omit<OfflineMemberRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineMemberRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineMemberRecord = {
    ...member,
    syncStatus: member.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_MEMBERS, record);
};

// ============ 离线库存调整 ============

/**
 * 写入离线库存调整
 */
export const putOfflineStockAdjust = async (
  adj: Omit<OfflineStockAdjustRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineStockAdjustRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineStockAdjustRecord = {
    ...adj,
    syncStatus: adj.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_STOCK_ADJUST, record);
};

// ============ 离线盘点单 ============

/**
 * 写入离线盘点单
 */
export const putOfflineStocktake = async (
  st: Omit<OfflineStocktakeRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineStocktakeRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineStocktakeRecord = {
    ...st,
    syncStatus: st.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_STOCKTAKES, record);
};

// ============ 离线要货申请单 ============

/**
 * 写入离线要货申请单
 */
export const putOfflineTransferRequest = async (
  req: Omit<OfflineTransferRequestRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineTransferRequestRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineTransferRequestRecord = {
    ...req,
    syncStatus: req.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_TRANSFER_REQUESTS, record);
};

// ============ 离线收货单 ============

/**
 * 写入离线收货单
 */
export const putOfflineReceipt = async (
  rec: Omit<OfflineReceiptRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineReceiptRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineReceiptRecord = {
    ...rec,
    syncStatus: rec.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_RECEIPTS, record);
};

// ============ 离线挂单 ============

/**
 * 写入离线挂单
 */
export const putOfflineSuspended = async (
  order: Omit<OfflineSuspendedRecord, 'createdAt' | 'updatedAt' | 'syncStatus'> &
    Partial<Pick<OfflineSuspendedRecord, 'syncStatus'>>,
): Promise<void> => {
  const now: number = Date.now();
  const record: OfflineSuspendedRecord = {
    ...order,
    syncStatus: order.syncStatus ?? 'pending',
    createdAt: now,
    updatedAt: now,
  };
  await putRecord(STORE_NAMES.OFFLINE_SUSPENDED, record);
};

/**
 * 获取所有离线挂单
 */
export const getOfflineSuspended = async (): Promise<OfflineSuspendedRecord[]> => {
  const records: OfflineSuspendedRecord[] =
    await getAllRecords<OfflineSuspendedRecord>(STORE_NAMES.OFFLINE_SUSPENDED);
  return records.sort((a: OfflineSuspendedRecord, b: OfflineSuspendedRecord) =>
    b.createdAt - a.createdAt,
  );
};

/**
 * 删除离线挂单（取单后移除）
 */
export const removeOfflineSuspended = async (clientId: string): Promise<void> => {
  await deleteRecord(STORE_NAMES.OFFLINE_SUSPENDED, clientId);
};

// ============ 同步状态更新 ============

/**
 * 更新离线记录的同步状态
 */
export const updateOfflineSyncStatus = async (
  clientId: string,
  storeName: string,
  status: SyncStatus,
  errorMessage?: string,
  serverEntityId?: string,
): Promise<void> => {
  const db: IDBDatabase = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(storeName, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(storeName);
    const getRequest: IDBRequest = store.get(clientId);

    getRequest.onsuccess = (): void => {
      const record = getRequest.result;
      if (!record) {
        reject(new Error(`Record ${clientId} not found in ${storeName}`));
        return;
      }
      const updated = {
        ...record,
        syncStatus: status,
        updatedAt: Date.now(),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
        ...(serverEntityId !== undefined ? { serverEntityId } : {}),
        ...(status === 'failed'
          ? { retryCount: (record.retryCount ?? 0) + 1 }
          : {}),
      };
      const putRequest: IDBRequest = store.put(updated);
      putRequest.onsuccess = (): void => resolve();
      putRequest.onerror = (): void => {
        const error = putRequest.error?.message ?? 'Unknown error';
        reject(new Error(error));
      };
    };

    getRequest.onerror = (): void => {
      const error = getRequest.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] updateOfflineSyncStatus get failed: ${error}`);
      reject(new Error(error));
    };
  });
};

// ============ 本地库存 ============

/**
 * 获取本地单个 SKU 库存
 */
export const getLocalStock = async (skuId: string): Promise<LocalStockRecord | undefined> => {
  return getRecord<LocalStockRecord>(STORE_NAMES.LOCAL_STOCK, skuId);
};

/**
 * 批量写入本地库存快照（全量替换）
 */
/**
 * P-2：库存本地写入分片大小。
 * 全量同步时 SKU×门店可达 10 万级。此前把全部记录塞进【单个】readwrite 事务，
 * 低配安卓机上会长时间占用 IndexedDB 线程并阻塞 UI（表现为白屏/无响应）。
 * 现按 CHUNK 切分为多个短事务，批次之间让出事件循环，使界面有机会重绘。
 */
/** 按分片大小拆解记录数组（见 chunk.ts 说明） */
const chunkRecords = <T,>(items: readonly T[]): T[][] => splitIntoChunks(items, LOCAL_STOCK_CHUNK_SIZE);

/** 单批写入：一个 readwrite 事务 + 该批内逐条 put，全部成功后 resolve */
const putLocalStockChunk = async (
  db: IDBDatabase,
  chunk: LocalStockRecord[],
  now: number,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(STORE_NAMES.LOCAL_STOCK, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(STORE_NAMES.LOCAL_STOCK);

    let completed = 0;
    let hasError = false;

    for (const item of chunk) {
      const record: LocalStockRecord = {
        ...item,
        // P-1：取「拉取时间」与「记录自带 updatedAt」的较大值。
        // 此前无条件写成拉取时间，会把离线扣减产生的本地时间戳抹平，
        // 使 updatedAt 完全丧失时序意义（增量同步、本地合并都依赖它）。
        updatedAt: Math.max(now, item.updatedAt ?? 0),
      };
      const request: IDBRequest = store.put(record);
      request.onsuccess = (): void => {
        completed += 1;
        if (completed === chunk.length && !hasError) {
          resolve();
        }
      };
      request.onerror = (): void => {
        if (!hasError) {
          hasError = true;
          const error = request.error?.message ?? 'Unknown error';
          logger.error(`[OfflineDB] putLocalStockBatch item failed: ${error}`);
          reject(new Error(error));
        }
      };
    }

    if (chunk.length === 0) {
      resolve();
      return;
    }

    transaction.onabort = (): void => {
      if (!hasError) {
        hasError = true;
        reject(new Error('Transaction aborted'));
      }
    };

    transaction.onerror = (): void => {
      const error = transaction.error?.message ?? 'Transaction error';
      if (!hasError) {
        hasError = true;
        reject(new Error(error));
      }
    };
  });
};

export const putLocalStockBatch = async (items: LocalStockRecord[]): Promise<void> => {
  if (items.length === 0) return;

  const db: IDBDatabase = await openDB();
  const now: number = Date.now();
  const chunks = chunkRecords(items);

  for (let ci = 0; ci < chunks.length; ci += 1) {
    await putLocalStockChunk(db, chunks[ci], now);
    // 批次间让出事件循环：避免长任务阻塞 UI（低配安卓机白屏的根因）
    await new Promise<void>((r) => setTimeout(r, 0));
    if (ci < chunks.length - 1) {
      logger.debug?.(
        `[OfflineDB] putLocalStockBatch progress ${chunks.slice(0, ci + 1).reduce((s, c) => s + c.length, 0)}/${items.length}`,
      );
    }
  }
};

/**
 * 按门店 ID 获取所有本地库存记录
 */
export const getLocalStockByStoreId = async (storeId: string): Promise<LocalStockRecord[]> => {
  return getByIndex<LocalStockRecord>(STORE_NAMES.LOCAL_STOCK, 'by_storeId', storeId);
};

/**
 * 按款式 ID 获取本地库存记录
 */
export const getLocalStockByStyle = async (styleId: string): Promise<LocalStockRecord[]> => {
  return getByIndex<LocalStockRecord>(STORE_NAMES.LOCAL_STOCK, 'by_styleId', styleId);
};

/**
 * 原子扣减本地库存
 * @returns 是否扣减成功（库存不足返回 false）
 */
export const updateLocalStockDeduction = async (
  skuId: string,
  qty: number,
): Promise<boolean> => {
  const db: IDBDatabase = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(STORE_NAMES.LOCAL_STOCK, 'readwrite');
    const stockStore: IDBObjectStore = transaction.objectStore(STORE_NAMES.LOCAL_STOCK);
    const getRequest: IDBRequest = stockStore.get(skuId);

    getRequest.onsuccess = (): void => {
      const record: LocalStockRecord | undefined = getRequest.result as
        | LocalStockRecord
        | undefined;
      if (!record) {
        // 库存记录不存在，视为失败
        resolve(false);
        return;
      }
      if (record.qty < qty) {
        // 库存不足
        resolve(false);
        return;
      }
      const updated: LocalStockRecord = {
        ...record,
        qty: record.qty - qty,
        updatedAt: Date.now(),
      };
      const putRequest: IDBRequest = stockStore.put(updated);
      putRequest.onsuccess = (): void => resolve(true);
      putRequest.onerror = (): void => {
        const error = putRequest.error?.message ?? 'Unknown error';
        logger.error(`[OfflineDB] updateLocalStockDeduction put failed: ${error}`);
        reject(new Error(error));
      };
    };

    getRequest.onerror = (): void => {
      const error = getRequest.error?.message ?? 'Unknown error';
      logger.error(`[OfflineDB] updateLocalStockDeduction get failed: ${error}`);
      reject(new Error(error));
    };
  });
};

/**
 * 批量扣减本地库存（事务内原子操作）
 * @returns 全部成功返回 true，任一 SKU 不足返回 false（全部回滚）
 */
export const batchDeductLocalStock = async (
  items: Array<{ skuId: string; qty: number }>,
): Promise<boolean> => {
  const db: IDBDatabase = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(STORE_NAMES.LOCAL_STOCK, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(STORE_NAMES.LOCAL_STOCK);

    const stockMap = new Map<string, LocalStockRecord>();
    let allSufficient = true;
    let getCompleted = 0;

    const doUpdate = (): void => {
      if (!allSufficient) {
        transaction.abort();
        resolve(false);
        return;
      }
      let putCompleted = 0;
      const stockMapSize = stockMap.size;
      for (const [skuId, record] of stockMap) {
        const item = items.find((it) => it.skuId === skuId);
        if (!item) continue;
        const updated: LocalStockRecord = {
          ...record,
          qty: record.qty - item.qty,
          updatedAt: Date.now(),
        };
        const putRequest: IDBRequest = store.put(updated);
        putRequest.onsuccess = (): void => {
          putCompleted += 1;
          if (putCompleted === stockMapSize) {
            resolve(true);
          }
        };
        putRequest.onerror = (): void => {
          const error = putRequest.error?.message ?? 'Unknown error';
          logger.error(`[OfflineDB] batchDeductLocalStock put failed: ${error}`);
          reject(new Error(error));
        };
      }
    };

    for (const item of items) {
      const getRequest: IDBRequest = store.get(item.skuId);
      getRequest.onsuccess = (): void => {
        const record: LocalStockRecord | undefined = getRequest.result as
          | LocalStockRecord
          | undefined;
        if (!record || record.qty < item.qty) {
          allSufficient = false;
        } else {
          stockMap.set(item.skuId, record);
        }
        getCompleted += 1;
        if (getCompleted === items.length) {
          doUpdate();
        }
      };
      getRequest.onerror = (): void => {
        const error = getRequest.error?.message ?? 'Unknown error';
        logger.error(`[OfflineDB] batchDeductLocalStock get failed: ${error}`);
        reject(new Error(error));
      };
    }

    if (items.length === 0) {
      resolve(true);
    }
  });
};

/**
 * 批量回补本地库存（用于离线下单写库失败时的回滚）
 * 与 batchDeductLocalStock 配对：扣减成功后若订单写入失败，需把库存加回来，
 * 否则会出现"库存被永久扣减但订单没生成"的本地库存泄漏。
 */
export const batchAddLocalStock = async (
  items: Array<{ skuId: string; qty: number }>,
): Promise<void> => {
  if (items.length === 0) return;
  const db: IDBDatabase = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction: IDBTransaction = db.transaction(STORE_NAMES.LOCAL_STOCK, 'readwrite');
    const store: IDBObjectStore = transaction.objectStore(STORE_NAMES.LOCAL_STOCK);
    let completed = 0;

    for (const item of items) {
      const getRequest: IDBRequest = store.get(item.skuId);
      getRequest.onsuccess = (): void => {
        const record = getRequest.result as LocalStockRecord | undefined;
        const updated: LocalStockRecord = record
          ? { ...record, qty: record.qty + item.qty, updatedAt: Date.now() }
          : {
              skuId: item.skuId,
              storeId: '',
              styleId: '',
              colorId: '',
              sizeId: '',
              qty: item.qty,
              updatedAt: Date.now(),
            };
        const putRequest: IDBRequest = store.put(updated);
        putRequest.onsuccess = (): void => {
          completed += 1;
          if (completed === items.length) resolve();
        };
        putRequest.onerror = (): void => {
          const error = putRequest.error?.message ?? 'Unknown error';
          logger.error(`[OfflineDB] batchAddLocalStock put failed: ${error}`);
          reject(new Error(error));
        };
      };
      getRequest.onerror = (): void => {
        const error = getRequest.error?.message ?? 'Unknown error';
        logger.error(`[OfflineDB] batchAddLocalStock get failed: ${error}`);
        reject(new Error(error));
      };
    }
  });
};

// ============ 待同步项聚合 ============

/**
 * 获取所有 pending 状态的待同步项（跨所有实体类型）
 */
export const getAllPendingItems = async (): Promise<PendingItem[]> => {
  const [orders, returns, members, stockAdjusts, stocktakes, transferReqs, receipts]: [
    OfflineOrderRecord[],
    OfflineReturnRecord[],
    OfflineMemberRecord[],
    OfflineStockAdjustRecord[],
    OfflineStocktakeRecord[],
    OfflineTransferRequestRecord[],
    OfflineReceiptRecord[],
  ] = await Promise.all([
    getByIndex<OfflineOrderRecord>(STORE_NAMES.OFFLINE_ORDERS, 'by_status', 'pending'),
    getByIndex<OfflineReturnRecord>(STORE_NAMES.OFFLINE_RETURNS, 'by_status', 'pending'),
    getByIndex<OfflineMemberRecord>(STORE_NAMES.OFFLINE_MEMBERS, 'by_status', 'pending'),
    getByIndex<OfflineStockAdjustRecord>(
      STORE_NAMES.OFFLINE_STOCK_ADJUST,
      'by_status',
      'pending',
    ),
    getByIndex<OfflineStocktakeRecord>(
      STORE_NAMES.OFFLINE_STOCKTAKES,
      'by_status',
      'pending',
    ),
    getByIndex<OfflineTransferRequestRecord>(
      STORE_NAMES.OFFLINE_TRANSFER_REQUESTS,
      'by_status',
      'pending',
    ),
    getByIndex<OfflineReceiptRecord>(
      STORE_NAMES.OFFLINE_RECEIPTS,
      'by_status',
      'pending',
    ),
  ]);

  const results: PendingItem[] = [];

  for (const order of orders) {
    results.push({
      entityType: 'order',
      clientId: order.clientId,
      entityData: order.orderData,
      storeId: order.storeId,
      retryCount: order.retryCount ?? 0,
    });
  }

  for (const ret of returns) {
    results.push({
      entityType: 'return',
      clientId: ret.clientId,
      entityData: ret.returnData,
      storeId: ret.storeId,
      retryCount: ret.retryCount ?? 0,
    });
  }

  for (const member of members) {
    results.push({
      entityType: 'member',
      clientId: member.clientId,
      entityData: member.memberData,
      storeId: member.storeId,
      retryCount: member.retryCount ?? 0,
    });
  }

  for (const adj of stockAdjusts) {
    results.push({
      entityType: 'stockAdjust',
      clientId: adj.clientId,
      entityData: adj.adjustData,
      storeId: adj.storeId,
      retryCount: adj.retryCount ?? 0,
    });
  }

  for (const st of stocktakes) {
    results.push({
      entityType: 'stocktake',
      clientId: st.clientId,
      entityData: st.stocktakeData,
      storeId: st.storeId,
      retryCount: st.retryCount ?? 0,
    });
  }

  for (const req of transferReqs) {
    results.push({
      entityType: 'transferRequest',
      clientId: req.clientId,
      entityData: req.requestData,
      storeId: req.storeId,
      retryCount: req.retryCount ?? 0,
    });
  }

  for (const rec of receipts) {
    results.push({
      entityType: 'receipt',
      clientId: rec.clientId,
      entityData: rec.receiptData,
      storeId: rec.storeId,
      retryCount: rec.retryCount ?? 0,
    });
  }

  // 按创建时间升序（先创建的先同步）
  return results.sort((a: PendingItem, b: PendingItem) => {
    // 由于不同 store 无统一 createdAt，用 clientId 中的时间戳排序
    const aTime = Number(a.clientId.split('_')[1]) ?? 0;
    const bTime = Number(b.clientId.split('_')[1]) ?? 0;
    return aTime - bTime;
  });
};

// ============ 死信 / 待处理工作台（P1-4） ============

/** 实体类型 -> 记录中承载业务数据的字段名 */
const ENTITY_DATA_KEY: Record<string, string> = {
  order: 'orderData',
  return: 'returnData',
  member: 'memberData',
  stockAdjust: 'adjustData',
  stocktake: 'stocktakeData',
  transferRequest: 'requestData',
  receipt: 'receiptData',
};

/** 所有离线实体 store 与其内部 entityType 的映射 */
const ENTITY_STORE_DEFS: Array<[string, string]> = [
  ['order', STORE_NAMES.OFFLINE_ORDERS],
  ['return', STORE_NAMES.OFFLINE_RETURNS],
  ['member', STORE_NAMES.OFFLINE_MEMBERS],
  ['stockAdjust', STORE_NAMES.OFFLINE_STOCK_ADJUST],
  ['stocktake', STORE_NAMES.OFFLINE_STOCKTAKES],
  ['transferRequest', STORE_NAMES.OFFLINE_TRANSFER_REQUESTS],
  ['receipt', STORE_NAMES.OFFLINE_RECEIPTS],
];

/**
 * 获取指定同步状态的所有离线项（跨所有实体类型）
 * 例如 getAllItemsByStatus('failed') 用于「待处理 / 死信」工作台
 */
export const getAllItemsByStatus = async (status: SyncStatus): Promise<PendingItem[]> => {
  const results: PendingItem[] = [];
  for (const [entityType, storeName] of ENTITY_STORE_DEFS) {
    const records = await getByIndex<OfflineEntityRecord>(storeName, 'by_status', status);
    for (const r of records) {
      const dataKey = ENTITY_DATA_KEY[entityType];
      results.push({
        entityType,
        clientId: r.clientId,
        entityData: (r as unknown as Record<string, unknown>)[dataKey],
        storeId: r.storeId,
        retryCount: r.retryCount ?? 0,
      });
    }
  }
  return results;
};

/**
 * 将指定项重置为 pending 并清零重试次数（人工核对/改单后重提）
 */
export const resetItemForRetry = async (
  clientId: string,
  entityType: string,
): Promise<void> => {
  const storeName = ENTITY_STORE_DEFS.find(([type]) => type === entityType)?.[1];
  if (!storeName) {
    throw new Error(`未知的实体类型: ${entityType}`);
  }
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const getReq = store.get(clientId);
    getReq.onsuccess = (): void => {
      const record = getReq.result as OfflineEntityRecord | undefined;
      if (!record) {
        reject(new Error(`记录不存在: ${clientId}`));
        return;
      }
      const putReq = store.put({
        ...record,
        syncStatus: 'pending',
        retryCount: 0,
        errorMessage: undefined,
        updatedAt: Date.now(),
      });
      putReq.onsuccess = (): void => resolve();
      putReq.onerror = (): void =>
        reject(new Error(putReq.error?.message ?? 'resetItemForRetry put 失败'));
    };
    getReq.onerror = (): void =>
      reject(new Error(getReq.error?.message ?? 'resetItemForRetry get 失败'));
  });
};

// ============ 同步日志 ============

/**
 * 写入同步日志
 */
export const addSyncLog = async (log: Omit<SyncLogRecord, 'id'>): Promise<void> => {
  await putRecord(STORE_NAMES.SYNC_LOG, log);
};

/**
 * 关闭数据库连接（主要用于测试）
 */
export const closeDB = (): void => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    openPromise = null;
  }
};
