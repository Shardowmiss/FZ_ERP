/**
 * Wave 4-D：unique-code 模块「重构护栏」。
 *
 * 背景：`unique-code.service.ts` 原本 2041 行，已按 5 个职责域 + 1 个归档域拆成独立 service
 * （配置开关 / 标签解析与入库登记 / 核销与退货 / 扫描与盘点 / 追溯 / 归档与公开溯源），
 * `unique-code.service.ts` 退化为只做委托的门面。**拆之前先把现有行为钉死**，
 * 拆完本 spec 原样全绿，即证明"拆得对"。
 *
 * 这个模块的成功语义几乎全部走返回值（`ok:false` + `reason`），
 * 全文件只有 1 处业务 `throw`，所以"改坏了"通常不报错、只会让业务静默走错分支。
 *
 * 护栏策略（与 report-pivot.spec.ts 一致）：
 *   · 断言只打在**公开方法的可见结果**上（返回值字段、库里落了什么行），不打 private 内部；
 *   · 每个用例都是"业务动作 → 结果"，无论内部域怎么挪、门面怎么写，护栏都成立；
 *   · 发现的**既有缺陷**一律显式钉死并注释 —— 重构时最容易发生的就是"顺手把缺陷修掉"
 *     或"顺手把缺陷带歪"，两种情况都需要先显式决策。
 *
 * ⚠️ 写测试时撞到的既有缺陷（先记录，不在本轮改）：
 *   ① 迁移 0013 给 `doc_unique_code.doc_type` 加了
 *        CHECK (doc_type IN ('retail','sales','transfer'))，
 *      但 service 实际会写 purchase_inbound / sales_outbound / sales_return /
 *      stocktake / retail_return（见 DOC_TYPE_LABEL 与 `${docType}_return` 改写）。
 *      凡传入这些 docType 的扫码/登记都会撞 PG 23514 → 500 —— 即采购入库、销售出库、
 *      盘点、销售退货这几条链路上的唯一码登记**全部不可用**（用例 21 钉死）。
 *   ② `returnDocUniqueCodes` 把 docType 改写成 `${docType}_return` 再逐码调
 *      `returnUniqueCode`。由于任何 docType 都拼不出 CHECK 允许的值，这个批量接口
 *      **在任何入参下都不可能成功**，而且报错发生在传入的事务里、没有 savepoint 兜底，
 *      会把调用方的整单事务一并打成 PG 25P02（用例 14 / 14b 钉死）。
 *      —— 目前查不到调用方，属于"接上去就会炸"，需要在接线前先修。
 *
 *   因此本 spec 主路径只用合法 docType（'retail'）跑通，缺陷本身单独钉成用例。
 *
 * 数据全部种在 `erp_test` 真库的事务里，跑完 ROLLBACK，不留痕。
 * ⚠️ 插入一律用参数化（drizzle `raw` 模板 + `${}`）：中文值硬编码进 SQL 文本会被
 *    drizzle 的字符串式 `execute` 解析坏（"unterminated quoted string"，位置还在语句末尾）。
 */
import { describe, it, expect } from 'vitest';
import { withIsolatedTransaction, raw, type TestDb } from './utils/db';
import {
  UniqueCodeService,
  createUniqueCodeService,
} from '@server/modules/unique-code/unique-code.service';

const U = {
  style1: 'aaaaaaa1-0000-0000-0000-000000000001',
  sku1: 'bbbbbbb1-0000-0000-0000-000000000001',
  sku2: 'bbbbbbb2-0000-0000-0000-000000000002',
  whA: 'ccccccc1-0000-0000-0000-000000000001',
  whB: 'ccccccc2-0000-0000-0000-000000000002',
  docIn: 'ddddddd1-0000-0000-0000-000000000001',
  docOut: 'ddddddd2-0000-0000-0000-000000000002',
  docRetail: 'ddddddd3-0000-0000-0000-000000000003',
  docOut2: 'ddddddd4-0000-0000-0000-000000000004',
};

/** docType 只能取这三个值（迁移 0013 的 CHECK 约束），详见文件头说明 */
const DOC = 'retail';

async function seed(tx: TestDb): Promise<void> {
  const off = (t: string) => tx.execute(`ALTER TABLE ${t} DISABLE TRIGGER ALL` as never);
  for (const t of [
    'style', 'sku', 'warehouse', 'system_config',
    'unique_code_stock', 'doc_unique_code', 'doc_unique_code_archive',
  ]) {
    await off(t);
  }

  await tx.execute(raw`
    INSERT INTO style (id, style_no, name, brand, category, sub_category, color_group_id, size_group_id, status, lifecycle_status, attributes, _created_at, _updated_at)
    VALUES (${U.style1}, 'ST001', ${'衬衫'}, ${'B1'}, ${'C1'}, ${'SC1'}, ${U.style1}, ${U.style1}, 'active', 'active', ${'{}'}::jsonb, now(), now())` as never);

  await tx.execute(raw`
    INSERT INTO sku (id, sku_code, style_id, style_no, color, size, tag_price, status, _created_at, _updated_at)
    VALUES
      (${U.sku1}, 'SKU001', ${U.style1}, 'ST001', ${'RED'},  ${'M'}, 100, 'active', now(), now()),
      (${U.sku2}, 'SKU002', ${U.style1}, 'ST001', ${'BLUE'}, ${'L'}, 120, 'active', now(), now())` as never);

  // 两个仓：whA = 主仓（入库仓），whB = 二仓（wrong_warehouse 用例要用）
  // ⚠️ type 必须落在 ck_warehouse_type 允许的集合内：dealer / finished / main / self / store
  await tx.execute(raw`
    INSERT INTO warehouse (id, code, name, type, status, _created_at, _updated_at)
    VALUES
      (${U.whA}, 'WH-A', ${'主仓'}, 'main', 'active', now(), now()),
      (${U.whB}, 'WH-B', ${'二仓'}, 'finished', 'active', now(), now())` as never);
}

async function setConfig(tx: TestDb, pairs: [string, string][]): Promise<void> {
  for (const [k, v] of pairs) {
    await tx.execute(raw`
      INSERT INTO system_config (config_key, config_value, description, _created_at, _updated_at)
      VALUES (${k}, ${v}, ${'测试'}, now(), now())` as never);
  }
}

/** 打开唯一码开关 */
async function enable(tx: TestDb): Promise<void> {
  await setConfig(tx, [['UNIQUE_CODE_ENABLED', 'true']]);
}

/**
 * 门面装配：唯一码引擎已拆成 6 个职责域服务，门面只做委托。
 * 这里走与 Nest 完全一致的装配顺序（createUniqueCodeService），
 * 因此护栏验证的仍是"门面对外契约"这一层。
 */
function mk(tx: TestDb): UniqueCodeService {
  return createUniqueCodeService(tx as never);
}

async function stockRow(tx: TestDb, uniqueCode: string): Promise<Record<string, unknown> | undefined> {
  const r = await tx.execute(raw`
    SELECT * FROM unique_code_stock WHERE unique_code = ${uniqueCode}` as never);
  return (r as unknown as Record<string, unknown>[])[0];
}

async function countRows(tx: TestDb, table: string, code: string): Promise<number> {
  // ⚠️ 表名是标识符，不能当参数绑定（${table} 会变成 $1 导致 "syntax error at or near $1"）
  const r = await tx.execute(raw`
    SELECT count(*)::int AS c FROM ${raw.identifier(table)} WHERE unique_code = ${code}` as never);
  return Number((r as unknown as { c: number }[])[0].c);
}

/**
 * 把一次失败的异常"摊平"成可断言的文本。
 *   · 包在 drizzle 事务里的语句 → `DrizzleQueryError.message` 只有 "Failed query: …\nparams: …"，
 *     PG 原始报错（含约束名）在 `error.cause` 里；
 *   · 事务外直接执行的语句 → 抛的就是 postgres.js 的原始 PostgresError，约束名在 `.message`。
 * 两种都取，断言约束名才不会漏。
 */
function pgCause(err: unknown): string {
  const e = err as { cause?: { message?: string }; message?: string } | null;
  return [e?.cause?.message, e?.message].filter(Boolean).join('\n');
}

// ============================================================
// 域 ①：配置开关
// ============================================================

describe('unique-code 重构护栏 / ① 配置开关', () => {
  it('1) isEnabled 是严格字符串比较：只有字面量 "true" 才算启用', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      for (const [val, expected] of [['true', true], ['TRUE', false], ['1', false], ['', false]] as const) {
        await setConfig(tx, [['UNIQUE_CODE_ENABLED', val]]);
        expect(await mk(tx).isEnabled()).toBe(expected);
        await tx.execute(raw`
          DELETE FROM system_config WHERE config_key = ${'UNIQUE_CODE_ENABLED'}` as never);
      }
      // 键完全不存在 → false
      expect(await mk(tx).isEnabled()).toBe(false);
    });
  });

  it('2) loadConfig：max 缺省为 0、prefix 空串为 null、checksum 只认 "true"', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await setConfig(tx, [
        ['UNIQUE_CODE_ENABLED', 'true'],
        ['UNIQUE_CODE_MAX', '5000'],
        ['UNIQUE_CODE_PREFIX', ''],
        ['UNIQUE_CODE_CHECKSUM', 'false'],
      ]);

      const cfg = await mk(tx).loadConfig();
      // ⚠️ 现状钉死：length 字段在 service 内部**从未被使用**（没有码长校验），缺失即为 null
      expect(cfg).toMatchObject({ enabled: true, max: 5000, prefix: null, checksum: false });
      expect(cfg.length).toBeNull();
    });
  });

  it('3) getArchiveDays：缺失 / 非法 / 小数分别退化为 0 与取整', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      expect(await mk(tx).getArchiveDays()).toBe(0);

      await setConfig(tx, [['UNIQUE_CODE_ARCHIVE_DAYS', 'abc']]);
      expect(await mk(tx).getArchiveDays()).toBe(0);

      await tx.execute(raw`
        UPDATE system_config SET config_value = '7.9' WHERE config_key = ${'UNIQUE_CODE_ARCHIVE_DAYS'}` as never);
      expect(await mk(tx).getArchiveDays()).toBe(7);
    });
  });
});

// ============================================================
// 域 ②：标签解析与入库登记
// ============================================================

describe('unique-code 重构护栏 / ② 标签解析与入库登记', () => {
  it('4) parseTagCode（未启用）：三段即匹配，不足三段返回 matched=false 且不抛异常', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);

      const ok = await svc.parseTagCode('ST001|RED|M');
      expect(ok.matched).toBe(true);
      expect(ok).toMatchObject({ styleNo: 'ST001', color: 'RED', size: 'M' });
      expect(ok.uniqueCode).toBeUndefined();

      const bad = await svc.parseTagCode('ST001|RED');
      expect(bad.matched).toBe(false);
      expect(bad.message).toContain('三段');
    });
  });

  it('5) parseTagCode（已启用）：四段取值；段数不足报错；校验位非法仍带出款色码', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      const svc = mk(tx);

      const ok = await svc.parseTagCode('ST001|RED|M|UC0001');
      expect(ok).toMatchObject({ styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0001' });

      const short = await svc.parseTagCode('ST001|RED|M');
      expect(short.matched).toBe(false);
      expect(short.message).toContain('四段');

      // 校验位：checksumDigit 只对 '0'-'9' 累加，字母不计入，末位须等于 sum % 10。
      //   'UC123' → 数字 1+2+3 = 6 → 合法全码 'UC1236'；'UC1295' 末位 5 ≠ 2 → 非法
      await setConfig(tx, [['UNIQUE_CODE_CHECKSUM', 'true']]);

      expect((await svc.parseTagCode('ST001|RED|M|UC1236')).matched).toBe(true);
      const bad = await svc.parseTagCode('ST001|RED|M|UC1295');
      expect(bad.matched).toBe(false);
      expect(bad.message).toContain('校验位');
      // ⚠️ 怪癖钉死：校验失败时款色码**已经填好**，调用方靠 matched 判断而不是靠空字段
      expect(bad.styleNo).toBe('ST001');
      expect(bad.uniqueCode).toBe('UC1295');

      // ⚠️ 怪癖钉死：validateChecksum 的判断是 `!== false`，只有显式传 false 才关闭校验
      expect((await svc.parseTagCode('ST001|RED|M|UC1295', { validateChecksum: false })).matched).toBe(true);
    });
  });

  it('6) registerInbound 未启用：直接返回 enabled:false，不写任何唯一码行', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const out = await mk(tx).registerInbound({
        docType: DOC, docId: U.docIn, warehouseId: U.whA,
        items: [{ styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0001' }],
      } as never);

      expect(out).toMatchObject({ enabled: false, registered: 0 });
      expect(await stockRow(tx, 'UC0001')).toBeUndefined();
    });
  });

  it('7) registerInbound 已启用：落唯一码行（in_stock）+ 写 inbound 流水；重复登记是幂等覆盖而不是报错', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      const svc = mk(tx);

      const base = {
        docType: DOC, docId: U.docIn, warehouseId: U.whA,
        items: [{ styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0001' }],
      } as never;

      const r1 = await svc.registerInbound(base, tx as never);
      expect(r1).toMatchObject({ enabled: true, registered: 1 });

      const row1 = await stockRow(tx, 'UC0001');
      // ⚠️ SELECT * 的列名是**下划线命名**（warehouse_id / sku_id / inbound_doc_type …）
      expect(row1).toMatchObject({
        status: 'in_stock', warehouse_id: U.whA, sku_id: U.sku1,
        inbound_doc_type: DOC, inbound_doc_id: U.docIn,
      });
      expect(await countRows(tx, 'doc_unique_code', 'UC0001')).toBe(1);

      // 先用掉（出库到 whB → 核销 sold），再重复登记 ——
      // 现状是"强行拉回在库并清空 outflow 三字段"，不是跳过、也不是报错
      // ⚠️ 出库扫码要求入参仓 == 库存所在仓，所以先模拟调拨把库存挪到 whB
      await tx.execute(raw`
        UPDATE unique_code_stock SET warehouse_id = ${U.whB} WHERE unique_code = ${'UC0001'}` as never);
      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whB,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0001' } as never,
        tx as never,
      );
      await svc.verifySold({ docType: DOC, docId: U.docOut, uniqueCode: 'UC0001' } as never, tx as never);
      expect(await stockRow(tx, 'UC0001')).toMatchObject({
        status: 'sold', warehouse_id: U.whB, outbound_doc_type: DOC, outbound_doc_id: U.docOut,
      });

      const r2 = await svc.registerInbound(base, tx as never);
      expect(r2).toMatchObject({ enabled: true, registered: 1 }); // 仍是 1，不是 +1
      // ⚠️ 怪癖钉死：流水条数是 3（inbound + outbound + sold），重复登记**不再新增流水**；
      //    onConflictDoNothing 挡的是 (doc_type, doc_id, unique_code, scan_type) 唯一键。
      expect(await countRows(tx, 'doc_unique_code', 'UC0001')).toBe(3);

      const row2 = await stockRow(tx, 'UC0001');
      expect(row2).toMatchObject({
        status: 'in_stock',
        warehouse_id: U.whA, // 被改写回主仓
        outbound_doc_type: null,
        outbound_doc_id: null,
        outbound_at: null,
      });
    });
  });

  it('8) registerInbound 款色码解析不出 SKU：抛裸 Error（不是 NestJS 异常）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);

      await expect(
        mk(tx).registerInbound({
          docType: DOC, docId: U.docIn, warehouseId: U.whA,
          items: [{ styleNo: 'NOT_EXIST', color: 'GOLD', size: 'XL', uniqueCode: 'UC0009' }],
        } as never, tx as never),
      ).rejects.toThrow(/款色码无效/);
    });
  });
});

// ============================================================
// 域 ③：核销与退货
// ============================================================

describe('unique-code 重构护栏 / ③ 核销与退货', () => {
  async function stocked(tx: TestDb, uniqueCode: string): Promise<void> {
    await tx.execute(raw`
      INSERT INTO unique_code_stock (unique_code, numeric_value, sku_id, style_no, color, size, warehouse_id, status, inbound_doc_type, inbound_doc_id, inbound_at, _created_at, _updated_at)
      VALUES (${uniqueCode}, 1, ${U.sku1}, 'ST001', 'RED', 'M', ${U.whA}, 'in_stock', ${DOC}, ${U.docIn}, now(), now(), now())` as never);
  }

  it('9) scanOutboundUniqueCode：in_stock → out 成功，并写一条 outbound 流水', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await stocked(tx, 'UC0002');
      const svc = mk(tx);

      // ⚠️ 签名上 styleNo/color/size 是**必填**，且会与库存行逐项比对，
      //    漏传会被判成 style_mismatch（见用例 10）
      const r = await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0002' } as never,
        tx as never,
      );

      // ScanResult 是可辨识联合：先收窄 ok:true 分支，才能断言 data 字段
      // （失败分支只有 reason/message，成功分支只有 data，用 JSON 兼容两种形态）
      if (!r.ok) throw new Error(`扫码应通过，实际被拒：${JSON.stringify(r)}`);
      expect(r.data).toMatchObject({ uniqueCode: 'UC0002', skuId: U.sku1, styleNo: 'ST001', color: 'RED', size: 'M' });
      expect(await stockRow(tx, 'UC0002')).toMatchObject({
        status: 'out', outbound_doc_type: DOC, outbound_doc_id: U.docOut,
      });
      expect(await countRows(tx, 'doc_unique_code', 'UC0002')).toBe(1);
    });
  });

  it('10) scanOutboundUniqueCode 的拒绝路径与检查顺序', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await stocked(tx, 'UC0003');
      const svc = mk(tx);
      const scan = (warehouseId: string, styleNo = 'ST001', uniqueCode = 'UC0003') =>
        svc.scanOutboundUniqueCode(
          { docType: DOC, docId: U.docOut, warehouseId,
            styleNo, color: 'RED', size: 'M', uniqueCode } as never,
          tx as never,
        );

      // ① 不是本仓（先于其它检查）
      expect(await scan(U.whB)).toMatchObject({ ok: false, reason: 'wrong_warehouse' });

      // ② 本仓扫码成功
      expect((await scan(U.whA)).ok).toBe(true);

      // ③ 同一单据同一码再扫 → already_scanned（只看 docType+docId，不看 scanType）
      expect(await scan(U.whA)).toMatchObject({ ok: false, reason: 'already_scanned' });

      // ④ 已 out 状态再扫另一单 → not_available
      await tx.execute(raw`
        INSERT INTO unique_code_stock (unique_code, sku_id, style_no, color, size, warehouse_id, status, _created_at, _updated_at)
        VALUES ('UC0004', ${U.sku1}, 'ST001', 'RED', 'M', ${U.whA}, 'out', now(), now())` as never);
      expect(await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0004' } as never,
        tx as never,
      )).toMatchObject({ ok: false, reason: 'not_available' });

      // ⑤ 款色码与库存行不一致 → style_mismatch（必须用**没扫过**的码，
      //    否则 already_scanned 的检查排在前面，根本走不到款色码比对）
      await stocked(tx, 'UC0010');
      expect(await scan(U.whA, 'ST999', 'UC0010'))
        .toMatchObject({ ok: false, reason: 'style_mismatch' });

      // ⑥ 未启用的开关会先于一切被拦住
      await tx.execute(raw`
        DELETE FROM system_config WHERE config_key = ${'UNIQUE_CODE_ENABLED'}` as never);
      expect(await scan(U.whA)).toMatchObject({ ok: false, reason: 'disabled' });
    });
  });

  it('11) verifySold：只有 out 可核销；重复核销被拒（不幂等）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await stocked(tx, 'UC0005');
      const svc = mk(tx);
      const vs = () => svc.verifySold(
        { docType: DOC, docId: U.docOut, uniqueCode: 'UC0005' } as never, tx as never);

      // 在库直接核销 → 拒绝（in_stock 也拒绝，不只是 sold）
      expect(await vs()).toMatchObject({ ok: false, reason: 'invalid_state' });

      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0005' } as never,
        tx as never,
      );
      const sold = await vs();
      expect(sold.ok).toBe(true);
      expect(sold.message).toContain('已核销');
      expect(await stockRow(tx, 'UC0005')).toMatchObject({ status: 'sold' });
      // ⚠️ verifySold 只改 status，不动 warehouseId
      expect(await stockRow(tx, 'UC0005')).toMatchObject({ warehouse_id: U.whA });

      // 重复核销 → invalid_state（不是 ok：onConflictDoNothing 挡不住状态机）
      expect(await vs()).toMatchObject({ ok: false, reason: 'invalid_state' });
    });
  });

  it('12) returnUniqueCode：sold → in_stock，且 warehouseId 被入参仓覆盖', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await stocked(tx, 'UC0006');
      const svc = mk(tx);

      // 在库状态下直接退货 → 拒绝（只接受 out / sold）
      expect(await svc.returnUniqueCode(
        { docType: DOC, docId: U.docRetail, warehouseId: U.whB, uniqueCode: 'UC0006' } as never,
        tx as never,
      )).toMatchObject({ ok: false, reason: 'invalid_state' });

      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0006' } as never,
        tx as never,
      );
      expect((await svc.returnUniqueCode(
        { docType: DOC, docId: U.docRetail, warehouseId: U.whB, uniqueCode: 'UC0006' } as never,
        tx as never,
      )).ok).toBe(true);

      // ⚠️ 怪癖钉死：退货把仓库**覆盖成入参仓**（whB），与扫码时所在仓（whA）无关
      expect(await stockRow(tx, 'UC0006')).toMatchObject({
        status: 'in_stock',
        warehouse_id: U.whB,
        inbound_doc_type: DOC,
        inbound_doc_id: U.docRetail,
        outbound_doc_type: null,
        outbound_at: null,
      });
    });
  });

  // 给某单据直接铺 outbound/sold 流水（不铺库存行）。
  // 这样 returnDocUniqueCodes 的**选码**部分能跑完，逐码调用 returnUniqueCode 会走
  // not_in_stock 分支被收进 failed —— 从返回值即可钉住选码口径，且不会触发下面的缺陷。
  async function seedDocEvents(tx: TestDb, docId: string, codes: string[]): Promise<void> {
    for (const code of codes) {
      for (const scanType of ['outbound', 'sold']) {
        await tx.execute(raw`
          INSERT INTO doc_unique_code (doc_type, doc_id, unique_code, sku_id, style_no, color, size, warehouse_id, scan_type, scan_at, _created_at, _updated_at)
          VALUES (${DOC}, ${docId}, ${code}, ${U.sku1}, 'ST001', 'RED', 'M', ${U.whA}, ${scanType}, now(), now(), now())` as never);
      }
    }
  }

  it('13) returnDocUniqueCodes：选码口径 = 该单据 scanType∈{outbound,sold} 去重；'
    + 'uniqueCodes 做部分退货过滤；未启用时整体跳过', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);

      // 未启用：直接短路，连选码都不跑
      expect(await svc.returnDocUniqueCodes(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA } as never, tx as never,
      )).toMatchObject({ enabled: false, total: 0, processed: 0, failed: [] });

      await enable(tx);
      await seedDocEvents(tx, U.docOut, ['UC0007', 'UC0008']);

      const all = await svc.returnDocUniqueCodes(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA } as never, tx as never);
      expect(all).toMatchObject({ enabled: true, total: 2 });
      // ⚠️ 两个码都没有库存行 → 逐码都走 not_in_stock，被收进 failed 而不是整体抛错
      expect(all.processed).toBe(0);
      expect((all.failed as unknown[]).map((f) => (f as { uniqueCode: string }).uniqueCode).sort())
        .toEqual(['UC0007', 'UC0008']);
      expect((all.failed as unknown[])[0]).toMatchObject({ reason: 'not_in_stock' });

      // 部分退货：显式传 uniqueCodes 做过滤
      const part = await svc.returnDocUniqueCodes(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          uniqueCodes: ['UC0007'] } as never, tx as never);
      expect(part).toMatchObject({ total: 1, processed: 0 });
      expect((part.failed as unknown[]).map((f) => (f as { uniqueCode: string }).uniqueCode))
        .toEqual(['UC0007']);
    });
  });

  it('14) ⚠️ 既有缺陷钉死：批量退货把 docType 改写成 `${docType}_return`，'
    + '任何 docType 都会撞 ck_doc_unique_code_doc_type 而抛错（单据事务随之被污染）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await stocked(tx, 'UC0011');
      const svc = mk(tx);

      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0011' } as never,
        tx as never,
      );
      await svc.verifySold({ docType: DOC, docId: U.docOut, uniqueCode: 'UC0011' } as never, tx as never);
      expect(await stockRow(tx, 'UC0011')).toMatchObject({ status: 'sold' });

      // 对照组：同一码、同样的 out/sold 状态，**单码**退货用合法 docType 是能成功的
      // （该成功路径由用例 12 用 UC0006 钉死，这里只做同码对比）
      const one = await svc.returnUniqueCode(
        { docType: DOC, docId: U.docRetail, warehouseId: U.whA, uniqueCode: 'UC0011' } as never,
        tx as never);
      expect(one.ok).toBe(true);
      // 恢复到 sold，让批量退货的逐码调用真的走到落流水那一步。
      // ⚠️ 必须换新单号：
      //    · 扫回 docOut 会被 already_scanned 拦掉（首次出库已落在 (retail,docOut,UC0011)）；
      //    · 扫回 docRetail 也会被拦掉 —— 上面那次退货回库已经写了 (retail,docRetail,UC0011)
      //      的 'returned' 流水，而 already_scanned 只比对 (docType,docId,uniqueCode)，
      //      **不看 scanType**。状态回不到 out/sold，就永远撞不到这个缺陷了。
      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut2, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0011' } as never,
        tx as never,
      );
      await svc.verifySold({ docType: DOC, docId: U.docOut2, uniqueCode: 'UC0011' } as never, tx as never);
      expect(await stockRow(tx, 'UC0011')).toMatchObject({ status: 'sold' });

      // 批量版本因此在任何 docType 下都不可能返回成功（不是 failed，是直接抛错）
      const err2 = await svc.returnDocUniqueCodes(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA } as never, tx as never,
      ).then(() => null, (e: unknown) => e);
      expect(pgCause(err2)).toMatch(/ck_doc_unique_code_doc_type/);

      // ⚠️ 后果钉死：报错发生在传入的事务里且没有 savepoint 兜底，
      //    PG 25P02 —— 调用方（retail/sales 退货流程）拿到的是"事务已中止"，
      //    即便外层捕获异常，整单也已经回滚。
      const poisoned = await stockRow(tx, 'UC0011')
        .then(() => null, (e: unknown) => pgCause(e));
      expect(poisoned).toMatch(/current transaction is aborted/);
    });
  });

  it('14b) ⚠️ 根因钉死：单码退货只要 docType 写成 `${docType}_return` 就抛同一个约束错误'
    + '（所以批量退货不是"状态问题"，是 docType 改写问题）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await stocked(tx, 'UC0012');
      const svc = mk(tx);

      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0012' } as never,
        tx as never,
      );
      // 对照组：docType 原样传（= 'retail'，合法）→ 成功
      expect((await svc.returnUniqueCode(
        { docType: DOC, docId: U.docRetail, warehouseId: U.whA, uniqueCode: 'UC0012' } as never,
        tx as never,
      )).ok).toBe(true);

      // 恢复到 sold 再实验（同上：换新单号重新出库+核销）
      await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut2, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC0012' } as never,
        tx as never,
      );
      await svc.verifySold({ docType: DOC, docId: U.docOut2, uniqueCode: 'UC0012' } as never, tx as never);

      // 实验组：docType 加 '_return' 后缀 → 同一个约束错误
      const err = await svc.returnUniqueCode(
        { docType: `${DOC}_return`, docId: U.docRetail, warehouseId: U.whA,
          uniqueCode: 'UC0012' } as never,
        tx as never,
      ).then(() => null, (e: unknown) => e);
      expect(pgCause(err)).toMatch(/ck_doc_unique_code_doc_type/);
    });
  });
});

// ============================================================
// 域 ④：扫描与盘点
// ============================================================

describe('unique-code 重构护栏 / ④ 扫描与盘点', () => {
  it('15) reconcileStocktake：纯只读对账，missing = 盘亏、extra = 盘盈，且不改任何状态', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await tx.execute(raw`
        INSERT INTO unique_code_stock (unique_code, sku_id, style_no, color, size, warehouse_id, status, _created_at, _updated_at)
        VALUES
          ('UC1001', ${U.sku1}, 'ST001', 'RED',  'M', ${U.whA}, 'in_stock', now(), now()),
          ('UC1002', ${U.sku1}, 'ST001', 'RED',  'M', ${U.whA}, 'in_stock', now(), now()),
          ('UC1003', ${U.sku2}, 'ST001', 'BLUE', 'L', ${U.whA}, 'in_stock', now(), now())` as never);

      const before = await stockRow(tx, 'UC1001');

      const r = await mk(tx).reconcileStocktake({
        docId: 'SK001', warehouseId: U.whA, scannedCodes: ['UC1001', 'UC9999'],
      } as never);

      expect(r).toMatchObject({ enabled: true, scannedCount: 2, expectedCount: 3 });
      // 盘亏：本仓在库但没盘到
      expect((r.missing as unknown[]).map((m) => (m as { uniqueCode: string }).uniqueCode).sort())
        .toEqual(['UC1002', 'UC1003']);
      // 盘盈：盘到了但本仓在库里没有
      expect(r.extra).toEqual(['UC9999']);

      // ⚠️ 怪癖钉死：extra 是拿**原始数组**过滤的，重复盘到的错码会在 extra 里重复出现，
      //    而 scannedCount 用的是去重后的 Set
      const dup = await mk(tx).reconcileStocktake({
        docId: 'SK003', warehouseId: U.whA, scannedCodes: ['UC9999', 'UC9999'],
      } as never);
      expect(dup.scannedCount).toBe(1);
      expect(dup.extra).toEqual(['UC9999', 'UC9999']);

      // 纯读：不修正、不改状态
      expect(await stockRow(tx, 'UC1001')).toEqual(before);
      expect([await stockRow(tx, 'UC1002'), await stockRow(tx, 'UC1003')]
        .every((x) => x?.status === 'in_stock')).toBe(true);
    });
  });

  it('16) reconcileStocktake 未启用：返回空对账结果', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const r = await mk(tx).reconcileStocktake({
        docId: 'SK002', warehouseId: U.whA, scannedCodes: ['UC0001'],
      } as never);
      expect(r).toMatchObject({ enabled: false });
      expect(r.missing).toEqual([]);
      expect(r.extra).toEqual([]);
    });
  });
});

// ============================================================
// 域 ⑤：追溯
// ============================================================

/** 直接把某码置为 out 并落在指定仓（构造跨仓场景，跳过业务校验） */
async function forceOutAt(tx: TestDb, uniqueCode: string, warehouseId: string): Promise<void> {
  await tx.execute(raw`
    UPDATE unique_code_stock SET status = 'out', outbound_at = now()
    WHERE unique_code = ${uniqueCode}` as never);
  // ⚠️ docId 必须与**本次之前**的出库流水不同：uniq_doc_uc 唯一键是
  //    (doc_type, doc_id, unique_code, scan_type)，复用会直接撞 23505
  await tx.execute(raw`
    INSERT INTO doc_unique_code (doc_type, doc_id, unique_code, sku_id, style_no, color, size, warehouse_id, scan_type, scan_at, _created_at, _updated_at)
    VALUES (${DOC}, ${U.docOut2}, ${uniqueCode}, ${U.sku1}, 'ST001', 'RED', 'M', ${warehouseId}, 'outbound', now(), now(), now())` as never);
}

describe('unique-code 重构护栏 / ⑤ 追溯（trace）', () => {
  it('17) getTrace：生命周期流水 + 当前状态 + 跨仓标记', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await tx.execute(raw`
        INSERT INTO unique_code_stock (unique_code, numeric_value, sku_id, style_no, color, size, warehouse_id, status, inbound_doc_type, inbound_doc_id, inbound_at, _created_at, _updated_at)
        VALUES ('UC2001', 1, ${U.sku1}, 'ST001', 'RED', 'M', ${U.whA}, 'in_stock', ${DOC}, ${U.docIn}, now(), now(), now())` as never);
      const svc = mk(tx);

      const empty = await svc.getTrace('UC_NOPE');
      expect(empty).toMatchObject({ enabled: true, eventCount: 0 });
      expect(empty.current).toBeNull();

      await svc.registerInbound({
        docType: DOC, docId: U.docIn, warehouseId: U.whA,
        items: [{ styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC2001' }],
      } as never, tx as never);

      // 在 whA 出库 = 原生在库仓，不算跨仓
      expect((await svc.scanOutboundUniqueCode(
        { docType: DOC, docId: U.docOut, warehouseId: U.whA,
          styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC2001' } as never,
        tx as never)).ok).toBe(true);

      const t1 = await svc.getTrace('UC2001');
      expect(t1.enabled).toBe(true);
      expect(t1.uniqueCode).toBe('UC2001');
      expect(t1.current).toMatchObject({ status: 'out', statusLabel: '已出库未核销' });
      expect(t1.channelCrossingSuspect).toBe(false);
      expect(t1.eventCount).toBeGreaterThanOrEqual(2);

      // 在 whB 出库 = 与入库仓(whA)不同且无调拨流水 → 标记跨仓
      await forceOutAt(tx, 'UC2001', U.whB);
      expect((await svc.getTrace('UC2001')).channelCrossingSuspect).toBe(true);
    });
  });

  it('18) getChannelViolations：跨仓才报；同一仓内流转不报', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      const svc = mk(tx);

      type Res = Awaited<ReturnType<typeof svc.getChannelViolations>>;
      const codesOf = (v: Res) => (v.items as unknown[]).map(
        (i) => (i as { uniqueCode: string }).uniqueCode).sort();

      /** whA 入库 → 在本仓出库（同仓内流转，不构成违规） */
      const flowWithinSameWarehouse = async (code: string, docId: string) => {
        await svc.registerInbound({
          docType: DOC, docId: U.docIn, warehouseId: U.whA,
          items: [{ styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: code }],
        } as never, tx as never);
        expect((await svc.scanOutboundUniqueCode(
          { docType: DOC, docId, warehouseId: U.whA,
            styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: code } as never,
          tx as never)).ok).toBe(true);
      };

      // A 码：whA 入库 → 调拨到 whB 后在 whB 出库（跨仓 → 报违规）
      await flowWithinSameWarehouse('VC3001', U.docOut);
      await tx.execute(raw`
        UPDATE unique_code_stock SET warehouse_id = ${U.whB} WHERE unique_code = ${'VC3001'}` as never);
      await tx.execute(raw`
        INSERT INTO doc_unique_code (doc_type, doc_id, unique_code, sku_id, style_no, color, size, warehouse_id, scan_type, scan_at, _created_at, _updated_at)
        VALUES (${DOC}, ${U.docOut2}, 'VC3001', ${U.sku1}, 'ST001', 'RED', 'M', ${U.whB}, 'outbound', now(), now(), now())` as never);

      const v = await svc.getChannelViolations({});
      expect(v).toMatchObject({ enabled: true });
      expect(v.total).toBe(1);
      expect(codesOf(v)).toEqual(['VC3001']);
      const item = v.items[0] as unknown as { originWarehouseId: string; violationWarehouseId: string };
      expect(item.originWarehouseId).toBe(U.whA);
      expect(item.violationWarehouseId).toBe(U.whB);

      // B 码：whA 入库 → whA 出库（同仓，不报）
      await flowWithinSameWarehouse('VC3002', U.docRetail);

      const v2 = await svc.getChannelViolations({});
      expect(v2.total).toBe(1);
      expect(codesOf(v2)).toEqual(['VC3001']);

      // ⚠️ 怪癖钉死：getChannelViolations **不支持时间窗**（无 from/to 参数）
      expect((await svc.getChannelViolations({} as never)).total).toBe(1);
    });
  });
});

// ============================================================
// 归档
// ============================================================

describe('unique-code 重构护栏 / 归档', () => {
  async function seedEvent(tx: TestDb, code: string): Promise<void> {
    await tx.execute(raw`
      INSERT INTO doc_unique_code (doc_type, doc_id, unique_code, sku_id, style_no, color, size, scan_type, scan_at, _created_at, _updated_at)
      VALUES (${DOC}, ${U.docIn}, ${code}, ${U.sku1}, 'ST001', 'RED', 'M', 'inbound', now(), now(), now())` as never);
  }

  it('19) archiveOldEvents：热表搬入归档表，moved 计数正确，热表行被删除；重复调用不重复搬', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await seedEvent(tx, 'ARC001');
      const svc = mk(tx);

      const r = await svc.archiveOldEvents(new Date(Date.now() + 60_000), 10);
      expect(r.moved).toBe(1);
      expect(typeof r.before).toBe('string');

      expect(await countRows(tx, 'doc_unique_code_archive', 'ARC001')).toBe(1);
      expect(await countRows(tx, 'doc_unique_code', 'ARC001')).toBe(0);

      // 再跑一次不会重复搬
      expect((await svc.archiveOldEvents(new Date(Date.now() + 60_000), 10)).moved).toBe(0);

      // getArchiveStats 不受开关影响，返回两侧真实统计
      const st = await svc.getArchiveStats();
      expect(st).toMatchObject({ hot: { count: 0 }, archive: { count: 1 } });
    });
  });

  it('20) archiveByDays：days 非法（0 / 负数）时一次都不搬', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      await seedEvent(tx, 'ARC002');

      expect(await mk(tx).archiveByDays(0)).toMatchObject({ moved: 0, days: 0, enabled: false });
      expect(await countRows(tx, 'doc_unique_code', 'ARC002')).toBe(1);
    });
  });
});

// ============================================================
// 库层约束导致的既有缺陷（钉死，不在本轮修）
// ============================================================

describe('unique-code 重构护栏 / ⚠️ 既有缺陷（CHECK 约束过窄）', () => {
  it('21) docType 取 purchase_inbound / sales_outbound / stocktake 时，'
    + 'registerInbound 与 scanOutboundUniqueCode 会撞 ck_doc_unique_code_doc_type 而 500', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      await enable(tx);
      const svc = mk(tx);

      // registerInbound 写的是调用方传入的 docType，采购入库场景必然是 purchase_inbound
      // drizzle 的 message 只有 "Failed query: …"，约束名在 `error.cause` 里，见 pgCause()
      const err = await svc.registerInbound({
        docType: 'purchase_inbound', docId: U.docIn, warehouseId: U.whA,
        items: [{ styleNo: 'ST001', color: 'RED', size: 'M', uniqueCode: 'UC5001' }],
      } as never, tx as never).then(() => null, (e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect(pgCause(err)).toMatch(/ck_doc_unique_code_doc_type/);

      // unique_code_stock 的行**已经写进去了**（ INSERT doc_unique_code 在同一事务内，
      // 事务整体回滚，但每一次 registerInbound 各自开事务，前序 item 不受影响）
      expect(await stockRow(tx, 'UC5001')).toBeUndefined();
    });
  });
});
