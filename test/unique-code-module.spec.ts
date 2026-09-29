/**
 * unique-code 模块【装配冒烟】。
 *
 * 背景：unique-code.service.ts 由单文件拆成 6 个职责域服务 + 一个门面，
 * 门面的构造参数变成 7 个（db + 6 个域服务）。这类改动**编译得过、护栏也过得了**
 * （护栏用例是直构门面），却可能在应用启动那一刻才以
 * "Nest can't resolve dependencies" 炸掉——因为没人真正把 DI 图跑一遍。
 *
 * ⚠️ 实现约束：vitest 用 esbuild 转译，esbuild **不发射 emitDecoratorMetadata**，
 * 因此 `design:paramtypes` 在本环境下恒为 undefined，静态读不到"按类型注入"的参数。
 * 于是分两层验证：
 *   · 静态层：模块 provider 清单完整性 + 显式 @Inject token 可解析 + 构造元数钉死；
 *   · 运行时层：createUniqueCodeService 真跑一遍装配，确认门面方法齐备（等价于 DI 生效）。
 */
import { describe, it, expect } from 'vitest';
import { DRIZZLE_DATABASE } from '@lark-apaas/fullstack-nestjs-core';
import { UniqueCodeModule } from '@server/modules/unique-code/unique-code.module';
import {
  UniqueCodeService,
  createUniqueCodeService,
} from '@server/modules/unique-code/unique-code.service';
import { UniqueCodeConfigService } from '@server/modules/unique-code/unique-code-config.service';
import { UniqueCodeInboundService } from '@server/modules/unique-code/unique-code-inbound.service';
import { UniqueCodeLifecycleService } from '@server/modules/unique-code/unique-code-lifecycle.service';
import { UniqueCodeScanService } from '@server/modules/unique-code/unique-code-scan.service';
import { UniqueCodeTraceService } from '@server/modules/unique-code/unique-code-trace.service';
import { UniqueCodeArchiveService } from '@server/modules/unique-code/unique-code-archive.service';

function keyOf(token: unknown): string {
  return typeof token === 'function' ? token.name : String(token);
}

/**
 * 把 Nest 的构造依赖 token 归一成可比较的字符串。
 * esbuild 下 `@Inject(X)` 存的是 `{ index, param }`，且 param 退化成字符串；
 * 真机 tsc 下存的是原始对象。两种都归一成名字比较。
 */
function depKey(token: unknown): string {
  const raw = (token as { param?: unknown } | null)?.param ?? token;
  return typeof raw === 'function' ? raw.name : String(raw);
}

/**
 * 由全局 DB 模块提供的注入 token（不在本模块 provider 清单内）。
 * 'DRIZZLE_DATABASE' 既是 @lark-apaas 的导出的 DI token，也是 esbuild 下 @Inject 存下来的字符串名。
 */
const EXTERNAL_TOKEN_KEYS = [keyOf(DRIZZLE_DATABASE), 'DRIZZLE_DATABASE'];

/**
 * 各服务的构造依赖数量 —— 与 unique-code.service.ts 里 createUniqueCodeService
 * 的装配顺序一一对应。任何人给某个域加了依赖却忘记改装配点，这里立刻炸。
 */
const EXPECTED_ARITY: [string, number][] = [
  [UniqueCodeConfigService.name, 1], // (db)
  [UniqueCodeInboundService.name, 2], // (db, config)
  [UniqueCodeLifecycleService.name, 2], // (db, config)
  [UniqueCodeScanService.name, 4], // (db, config, inbound, lifecycle)
  [UniqueCodeTraceService.name, 3], // (db, config, scan)
  [UniqueCodeArchiveService.name, 2], // (db, trace)
  [UniqueCodeService.name, 7], // (db, config, inbound, lifecycle, scan, trace, archive)
];

/** 门面应该对外暴露的能力 */
const FACADE_API = [
  'isEnabled', 'loadConfig',
  'parseTagCode', 'registerInbound',
  'verifySold', 'returnUniqueCode', 'verifySoldByDoc', 'returnDocUniqueCodes',
  'scanOutboundUniqueCode', 'scanDocument', 'scanTransfer', 'reconcileStocktake',
  'getUniqueCodeStock', 'listStockByWarehouse',
  'resolveDocNo', 'getTrace', 'getTraceBySku', 'getTraceByRange',
  'getChannelViolations', 'buildTraceCsv', 'getLifecycleReport',
  'archiveOldEvents', 'getArchiveStats', 'getArchiveDays', 'archiveByDays', 'getPublicTrace',
];

describe('unique-code 模块装配', () => {
  it('模块 provider 清单完整：门面 + 六个域服务全部注册', () => {
    const providers: unknown[] =
      (Reflect.getMetadata('providers', UniqueCodeModule) as unknown[]) ?? [];
    // ⚠️ 按引用比对而非名字：DRIZZLE_DATABASE 这类 token 是对象，String() 只会得到 "[object Object]"
    const providerRefs = new Set(providers);
    const all = [
      UniqueCodeService,
      UniqueCodeConfigService,
      UniqueCodeInboundService,
      UniqueCodeLifecycleService,
      UniqueCodeScanService,
      UniqueCodeTraceService,
      UniqueCodeArchiveService,
    ];
    for (const cls of all) {
      expect(providerRefs.has(cls), `${cls.name} 未在 UniqueCodeModule 注册`).toBe(true);
    }
    expect(providers.length).toBe(all.length);
  });

  it('显式 @Inject 的 token 均可解析：要么是本模块 provider，要么是全局注入 token', () => {
    const providers: unknown[] =
      (Reflect.getMetadata('providers', UniqueCodeModule) as unknown[]) ?? [];
    const resolvable = new Set<string>([
      ...providers.map(keyOf),
      ...EXTERNAL_TOKEN_KEYS,
    ]);

    const all = [
      UniqueCodeService,
      UniqueCodeConfigService,
      UniqueCodeInboundService,
      UniqueCodeLifecycleService,
      UniqueCodeScanService,
      UniqueCodeTraceService,
      UniqueCodeArchiveService,
    ];
    for (const cls of all) {
      // 本环境下只有带 @Inject 的参数会留下 'self:paramtypes'（其余靠 design:paramtypes，
      // 而 esbuild 不发这个元数据），因此这里能读到的就是全部"自定义 token"注入。
      const tokens: unknown[] =
        (Reflect.getMetadata('self:paramtypes', cls) as unknown[]) ?? [];
      for (const token of tokens) {
        const key = depKey(token);
        expect(
          resolvable.has(key),
          `${cls.name} 依赖的 token ${key} 无法解析（既非本模块 provider，也非全局注入 token）`,
        ).toBe(true);
      }
    }
  });

  it('构造依赖元数与 createUniqueCodeService 的装配点一一对应', () => {
    for (const [name, arity] of EXPECTED_ARITY) {
      const cls = (Reflect.getMetadata('providers', UniqueCodeModule) as Function[]).find(
        (p) => p?.name === name,
      );
      expect(cls, `模块未注册 ${name}`).toBeTruthy();
      expect(cls!.length, `${name} 的构造依赖数量与装配点不一致（Nest 会无法解析）`).toBe(arity);
    }
  });

  it('运行时装配：工厂产出的门面具备全部公开方法（等价于 DI 生效）', () => {
    // 数据库句柄传空壳即可——只验方法存在性，不触碰真实 SQL
    const svc = createUniqueCodeService({} as never);
    expect(svc).toBeInstanceOf(UniqueCodeService);
    for (const fn of FACADE_API) {
      expect(typeof (svc as unknown as Record<string, unknown>)[fn], `门面缺少公开方法 ${fn}`).toBe(
        'function',
      );
    }
  });
});
