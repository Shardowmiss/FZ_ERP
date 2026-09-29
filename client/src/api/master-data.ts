import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  Color,
  Size,
  Style,
  Sku,
  StyleQuery,
  ListResponse,
} from '@shared/api.interface';

export async function getColors(): Promise<Color[]> {
  try {
    const response = await axiosForBackend.get('/api/master-data/colors');
    return response.data;
  } catch (error) {
    logger.error('getColors failed', error as Error);
    throw error;
  }
}

export async function getSizes(): Promise<Size[]> {
  try {
    const response = await axiosForBackend.get('/api/master-data/sizes');
    return response.data;
  } catch (error) {
    logger.error('getSizes failed', error as Error);
    throw error;
  }
}

export async function getStyles(
  params: StyleQuery,
): Promise<ListResponse<Style>> {
  try {
    const response = await axiosForBackend.get('/api/master-data/styles', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getStyles failed', error as Error);
    throw error;
  }
}

export async function getStyleById(id: string): Promise<Style> {
  try {
    const response = await axiosForBackend.get(
      `/api/master-data/styles/${id}`,
    );
    return response.data;
  } catch (error) {
    logger.error('getStyleById failed', error as Error);
    throw error;
  }
}

export async function searchSkus(keyword: string): Promise<Sku[]> {
  try {
    const response = await axiosForBackend.get('/api/master-data/skus/search', {
      params: { keyword },
    });
    return response.data;
  } catch (error) {
    logger.error('searchSkus failed', error as Error);
    throw error;
  }
}
