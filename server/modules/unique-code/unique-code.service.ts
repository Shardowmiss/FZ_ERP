import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { UniqueCodeArchiveService } from './unique-code-archive.service';
import { UniqueCodeConfigService } from './unique-code-config.service';
import { UniqueCodeInboundService } from './unique-code-inbound.service';
import { UniqueCodeLifecycleService } from './unique-code-lifecycle.service';
import { UniqueCodeScanService } from './unique-code-scan.service';
import { UniqueCodeTraceService } from './unique-code-trace.service';

/**
 * 唯一码引擎【门面】。
 *
 * 本文件只做「装配 + 委托」，不再包含任何业务逻辑——所有行为都下沉到各职责域服务：
 *  ① 配置开关     UniqueCodeConfigService  isEnabled / loadConfig
 *  ② 解析与入库   UniqueCodeInboundService  parseTagCode / registerInbound
 *  ③ 核销与退货   UniqueCodeLifecycleService verifySold / returnUniqueCode / verifySoldByDoc / returnDocUniqueCodes
 *  ④ 扫描与盘点   UniqueCodeScanService     scanOutboundUniqueCode / scanDocument / scanTransfer / reconcileStocktake
 *  ⑤ 追溯与串货   UniqueCodeTraceService    getTrace / getTraceBySku / getTraceByRange / getChannelViolations
 *  ⑥ 归档与公开   UniqueCodeArchiveService  archiveOldEvents / archiveByDays / getPublicTrace
 *
 * 依赖关系（无环）：
 *   ① ← ②③④⑤；② ← ④；③ ← ④；④ ← ⑤；⑤ ← ⑥；门面 ← 全部分域。
 *
 * 对外契约保持不变：控制器、retail.service、ops 校验器以及护栏用例
 * 仍只与门面打交道，拆域前后的方法签名与返回值完全一致。
 * 唯一变化是构造方式：由 Nest DI 提供，`createUniqueCodeService(db)` 供脚本直构。
 */
@Injectable()
export class UniqueCodeService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
    private readonly config: UniqueCodeConfigService,
    private readonly inbound: UniqueCodeInboundService,
    private readonly lifecycle: UniqueCodeLifecycleService,
    private readonly scan: UniqueCodeScanService,
    private readonly trace: UniqueCodeTraceService,
    private readonly archive: UniqueCodeArchiveService,
  ) {}

  /* ----------------------------- ① 配置 ----------------------------- */
  isEnabled() {
    return this.config.isEnabled();
  }
  loadConfig() {
    return this.config.loadConfig();
  }

  /* --------------------------- ② 解析与入库 --------------------------- */
  parseTagCode(
    raw: string,
    opts?: Parameters<UniqueCodeInboundService['parseTagCode']>[1],
  ) {
    return this.inbound.parseTagCode(raw, opts);
  }
  registerInbound(
    input: Parameters<UniqueCodeInboundService['registerInbound']>[0],
    tx?: Parameters<UniqueCodeInboundService['registerInbound']>[1],
  ) {
    return this.inbound.registerInbound(input, tx);
  }

  /* --------------------------- ③ 核销与退货 --------------------------- */
  verifySold(
    input: Parameters<UniqueCodeLifecycleService['verifySold']>[0],
    tx?: Parameters<UniqueCodeLifecycleService['verifySold']>[1],
  ) {
    return this.lifecycle.verifySold(input, tx);
  }
  returnUniqueCode(
    input: Parameters<UniqueCodeLifecycleService['returnUniqueCode']>[0],
    tx?: Parameters<UniqueCodeLifecycleService['returnUniqueCode']>[1],
  ) {
    return this.lifecycle.returnUniqueCode(input, tx);
  }
  verifySoldByDoc(
    input: Parameters<UniqueCodeLifecycleService['verifySoldByDoc']>[0],
    tx?: Parameters<UniqueCodeLifecycleService['verifySoldByDoc']>[1],
  ) {
    return this.lifecycle.verifySoldByDoc(input, tx);
  }
  returnDocUniqueCodes(
    input: Parameters<UniqueCodeLifecycleService['returnDocUniqueCodes']>[0],
    tx?: Parameters<UniqueCodeLifecycleService['returnDocUniqueCodes']>[1],
  ) {
    return this.lifecycle.returnDocUniqueCodes(input, tx);
  }

  /* --------------------------- ④ 扫描与盘点 --------------------------- */
  scanOutboundUniqueCode(
    input: Parameters<UniqueCodeScanService['scanOutboundUniqueCode']>[0],
    tx?: Parameters<UniqueCodeScanService['scanOutboundUniqueCode']>[1],
  ) {
    return this.scan.scanOutboundUniqueCode(input, tx);
  }
  scanDocument(
    input: Parameters<UniqueCodeScanService['scanDocument']>[0],
    tx?: Parameters<UniqueCodeScanService['scanDocument']>[1],
  ) {
    return this.scan.scanDocument(input, tx);
  }
  scanTransfer(
    input: Parameters<UniqueCodeScanService['scanTransfer']>[0],
    tx?: Parameters<UniqueCodeScanService['scanTransfer']>[1],
  ) {
    return this.scan.scanTransfer(input, tx);
  }
  reconcileStocktake(
    input: Parameters<UniqueCodeScanService['reconcileStocktake']>[0],
    tx?: Parameters<UniqueCodeScanService['reconcileStocktake']>[1],
  ) {
    return this.scan.reconcileStocktake(input, tx);
  }
  getUniqueCodeStock(uniqueCode: string) {
    return this.scan.getUniqueCodeStock(uniqueCode);
  }
  listStockByWarehouse(warehouseId: string, status?: string) {
    return this.scan.listStockByWarehouse(warehouseId, status);
  }

  /* --------------------------- ⑤ 追溯与串货 --------------------------- */
  resolveDocNo(docType: string, docId: string) {
    return this.trace.resolveDocNo(docType, docId);
  }
  getTrace(
    uniqueCode: string,
    opts?: Parameters<UniqueCodeTraceService['getTrace']>[1],
  ) {
    return this.trace.getTrace(uniqueCode, opts);
  }
  getTraceBySku(
    skuId: string,
    opts?: Parameters<UniqueCodeTraceService['getTraceBySku']>[1],
  ) {
    return this.trace.getTraceBySku(skuId, opts);
  }
  getTraceByRange(opts: Parameters<UniqueCodeTraceService['getTraceByRange']>[0]) {
    return this.trace.getTraceByRange(opts);
  }
  getChannelViolations(opts?: Parameters<UniqueCodeTraceService['getChannelViolations']>[0]) {
    return this.trace.getChannelViolations(opts);
  }
  buildTraceCsv(
    trace: Awaited<ReturnType<UniqueCodeTraceService['getTrace']>>,
  ) {
    return this.trace.buildTraceCsv(trace);
  }
  getLifecycleReport(filter?: Parameters<UniqueCodeTraceService['getLifecycleReport']>[0]) {
    return this.trace.getLifecycleReport(filter);
  }

  /* --------------------------- ⑥ 归档与公开 --------------------------- */
  archiveOldEvents(before: Date, batchSize?: number) {
    return this.archive.archiveOldEvents(before, batchSize);
  }
  getArchiveStats() {
    return this.archive.getArchiveStats();
  }
  getArchiveDays() {
    return this.archive.getArchiveDays();
  }
  archiveByDays(days: number, batchSize?: number) {
    return this.archive.archiveByDays(days, batchSize);
  }
  getPublicTrace(uniqueCode: string) {
    return this.archive.getPublicTrace(uniqueCode);
  }
}

/**
 * 门面的唯一装配点：数据库句柄 + 六个域服务。
 *
 * 供两类调用方使用：
 *  - Nest 容器：见 unique-code.module.ts（门面本身 @Injectable，依赖经 DI 注入）；
 *  - 脚本直构：联调/回归脚本（sim-*.cjs）与护栏用例 `createUniqueCodeService(pool)` 一行搞定，
 *    不必知道内部六个域的构造顺序。
 */
export function createUniqueCodeService(
  db: PostgresJsDatabase<any>,
): UniqueCodeService {
  const config = new UniqueCodeConfigService(db);
  const inbound = new UniqueCodeInboundService(db, config);
  const lifecycle = new UniqueCodeLifecycleService(db, config);
  const scan = new UniqueCodeScanService(db, config, inbound, lifecycle);
  const trace = new UniqueCodeTraceService(db, config, scan);
  const archive = new UniqueCodeArchiveService(db, trace);
  return new UniqueCodeService(
    db,
    config,
    inbound,
    lifecycle,
    scan,
    trace,
    archive,
  );
}

// 共享契约（配置键 / 状态字典 / 解析结果类型 / 校验位纯函数）对外仍从本文件导出，
// 保证既有 `import { UniqueCodeService } from './unique-code.service'` 的写法不受影响。
export * from './unique-code.tokens';
