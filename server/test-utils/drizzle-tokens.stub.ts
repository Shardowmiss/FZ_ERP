/**
 * 测试桩：替代平台 `drizzle-tokens` 门面。
 *
 * 平台 `@lark-apaas/fullstack-nestjs-core` 在本地（非 aPaaS 运行时）环境下
 * 再导出不完整（缺少 `ObservableService` 等），直接 import 会抛错。
 * 集成测试只用到 `DRIZZLE_DATABASE` 这个字符串 token 与 `PostgresJsDatabase`
 * 类型占位，因此提供最小桩即可，绝不触碰生产代码。
 */
export const DRIZZLE_DATABASE = 'DRIZZLE_DATABASE';

// 类型占位：集成测试直接传入 pglite drizzle 实例，运行时为 any。
export type PostgresJsDatabase<T = unknown> = T;
