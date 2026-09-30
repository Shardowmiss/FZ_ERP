import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

// 仅 dev 覆盖 vite base：
// 模板 root=工程根、index.html 在 client/ 子目录；设 CLIENT_BASE_PATH=/client 会让 preset
// 把 vite base 也改成 /client/，dev 下 /client/ 反变 404（base 把挂载点挪走却找不到根 index.html）。
// 故 dev 强制 base='/'（静态服务 /client/ 正常），保留 CLIENT_BASE_PATH=/client 驱动
// 路由 basename / dev 代理前缀(/client/api) / 后端 globalPrefix 三者对齐。生产构建不受影响（走 preset 默认）。
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  // 监听 IPv4（0.0.0.0），避免默认仅绑 [::1] 导致浏览器走 IPv4 时连接被拒
  server: {
    host: '0.0.0.0',
  },
  optimizeDeps: {
    // 预打包体积大且被全站共用的 UI 库，避免每个懒加载页面首次打开时
    // vite 现 transform 数百个 ESM 模块（首开 1-5s 卡顿的根因）。
    // 同时让 client-toolkit 与业务页共用同一份 antd，消除双副本告警。
    include: ['antd', '@ant-design/icons'],
  },
  // ---- dev 期 SPA history fallback ----
  // preset 让 vite root = 工程根，但 index.html 在 client/ 子目录，
  // 于是 vite 内建 spa fallback 会去找 root 下的 /index.html（不存在），
  // 导致：/client/ 能开（精确命中 client/index.html），但任何子路由
  // /client/product/color 都 404 —— 表现为「页面不存在」。
  // 这里在内部中间件之后补一层：/client/** 且无扩展名的请求统一回落到
  // /client/index.html，交给前端路由接管。（仅 dev，生产构建不受影响）
  plugins: [
    {
      name: 'client-spa-fallback',
      apply: 'serve',
      configureServer(server) {
        // 注意：必须在 pre 钩子（不返回函数）注册——preset 会在 post 阶段
        // 挂自己的 404 处理，post 注册的 fallback 永远轮不到执行。
        server.middlewares.use((req, _res, next) => {
          const url = req.url || '';
          const pathname = url.split('?')[0].split('#')[0];
          // 只处理挂载点下的「前端路由」请求。必须排除以下无扩展名但并非前端路由的前缀，
          // 否则会被错误回落成 index.html：
          //   /client/api  —— preset dev-proxy 反代到 Nest 的 API 前缀（本中间件挂在 pre 钩子，
          //                   早于代理，一旦吞掉会让所有页面「加载失败」）
          //   /client/dev  —— preset 的 dev 中间件（dev-logs / openapi）
          // 带扩展名的（js/tsx/css/svg…）一律走原链路。
          if (
            pathname.startsWith('/client') &&
            !pathname.startsWith('/client/api') &&
            !pathname.startsWith('/client/dev') &&
            !path.extname(pathname)
          ) {
            req.url = '/client/index.html';
          }
          next();
        });
      },
    },
  ],
  ...(isDev ? { base: '/' } : {}),
});
