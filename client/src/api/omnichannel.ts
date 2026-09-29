import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  OmnichannelOrder,
  OmnichannelQuery,
  ShipOrderDto,
  ListResponse,
} from '@shared/api.interface';

export async function getOrderDetail(id: string): Promise<OmnichannelOrder> {
  try {
    const response = await axiosForBackend.get(`/api/omnichannel/orders/${id}`);
    return response.data;
  } catch (error) {
    logger.error('getOrderDetail failed', error as Error);
    throw error;
  }
}

export async function getOmnichannelOrders(
  params: OmnichannelQuery,
): Promise<ListResponse<OmnichannelOrder>> {
  try {
    const response = await axiosForBackend.get('/api/omnichannel/orders', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getOmnichannelOrders failed', error as Error);
    throw error;
  }
}

export async function shipOrder(
  id: string,
  data: ShipOrderDto,
): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      `/api/omnichannel/orders/${id}/ship`,
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('shipOrder failed', error as Error);
    throw error;
  }
}

export async function pickupOrder(id: string): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      `/api/omnichannel/orders/${id}/pickup`,
    );
    return response.data;
  } catch (error) {
    logger.error('pickupOrder failed', error as Error);
    throw error;
  }
}
