import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  Store,
  Employee,
  EmployeeQuery,
  PaymentMethod,
  PointsRule,
  OperationLog,
  OperationLogQuery,
  ListResponse,
} from '@shared/api.interface';

export async function getStoreInfo(): Promise<Store> {
  try {
    const response = await axiosForBackend.get('/api/settings/store');
    return response.data;
  } catch (error) {
    logger.error('getStoreInfo failed', error as Error);
    throw error;
  }
}

export async function getEmployees(
  params: EmployeeQuery,
): Promise<ListResponse<Employee>> {
  try {
    const response = await axiosForBackend.get('/api/settings/employees', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getEmployees failed', error as Error);
    throw error;
  }
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/settings/payment-methods',
    );
    return response.data;
  } catch (error) {
    logger.error('getPaymentMethods failed', error as Error);
    throw error;
  }
}

export async function getPointsRules(): Promise<PointsRule[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/settings/points-rules',
    );
    return response.data;
  } catch (error) {
    logger.error('getPointsRules failed', error as Error);
    throw error;
  }
}

export async function getOpLogs(
  params: OperationLogQuery,
): Promise<ListResponse<OperationLog>> {
  try {
    const response = await axiosForBackend.get('/api/settings/op-logs', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getOpLogs failed', error as Error);
    throw error;
  }
}
