import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';
import type {
  Transfer,
  TransferQuery,
  TransferRequest,
  CreateTransferRequestDto,
  Stocktake,
  StocktakeQuery,
  CreateStocktakeDto,
  StockAdjustment,
  StockAdjustmentQuery,
  ListResponse,
} from '@shared/api.interface';

export async function getTransfers(
  params: TransferQuery,
): Promise<ListResponse<Transfer>> {
  try {
    const response = await axiosForBackend.get(
      '/api/inventory/transfers',
      { params },
    );
    return response.data;
  } catch (error) {
    logger.error('getTransfers failed', error as Error);
    throw error;
  }
}

export async function receiveTransfer(
  id: string,
  data: { items: { skuId: string; receivedQty: number }[] },
): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      `/api/inventory/transfers/${id}/receive`,
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('receiveTransfer failed', error as Error);
    throw error;
  }
}

export async function getTransferRequests(
  params: TransferQuery,
): Promise<ListResponse<TransferRequest>> {
  try {
    const response = await axiosForBackend.get(
      '/api/inventory/transfer-requests',
      { params },
    );
    return response.data;
  } catch (error) {
    logger.error('getTransferRequests failed', error as Error);
    throw error;
  }
}

export async function createTransferRequest(
  data: CreateTransferRequestDto,
): Promise<TransferRequest> {
  try {
    const response = await axiosForBackend.post(
      '/api/inventory/transfer-requests',
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('createTransferRequest failed', error as Error);
    throw error;
  }
}

export async function getStocktakes(
  params: StocktakeQuery,
): Promise<ListResponse<Stocktake>> {
  try {
    const response = await axiosForBackend.get(
      '/api/inventory/stocktakes',
      { params },
    );
    return response.data;
  } catch (error) {
    logger.error('getStocktakes failed', error as Error);
    throw error;
  }
}

export async function createStocktake(
  data: CreateStocktakeDto,
): Promise<Stocktake> {
  try {
    const response = await axiosForBackend.post(
      '/api/inventory/stocktakes',
      data,
    );
    return response.data;
  } catch (error) {
    logger.error('createStocktake failed', error as Error);
    throw error;
  }
}

export async function auditStocktake(id: string): Promise<void> {
  try {
    const response = await axiosForBackend.post(
      `/api/inventory/stocktakes/${id}/audit`,
    );
    return response.data;
  } catch (error) {
    logger.error('auditStocktake failed', error as Error);
    throw error;
  }
}

export async function getAdjustments(
  params: StockAdjustmentQuery,
): Promise<ListResponse<StockAdjustment>> {
  try {
    const response = await axiosForBackend.get(
      '/api/inventory/adjustments',
      { params },
    );
    return response.data;
  } catch (error) {
    logger.error('getAdjustments failed', error as Error);
    throw error;
  }
}
