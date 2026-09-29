import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { eq, inArray } from 'drizzle-orm';
import { systemConfig } from '@server/database/schema';
import {
  K_CHECKSUM,
  K_ENABLED,
  K_ENABLED_OLD,
  K_PREFIX,
} from './unique-code.tokens';

/**
 * 唯一码引擎【域①：配置开关】。
 *
 * 职责边界（全局唯一的配置读写口）：
 *  - isEnabled：功能总开关（严格字符串 'true' 判定）；
 *  - loadConfig：前缀/长度/上限/校验位等构建与解析参数；
 *  - migrateOldEnabled：历史键 HANGTAG_UNIQUE_CODE_ENABLED 的一次性迁移。
 *
 * 其他域一律经注入本服务读取配置，不再各自查 system_config，
 * 避免拆域后配置口径分裂（例如某处漏做迁移导致开关行为不一致）。
 */
@Injectable()
export class UniqueCodeConfigService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
  ) {}

  async isEnabled(): Promise<boolean> {
    await this.migrateOldEnabled();
    const r = await this.db
      .select({ v: systemConfig.configValue })
      .from(systemConfig)
      .where(eq(systemConfig.configKey, K_ENABLED))
      .limit(1);
    return r.length > 0 && r[0].v === 'true';
  }

  /** 读取完整唯一码配置（含前缀/校验位），供构建与解析使用 */
  async loadConfig(): Promise<{
    enabled: boolean;
    length: number | null;
    max: number;
    prefix: string | null;
    checksum: boolean;
  }> {
    const rows = await this.db
      .select()
      .from(systemConfig)
      .where(
        inArray(systemConfig.configKey, [
          K_ENABLED,
          'UNIQUE_CODE_LENGTH',
          'UNIQUE_CODE_MAX',
          K_PREFIX,
          K_CHECKSUM,
        ]),
      );
    const map = new Map(rows.map((r) => [r.configKey, r.configValue]));
    const len = map.get('UNIQUE_CODE_LENGTH');
    const max = map.get('UNIQUE_CODE_MAX');
    return {
      enabled: map.get(K_ENABLED) === 'true',
      length: len != null && len !== '' ? parseInt(len, 10) : null,
      max: max != null && max !== '' ? parseInt(max, 10) : 0,
      prefix: map.get(K_PREFIX) || null,
      checksum: map.get(K_CHECKSUM) === 'true',
    };
  }

  /** 历史键一次性迁移：HANGTAG_UNIQUE_CODE_ENABLED → UNIQUE_CODE_ENABLED */
  private async migrateOldEnabled(): Promise<void> {
    const rows = await this.db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.configKey, K_ENABLED_OLD))
      .limit(1);
    if (!rows.length) return;
    const exists = await this.db
      .select({ id: systemConfig.id })
      .from(systemConfig)
      .where(eq(systemConfig.configKey, K_ENABLED))
      .limit(1);
    if (!exists.length) {
      await this.db.insert(systemConfig).values({
        configKey: K_ENABLED,
        configValue: rows[0].configValue,
        description: '唯一码功能总开关',
      });
    }
    await this.db.delete(systemConfig).where(eq(systemConfig.configKey, K_ENABLED_OLD));
  }
}
