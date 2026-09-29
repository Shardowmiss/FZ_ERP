import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  ReturnOrder,
  ReturnOrderQuery,
  CreateReturnOrderDto,
  SaleOrder,
  ListResponse,
} from '@shared/api.interface';

export async function getOriginalOrder(
  orderNo: string,
  phone?: string,
): Promise<SaleOrder> {
  try {
    const response = await axiosForBackend.get(
      '/api/returns/original-order',
      { params: { orderNo, phone } },
    );
    return response.data;
  } catch (error) {
    logger.error('getOriginalOrder failed', error as Error);
    throw error;
  }
}

export async function createReturn(
  data: CreateReturnOrderDto,
): Promise<ReturnOrder> {
  try {
    const response = await axiosForBackend.post('/api/returns/orders', data);
    return response.data;
  } catch (error) {
    logger.error('createReturn failed', error as Error);
    throw error;
  }
}

export async function getReturns(
  params: ReturnOrderQuery,
): Promise<ListResponse<ReturnOrder>> {
  try {
    const response = await axiosForBackend.get('/api/returns/orders', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getReturns failed', error as Error);
    throw error;
  }
}
