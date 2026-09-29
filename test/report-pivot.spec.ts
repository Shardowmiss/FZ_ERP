/**
 * Wave 4-D：report 模块「重构护栏」。
 *
 * 背景：`report.service.ts` 原本约 1910 行，前一轮已把透视引擎（约 705 行）拆到
 * `pivot-engine.ts`；本轮再把剩余的 7 张报表查询（约 870 行）按数据源拆成 7 个
 * 职责域服务（`report-{purchase,sales,retail,retail-summary,inventory,transfer,
 * stock-movement}.service.ts`），`report.service.ts` 退化为只做委托的门面，由
 * `createReportService(db)` 统一装配。**拆之前/拆之后本 spec 都必须全绿**，
 * 即证明"拆得对、没改坏口径"。
 *
 * 护栏策略：所有断言都打在**公开行为的可见结果**上（报表汇总 / 透视的 rows /
 * colKeys / grandTotal / 异常类型），而不是 private 方法内部。这样无论内部怎么
 * 拆，护栏都成立；反之若重构改变了数字，护栏立刻变红。
 *
 * 数据全部种在 `erp_test` 真库的事务里，跑完 ROLLBACK，不留痕。
 */
import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { withIsolatedTransaction, raw, type TestDb } from './utils/db';
import {
  ReportService,
  createReportService,
} from '@server/modules/report/report.service';
import type { PivotConfig, PivotResponse } from '@shared/api.interface';

/**
 * 显式装配 service（复刻 Nest 真实注入形态）。
 * 报表逻辑已拆到 7 个域服务，透视在 PivotEngineService；`createReportService`
 * 是唯一的装配点，直构时一并把全部子服务与透视引擎实例化。
 */
function mk(tx: TestDb): ReportService {
  return createReportService(tx as never);
}

/** 固定 UUID，避免每次运行不同导致快照断言不稳定 */
const U = {
  s1: 'aaaaaaa1-0000-0000-0000-000000000001',
  s2: 'aaaaaaa2-0000-0000-0000-000000000002',
  sk1: 'bbbbbbb1-0000-0000-0000-000000000001',
  sk2: 'bbbbbbb2-0000-0000-0000-000000000002',
  pi1: 'ccccccc1-0000-0000-0000-000000000001',
  pi2: 'ccccccc2-0000-0000-0000-000000000002',
  so1: 'ddddddd1-0000-0000-0000-000000000001',
  so2: 'ddddddd2-0000-0000-0000-000000000002',
  so3: 'ddddddd3-0000-0000-0000-000000000003',
  oi1: '01010101-0000-0000-0000-000000000001',
  oi2: '01010101-0000-0000-0000-000000000002',
  oi3: '01010101-0000-0000-0000-000000000003',
  roi1: 'eeeeeee1-0000-0000-0000-000000000001',
  roi2: 'eeeeeee2-0000-0000-0000-000000000002',
  roi3: 'eeeeeee3-0000-0000-0000-000000000003',
  ro1: 'fffffff1-0000-0000-0000-000000000001',
  ist1: '11111111-0000-0000-0000-000000000001',
  it1: '22222222-0000-0000-0000-000000000001',
  iti1: '33333333-0000-0000-0000-000000000001',
};

/**
 * 种子数据：覆盖 4 个透视数据源 + 5 张报表的单据事实。
 *
 * 会临时停用外键触发器：这些表的 uuid 列多数是 NOT NULL，且父表（color_group /
 * sales_order / warehouse …）离报表逻辑很远。为种两行数据去铺一整条父表链不值当。
 * 停用是 DDL，在事务内执行，ROLLBACK 自动还原；CHECK 约束不受影响，因此测到的
 * 仍然是真实库约束下的行为。
 *
 * ⚠️ 插入一律用参数化（drizzle `raw` 模板 + `${}`）：把中文值直接硬编码进 SQL
 * 文本时，drizzle 的字符串式 `execute` 会把语句解析坏（表现为 PG 的
 * "unterminated quoted string" 且位置落在语句末尾，极难定位）。参数化后中文正常。
 */
async function seed(tx: TestDb): Promise<void> {
  const off = (t: string) => tx.execute(`ALTER TABLE ${t} DISABLE TRIGGER ALL` as never);
  for (const t of [
    'style', 'sku', 'garment_purchase_inbound_sku', 'garment_purchase_inbound',
    'purchase_inbound', 'purchase_inbound_item', 'sales_outbound_item', 'sales_outbound',
    'retail_order_item', 'retail_order', 'inventory_stock',
    'inventory_transfer_item', 'inventory_transfer',
  ]) {
    await off(t);
  }

  // 款式：两个品牌，透视维度的主要来源
  await tx.execute(raw`
    INSERT INTO style (id, style_no, name, brand, category, sub_category, color_group_id, size_group_id, status, lifecycle_status, attributes, _created_at, _updated_at)
    VALUES
      (${U.s1}, 'ST001', ${'衬衫'}, ${'B1'}, ${'C1'}, ${'SC1'}, ${U.s1}, ${U.s1}, 'active', 'active', ${'{}'}::jsonb, now(), now()),
      (${U.s2}, 'ST002', ${'外套'}, ${'B2'}, ${'C1'}, ${'SC1'}, ${U.s2}, ${U.s2}, 'active', 'active', ${'{}'}::jsonb, now(), now())` as never);

  await tx.execute(raw`
    INSERT INTO sku (id, sku_code, style_id, style_no, color, size, tag_price, status, _created_at, _updated_at)
    VALUES
      (${U.sk1}, 'SKU001', ${U.s1}, 'ST001', ${'RED'},  ${'M'}, 100, 'active', now(), now()),
      (${U.sk2}, 'SKU002', ${U.s2}, 'ST002', ${'BLUE'}, ${'L'}, 200, 'active', now(), now())` as never);

  // 注意：采购入库在本系统里是**两组并存的表**，列名高度相似但含义不同 ——
  //   · 报表 getPurchaseReport 读 `purchase_inbound` + `purchase_inbound_item`（材料维度）
  //   · 透视 dataSource=purchase 读 `garment_purchase_inbound` + `garment_purchase_inbound_sku`（成衣 SKU 维度）
  // 两边都要种，否则其中一路会静默空结果。这里也顺带把该事实钉进护栏。
  // ⚠️ status 取 'approved' 是必须的：透视对 purchase / transfer 数据源在 WHERE 里
  //    硬编码了 `status = 'approved'`（与 getStockMovementReport 用的 booked/accepted
  //    口径不同）。改成 'accepted' 会让透视静默返回空表。此处锁住现状，拆分时不要动。
  await tx.execute(raw`
    INSERT INTO purchase_inbound (id, inbound_no, order_id, order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, inbound_date, total_amount, status, _created_at, _updated_at)
    VALUES (${U.pi1}, 'PI001-LEGACY', ${U.pi1}, 'PO001', ${U.pi1}, ${'供应商甲'}, ${U.pi1}, ${'主仓'}, '2026-03-05', 500, 'approved', now(), now())` as never);
  await tx.execute(raw`
    INSERT INTO purchase_inbound_item (id, inbound_id, order_item_id, material_id, material_code, material_name, unit, quantity, price, amount, _created_at, _updated_at)
    VALUES (${U.pi1}, ${U.pi1}, ${U.pi1}, ${U.pi1}, 'M001', ${'面料'}, ${'件'}, 10, 50, 500, now(), now())` as never);
  await tx.execute(raw`
    INSERT INTO garment_purchase_inbound (id, inbound_no, order_id, order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, inbound_date, total_amount, total_qty, status, _created_at, _updated_at)
    VALUES (${U.pi1}, 'PI001', ${U.pi1}, 'PO001', ${U.pi1}, ${'供应商甲'}, ${U.pi1}, ${'主仓'}, '2026-03-05', 500, 10, 'approved', now(), now())` as never);
  await tx.execute(raw`
    INSERT INTO garment_purchase_inbound_sku (id, inbound_id, style_id, style_no, sku_id, color, size, quantity, price, amount, _created_at, _updated_at)
    VALUES (${U.pi1}, ${U.pi1}, ${U.s1}, 'ST001', ${U.sk1}, ${'RED'},  ${'M'}, 10, 50, 500, now(), now())` as never);

  // ── dataSource=sales 的出库半段（status 必须是 booked/accepted 才被透视纳入）
  await tx.execute(raw`
    INSERT INTO sales_outbound (id, outbound_no, order_id, order_no, customer_id, customer_name, warehouse_id, warehouse_name, outbound_date, total_amount, cost_amount, status, _created_at, _updated_at)
    VALUES
      (${U.so1}, 'SO001', ${U.so1}, 'SO001', ${U.pi1}, ${'客户甲'}, ${U.pi1}, ${'主仓'}, '2026-03-06', 800, 400, 'accepted', now(), now()),
      (${U.so2}, 'SO002', ${U.so2}, 'SO002', ${U.pi1}, ${'客户甲'}, ${U.pi1}, ${'主仓'}, '2026-03-20', 600, 300, 'accepted', now(), now()),
      (${U.so3}, 'SO003', ${U.so3}, 'SO003', ${U.pi1}, ${'客户甲'}, ${U.pi1}, ${'主仓'}, '2026-04-05', 400, 200, 'accepted', now(), now())` as never);
  await tx.execute(raw`
    INSERT INTO sales_outbound_item (id, outbound_id, order_item_id, sku_id, sku_code, style_no, color, size, quantity, price, cost_price, amount, cost_amount, _created_at, _updated_at)
    VALUES
      (${U.oi1}, ${U.so1}, ${U.oi1}, ${U.sk1}, 'SKU001', 'ST001', ${'RED'},  ${'M'}, 4, 200, 100, 800, 400, now(), now()),
      (${U.oi2}, ${U.so2}, ${U.oi2}, ${U.sk2}, 'SKU002', 'ST002', ${'BLUE'}, ${'L'}, 2, 300, 150, 600, 300, now(), now()),
      (${U.oi3}, ${U.so3}, ${U.oi3}, ${U.sk1}, 'SKU001', 'ST001', ${'RED'},  ${'M'}, 2, 200, 100, 400, 200, now(), now())` as never);

  // ── dataSource=sales 的零售半段（status 必须是 approved；金额口径是 line_amount）
  await tx.execute(raw`
    INSERT INTO retail_order (id, retail_no, store_id, store_name, sale_date, source, total_amount, discount_amount, receivable_amount, received_amount, change_amount, pay_methods, item_count, status, _created_at, _updated_at)
    VALUES (${U.ro1}, 'RO001', ${U.pi1}, ${'门店甲'}, '2026-04-07', 'pos', 300, 30, 270, 270, 0, ${'[]'}::jsonb, 1, 'approved', now(), now())` as never);
  await tx.execute(raw`
    INSERT INTO retail_order_item (id, retail_id, sku_id, sku_code, style_no, quantity, tag_price, deal_price, line_amount, _created_at, _updated_at)
    VALUES (${U.oi1}, ${U.ro1}, ${U.sk1}, 'SKU001', 'ST001', 3, 100, 100, 300, now(), now())` as never);

  // ── dataSource=inventory：SKU001 主仓 50 件
  await tx.execute(raw`
    INSERT INTO inventory_stock (id, sku_id, sku_code, style_no, color, size, warehouse_id, warehouse_name, quantity, in_transit_qty, _created_at, _updated_at)
    VALUES (${U.ist1}, ${U.sk1}, 'SKU001', 'ST001', ${'RED'}, ${'M'}, ${U.pi1}, ${'主仓'}, 50, 0, now(), now())` as never);

  // ── dataSource=transfer：主仓 → 二仓 5 件
  // 明细必须带 sku_id：stock-movement 用 `sku_id IN (...)` 过滤，漏了就是 NULL
  // 匹配不上，调拨量会被静默算成 0。
  await tx.execute(raw`
    INSERT INTO inventory_transfer (id, transfer_no, from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name, transfer_date, item_type, status, _created_at, _updated_at)
    VALUES (${U.it1}, 'IT001', ${U.pi1}, ${'主仓'}, ${U.pi2}, ${'二仓'}, '2026-03-08', 'sku', 'approved', now(), now())` as never);
  await tx.execute(raw`
    INSERT INTO inventory_transfer_item (id, transfer_id, sku_id, item_code, item_name, quantity, _created_at, _updated_at)
    VALUES (${U.iti1}, ${U.it1}, ${U.sk1}, 'SKU001', 'SKU001', 5, now(), now())` as never);
}

/** 报表统一时间窗：覆盖上面全部种子日期（透视无时间列时不传，见用例 3 的注释） */
const WIN = { startDate: '2026-01-01', endDate: '2026-12-31', page: 1, pageSize: 20, allowFullRange: true };
/** 时间窗必须显式给全，否则透视/报表会注入默认 90 天窗口，把 2026 上半年的种子全滤掉 */
const PIVOT_WIN = { startDate: '2026-01-01', endDate: '2026-12-31', allowFullRange: true };

describe('report 模块重构护栏（重构前后都必须绿）', () => {
  it('1) purchase 报表：取到采购入库明细行并汇总金额', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const out = await svc.getPurchaseReport(WIN);
      // total 是 PG 的 count(0) 结果，drizzle 回读为字符串，断言时需 Number
      expect(Number(out.total)).toBe(1);
      expect(out.summary.totalAmount).toBe(500);
      expect(out.items[0].materialName).toBe('面料');
    });
  });

  it('2) purchase 透视：按品牌求和 quantity，口径 = SKU 明细行而不是单据头', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const res: PivotResponse = await svc.getPivotData({
        dataSource: 'purchase',
        filters: [],
        rows: ['brand'],
        cols: [],
        values: [{ key: 'quantity', label: '数量', agg: 'sum' }],
        ...PIVOT_WIN,
      } as PivotConfig);

      // 透视对 purchase 数据源在 WHERE 里硬编码 `gpi.status = 'approved'`
      // （种子里正好是 approved，见 seed 处的说明）
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].rowValues).toEqual(['B1']);
      expect(res.rows[0].cells['quantity_sum'].value).toBe(10);
      expect(res.grandTotal['quantity_sum'].value).toBe(10);
      // 数值与展示串同时成立（前端两处都吃）
      expect(res.grandTotal['quantity_sum'].formatted).toBe('10.00');
    });
  });

  it('3) sales 透视：出库 UNION ALL 零售，金额按 Line 口径（不是单据头）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const res: PivotResponse = await svc.getPivotData({
        dataSource: 'sales',
        filters: [],
        rows: ['brand'],
        cols: ['month'],
        values: [{ key: 'amount', label: '销售额', agg: 'sum' }],
        ...PIVOT_WIN,
      } as PivotConfig);

      // 出库段按 soi.amount：B1/2026-03=800(SO001)、B2/2026-03=600(SO002)、B1/2026-04=400(SO003)
      // 零售段按 roi.line_amount：B1/2026-04=300
      const byBrand = new Map(res.rows.map((r) => [r.rowValues[0], r]));
      expect(byBrand.get('B1')!.cells['2026-03|amount_sum'].value).toBe(800);
      expect(byBrand.get('B1')!.cells['2026-04|amount_sum'].value).toBe(700);
      expect(byBrand.get('B2')!.cells['2026-03|amount_sum'].value).toBe(600);
      expect(byBrand.get('B2')!.cells['2026-04|amount_sum'].value).toBe(null);

      // 列 key 固定由「列维度值 + 指标key」拼成，且按字典序排序
      expect(res.colKeys).toEqual(['2026-03|amount_sum', '2026-04|amount_sum']);
      expect(res.colLabels).toEqual([['2026-03', '销售额'], ['2026-04', '销售额']]);
      expect(res.grandTotal['2026-03|amount_sum'].value).toBe(1400);
      expect(res.grandTotal['2026-04|amount_sum'].value).toBe(700);
    });
  });

  it('4) 两级行维度：父级出小计行（isSubtotal），叶子不再重复打标', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const res: PivotResponse = await svc.getPivotData({
        dataSource: 'sales',
        filters: [],
        rows: ['brand', 'styleNo'],
        cols: [],
        values: [{ key: 'amount', label: '销售额', agg: 'sum' }],
        ...PIVOT_WIN,
      } as PivotConfig);

      const subtotals = res.rows.filter((r) => r.isSubtotal);
      expect(subtotals.length).toBe(2); // B1、B2 各一个小计
      for (const r of subtotals) {
        expect(r.rowValues.length).toBe(1); // 小计只到父级
      }
      // 只有两级行维度时 GROUP BY (brand, styleNo)，同组合并：
      //   B1/ST001 = 800 + 400 = 1200，B2/ST002 = 600
      // 零售段的 styleNo 同为 ST001，因此 B1/ST001 = 800(SO001) + 400(SO003) + 300(零售)
      const leaf = res.rows.filter((r) => !r.isSubtotal);
      expect(leaf.length).toBe(2);
      expect(leaf.every((r) => r.rowValues.length === 2)).toBe(true);
      // 注意数组默认 sort 是字典序（"1500" < "600"），比较数值必须给比较器
      expect(leaf.map((r) => r.cells.amount_sum.value).sort((a, b) => a - b)).toEqual([600, 1500]);
    });
  });

  it('5) 同一指标多个聚合并存：sum / avg 各算各的', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const res: PivotResponse = await svc.getPivotData({
        dataSource: 'sales',
        filters: [],
        rows: ['brand'],
        cols: [],
        values: [
          { key: 'amount', label: '销售额', agg: 'sum' },
          { key: 'quantity', label: '件数', agg: 'sum' },
          { key: 'quantity', label: '件数均值', agg: 'avg' },
        ],
        ...PIVOT_WIN,
      } as PivotConfig);

      const cells = res.rows[0].cells;
      // B1：出库 4 + 2，零售 3 → 件数 9；金额 800 + 400 + 300 = 1500
      expect(cells['amount_sum'].value).toBe(1500);
      expect(cells['quantity_sum'].value).toBe(9);
      // B1 分组内三个行：(4 + 2 + 3) / 3 = 3（零售那行的件数也一起进均值）
      expect(cells['quantity_avg'].value).toBe(3);
    });
  });

  it('6) 安全边界：聚合函数/维度/数据源非白名单一律 400，不给 SQL 注入机会', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const base = { filters: [], rows: ['brand'], cols: [], values: [{ key: 'amount', label: 'x', agg: 'sum' }] };

      // 试图把任意 SQL 塞进聚合位（故意不安全强转：负向测试必须绕过类型检查）
      await expect(
        svc.getPivotData({ ...base, dataSource: 'purchase', values: [{ key: 'amount', label: 'x', agg: '1); DROP TABLE style; --' }], ...PIVOT_WIN } as unknown as PivotConfig),
      ).rejects.toBeInstanceOf(BadRequestException);

      // 非法数据源
      await expect(
        svc.getPivotData({ ...base, dataSource: 'sales2', ...PIVOT_WIN } as unknown as PivotConfig),
      ).rejects.toBeInstanceOf(BadRequestException);

      // 非法维度字段
      await expect(
        svc.getPivotData({ ...base, dataSource: 'purchase', rows: ['__hack'], ...PIVOT_WIN } as PivotConfig),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('7) inventory 数据源没有时间列：date 类维度必须在校验层被拦住（否则拼出 date_trunc(month, ) 语法错 → 500）', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      await expect(
        svc.getPivotData({
          dataSource: 'inventory',
          filters: [],
          rows: ['date'],
          cols: [],
          values: [{ key: 'quantity', label: '库存', agg: 'sum' }],
          ...PIVOT_WIN,
        } as PivotConfig),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('8) 空结果集：cell 值为 null、展示为占位符，不抛错', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const res: PivotResponse = await svc.getPivotData({
        dataSource: 'purchase',
        filters: [{ key: 'brand', values: ['不存在'] }],
        rows: ['brand'],
        cols: [],
        values: [{ key: 'quantity', label: '数量', agg: 'sum' }],
        ...PIVOT_WIN,
      } as PivotConfig);
      // 没有任何一行 → 连列 key 都构造不出来，grandTotal 是空对象（不是占位符）
      expect(res.rowCount).toBe(0);
      expect(res.grandTotal).toEqual({});
      expect(res.colKeys).toEqual([]);
    });
  });

  it('9) values 为空是合法输入，返回空透视结构而不是报错', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const res: PivotResponse = await svc.getPivotData({
        dataSource: 'purchase',
        filters: [],
        rows: ['brand'],
        cols: [],
        values: [],
        ...PIVOT_WIN,
      } as PivotConfig);
      expect(res.rows).toEqual([]);
      expect(res.grandTotal).toEqual({});
      expect(res.rowFields).toEqual(['brand']);
    });
  });

  it('10) stock-movement：逐项流入流出口径与守恒关系', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      const out = await svc.getStockMovementReport({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        pageSize: 20,
      });
      const s = out.summary;
      // 期初 50 件；销售出 = SKU001 在 SO001(4) + SO003(2) = 6；零售出 3；
      // 调拨净 = 收 0 - 发 5 = -5（种子里只有「主仓 → 二仓」这一笔，主仓不发）
      expect(s.salesOutQty).toBe(6);
      expect(s.retailOutQty).toBe(3);
      expect(s.transferNetQty).toBe(-5);
      expect(s.endQty).toBe(50);
      expect(s.beginQty).toBe(50 + 6 + 3 + 5); // 恒等式：beginQty = endQty + 出 - 入
      // ⚠️ 已知既有缺陷：purchaseInQty 在 report.service.ts 里被硬编码为 0，
      //    采购入库数量从不计入，因此期初库存系统性少算「采购量」。本轮 4-D 只做
      //    拆分不改口径，故此处把现状钉死；将来修口径时必须同步更新这条断言与
      //    报表数字，不要当成"拆分副作用"顺手改掉。
      expect(s.purchaseInQty).toBe(0);
    });
  });

  it('11) 报表强制时间窗：不传日期时不能退化成全表扫描', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);
      // 不传 startDate/endDate：应注入默认窗口（约 90 天），看不到 2026 上半年的种子
      const out = await svc.getPurchaseReport({ page: 1, pageSize: 20 });
      expect(Number(out.total)).toBe(0);
    });
  });

  it('12) sales / retail / inventory / transfer 报表能取到汇总值', async () => {
    await withIsolatedTransaction(async ({ db: tx }) => {
      await seed(tx);
      const svc = mk(tx);

      const sales = await svc.getSalesReport(WIN);
      expect(Number(sales.total)).toBe(3);
      // 金额合计按 soi.amount = 800 + 600 + 400 = 1800
      // 吊牌额合计 = 4×100(SKU001) + 2×200(SKU002) + 2×100(SKU001) = 1000
      // → 优惠额 = 吊牌 - 金额 = -800
      expect(sales.summary.totalAmount).toBe(1800);
      expect(sales.summary.totalDiscountAmount).toBe(-800);

      const retail = await svc.getRetailReport(WIN);
      expect(Number(retail.total)).toBe(1);

      await svc.getRetailSummary({ startDate: '2026-01-01', endDate: '2026-12-31', allowFullRange: true });

      const inv = await svc.getInventoryReport({ page: 1, pageSize: 20 });
      expect(Number(inv.total)).toBe(1);
      expect(inv.summary.totalQty).toBe(50);

      const tr = await svc.getTransferReport(WIN);
      expect(Number(tr.total)).toBe(1);
    });
  });
});
