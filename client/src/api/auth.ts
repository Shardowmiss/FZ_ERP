import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import { logger } from '@lark-apaas/client-toolkit/logger';

export interface ServerLoginResult {
  token: string;
  expiresAt: string;
  employee: {
    employeeId: string;
    name: string;
    role: string;
    storeId: string | null;
    code: string;
  };
}

/**
 * A-4：POS 本地收银员登录。
 *
 * 平台 SSO 认证的是「平台账号」，而门店终端是多人共用的，
 * 收银员需要用自己的工号登录才能区分责任人（班次、长短款、退货留痕）。
 * 因此这里额外做一层 POS 本地登录，令牌随请求头下发。
 */
export async function login(code: string, password: string): Promise<ServerLoginResult> {
  const res = await axiosForBackend.post<ServerLoginResult>('/api/auth/login', { code, password });
  return res.data;
}

/** 查询当前令牌是否仍有效 */
export async function me(): Promise<ServerLoginResult['employee'] | null> {
  try {
    const res = await axiosForBackend.get<ServerLoginResult['employee'] | null>('/api/auth/me');
    return res.data ?? null;
  } catch (e) {
    logger.error('auth.me failed', e as Error);
    return null;
  }
}
