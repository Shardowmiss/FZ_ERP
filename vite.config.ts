import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

// 仅 dev 覆盖 vite base（同 ERP，详见 ERP vite.config.ts 注释）：
// 保留 CLIENT_BASE_PATH=/client 对齐路由 basename / 代理 / 后端 globalPrefix；
// dev 强制 base='/' 修复 /client/ 静态服务，生产构建不受影响。
const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  server: {
    host: '0.0.0.0',
  },
  ...(isDev ? { base: '/' } : {}),
});
