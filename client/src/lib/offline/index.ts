/**
 * Offline-First 核心层
 *
 * 模块组织：
 * - db.ts            IndexedDB 数据库封装
 * - network.ts       网络状态管理
 * - sync-engine.ts   同步引擎
 * - master-data-cache.ts  主数据缓存
 */

export {
  openDB,
  closeDB,
  STORE_NAMES,
  putMasterData,
  getMasterData,
  putOfflineOrder,
  getOfflineOrders,
  putOfflineReturn,
  putOfflineMember,
  putOfflineStockAdjust,
  putOfflineStocktake,
  putOfflineTransferRequest,
  putOfflineReceipt,
  putOfflineSuspended,
  getOfflineSuspended,
  removeOfflineSuspended,
  updateOfflineSyncStatus,
  getLocalStock,
  putLocalStockBatch,
  updateLocalStockDeduction,
  batchDeductLocalStock,
  getAllPendingItems,
  addSyncLog,
} from './db';

export type {
  SyncStatus,
  MasterDataRecord,
  OfflineEntityRecord,
  OfflineOrderRecord,
  OfflineReturnRecord,
  OfflineMemberRecord,
  OfflineStockAdjustRecord,
  OfflineStocktakeRecord,
  OfflineTransferRequestRecord,
  OfflineReceiptRecord,
  OfflineSuspendedRecord,
  LocalStockRecord,
  SyncLogRecord,
  PendingItem,
} from './db';

export { useNetworkStatus, isOnline } from './network';
export type { NetworkStatus } from './network';

export { SyncEngine, getSyncEngine, useSyncEngine } from './sync-engine';
export type {
  OfflineSyncResult,
  SyncBatchRequest,
  SyncBatchResponse,
  SyncEventName,
  SyncProgressEvent,
  SyncCompleteEvent,
  SyncConflictEvent,
  UseSyncEngineResult,
} from './sync-engine';

export { useMasterData, getSkuStock } from './master-data-cache';
export type {
  MasterDataState,
  StyleLite,
  SkuLite,
  MemberLite,
  ColorLite,
  SizeLite,
  PromotionLite,
  StoreLite,
  UseMasterDataResult,
  StockMatrixResult,
  CartItem,
  PromotionCalcResult,
} from './master-data-cache';
