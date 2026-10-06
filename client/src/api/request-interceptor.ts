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

/** 读取非 HttpOnly cookie（用于 double-submit 回放 CSRF 令牌）。 */
function getCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const cookies = document.cookie.split('; ');
  for (const c of cookies) {
    const idx = c.indexOf('=');
    if (idx === -1) continue;
    if (c.slice(0, idx) === name) return decodeURIComponent(c.slice(idx + 1));
  }
  return '';
}

// 与 server/common/security/erp-csrf.util.ts 中的 ERP_CSRF_COOKIE_NAME / ERP_CSRF_HEADER_NAME 保持一致。
const ERP_CSRF_COOKIE_NAME = 'erp-csrf';
const ERP_CSRF_HEADER_NAME = 'x-erp-csrf';

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
    // 应用层自签 CSRF（D.1）：读取 erp-csrf cookie 并回放为同名 header（double-submit），
    // 供服务端 ErpCsrfGuard 校验。cookie/header 同名即满足同源约束，跨站请求无法读取/设置。
    const csrf = getCookie(ERP_CSRF_COOKIE_NAME);
    if (csrf) {
      config.headers = config.headers || {};
      config.headers[ERP_CSRF_HEADER_NAME] = csrf;
    }
    return config;
  });

  axiosForBackend.interceptors.response.use(
    (res) => res,
    (err: any) => {
      if (err?.response?.status === 401) {
        if (err.response?.headers) {
          delete err.response.headers['x-login-url'];
        }
        // suppressAuthRedirect：静默恢复（启动期 me()）的 401 是预期内的（旧 token 失效），
        // 绝不可触发全局登出/整页跳登录——否则会与用户刚完成的登录竞态，把页面弹回登录页。
        // 正常业务请求（会话中 token 真的过期）仍走原逻辑：清 token + 跳登录。
        if (!err.config?.meta?.suppressAuthRedirect) {
          localStorage.removeItem(TOKEN_KEY);
          if (!isOnLoginPage()) {
            redirectToLogin();
          }
        }
      }
      return Promise.reject(err);
    },
  );
}

installInterceptor();
