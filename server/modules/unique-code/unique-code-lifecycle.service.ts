import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, inArray } from 'drizzle-orm';
import { docUniqueCode, uniqueCodeStock } from '@server/database/schema';
import { UniqueCodeConfigService } from './unique-code-config.service';

/**
 * 唯一码引擎【域③：核销与退货】。
 *
 * 职责边界：负责补全 in_stock → out → sold → returned → in_stock 状态机的后半段。
 *  - verifySold：out → sold（零售/销售结算后）；
 *  - returnUniqueCode：out/sold → in_stock（退货回库，重置出库字段 + 记 returned 流水）；
 *  - verifySoldByDoc / returnDocUniqueCodes：单据级批量入口，供单据服务在同一事务内调用。
 *
 * ⚠️ 已知缺陷（保留原样，由 test/unique-code-guardrail.spec.ts 用例 14/14b/21 钉死）：
 * returnDocUniqueCodes 会把 docType 改写为 `${docType}_return`（如 retail_return），
 * 而迁移 0013 的 ck_doc_unique_code_doc_type 仅允许 ('retail','sales','transfer')，
 * 因此该批量接口在任何入参下都会撞 PG 23514，且报错发生在调用方事务内、无 savepoint 兜底，
 * 会把整单事务打成 25P02。修复需改迁移 + 该改写逻辑，不在本次拆域范围内。
 */
@Injectable()
export class UniqueCodeLifecycleService {
  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
    private readonly config: UniqueCodeConfigService,
  ) {}

  /** 结算核销：out → sold（仅零售/销售结算后调用） */
  async verifySold(input: {
    docType: string;
    docId: string;
    uniqueCode: string;
    operatorId?: string;
  }, tx?: PostgresJsDatabase<any>): Promise<{ ok: boolean; reason?: string; message: string; data?: any }> {
    const dbx = tx ?? this.db;
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { ok: false, reason: 'disabled', message: '唯一码未启用' };
    }
    const stock = await dbx
      .select()
      .from(uniqueCodeStock)
      .where(eq(uniqueCodeStock.uniqueCode, input.uniqueCode))
      .limit(1);
    if (!stock.length) {
      return { ok: false, reason: 'not_in_stock', message: '唯一码不存在，无法核销' };
    }
    const s = stock[0];
    if (s.status !== 'out') {
      return {
        ok: false,
        reason: 'invalid_state',
        message: `唯一码状态为「${s.status}」，仅「已出库(out)」可结算核销`,
      };
    }
    const doUpdate = async (t: PostgresJsDatabase<any>) => {
      await t.update(uniqueCodeStock).set({ status: 'sold' }).where(eq(uniqueCodeStock.uniqueCode, input.uniqueCode));
      await t.insert(docUniqueCode).values({
        docType: input.docType,
        docId: input.docId,
        uniqueCode: input.uniqueCode,
        skuId: s.skuId,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
        warehouseId: s.warehouseId,
        scanType: 'sold',
        operatorId: input.operatorId ?? null,
      }).onConflictDoNothing();
    };
    if (tx) await doUpdate(tx);
    else await this.db.transaction(async (t) => { await doUpdate(t); });
    return {
      ok: true,
      message: `唯一码 ${input.uniqueCode} 已核销为 sold`,
      data: { uniqueCode: s.uniqueCode, skuId: s.skuId, styleNo: s.styleNo, color: s.color, size: s.size },
    };
  }

  /** 退货回滚：out/sold → in_stock（重置出库字段 + 记 returned 流水） */
  async returnUniqueCode(input: {
    docType: string;
    docId: string;
    warehouseId: string;
    uniqueCode: string;
    operatorId?: string;
  }, tx?: PostgresJsDatabase<any>): Promise<{ ok: boolean; reason?: string; message: string; data?: any }> {
    const dbx = tx ?? this.db;
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { ok: false, reason: 'disabled', message: '唯一码未启用' };
    }
    const stock = await dbx
      .select()
      .from(uniqueCodeStock)
      .where(eq(uniqueCodeStock.uniqueCode, input.uniqueCode))
      .limit(1);
    if (!stock.length) {
      return { ok: false, reason: 'not_in_stock', message: '唯一码不存在，无法退货' };
    }
    const s = stock[0];
    if (s.status !== 'out' && s.status !== 'sold') {
      return {
        ok: false,
        reason: 'invalid_state',
        message: `唯一码状态为「${s.status}」，仅「已出库(out)/已售(sold)」可退货回库`,
      };
    }
    const doUpdate = async (t: PostgresJsDatabase<any>) => {
      await t
        .update(uniqueCodeStock)
        .set({
          status: 'in_stock',
          warehouseId: input.warehouseId,
          inboundDocType: input.docType,
          inboundDocId: input.docId,
          inboundAt: new Date(),
          outboundDocType: null,
          outboundDocId: null,
          outboundAt: null,
        })
        .where(eq(uniqueCodeStock.uniqueCode, input.uniqueCode));
      await t.insert(docUniqueCode).values({
        docType: input.docType,
        docId: input.docId,
        uniqueCode: input.uniqueCode,
        skuId: s.skuId,
        styleNo: s.styleNo,
        color: s.color,
        size: s.size,
        warehouseId: input.warehouseId,
        scanType: 'returned',
        operatorId: input.operatorId ?? null,
      }).onConflictDoNothing();
    };
    if (tx) await doUpdate(tx);
    else await this.db.transaction(async (t) => { await doUpdate(t); });
    return {
      ok: true,
      message: `唯一码 ${input.uniqueCode} 已退货回库（in_stock@${input.warehouseId}）`,
      data: { uniqueCode: s.uniqueCode, skuId: s.skuId, styleNo: s.styleNo, color: s.color, size: s.size },
    };
  }

  /* ---------------------------------------------------------------- */
  /* 单据级批量核销 / 退货（供单据服务接入，同一事务）                   */
  /* ---------------------------------------------------------------- */

  /**
   * 单据级核销：把某单据已出库扫描(outbound)的唯一码批量核销为 sold。
   * 供零售/销售【结算】环节调用（如 retail settle），与业务单据同一事务。
   * 未启用唯一码时直接跳过，不影响原单据流程。
   */
  async verifySoldByDoc(
    input: { docType: string; docId: string; operatorId?: string },
    tx?: PostgresJsDatabase<any>,
  ) {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, total: 0, processed: 0, failed: [], message: '唯一码未启用，跳过核销' };
    }
    const dbx = tx ?? this.db;
    const rows = await dbx
      .select({ uniqueCode: docUniqueCode.uniqueCode })
      .from(docUniqueCode)
      .where(
        and(
          eq(docUniqueCode.docType, input.docType),
          eq(docUniqueCode.docId, input.docId),
          eq(docUniqueCode.scanType, 'outbound'),
        ),
      );
    const failed: { uniqueCode: string; reason?: string; message: string }[] = [];
    let processed = 0;
    for (const r of rows) {
      const res = await this.verifySold(
        { docType: input.docType, docId: input.docId, uniqueCode: r.uniqueCode, operatorId: input.operatorId },
        tx,
      );
      if (res.ok) processed++;
      else failed.push({ uniqueCode: r.uniqueCode, reason: res.reason, message: res.message });
    }
    return {
      enabled: true,
      total: rows.length,
      processed,
      failed,
      message: `已核销 ${processed}/${rows.length} 个唯一码`,
    };
  }

  /**
   * 单据级退货回库：把某单据已出库/已售的唯一码批量回库（out/sold → in_stock）。
   * 供零售/销售【退货】环节调用，传入原销售单据号即可整单回库。
   */
  async returnDocUniqueCodes(
    input: {
      docType: string;
      docId: string;
      warehouseId: string;
      operatorId?: string;
      /**
       * 仅回库这些唯一码（部分退货场景必填：只回库实际退回的那几件）。
       * 不传则回库该单据全部已出库/已售的码（整单退货场景）。
       */
      uniqueCodes?: string[];
    },
    tx?: PostgresJsDatabase<any>,
  ) {
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, total: 0, processed: 0, failed: [], message: '唯一码未启用，跳过回库' };
    }
    const dbx = tx ?? this.db;
    // 取该单据最近一次出库/核销流水涉及的唯一码（去重）
    const rows = await dbx
      .select({ uniqueCode: docUniqueCode.uniqueCode })
      .from(docUniqueCode)
      .where(
        and(
          eq(docUniqueCode.docType, input.docType),
          eq(docUniqueCode.docId, input.docId),
          inArray(docUniqueCode.scanType, ['outbound', 'sold']),
        ),
      );
    let codes = Array.from(new Set(rows.map((r) => r.uniqueCode)));
    // 部分退货：只回库显式指定的码，避免把整单未退的件一起回库
    if (input.uniqueCodes && input.uniqueCodes.length > 0) {
      const allow = new Set(input.uniqueCodes);
      codes = codes.filter((c) => allow.has(c));
    }
    const failed: { uniqueCode: string; reason?: string; message: string }[] = [];
    let processed = 0;
    for (const uc of codes) {
      const res = await this.returnUniqueCode(
        { docType: input.docType + '_return', docId: input.docId, warehouseId: input.warehouseId, uniqueCode: uc, operatorId: input.operatorId },
        tx,
      );
      if (res.ok) processed++;
      else failed.push({ uniqueCode: uc, reason: res.reason, message: res.message });
    }
    return {
      enabled: true,
      total: codes.length,
      processed,
      failed,
      message: `已回库 ${processed}/${codes.length} 个唯一码`,
    };
  }
}
