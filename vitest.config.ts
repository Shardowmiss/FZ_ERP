import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * ERP 测试运行配置。
 *
 * 与 `tsconfig.node.json` 的 paths 保持一致（@server/* → server/*，@shared/* → shared/*），
 * 否则 spec 里写 `@server/common/report-window` 会解析失败，而源码本身用的是别名 —— 那样
 * 测试就变成"测另一套路径"了。
 *
 * 关于 `maxForks: 1`：真库夹具（server/test-utils/db.ts）用事务回滚做用例隔离，多个 worker
 * 并发跑会把彼此的未提交事务搅在一起。串行执行更慢，但结果可信。
 */
export default defineConfig({
  // 服务端测试与 CSS 无关，但 vite 会扫描项目根的 postcss.config.js，
  // 那里链到 tailwind → lightningcss 的原生二进制，加载失败会直接拖死整个 run。
  css: { postcss: {} },
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, 'server'),
      '@shared': path.resolve(__dirname, 'shared'),
      // 平台包的 ESM 产物在 vitest 下会直接抛错：
      //   fullstack-nestjs-core/dist/index.js `import { ObservableService } from
      //   '@lark-apaas/nestjs-common'`，而 nestjs-common@0.1.9 的运行时产物里根本没有
      //   这个导出（只在 index.d.ts 里作为 type 声明），ESM 命名导出缺失是 SyntaxError。
      // 生产走 tsc→CJS，缺失名字只会变成 undefined，因此线上一直是好的，只有测试会炸。
      // 这里指到同一包的 CJS 产物：CJS interop 容忍缺失命名，且保留全部真实导出。
      '@lark-apaas/fullstack-nestjs-core': path.resolve(
        __dirname,
        'node_modules/@lark-apaas/fullstack-nestjs-core/dist/index.cjs',
      ),
    },
  },
  test: {
    environment: 'node',
    // 测试代码放在 test/（与 server/ 源码分离）：nest 构建的 filenames 只含
    // server 与 shared，因此不会被编译进 dist，生产包里不会混进测试代码。
    include: ['test/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**', 'source_package/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: {
      forks: { minThreads: 1, maxThreads: 1 },
    },
  },
});
