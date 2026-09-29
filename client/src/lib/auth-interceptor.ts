import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

/**
 * A-4：把 POS 本地登录令牌挂到所有后端请求上。
 *
 * 无令牌时不做任何处理，保持平台 SSO 的既有行为，避免破坏未启用
 * POS 登录的环境。
 */
let installed = false;

export function installAuthInterceptor(): void {
  if (installed) return;
  installed = true;
  axiosForBackend.interceptors.request.use((config) => {
    try {
      const raw = localStorage.getItem('yuncaipos_session');
      if (raw) {
        const session = JSON.parse(raw) as { token?: string };
        if (session?.token && config.headers) {
          config.headers.Authorization = `Bearer ${session.token}`;
        }
      }
    } catch {
      /* 令牌读取失败不阻断请求，交由服务端判定 */
    }
    return config;
  });
}
