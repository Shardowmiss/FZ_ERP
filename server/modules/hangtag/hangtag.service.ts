import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
} from 'drizzle-orm';
import {
  hangtagTemplate,
  hangtagPrintTask,
  hangtagPrintItem,
  systemConfig,
  garmentPurchaseOrder,
  garmentPurchaseOrderSku,
  style,
  sku,
  colorGroup,
  sizeGroup,
} from '@server/database/schema';
import { buildUniqueCode } from '../unique-code/unique-code.service';

// 唯一码配置键（全局命名，已从 HANGTAG_* 收敛为 UNIQUE_CODE_*）
const K_ENABLED = 'UNIQUE_CODE_ENABLED';
const K_LENGTH = 'UNIQUE_CODE_LENGTH';
const K_MAX = 'UNIQUE_CODE_MAX';
const K_PREFIX = 'UNIQUE_CODE_PREFIX';
const K_CHECKSUM = 'UNIQUE_CODE_CHECKSUM';
// 旧键（吊牌模块早期命名），读取时一次性自动迁移到新键，保证历史数据平滑过渡
const K_ENABLED_OLD = 'HANGTAG_UNIQUE_CODE_ENABLED';
const K_LENGTH_OLD = 'HANGTAG_UNIQUE_CODE_LENGTH';
const K_MAX_OLD = 'HANGTAG_UNIQUE_CODE_MAX';

export interface UniqueCodeConfig {
  /** 是否启用唯一码 */
  enabled: boolean;
  /** 唯一码长度（数字位数）；未配置为 null */
  length: number | null;
  /** 当前已分配的最大唯一码（自增计数）；未配置默认为 0 */
  max: number;
  /** 唯一码前缀（品牌码+年份，如 GM26）；启用防伪时附加在码体前部 */
  prefix: string | null;
  /** 是否启用校验位（模 10） */
  checksum: boolean;
}

export interface GridCell {
  color: string;
  size: string;
  /** 采购单导入时自动带出；手工录入时为 0，由用户设置 */
  quantity: number;
}

export interface StyleGrid {
  styleNo: string;
  styleName: string;
  colors: string[];
  sizes: string[];
  cells: GridCell[];
}

export interface PrintItemInput {
  styleNo: string;
  styleName?: string;
  color: string;
  size: string;
  quantity: number;
}

export interface PrintInput {
  templateId: string;
  sourceType: 'purchase_order' | 'manual';
  sourceRef: string;
  items: PrintItemInput[];
  includeUniqueCode: boolean;
  /** 可选：指定打印日期（YYYY-MM-DD）；缺省取当天 */
  printDate?: string;
}

export interface PrintResult {
  taskId: string;
  taskNo: string;
  totalQty: number;
  itemCount: number;
  includeUniqueCode: boolean;
  uniqueCodeStart: number | null;
  uniqueCodeEnd: number | null;
  /** 唯一码格式化示例（演示长度补零效果） */
  sampleCodes: string[];
  /**
   * 本次打印分配的逐件唯一码（完整列表，已按前缀/长度/校验位格式化）。
   * 供前端吊牌打印结果展示"每件唯一码溯源二维码"使用，消费者扫码即可跳公开溯源页。
   */
  uniqueCodes: string[];
}

/**
 * 吊牌打印服务
 *
 * 能力：
 *  1. 唯一码参数配置（是否启用 / 长度 / 当前最大码），配置落在 systemConfig。
 *  2. 吊牌模板 CRUD（内容项 + 样式）。
 *  3. 二维表生成：按采购单自动带入数量；按款号生成颜色×尺码空表（数量手工/批量填）。
 *  4. 批量打印：生成打印任务 + 明细，并在启用唯一码时分配连续唯一码区间、更新最大码。
 *  5. 打印日志查询与 CSV 导出（打印日期 / 内容 / 数量 / 唯一码区间）。
 *
 * 唯一码连续性机制：
 *  - 唯一码是数据库层面的逻辑自增计数器（非数据库序列），由 systemConfig.UNIQUE_CODE_MAX 记录。
 *  - 每次打印若启用唯一码：start = max + 1，end = max + totalQty；打印完成后写回 max = end。
 *  - 下一次打印从新的 max 续增，从而保证系统全局唯一、不重不漏，且从 1 起步。
 * 配置键已从早期 HANGTAG_UNIQUE_CODE_* 收敛为全局 UNIQUE_CODE_*，读取时自动迁移历史键。
 */
@Injectable()
export class HangtagService {
  private readonly logger = new Logger(HangtagService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: PostgresJsDatabase<any>,
  ) {}

  /* ---------------------------------------------------------------- */
  /* 唯一码参数配置                                                     */
  /* ---------------------------------------------------------------- */

  async getUniqueCodeConfig(): Promise<UniqueCodeConfig> {
    await this.migrateOldKeys();
    const rows = await this.db
      .select()
      .from(systemConfig)
      .where(inArray(systemConfig.configKey, [K_ENABLED, K_LENGTH, K_MAX, K_PREFIX, K_CHECKSUM]));
    const map = new Map(rows.map((r) => [r.configKey, r.configValue]));
    const enabled = map.get(K_ENABLED) === 'true';
    const lengthRaw = map.get(K_LENGTH);
    const maxRaw = map.get(K_MAX);
    return {
      enabled,
      length: lengthRaw != null && lengthRaw !== '' ? parseInt(lengthRaw, 10) : null,
      max: maxRaw != null && maxRaw !== '' ? parseInt(maxRaw, 10) : 0,
      prefix: map.get(K_PREFIX) || null,
      checksum: map.get(K_CHECKSUM) === 'true',
    };
  }

  /**
   * 历史键一次性迁移：将早期 HANGTAG_* 配置迁移到全局 UNIQUE_CODE_* 键。
   * 幂等：仅当新键缺失且旧键存在时才复制并删除旧键。
   */
  private async migrateOldKeys(): Promise<void> {
    const oldKeys = [K_ENABLED_OLD, K_LENGTH_OLD, K_MAX_OLD];
    const rows = await this.db
      .select()
      .from(systemConfig)
      .where(inArray(systemConfig.configKey, oldKeys));
    if (!rows.length) return;
    const map = new Map(rows.map((r) => [r.configKey, r]));
    const newForOld: [string, string, string][] = [
      [K_ENABLED_OLD, K_ENABLED, '唯一码功能总开关'],
      [K_LENGTH_OLD, K_LENGTH, '唯一码长度（位数）'],
      [K_MAX_OLD, K_MAX, '唯一码当前最大已分配值'],
    ];
    for (const [oldK, newK, desc] of newForOld) {
      const oldRow = map.get(oldK);
      if (!oldRow) continue;
      const exists = await this.cfgExists(newK);
      if (!exists) {
        await this.upsertCfg(newK, oldRow.configValue, desc);
      }
      await this.db.delete(systemConfig).where(eq(systemConfig.configKey, oldK));
    }
  }

  async setUniqueCodeConfig(input: {
    enabled: boolean;
    length?: number | null;
    /** 唯一码前缀（品牌码+年份，如 GM26）；空串视为清除 */
    prefix?: string | null;
    /** 是否启用校验位（模 10） */
    checksum?: boolean | null;
    /** 关闭开关时，若已有已分配的唯一码/库存记录，需显式 force=true 才允许关闭 */
    force?: boolean;
  }): Promise<UniqueCodeConfig> {
    const enabled = !!input.enabled;
    let length = input.length ?? null;
    if (length != null) {
      length = Math.trunc(length);
      if (length < 1 || length > 20) {
        throw new BadRequestException('唯一码长度须为 1~20 之间的整数');
      }
    }
    if (enabled && (length == null || length < 1)) {
      throw new BadRequestException('启用唯一码时必须设置唯一码长度');
    }

    const cur = await this.getUniqueCodeConfig();

    // —— 配置变更保护 ——
    // 1) 缩短长度不得使已分配的最大码位数溢出（否则既有码会重叠/截断）
    if (length != null && cur.max > 0) {
      const digits = String(cur.max).length;
      if (length < digits) {
        throw new BadRequestException(
          `唯一码长度不得缩短为 ${length} 位：当前已分配最大码为 ${cur.max}（占 ${digits} 位），缩短将导致既有码位数溢出与重叠`,
        );
      }
    }
    // 2) 重新启用/改变长度须与既有码长度一致（避免已发码位数不一致）
    if (enabled && cur.max > 0 && length != null && cur.length != null && length !== cur.length) {
      throw new BadRequestException(
        `已存在按 ${cur.length} 位分配的唯一码（最大 ${cur.max}），启用/改长度必须与既有长度一致，不可改为 ${length} 位`,
      );
    }
    // 3) 关闭开关保护：存在已分配码或唯一码库存记录时禁止直接关闭（历史码失去校验依据）
    if (!enabled && (cur.max > 0 || (await this.hasIssuedCodes()))) {
      if (!input.force) {
        throw new BadRequestException(
          '当前已存在已分配/在库的唯一码，关闭唯一码开关会导致既有码失去校验依据；如需关闭请显式传 force=true（历史码数据仍保留）',
        );
      }
    }
    // 4) 防伪变更保护：已发码后变更前缀或开关校验位，会使既有码体/校验位失效，需 force
    //    已发码的判定：打印计数器 max>0（吊牌打印分配） 或 已存在件级库存登记记录（registerInbound 入库）
    const newChecksum = input.checksum ?? cur.checksum;
    const newPrefix = input.prefix !== undefined ? (input.prefix || null) : cur.prefix;
    const hasIssued = cur.max > 0 || (await this.hasIssuedCodes());
    if (hasIssued) {
      const checksumChanged = newChecksum !== cur.checksum;
      const prefixChanged = (newPrefix || null) !== (cur.prefix || null);
      if ((checksumChanged || prefixChanged) && !input.force) {
        throw new BadRequestException(
          '当前已分配/已登记唯一码，变更前缀或校验位会使既有码体失效（解析/校验失败）；如需变更请显式传 force=true（既有码需重新打印）',
        );
      }
    }

    await this.upsertCfg(
      K_ENABLED,
      enabled ? 'true' : 'false',
      '唯一码功能总开关',
    );
    if (length != null) {
      await this.upsertCfg(K_LENGTH, String(length), '唯一码长度（位数）');
    }
    if (input.prefix !== undefined) {
      if (input.prefix) {
        await this.upsertCfg(K_PREFIX, input.prefix, '唯一码前缀（品牌码+年份）');
      } else if (await this.cfgExists(K_PREFIX)) {
        await this.db.delete(systemConfig).where(eq(systemConfig.configKey, K_PREFIX));
      }
    }
    if (input.checksum !== undefined) {
      await this.upsertCfg(K_CHECKSUM, newChecksum ? 'true' : 'false', '唯一码校验位开关（模10）');
    }
    // 启用/配置时确保 max 键存在（默认 0），不破坏已有计数
    if (cur.max === 0 && !(await this.cfgExists(K_MAX))) {
      await this.upsertCfg(K_MAX, '0', '唯一码当前最大已分配值');
    }
    return this.getUniqueCodeConfig();
  }

  /** 是否存在已登记的唯一码库存记录（用于关闭开关保护判断） */
  private async hasIssuedCodes(): Promise<boolean> {
    const r = await this.db.execute(
      sql`select 1 from unique_code_stock limit 1`,
    );
    return Array.isArray(r) && r.length > 0;
  }

  /** 仅用于内部：测试 / 重置最大码 */
  async setUniqueCodeMax(max: number): Promise<void> {
    await this.upsertCfg(K_MAX, String(max), '唯一码当前最大已分配值');
  }

  /** 确保 UNIQUE_CODE_MAX 键存在（默认 0），供打印分配防并发前使用 */
  private async ensureMaxKey(): Promise<void> {
    if (!(await this.cfgExists(K_MAX))) {
      await this.upsertCfg(K_MAX, '0', '唯一码当前最大已分配值');
    }
  }

  private async cfgExists(key: string): Promise<boolean> {
    const r = await this.db
      .select({ id: systemConfig.id })
      .from(systemConfig)
      .where(eq(systemConfig.configKey, key))
      .limit(1);
    return r.length > 0;
  }

  private async upsertCfg(
    key: string,
    value: string,
    description: string,
  ): Promise<void> {
    const existing = await this.db
      .select({ id: systemConfig.id })
      .from(systemConfig)
      .where(eq(systemConfig.configKey, key))
      .limit(1);
    if (existing.length) {
      await this.db
        .update(systemConfig)
        .set({ configValue: value, description })
        .where(eq(systemConfig.configKey, key));
    } else {
      await this.db.insert(systemConfig).values({
        configKey: key,
        configValue: value,
        description,
      });
    }
  }

  formatUniqueCode(
    n: number,
    length: number,
    prefix: string | null = null,
    checksum = false,
  ): string {
    return buildUniqueCode(n, length, prefix, checksum);
  }

  /* ---------------------------------------------------------------- */
  /* 吊牌模板 CRUD                                                      */
  /* ---------------------------------------------------------------- */

  async listTemplates() {
    return this.db
      .select()
      .from(hangtagTemplate)
      .orderBy(desc(hangtagTemplate.createdAt));
  }

  async getTemplate(id: string) {
    const r = await this.db
      .select()
      .from(hangtagTemplate)
      .where(eq(hangtagTemplate.id, id))
      .limit(1);
    return r[0] ?? null;
  }

  async createTemplate(input: {
    code: string;
    name: string;
    contentConfig?: any;
    styleConfig?: any;
    isDefault?: boolean;
    status?: string;
    remark?: string;
  }) {
    if (input.isDefault) {
      await this.db
        .update(hangtagTemplate)
        .set({ isDefault: false })
        .where(eq(hangtagTemplate.isDefault, true));
    }
    const [row] = await this.db
      .insert(hangtagTemplate)
      .values({
        code: input.code,
        name: input.name,
        contentConfig: input.contentConfig ?? {},
        styleConfig: input.styleConfig ?? {},
        isDefault: input.isDefault ?? false,
        status: input.status ?? 'active',
        remark: input.remark,
      })
      .returning();
    return row;
  }

  async updateTemplate(
    id: string,
    patch: {
      code?: string;
      name?: string;
      contentConfig?: any;
      styleConfig?: any;
      isDefault?: boolean;
      status?: string;
      remark?: string;
    },
  ) {
    if (patch.isDefault) {
      await this.db
        .update(hangtagTemplate)
        .set({ isDefault: false })
        .where(eq(hangtagTemplate.isDefault, true));
    }
    const set: any = {};
    for (const k of [
      'code',
      'name',
      'contentConfig',
      'styleConfig',
      'isDefault',
      'status',
      'remark',
    ] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    if (!Object.keys(set).length) return this.getTemplate(id);
    await this.db.update(hangtagTemplate).set(set).where(eq(hangtagTemplate.id, id));
    return this.getTemplate(id);
  }

  async deleteTemplate(id: string) {
    await this.db
      .delete(hangtagTemplate)
      .where(eq(hangtagTemplate.id, id));
    return { deleted: true, id };
  }

  /* ---------------------------------------------------------------- */
  /* 二维表生成                                                         */
  /* ---------------------------------------------------------------- */

  /** 按采购单（成品采购单）导入：自动带出 款号×颜色×尺码 的数量 */
  /** 按 款号/颜色/尺码 反查 sku_id（强绑定用），查不到返回 null */
  /**
   * 批量解析 SKU：按去重款号一次性取出所有 SKU，内存中以 款号|颜色|尺码 建索引映射，
   * 替代原先逐件查询（大批量吊牌打印时形成 N+1）。
   */
  private async resolveSkuIds(
    keys: { styleNo: string; color: string; size: string }[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (!keys.length) return result;
    const distinctStyleNos = [...new Set(keys.map((k) => k.styleNo))];
    const rows = await this.db
      .select({
        id: sku.id,
        styleNo: sku.styleNo,
        color: sku.color,
        size: sku.size,
      })
      .from(sku)
      .where(inArray(sku.styleNo, distinctStyleNos));
    const byKey = new Map<string, string>();
    for (const r of rows) {
      byKey.set(`${r.styleNo}|${r.color}|${r.size}`, r.id);
    }
    for (const k of keys) {
      const compositeKey = `${k.styleNo}|${k.color}|${k.size}`;
      result.set(compositeKey, byKey.get(compositeKey) ?? null);
    }
    return result;
  }

  async buildGridFromPurchaseOrder(orderNo: string): Promise<{
    orderNo: string;
    orderId: string;
    supplierName: string;
    styles: StyleGrid[];
  }> {
    const orders = await this.db
      .select()
      .from(garmentPurchaseOrder)
      .where(eq(garmentPurchaseOrder.orderNo, orderNo))
      .limit(1);
    if (!orders.length) {
      throw new NotFoundException(`成品采购单不存在：${orderNo}`);
    }
    const order = orders[0];
    const skus = await this.db
      .select()
      .from(garmentPurchaseOrderSku)
      .where(eq(garmentPurchaseOrderSku.orderId, order.id));
    if (!skus.length) {
      throw new BadRequestException(`成品采购单 ${orderNo} 没有明细`);
    }

    const byStyle = new Map<string, { styleNo: string; cells: GridCell[] }>();
    for (const s of skus) {
      if (!byStyle.has(s.styleNo)) {
        byStyle.set(s.styleNo, { styleNo: s.styleNo, cells: [] });
      }
      byStyle.get(s.styleNo)!.cells.push({
        color: s.color,
        size: s.size,
        quantity: Number(s.quantity ?? 0),
      });
    }

    const styleRows = await this.db
      .select({ styleNo: style.styleNo, name: style.name })
      .from(style)
      .where(
        inArray(
          style.styleNo,
          [...byStyle.keys()],
        ),
      );
    const nameMap = new Map(styleRows.map((r) => [r.styleNo, r.name]));

    const styles: StyleGrid[] = [];
    for (const [styleNo, g] of byStyle) {
      const colors = [...new Set(g.cells.map((c) => c.color))];
      const sizes = [...new Set(g.cells.map((c) => c.size))];
      styles.push({
        styleNo,
        styleName: nameMap.get(styleNo) ?? '',
        colors,
        sizes,
        cells: g.cells,
      });
    }
    return {
      orderNo,
      orderId: order.id,
      supplierName: order.supplierName,
      styles,
    };
  }

  /** 按款号录入：生成 颜色×尺码 二维空表（数量默认 0，由用户设置） */
  async buildGridFromStyle(styleNo: string): Promise<StyleGrid> {
    const styles = await this.db
      .select()
      .from(style)
      .where(eq(style.styleNo, styleNo))
      .limit(1);
    if (!styles.length) {
      throw new NotFoundException(`款号不存在：${styleNo}`);
    }
    const st = styles[0];

    let colors: string[] = [];
    let sizes: string[] = [];
    if (st.colorGroupId) {
      const cg = await this.db
        .select()
        .from(colorGroup)
        .where(eq(colorGroup.id, st.colorGroupId))
        .limit(1);
      if (cg.length && Array.isArray(cg[0].colors)) {
        colors = cg[0].colors.map((c: any) =>
          c && c.value != null ? c.value : c && c.name != null ? c.name : String(c),
        );
      }
    }
    if (st.sizeGroupId) {
      const sg = await this.db
        .select()
        .from(sizeGroup)
        .where(eq(sizeGroup.id, st.sizeGroupId))
        .limit(1);
      if (sg.length && Array.isArray(sg[0].sizes)) {
        sizes = sg[0].sizes.map((s: any) => String(s));
      }
    }
    // 兜底：从已建 SKU 取实际存在的颜色/尺码
    if (!colors.length || !sizes.length) {
      const skus = await this.db
        .select({ color: sku.color, size: sku.size })
        .from(sku)
        .where(eq(sku.styleNo, styleNo));
      if (!colors.length) colors = [...new Set(skus.map((s) => s.color))];
      if (!sizes.length) sizes = [...new Set(skus.map((s) => s.size))];
    }

    const cells: GridCell[] = [];
    for (const c of colors) {
      for (const s of sizes) {
        cells.push({ color: c, size: s, quantity: 0 });
      }
    }
    return { styleNo, styleName: st.name, colors, sizes, cells };
  }

  /* ---------------------------------------------------------------- */
  /* 批量打印                                                           */
  /* ---------------------------------------------------------------- */

  async printTags(input: PrintInput): Promise<PrintResult> {
    const tpl = await this.getTemplate(input.templateId);
    if (!tpl) {
      throw new NotFoundException(`吊牌模板不存在：${input.templateId}`);
    }
    if (!input.items || !input.items.length) {
      throw new BadRequestException('打印明细为空');
    }

    const items = input.items.map((i) => ({
      styleNo: i.styleNo,
      styleName: i.styleName ?? '',
      color: i.color,
      size: i.size,
      quantity: Math.max(0, Math.trunc(Number(i.quantity ?? 0))),
    }));
    // 强绑定 SKU：打印时即按 款号/颜色/尺码 反查 sku_id 落库（不依赖出库时反查）
    // 批量解析（去重款号一次性查询 + 内存映射），避免逐件查询形成 N+1
    const skuKeyMap = await this.resolveSkuIds(items);
    const resolved = items.map((i) => ({
      ...i,
      skuId: skuKeyMap.get(`${i.styleNo}|${i.color}|${i.size}`) ?? null,
    }));
    const totalQty = resolved.reduce((a, b) => a + b.quantity, 0);
    if (totalQty <= 0) {
      throw new BadRequestException('打印总数量为 0，无法打印');
    }

    const cfg = await this.getUniqueCodeConfig();
    let start = 0;
    let end = 0;
    if (input.includeUniqueCode) {
      if (!cfg.enabled) {
        throw new BadRequestException('唯一码未启用，无法在吊牌上打印唯一码');
      }
      if (!cfg.length) {
        throw new BadRequestException('未配置唯一码长度，无法打印唯一码');
      }
      await this.ensureMaxKey();
      // 事务 + 行锁，保证并发打印不会重复分配同一区间
      const alloc = await this.db.transaction(async (tx) => {
        const locked = (await tx.execute(
          sql`select config_value from system_config where config_key = ${K_MAX} for update`,
        )) as any;
        const maxRaw = locked?.[0]?.config_value;
        const max = maxRaw != null && maxRaw !== '' ? parseInt(maxRaw, 10) : 0;
        const s = max + 1;
        const e = s + totalQty - 1;
        await tx.execute(
          sql`update system_config set config_value = ${String(e)} where config_key = ${K_MAX}`,
        );
        return { s, e };
      });
      start = alloc.s;
      end = alloc.e;
    }

    // 为每条明细分配唯一码子区间（连续、不重叠）
    let cursor = start;
    const itemMeta = resolved.map((i) => {
      let cs: number | null = null;
      let ce: number | null = null;
      if (input.includeUniqueCode && i.quantity > 0) {
        cs = cursor;
        ce = cursor + i.quantity - 1;
        cursor = ce + 1;
      }
      return { ...i, uniqueCodeStart: cs, uniqueCodeEnd: ce };
    });

    // 并发安全：原 Date.now() 同毫秒并发会碰撞 .unique() 列导致 500。
    // 改用 UUID v4（去除连字符），碰撞概率可忽略，且不依赖跨进程锁。
    const taskNo = 'HT' + crypto.randomUUID().replace(/-/g, '');
    const printDate =
      input.printDate || new Date().toISOString().slice(0, 10);

    const contentSnapshot = {
      templateName: tpl.name,
      fields: ((tpl.contentConfig as any)?.fields || [])
        .filter((f: any) => f.show)
        .map((f: any) => ({ key: f.key, label: f.label })),
      items: resolved.map((i) => ({
        skuId: i.skuId,
        styleNo: i.styleNo,
        color: i.color,
        size: i.size,
        qty: i.quantity,
      })),
    };

    const [task] = await this.db
      .insert(hangtagPrintTask)
      .values({
        taskNo,
        templateId: tpl.id,
        templateName: tpl.name,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        includeUniqueCode: !!input.includeUniqueCode,
        printDate,
        totalQty: String(totalQty),
        uniqueCodeStart: input.includeUniqueCode ? start : null,
        uniqueCodeEnd: input.includeUniqueCode ? end : null,
        contentSnapshot,
      })
      .returning();

    await this.db.insert(hangtagPrintItem).values(
      itemMeta.map((m) => ({
        taskId: task.id,
        styleNo: m.styleNo,
        styleName: m.styleName,
        color: m.color,
        size: m.size,
        skuId: m.skuId,
        quantity: String(m.quantity),
        uniqueCodeStart: m.uniqueCodeStart,
        uniqueCodeEnd: m.uniqueCodeEnd,
      })),
    );

    // 打印唯一码完成后，写回最大码，保证后续续增
    if (input.includeUniqueCode) {
      await this.setUniqueCodeMax(end);
    }

    const sampleCodes: string[] = [];
    if (input.includeUniqueCode && cfg.length) {
      for (let n = start; n <= Math.min(end, start + 2); n++) {
        sampleCodes.push(this.formatUniqueCode(n, cfg.length, cfg.prefix, cfg.checksum));
      }
    }

    // 逐件唯一码完整列表：供前端"每件吊牌溯源二维码"使用（消费者扫码跳公开溯源页）
    const uniqueCodes: string[] = [];
    if (input.includeUniqueCode && cfg.length) {
      for (let n = start; n <= end; n++) {
        uniqueCodes.push(this.formatUniqueCode(n, cfg.length, cfg.prefix, cfg.checksum));
      }
    }

    return {
      taskId: task.id,
      taskNo,
      totalQty,
      itemCount: items.length,
      includeUniqueCode: !!input.includeUniqueCode,
      uniqueCodeStart: input.includeUniqueCode ? start : null,
      uniqueCodeEnd: input.includeUniqueCode ? end : null,
      sampleCodes,
      uniqueCodes,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 打印日志                                                           */
  /* ---------------------------------------------------------------- */

  async listLogs(filter?: {
    from?: string;
    to?: string;
    sourceType?: string;
  }) {
    const where: any[] = [];
    if (filter?.from) where.push(gte(hangtagPrintTask.printDate, filter.from));
    if (filter?.to) where.push(lte(hangtagPrintTask.printDate, filter.to));
    if (filter?.sourceType)
      where.push(eq(hangtagPrintTask.sourceType, filter.sourceType));
    return this.db
      .select()
      .from(hangtagPrintTask)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(hangtagPrintTask.printDate), desc(hangtagPrintTask.createdAt));
  }

  async getLogItems(taskId: string) {
    return this.db
      .select()
      .from(hangtagPrintItem)
      .where(eq(hangtagPrintItem.taskId, taskId))
      .orderBy(hangtagPrintItem.createdAt);
  }

  /** 打印日志 → CSV（含 UTF-8 BOM，防 Excel 乱码） */
  toLogsCsv(rows: any[]): string {
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = [
      '打印日期',
      '打印单号',
      '模板',
      '来源类型',
      '来源单号/款号',
      '是否打印唯一码',
      '唯一码区间',
      '打印数量',
      '打印内容摘要',
    ];
    const lines = [header.map(esc).join(',')];
    for (const r of rows) {
      const snap = r.contentSnapshot || {};
      const items: any[] = snap.items || [];
      const summary = items
        .map(
          (it: any) =>
            `${it.styleNo}|${it.color}|${it.size}×${it.qty}`,
        )
        .join('; ');
      const ucRange =
        r.includeUniqueCode && r.uniqueCodeStart != null
          ? `${r.uniqueCodeStart}~${r.uniqueCodeEnd}`
          : '—';
      lines.push(
        [
          r.printDate,
          r.taskNo,
          r.templateName,
          r.sourceType,
          r.sourceRef,
          r.includeUniqueCode ? '是' : '否',
          ucRange,
          r.totalQty,
          summary,
        ]
          .map(esc)
          .join(','),
      );
    }
    return '﻿' + lines.join('\r\n');
  }
}
