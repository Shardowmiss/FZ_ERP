import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { ListResponse } from '@shared/api.interface';

/**
 * 离线同步相关 API
 *
 * 注意：当前后端接口尚未实现，本文件作为 API 契约占位，
 * 所有方法会 fallback 到本地 mock 数据。待后端完成后替换实现即可。
 */

export interface OfflineQueueItem {
  id: string;
  tempNo: string;
  type: 'sale' | 'return' | 'suspend' | 'inventory' | 'member' | 'stocktake' | 'transfer_request' | 'receipt' | 'stock_adjust';
  typeName: string;
  amount: number;
  payMethod?: string;
  createdAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';
  retryCount: number;
  errorMsg?: string;
  conflictType?: string;
  entityData?: Record<string, unknown>;
  clientId?: string;
}

export interface OfflineQueueQuery {
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}

export interface MasterDataVersion {
  lastSyncAt: string;
  version: string;
  styleCount: number;
  skuCount: number;
  memberCount: number;
}

const MOCK_QUEUE: OfflineQueueItem[] = [
  {
    id: 'off_001',
    tempNo: 'LX202609170001',
    type: 'sale',
    typeName: '销售单',
    amount: 1288.0,
    createdAt: '2026-09-17T10:12:00',
    status: 'pending',
    retryCount: 0,
  },
  {
    id: 'off_002',
    tempNo: 'LX202609170002',
    type: 'sale',
    typeName: '销售单',
    amount: 569.0,
    createdAt: '2026-09-17T09:55:00',
    status: 'failed',
    retryCount: 2,
    errorMsg: 'ERP 返回：单据号重复，请检查本地单号规则',
  },
  {
    id: 'off_003',
    tempNo: 'LX202609170003',
    type: 'return',
    typeName: '退货单',
    amount: -299.0,
    createdAt: '2026-09-17T09:40:00',
    status: 'conflict',
    retryCount: 1,
    errorMsg: '原单已被其他门店退货，库存扣减冲突',
  },
  {
    id: 'off_004',
    tempNo: 'LX202609170004',
    type: 'sale',
    typeName: '销售单',
    amount: 2156.0,
    createdAt: '2026-09-17T09:25:00',
    status: 'synced',
    retryCount: 0,
  },
  {
    id: 'off_005',
    tempNo: 'LX202609170005',
    type: 'member',
    typeName: '会员注册',
    amount: 0,
    createdAt: '2026-09-17T09:10:00',
    status: 'synced',
    retryCount: 0,
  },
];

export async function getOfflineQueue(
  params: OfflineQueueQuery = {},
): Promise<ListResponse<OfflineQueueItem>> {
  // TODO: 替换为真实后端接口
  // const response = await axiosForBackend.get('/api/offline/queue', { params });
  // return response.data;
  try {
    const response = await axiosForBackend.get('/api/offline/queue', { params });
    return response.data;
  } catch (error) {
    logger.warn('offline queue API not available, using mock', error as Error);
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 20;
    const filtered = MOCK_QUEUE.filter((item) => {
      if (params.status && item.status !== params.status) return false;
      if (params.type && item.type !== params.type) return false;
      return true;
    });
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
    };
  }
}

export async function syncAllOffline(): Promise<void> {
  try {
    await axiosForBackend.post('/api/offline/sync-all');
  } catch (error) {
    logger.warn('syncAllOffline API not available, mock only', error as Error);
  }
}

export async function retryOfflineItem(id: string): Promise<void> {
  try {
    await axiosForBackend.post(`/api/offline/queue/${id}/retry`);
  } catch (error) {
    logger.warn('retryOfflineItem API not available, mock only', error as Error);
  }
}

export async function getMasterDataVersion(): Promise<MasterDataVersion> {
  try {
    const response = await axiosForBackend.get('/api/offline/master-version');
    return response.data;
  } catch (error) {
    logger.warn('master version API not available, using mock', error as Error);
    return {
      lastSyncAt: '2026-09-17 08:30:00',
      version: 'v2026.09.17-01',
      styleCount: 1286,
      skuCount: 9642,
      memberCount: 5238,
    };
  }
}

export async function syncMasterData(): Promise<void> {
  try {
    await axiosForBackend.post('/api/offline/sync-master');
  } catch (error) {
    logger.warn('syncMasterData API not available, mock only', error as Error);
  }
}
