import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type { StockMatrix, Stock, StockAdjustDto } from '@shared/api.interface';

export async function getStockMatrix(
  styleId: string,
  storeId?: string,
): Promise<StockMatrix> {
  try {
    const response = await axiosForBackend.get(
      `/api/stock/matrix/${styleId}`,
      { params: storeId ? { storeId } : {} },
    );
    return response.data;
  } catch (error) {
    logger.error('getStockMatrix failed', error as Error);
    throw error;
  }
}

export async function getLowStockItems(): Promise<Stock[]> {
  try {
    const response = await axiosForBackend.get('/api/stock/low-stock');
    return response.data;
  } catch (error) {
    logger.error('getLowStockItems failed', error as Error);
    throw error;
  }
}

export async function adjustStock(data: StockAdjustDto): Promise<void> {
  try {
    const response = await axiosForBackend.post('/api/stock/adjust', data);
    return response.data;
  } catch (error) {
    logger.error('adjustStock failed', error as Error);
    throw error;
  }
}
