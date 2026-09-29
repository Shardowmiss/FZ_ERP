import { logger } from '@lark-apaas/client-toolkit/logger';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

const TOKEN_KEY = 'erp_auth_token';

export async function request<T>(
  url: string,
  method: string = 'GET',
  data?: any,
  params?: any,
): Promise<T> {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || '';
    const response = await axiosForBackend({
      url,
      method,
      data,
      params,
      headers: {
        'x-auth-token': token,
      },
    });
    return response.data as T;
  } catch (error: any) {
    logger.error(`API请求失败: ${method} ${url}`, error);
    throw error;
  }
}
