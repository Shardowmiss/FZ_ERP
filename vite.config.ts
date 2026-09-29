import path from 'path';
import { defineConfig } from '@lark-apaas/coding-preset-vite-react';

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
});
