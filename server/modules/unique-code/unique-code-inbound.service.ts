import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import { and, eq } from 'drizzle-orm';
import { docUniqueCode, sku, uniqueCodeStock } from '@server/database/schema';
import { UniqueCodeConfigService } from './unique-code-config.service';
import {
  extractNumeric,
  validateChecksum,
  type ParseTagResult,
} from './unique-code.tokens';

/**
 * 唯一码引擎【域②：标签解析与入库登记】。
 *
 * 职责边界：
 *  - parseTagCode：从吊牌码识别款色码（+ 唯一码），反查 sku_id；启用校验位时校验码体；
 *  - registerInbound：采购入库 / 调拨入库 / 退货回库时把唯一码写入 unique_code_stock（in_stock），
 *    并记 doc_unique_code(inbound) 流水；
 *  - resolveSkuId（私有）：registerInbound 内部的款色码 → sku_id 反查。
 *
 * 对外保持与拆分前完全一致的方法签名与返回值，refactor 不引入行为变化。
 */
@Injectable()
export class UniqueCodeInboundService {
  private readonly logger = new Logger(UniqueCodeInboundService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
    private readonly config: UniqueCodeConfigService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 扫码解析                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 解析吊牌码，自动识别款色码（+ 唯一码），反查 sku_id。
   * 默认编码规则（可扩展）：以 | 分隔
   *   未启用唯一码： STYLE|COLOR|SIZE
   *   启用唯一码：   STYLE|COLOR|SIZE|UNIQUECODE
   * 启用校验位时，对 UNIQUECODE 段做校验位合法性校验。
   */
  async parseTagCode(
    raw: string,
    opts?: { separator?: string; validateChecksum?: boolean },
  ): Promise<ParseTagResult> {
    const sep = opts?.separator ?? '|';
    const parts = String(raw ?? '')
      .split(sep)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const enabled = await this.config.isEnabled();
    let styleNo = '',
      color = '',
      size = '',
      uniqueCode: string | undefined;
    if (enabled) {
      if (parts.length < 4) {
        return {
          styleNo,
          color,
          size,
          matched: false,
          message: '启用唯一码时吊牌码应包含 款号|颜色|尺码|唯一码 四段',
        };
      }
      [styleNo, color, size, uniqueCode] = [
        parts[0],
        parts[1],
        parts[2],
        parts[3],
      ];
      const cfg = await this.config.loadConfig();
      if (cfg.checksum && opts?.validateChecksum !== false) {
        if (!validateChecksum(uniqueCode!)) {
          return {
            styleNo,
            color,
            size,
            uniqueCode,
            matched: false,
            message: `唯一码 ${uniqueCode} 校验位不合法（疑似错扫或伪造）`,
          };
        }
      }
    } else {
      if (parts.length < 3) {
        return {
          styleNo,
          color,
          size,
          matched: false,
          message: '吊牌码应包含 款号|颜色|尺码 三段',
        };
      }
      [styleNo, color, size] = [parts[0], parts[1], parts[2]];
    }
    const matched = await this.db
      .select({ id: sku.id })
      .from(sku)
      .where(
        and(
          eq(sku.styleNo, styleNo),
          eq(sku.color, color),
          eq(sku.size, size),
        ),
      )
      .limit(1);
    if (!matched.length) {
      return {
        styleNo,
        color,
        size,
        uniqueCode,
        matched: false,
        message: `款色码无效：未找到对应 SKU (${styleNo}/${color}/${size})`,
      };
    }
    return {
      styleNo,
      color,
      size,
      uniqueCode,
      skuId: matched[0].id,
      matched: true,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 入库登记                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * 入库登记：采购入库 / 调拨入库 / 退货回库时把唯一码写入 unique_code_stock（in_stock），并记 doc_unique_code(inbound)。
   * 未启用唯一码时返回 enabled:false。
   * 支持传入事务 tx，与调用方业务单据写入同事务。
   */
  async registerInbound(input: {
    docType: string;
    docId: string;
    warehouseId: string;
    items: {
      styleNo: string;
      color: string;
      size: string;
      uniqueCode?: string;
      skuId?: string;
    }[];
    operatorId?: string;
  }, tx?: PostgresJsDatabase<any>) {
    const dbx = tx ?? this.db;
    const enabled = await this.config.isEnabled();
    if (!enabled) {
      return { enabled: false, registered: 0, message: '唯一码未启用，跳过登记' };
    }
    const cfg = await this.config.loadConfig();
    let registered = 0;
    for (const it of input.items) {
      if (!it.uniqueCode) {
        this.logger.warn(
          `入库明细缺少唯一码，跳过：${it.styleNo}/${it.color}/${it.size}`,
        );
        continue;
      }
      const skuId =
        it.skuId ?? (await this.resolveSkuId(it.styleNo, it.color, it.size, dbx));
      if (!skuId) {
        throw new BadRequestException(
          `入库唯一码 ${it.uniqueCode} 的款色码无效：${it.styleNo}/${it.color}/${it.size}`,
        );
      }
      // 数字部分（用于排序/区间统计）。含前缀或校验位时剥离还原；
      // 兼容非纯数字的历史/自定义码（如带字母前缀）：无法还原时记为 null，避免写入 bigint 报错
      const rawNumeric =
        cfg.prefix || cfg.checksum
          ? extractNumeric(it.uniqueCode, cfg.prefix, cfg.checksum)
          : Number(it.uniqueCode);
      const numericValue = Number.isFinite(rawNumeric) ? rawNumeric : null;
      await dbx.transaction(async (t) => {
        const exist = await t
          .select({ id: uniqueCodeStock.id })
          .from(uniqueCodeStock)
          .where(eq(uniqueCodeStock.uniqueCode, it.uniqueCode!))
          .limit(1);
        if (exist.length) {
          await t
            .update(uniqueCodeStock)
            .set({
              numericValue,
              skuId,
              styleNo: it.styleNo,
              color: it.color,
              size: it.size,
              warehouseId: input.warehouseId,
              status: 'in_stock',
              inboundDocType: input.docType,
              inboundDocId: input.docId,
              inboundAt: new Date(),
              outboundDocType: null,
              outboundDocId: null,
              outboundAt: null,
            })
            .where(eq(uniqueCodeStock.uniqueCode, it.uniqueCode!));
        } else {
          await t.insert(uniqueCodeStock).values({
            uniqueCode: it.uniqueCode!,
            numericValue,
            skuId,
            styleNo: it.styleNo,
            color: it.color,
            size: it.size,
            warehouseId: input.warehouseId,
            status: 'in_stock',
            inboundDocType: input.docType,
            inboundDocId: input.docId,
            inboundAt: new Date(),
          });
        }
        await t
          .insert(docUniqueCode)
          .values({
            docType: input.docType,
            docId: input.docId,
            uniqueCode: it.uniqueCode!,
            skuId,
            styleNo: it.styleNo,
            color: it.color,
            size: it.size,
            warehouseId: input.warehouseId,
            scanType: 'inbound',
            operatorId: input.operatorId ?? null,
          })
          .onConflictDoNothing();
      });
      registered++;
    }
    return {
      enabled: true,
      registered,
      message: `已登记 ${registered} 个唯一码`,
    };
  }

  private async resolveSkuId(
    styleNo: string,
    color: string,
    size: string,
    dbx: PostgresJsDatabase<any> = this.db,
  ): Promise<string | null> {
    const r = await dbx
      .select({ id: sku.id })
      .from(sku)
      .where(
        and(
          eq(sku.styleNo, styleNo),
          eq(sku.color, color),
          eq(sku.size, size),
        ),
      )
      .limit(1);
    return r.length ? r[0].id : null;
  }
}
