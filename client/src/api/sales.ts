import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  SaleOrder,
  SaleOrderQuery,
  CreateSaleOrderDto,
  SuspendedOrder,
  SuspendOrderDto,
  ListResponse,
} from '@shared/api.interface';

export async function createOrder(
  data: CreateSaleOrderDto,
): Promise<SaleOrder> {
  try {
    const response = await axiosForBackend.post('/api/sales/orders', data);
    return response.data;
  } catch (error) {
    logger.error('createOrder failed', error as Error);
    throw error;
  }
}

export async function getOrders(
  params: SaleOrderQuery,
): Promise<ListResponse<SaleOrder>> {
  try {
    const response = await axiosForBackend.get('/api/sales/orders', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getOrders failed', error as Error);
    throw error;
  }
}

export async function getOrderById(id: string): Promise<SaleOrder> {
  try {
    const response = await axiosForBackend.get(`/api/sales/orders/${id}`);
    return response.data;
  } catch (error) {
    logger.error('getOrderById failed', error as Error);
    throw error;
  }
}

export async function suspendOrder(data: SuspendOrderDto): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      '/api/sales/suspended-orders',
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('suspendOrder failed', error as Error);
    throw error;
  }
}

export async function getSuspendedOrders(): Promise<SuspendedOrder[]> {
  try {
    const response = await axiosForBackend.get(
      '/api/sales/suspended-orders',
    );
    return response.data;
  } catch (error) {
    logger.error('getSuspendedOrders failed', error as Error);
    throw error;
  }
}

export async function activateSuspendedOrder(
  id: string,
): Promise<SuspendedOrder> {
  try {
    const response = await axiosForBackend.post(
      `/api/sales/suspended-orders/${id}/activate`,
    );
    return response.data;
  } catch (error) {
    logger.error('activateSuspendedOrder failed', error as Error);
    throw error;
  }
}
