import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import { docUniqueCode, uniqueCodeStock, warehouse } from '@server/database/schema';
import { UniqueCodeConfigService } from './unique-code-config.service';
import { UniqueCodeInboundService } from './unique-code-inbound.service';
import { UniqueCodeLifecycleService } from './unique-code-lifecycle.service';
import { validateChecksum, type ScanResult } from './unique-code.tokens';

/**
 * 唯一码引擎【域④：扫描与盘点】。
 *
 * 职责边界：所有「扫码动作」的入口，落库方向均为写 unique_code_stock / doc_unique_code。
 *  - scanOutboundUniqueCode：核心出库校验（三拒绝 + 款色码校验 + 同单据去重）；
 *  - scanDocument：单据扫码统一网关，按 direction 路由到登记/出库/退货/核销；
 *  - scanTransfer：调拨（源仓出校验 + 目标仓入登记）；
 *  - reconcileStocktake：盘点对账（missing 盘亏 / extra 盘盈）；
 *  - getUniqueCodeStock / listStockByWarehouse：unique_code_stock 表的读入口（本域持有该表的所有权）。
 *
 * 依赖：配置①、入库登记②、核销退货③（网关与调拨需要跨域组合），无反向依赖，DI 无环。
 */
@Injectable()
export class UniqueCodeScanService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
    private readonly config: UniqueCodeConfigService,
    private readonly inbound: UniqueCodeInboundService,
    private readonly lifecycle: UniqueCodeLifecycleService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 出库扫码校验（核心）                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 出库/零售扫码校验。
   * 规则（按优先级）：
   *  1. 未启用 → disabled；2. 同单重复 → already_scanned；3. 不存在 → not_in_stock；
   *  4. 非在库 → not_available；5. 非本仓 → wrong_warehouse；6. 款色码不符 → style_mismatch。
   * 通过：事务内更新 status=out + 写 doc_unique_code(outbound)。
   * 支持传入事务 tx。
   */
  async scanOutboundUniqueCode(input: {
    docType: string;
    docId: string;
    docItemId?: string;
    warehouseId: string;
    styleNo: string;
    color: string;
    size: string;
    uniqueCode: string;
    operatorId?: string;
  }, tx?: PostgresJsDatabase<any>): Promise<ScanResult> {
    const dbx = tx ?? this.db;
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { ok: false, reason: 'disabled', message: '唯一码未启用，无法扫码出库' };
    }
    if (!input.uniqueCode) {
      return { ok: false, reason: 'missing_unique_code', message: '缺少唯一码' };
    }

    const cfg = await this.config.loadConfig();
    if (cfg.checksum && !validateChecksum(input.uniqueCode)) {
      return {
        ok: false,
        reason: 'bad_checksum',
        message: `唯一码 ${input.uniqueCode} 校验位不合法（疑似错扫或伪造）`,
      };
    }

    const dup = await dbx
      .select({ id: docUniqueCode.id })
      .from(docUniqueCode)
      .where(
        and(
          eq(docUniqueCode.docType, input.docType),
          eq(docUniqueCode.docId, input.docId),
          eq(docUniqueCode.uniqueCode, input.uniqueCode),
        ),
      )
      .limit(1);
    if (dup.length) {
      return {
        ok: false,
        reason: 'already_scanned',
        message: `该唯一码已在本单据(${input.docType}/${input.docId})扫描过`,
      };
    }

    const stock = await dbx
      .select()
      .from(uniqueCodeStock)
      .where(eq(uniqueCodeStock.uniqueCode, input.uniqueCode))
      .limit(1);
    if (!stock.length) {
      return {
        ok: false,
        reason: 'not_in_stock',
        message: '库存不存在：该唯一码未入库过，不允许出库',
      };
    }
    const s = stock[0];

    if (s.status !== 'in_stock') {
      const label: Record<string, string> = {
        out: '已出库',
        sold: '已售',
        returned: '退回中',
      };
      return {
        ok: false,
        reason: 'not_available',
        message: `该唯一码状态为「${label[s.status] ?? s.status}」，不可出库`,
      };
    }

    if (s.warehouseId !== input.warehouseId) {
      const wh = await dbx
        .select({ name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, s.warehouseId))
        .limit(1);
      const cur = await dbx
        .select({ name: warehouse.name })
        .from(warehouse)
        .where(eq(warehouse.id, input.warehouseId))
        .limit(1);
      const actual = wh[0]?.name ?? s.warehouseId;
      const expect = cur[0]?.name ?? input.warehouseId;
      return {
        ok: false,
        reason: 'wrong_warehouse',
        message: `该唯一码属于 ${actual} 仓，不在本仓(${expect})`,
      };
    }

    if (
      s.styleNo !== input.styleNo ||
      s.color !== input.color ||
      s.size !== input.size
    ) {
      return {
        ok: false,
        reason: 'style_mismatch',
        message: `款色码不符：库存记录 ${s.styleNo}/${s.color}/${s.size}，扫码 ${input.styleNo}/${input.color}/${input.size}`,
      };
    }

    const doUpdates = async (t: PostgresJsDatabase<any>) => {
      await t
        .update(uniqueCodeStock)
        .set({
          status: 'out',
          outboundDocType: input.docType,
          outboundDocId: input.docId,
          outboundAt: new Date(),
        })
        .where(eq(uniqueCodeStock.uniqueCode, input.uniqueCode));
      await t.insert(docUniqueCode).values({
        docType: input.docType,
        docId: input.docId,
        docItemId: input.docItemId,
        uniqueCode: input.uniqueCode,
        skuId: s.skuId,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
        warehouseId: input.warehouseId,
        scanType: 'outbound',
        operatorId: input.operatorId ?? null,
      });
    };

    if (tx) {
      await doUpdates(tx);
    } else {
      await this.db.transaction(async (t) => {
        await doUpdates(t);
      });
    }

    return {
      ok: true,
      data: {
        uniqueCode: s.uniqueCode!,
        skuId: s.skuId,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
      },
    };
  }

  /* ---------------------------------------------------------------- */
  /* 单据扫码网关                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * 单据扫码统一入口：按 direction 路由到登记/出库/退货/核销。
   * 用于采购入库(inbound)、销售/零售出库(outbound)、销售退货(return)、结算核销(sold) 等单据的扫码接入。
   * 支持传入 tx，与业务单据同事务。
   */
  async scanDocument(input: {
    direction: 'inbound' | 'outbound' | 'return' | 'sold';
    docType: string;
    docId: string;
    warehouseId: string;
    docItemId?: string;
    operatorId?: string;
    items: {
      styleNo: string;
      color: string;
      size: string;
      uniqueCode?: string;
      skuId?: string;
    }[];
  }, tx?: PostgresJsDatabase<any>) {
    const results: any[] = [];
    if (input.direction === 'inbound') {
      const reg = await this.inbound.registerInbound(
        {
          docType: input.docType,
          docId: input.docId,
          warehouseId: input.warehouseId,
          items: input.items,
          operatorId: input.operatorId,
        },
        tx,
      );
      return { direction: 'inbound', registered: reg.registered, results };
    }
    for (const it of input.items) {
      if (!it.uniqueCode) continue;
      if (input.direction === 'outbound') {
        results.push(
          await this.scanOutboundUniqueCode(
            {
              docType: input.docType,
              docId: input.docId,
              docItemId: input.docItemId,
              warehouseId: input.warehouseId,
              styleNo: it.styleNo,
              color: it.color,
              size: it.size,
              uniqueCode: it.uniqueCode,
              operatorId: input.operatorId,
            },
            tx,
          ),
        );
      } else if (input.direction === 'sold') {
        results.push(
          await this.lifecycle.verifySold(
            {
              docType: input.docType,
              docId: input.docId,
              uniqueCode: it.uniqueCode,
              operatorId: input.operatorId,
            },
            tx,
          ),
        );
      } else if (input.direction === 'return') {
        results.push(
          await this.lifecycle.returnUniqueCode(
            {
              docType: input.docType,
              docId: input.docId,
              warehouseId: input.warehouseId,
              uniqueCode: it.uniqueCode,
              operatorId: input.operatorId,
            },
            tx,
          ),
        );
      }
    }
    const okCount = results.filter((r) => r && (r.ok === true || r.ok === undefined)).length;
    return { direction: input.direction, total: results.length, okCount, results };
  }

  /**
   * 调拨扫码：源仓出库校验 + 目标仓入库登记。两仓均需启用唯一码校验。
   * 任一条目出库校验失败则整体返回失败条目，已成功的条目仍在各自事务内生效（调用方应回滚）。
   */
  async scanTransfer(input: {
    docId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    operatorId?: string;
    items: { styleNo: string; color: string; size: string; uniqueCode: string }[];
  }, tx?: PostgresJsDatabase<any>) {
    const results: any[] = [];
    let allOk = true;
    for (const it of input.items) {
      const out = await this.scanOutboundUniqueCode(
        {
          docType: 'transfer',
          docId: input.docId,
          warehouseId: input.fromWarehouseId,
          styleNo: it.styleNo,
          color: it.color,
          size: it.size,
          uniqueCode: it.uniqueCode,
          operatorId: input.operatorId,
        },
        tx,
      );
      if (!out.ok) {
        allOk = false;
        const f = out as { reason?: string; message: string };
        results.push({ uniqueCode: it.uniqueCode, ok: false, reason: f.reason, message: f.message });
        continue;
      }
      const reg = await this.inbound.registerInbound(
        {
          docType: 'transfer',
          docId: input.docId,
          warehouseId: input.toWarehouseId,
          items: [{ styleNo: it.styleNo, color: it.color, size: it.size, uniqueCode: it.uniqueCode }],
          operatorId: input.operatorId,
        },
        tx,
      );
      results.push({ uniqueCode: it.uniqueCode, ok: reg.registered > 0, message: '调拨入库登记成功' });
    }
    return { allOk, total: input.items.length, results };
  }

  /* ---------------------------------------------------------------- */
  /* 盘点扫码对账                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * 盘点扫码对账：将实扫码集合与系统"在库(in_stock)"集合比对。
   *  - missing（盘亏）：系统在库但本次未扫到；
   *  - extra（盘盈）：实扫到但系统不在库（未入库/已出库/错码/伪造）。
   * 支持按 (warehouseId[, styleNo,color,size]) 过滤应盘范围。
   */
  async reconcileStocktake(input: {
    docId: string;
    warehouseId: string;
    scannedCodes: string[];
    styleNo?: string;
    color?: string;
    size?: string;
  }, tx?: PostgresJsDatabase<any>) {
    const dbx = tx ?? this.db;
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, missing: [], extra: [] };
    }
    const cfg = await this.config.loadConfig();
    const scanned = new Set(
      input.scannedCodes.map((c) => {
        if (cfg.checksum && !validateChecksum(c)) return c; // 保留原值，由下方判定为 extra(错码)
        return c;
      }),
    );
    const where: any[] = [
      eq(uniqueCodeStock.warehouseId, input.warehouseId),
      eq(uniqueCodeStock.status, 'in_stock'),
    ];
    if (input.styleNo) where.push(eq(uniqueCodeStock.styleNo, input.styleNo));
    if (input.color) where.push(eq(uniqueCodeStock.color, input.color));
    if (input.size) where.push(eq(uniqueCodeStock.size, input.size));
    const rows = await dbx
      .select({
        uniqueCode: uniqueCodeStock.uniqueCode,
        styleNo: uniqueCodeStock.styleNo,
        color: uniqueCodeStock.color,
        size: uniqueCodeStock.size,
      })
      .from(uniqueCodeStock)
      .where(where.length === 1 ? where[0] : and(...where));
    const expected = new Set(rows.map((r) => r.uniqueCode));

    const missing = rows
      .filter((r) => !scanned.has(r.uniqueCode))
      .map((r) => ({ uniqueCode: r.uniqueCode, styleNo: r.styleNo, color: r.color, size: r.size }));
    const extra = input.scannedCodes.filter((c) => !expected.has(c));

    return {
      enabled: true,
      scannedCount: scanned.size,
      expectedCount: expected.size,
      missing,
      extra,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 库存查询（本域持有 unique_code_stock 读写权）                     */
  /* ---------------------------------------------------------------- */

  async getUniqueCodeStock(uniqueCode: string) {
    const r = await this.db
      .select()
      .from(uniqueCodeStock)
      .where(eq(uniqueCodeStock.uniqueCode, uniqueCode))
      .limit(1);
    return r[0] ?? null;
  }

  async listStockByWarehouse(warehouseId: string, status?: string) {
    const where: any[] = [eq(uniqueCodeStock.warehouseId, warehouseId)];
    if (status) where.push(eq(uniqueCodeStock.status, status));
    return this.db
      .select()
      .from(uniqueCodeStock)
      .where(where.length === 1 ? where[0] : and(...where));
  }
}
