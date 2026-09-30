import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER, type Cache } from '@nestjs/cache-manager';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { systemConfig } from '@server/database/schema';
import { eq, sql } from 'drizzle-orm';
import { TTL, cached, invalidate } from '@server/common/cache';
import type { SystemConfig } from '@shared/api.interface';

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  rememberTabs: true,
  defaultHomePage: 'dashboard',
  sidebarCollapsed: false,
  tablePageSize: 20,
  amountDecimals: 2,
  qtyDecimals: 2,
  autoSaveDraft: true,
  autoSaveInterval: 60,
  allowNegativeStock: false,
  allowEditAfterApproval: false,
  overDeliveryRatio: 0,
  retailAllowPriceEdit: true,
  lowStockAlert: true,
  pendingApprovalAlert: true,
  maxTabs: 10,
  uniqueCodeArchiveDays: 0,
  defaultDocQueryDays: 90,
};

const CONFIG_KEYS: (keyof SystemConfig)[] = [
  'rememberTabs',
  'defaultHomePage',
  'sidebarCollapsed',
  'tablePageSize',
  'amountDecimals',
  'qtyDecimals',
  'autoSaveDraft',
  'autoSaveInterval',
  'allowNegativeStock',
  'allowEditAfterApproval',
  'overDeliveryRatio',
  'retailAllowPriceEdit',
  'lowStockAlert',
  'pendingApprovalAlert',
  'maxTabs',
  'uniqueCodeArchiveDays',
  'defaultDocQueryDays',
];

function parseValue(key: keyof SystemConfig, raw: string): boolean | number | string {
  switch (typeof DEFAULT_SYSTEM_CONFIG[key]) {
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'number':
      return Number(raw) || 0;
    default:
      return raw;
  }
}

function serializeValue(key: keyof SystemConfig, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value ?? '');
}

@Injectable()
export class SystemConfigService {
  /** 系统配置为全局单表（非租户维度），无需作用域分片。 */
  private static readonly CACHE_KEY = 'sys:config';

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * 读取系统配置：全表扫描极轻，但前端每个页面首屏都会调一次，
   * 属于典型的"高频低变更"读路径。缓存 60 秒，并在 updateConfig 中主动失效，
   * 因此实际生效延迟 ≈ 0（写后立即清缓存）。
   */
  async getConfig(): Promise<SystemConfig> {
    return cached<SystemConfig>(
      this.cacheManager,
      SystemConfigService.CACHE_KEY,
      TTL.reference,
      () => this.loadConfig(),
    );
  }

  private async loadConfig(): Promise<SystemConfig> {
    const rows = await this.db.select().from(systemConfig);
    const result: SystemConfig = { ...DEFAULT_SYSTEM_CONFIG };
    for (const row of rows) {
      const key = row.configKey as keyof SystemConfig;
      if (key in DEFAULT_SYSTEM_CONFIG) {
        (result as unknown as Record<string, unknown>)[key] = parseValue(key, row.configValue);
      }
    }
    return result;
  }

  async updateConfig(patch: Partial<SystemConfig>, userId: string): Promise<SystemConfig> {
    const rows: { configKey: string; configValue: string }[] = [];
    for (const key of CONFIG_KEYS) {
      if (!(key in patch)) continue;
      rows.push({
        configKey: key,
        configValue: serializeValue(key, (patch as Record<string, unknown>)[key]),
      });
    }
    // 一次批量 upsert 替代逐条 select+update/insert（消除 N+1）
    if (rows.length > 0) {
      await this.db
        .insert(systemConfig)
        .values(rows)
        .onConflictDoUpdate({
          target: [systemConfig.configKey],
          set: { configValue: sql`EXCLUDED.config_value` },
        });
    }
    // 主动失效：配置参与计价/库存等业务规则判断，必须做到"改完立即生效"。
    await invalidate(this.cacheManager, SystemConfigService.CACHE_KEY);
    return this.loadConfig();
  }
}
