import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

const TOKEN_KEY = 'erp_auth_token';

const INTERCEPTOR_FLAG = '__erp_login_interceptor_installed__';

declare global {
  interface Window {
    [INTERCEPTOR_FLAG]?: boolean;
  }
}

function getBasePath(): string {
  const w = typeof window !== 'undefined' ? (window as any) : null;
  if (w?.__BASENAME__) return w.__BASENAME__;
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const match = pathname.match(/^(\/app\/[^/]+)/);
  return match ? match[1] : '/';
}

function redirectToLogin(): void {
  const base = getBasePath().replace(/\/$/, '');
  window.location.assign(`${base}/login`);
}

export function isOnLoginPage(): boolean {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const base = getBasePath().replace(/\/$/, '');
  return pathname === `${base}/login` || pathname.endsWith('/login');
}

function installInterceptor(): void {
  if (typeof window !== 'undefined' && window[INTERCEPTOR_FLAG]) return;
  if (typeof window !== 'undefined') window[INTERCEPTOR_FLAG] = true;

  axiosForBackend.interceptors.request.use((config: any) => {
    // 统一为 axiosForBackend 直连调用注入登录态 token。
    // 否则直接 axiosForBackend.get/post 调 @NeedLogin 接口会因缺 x-auth-token 头而 401。
    const token = localStorage.getItem(TOKEN_KEY) || '';
    if (token) {
      config.headers = config.headers || {};
      config.headers['x-auth-token'] = token;
    }
    if (!config.meta) config.meta = {};
    config.meta.autoJumpToLogin = false;
    return config;
  });

  axiosForBackend.interceptors.response.use(
    (res) => res,
    (err: any) => {
      if (err?.response?.status === 401) {
        if (err.response?.headers) {
          delete err.response.headers['x-login-url'];
        }
        localStorage.removeItem(TOKEN_KEY);
        if (!isOnLoginPage()) {
          redirectToLogin();
        }
      }
      return Promise.reject(err);
    },
  );
}

installInterceptor();
