import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  Shift,
  ShiftQuery,
  OpenShiftDto,
  CloseShiftDto,
  Eod,
  EodQuery,
  ListResponse,
} from '@shared/api.interface';

export async function getCurrentShift(storeId: string): Promise<Shift | null> {
  try {
    const response = await axiosForBackend.get('/api/shift/current', {
      params: { storeId },
    });
    return response.data;
  } catch (error) {
    logger.error('getCurrentShift failed', error as Error);
    throw error;
  }
}

export async function openShift(data: OpenShiftDto): Promise<Shift> {
  try {
    const response = await axiosForBackend.post('/api/shift/open', data);
    return response.data;
  } catch (error) {
    logger.error('openShift failed', error as Error);
    throw error;
  }
}

export async function closeShift(
  id: string,
  data: CloseShiftDto,
): Promise<Shift> {
  try {
    const response = await axiosForBackend.post('/api/shift/close', {
      id,
      ...data,
    });
    return response.data;
  } catch (error) {
    logger.error('closeShift failed', error as Error);
    throw error;
  }
}

export async function getShiftHistory(
  params: ShiftQuery,
): Promise<ListResponse<Shift>> {
  try {
    const response = await axiosForBackend.get('/api/shift/history', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getShiftHistory failed', error as Error);
    throw error;
  }
}

export async function getEodList(
  params: EodQuery,
): Promise<ListResponse<Eod>> {
  try {
    const response = await axiosForBackend.get('/api/shift/eod', {
      params,
    });
    return response.data;
  } catch (error) {
    logger.error('getEodList failed', error as Error);
    throw error;
  }
}

export async function createEod(date: string): Promise<Eod> {
  try {
    const response = await axiosForBackend.post('/api/shift/eod', {
      date,
    });
    return response.data;
  } catch (error) {
    logger.error('createEod failed', error as Error);
    throw error;
  }
}
