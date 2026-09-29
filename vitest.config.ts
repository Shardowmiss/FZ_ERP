import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 纯逻辑单测无需 CSS；用内联空 PostCSS 配置覆盖项目根 postcss.config.js，
  // 避免 Vite 加载 tailwindcss/lightningcss 缺失的原生绑定
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: 'node',
    // P1-2 / P-1：仅放行 client 侧纯逻辑用例（chunk / sync-plan）。
    // client 其余代码引入 @lark-apaas/client-toolkit 的 logger（需 window），
    // 在 environment='node' 下会 ReferenceError，故不放开整个 client 目录。
    include: ['server/**/*.spec.ts', 'client/src/lib/offline/*.spec.ts'],
  },
  resolve: {
    // 顺序敏感：特异性别名必须排在 @server 前缀别名之前，否则会被前缀改写后失配。
    alias: [
      // P1-8：平台 drizzle-tokens 门面在本地非 aPaaS 环境再导出不完整，
      // 用最小桩替代，仅提供 DRIZZLE_DATABASE 常量与 PostgresJsDatabase 类型占位。
      {
        find: /^@server\/database\/drizzle-tokens$/,
        replacement: resolve(__dirname, 'server/test-utils/drizzle-tokens.stub.ts'),
      },
      { find: '@server', replacement: resolve(__dirname, 'server') },
      { find: '@shared', replacement: resolve(__dirname, 'shared') },
    ],
  },
});
