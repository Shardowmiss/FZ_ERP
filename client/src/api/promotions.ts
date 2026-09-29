import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  Promotion,
  PromotionQuery,
  CalculatePromotionDto,
  PromotionCalculateResult,
  ListResponse,
} from '@shared/api.interface';

export async function getPromotions(
  params: PromotionQuery,
): Promise<ListResponse<Promotion>> {
  try {
    const response = await axiosForBackend.get('/api/promotions', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getPromotions failed', error as Error);
    throw error;
  }
}

export async function getPromotionById(id: string): Promise<Promotion> {
  try {
    const response = await axiosForBackend.get(
      `/api/promotions/${id}`,
    );
    return response.data;
  } catch (error) {
    logger.error('getPromotionById failed', error as Error);
    throw error;
  }
}

export async function calculatePromotions(
  data: CalculatePromotionDto,
): Promise<PromotionCalculateResult> {
  try {
    const response = await axiosForBackend.post(
      '/api/promotions/calculate',
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('calculatePromotions failed', error as Error);
    throw error;
  }
}
