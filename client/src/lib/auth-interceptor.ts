import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';

/**
 * A-4：把 POS 本地登录令牌挂到所有后端请求上。
 *
 * 无令牌时不做任何处理，保持平台 SSO 的既有行为，避免破坏未启用
 * POS 登录的环境。
 *
 * A-5（CSRF 双提交补发）：本地裸连 `node dist/server/main.js` 时，平台 SSO
 * 不会注入 CSRF「头/cookie 双提交」所需请求头，后端 CsrfMiddleware 会拒绝
 * 几乎所有接口（403 "csrf token not found in cookie"），导致：
 *   - 登录接口本身被拒 → 登录走前端降级名册；
 *   - 所有数据接口被拒 → 页面被「假绿」错误体拖垮（见 PosPage/PosSidebar 崩溃）。
 * 服务端 `spa-template` 中间件已在返回 HTML 时下发 `Set-Cookie: suda-csrf-token`
 * 并注入 `window.csrfToken`（二者同值）。平台约定头名为 `x-suda-csrf-token`
 * （cookie 名才是 `suda-csrf-token`），这里用它补发该头，使头/cookie 一致，
 * 满足双提交校验，本地即可正常登录与取数。
 * 注：cookie 为 HttpOnly，JS 无法读取，因此取 HTML 注入的 `window.csrfToken`。
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

      // A-5：补发 CSRF 双提交头（本地裸连必需）
      const csrf = (window as unknown as { csrfToken?: string }).csrfToken;
      if (csrf && config.headers) {
        (config.headers as Record<string, string>)['x-suda-csrf-token'] = csrf;
      }
    } catch {
      /* 令牌读取/注入失败不阻断请求，交由服务端判定 */
    }
    return config;
  });
}
