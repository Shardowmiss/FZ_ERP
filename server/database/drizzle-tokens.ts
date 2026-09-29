/**
 * 平台解耦门面（零成本前置）
 * ------------------------------------------------------------------
 * 当前 re-export 自飞书 aPaaS 运行时（`@lark-apaas/fullstack-nestjs-core`，
 * 实际由 `@lark-apaas/nestjs-datapaas` 透传）。所有业务 service 统一从此处
 * 引入 `DRIZZLE_DATABASE` 注入 token 与 `PostgresJsDatabase` 类型，
 * 不再直接 import 平台运行时包。
 *
 * 运行时语义：re-export 与直接从平台包引入是【同一绑定】，因此平台上
 * `PlatformModule.forRoot()` 注册的 provider 仍能精确匹配，行为零变化。
 *
 * 未来独立部署（DEPLOY_MODE=standalone）时，只需把本文件内容替换为：
 *   import postgres from 'postgres';
 *   import { drizzle } from 'drizzle-orm/postgres-js';
 *   import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
 *   import * as schema from './schema';
 *   export const DRIZZLE_DATABASE = 'DRIZZLE_DATABASE';
 *   export type { PostgresJsDatabase };
 * 并在 DatabaseModule 中用真实 postgres-js 实例 provide 该 token，
 * 业务 service 完全无需改动。
 */
export { DRIZZLE_DATABASE } from '@lark-apaas/fullstack-nestjs-core';
export type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
