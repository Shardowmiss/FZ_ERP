import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  ErpSyncStatus,
  ErpConnectionStatus,
  SyncLog,
  SyncLogQuery,
  ListResponse,
} from '@shared/api.interface';

export async function getStatus(): Promise<ErpConnectionStatus> {
  try {
    const response = await axiosForBackend.get('/api/erp-integration/status');
    return response.data;
  } catch (error) {
    logger.error('getStatus failed', error as Error);
    throw error;
  }
}

export async function toggleConnection(online: boolean): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      '/api/erp-integration/toggle',
      { online },
    );
    return response.data;
  } catch (error) {
    logger.error('toggleConnection failed', error as Error);
    throw error;
  }
}

export async function getDownstreamSyncStatus(): Promise<ErpSyncStatus[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/erp-integration/downstream',
    );
    return response.data;
  } catch (error) {
    logger.error('getDownstreamSyncStatus failed', error as Error);
    throw error;
  }
}

export async function syncDownstream(type: string): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      `/api/erp-integration/downstream/${type}/sync`,
    );
    return response.data;
  } catch (error) {
    logger.error('syncDownstream failed', error as Error);
    throw error;
  }
}

export async function getUpstreamSyncStatus(): Promise<ErpSyncStatus[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/erp-integration/upstream',
    );
    return response.data;
  } catch (error) {
    logger.error('getUpstreamSyncStatus failed', error as Error);
    throw error;
  }
}

export async function retryUpstream(): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      '/api/erp-integration/upstream/retry',
    );
    return response.data;
  } catch (error) {
    logger.error('retryUpstream failed', error as Error);
    throw error;
  }
}

export async function getSyncLogs(
  params: SyncLogQuery,
): Promise<ListResponse<SyncLog>> {
  try {
    const response = await axiosForBackend.get(
      '/api/erp-integration/logs',
      { params },
    );
    return response.data;
  } catch (error) {
    logger.error('getSyncLogs failed', error as Error);
    throw error;
  }
}

export async function initialSync(): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      '/api/erp-integration/initial-sync',
    );
    return response.data;
  } catch (error) {
    logger.error('initialSync failed', error as Error);
    throw error;
  }
}
