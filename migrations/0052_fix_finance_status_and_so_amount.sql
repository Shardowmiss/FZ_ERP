-- 0052 确定性脏数据修正：财务/全渠道表非法状态 + 销售单表头金额同源修正（幂等）
-- 巡检报告（business-audit-report-2026-10-07）遗留项中「代码可判定」的部分。
--
-- 【根因复盘】这批脏数据与 #742 修的 P0-1 同源：
--   finance_payment / finance_receipt / omni_order / receivable / payable / pre_order
--   六张表的 CHECK 约束都是同一个「28 值通用枚举模板」（一次性放行
--   draft/confirmed/approved/booked/completed/unpaid/... 全部 28 个值），
--   导致本表不该出现的状态值也能写入，脏数据得以长期潜伏。
--   本迁移只做数据修正；约束收紧属另一项改动，未包含在此。
--
-- 【修正 1】财务/全渠道表非法状态 → 按各服务层实际写入值归一化
--   依据（服务层实际写入点，非猜测）：
--     · payment.service.ts:205 写 'draft'、:349 写 'approved'
--       → finance_payment 合法枚举为 draft/approved，'confirmed' 非法 → approved
--     · receipt.service.ts:205 写 'draft'、:349 写 'approved'
--       → finance_receipt 同上 → approved
--     · omni.service.ts:149 写 'pending'、:175 写 'approved'、:277 写 'completed'
--       → omni_order 合法枚举为 pending/approved/completed，'confirmed' 非法 → approved
--   语义等价性：'confirmed'（已确认）→ 'approved'（已审核）在收付款单语境下
--   均表示「单据已生效、可进入核销流程」，归一化不改变业务含义与金额。
--
-- 【修正 2】销售单表头金额与应收同源修正
--   sales_order SEED-SO-2026-001 表头 total_amount=4485，
--   而其 4 条明细 SUM=7970，差 3485。
--   已逐行验证明细自洽（price × quantity = amount，4 行行内差额均为 0），
--   故**表头 4485 是孤立错误**，应以明细 7970 为准。
--   receivable SEED-AR-2026-001（biz_type=sales_outbound, biz_no=SEED-OB-2026-001）
--   amount=4485 与 balance=4485，与错误的表头同源同错，同步修正为 7970。
--   涉及单据号：SEED-SO-2026-001 / SEED-OB-2026-001 / SEED-AR-2026-001

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_pay   bigint;
  v_rcpt  bigint;
  v_omni  bigint;
  v_so    numeric;
  v_so_items numeric;
  v_ar    numeric;
BEGIN
  SELECT count(*) INTO v_pay  FROM finance_payment  WHERE status NOT IN ('draft','approved');
  SELECT count(*) INTO v_rcpt FROM finance_receipt WHERE status NOT IN ('draft','approved');
  SELECT count(*) INTO v_omni FROM omni_order      WHERE status NOT IN ('pending','approved','completed');

  SELECT total_amount INTO v_so FROM sales_order WHERE order_no = 'SEED-SO-2026-001';
  SELECT COALESCE(SUM(amount),0) INTO v_so_items FROM sales_order_item
    WHERE order_id = (SELECT id FROM sales_order WHERE order_no='SEED-SO-2026-001');
  SELECT amount INTO v_ar FROM receivable WHERE receivable_no = 'SEED-AR-2026-001';

  RAISE NOTICE '[0052] 预检查：';
  RAISE NOTICE '  finance_payment 非法状态=% 行, finance_receipt=% 行, omni_order=% 行', v_pay, v_rcpt, v_omni;
  RAISE NOTICE '  SEED-SO-2026-001 表头=% 明细合计=% 差额=%', v_so, v_so_items, v_so - v_so_items;
  RAISE NOTICE '  SEED-AR-2026-001 应收=%', v_ar;
END $$;

-- ============================================================
-- 2) 修正 1：财务/全渠道表非法状态归一化
-- ============================================================
UPDATE finance_payment
SET status = 'approved', _updated_at = now()
WHERE status = 'confirmed'
  AND status NOT IN ('draft', 'approved');

UPDATE finance_receipt
SET status = 'approved', _updated_at = now()
WHERE status = 'confirmed'
  AND status NOT IN ('draft', 'approved');

UPDATE omni_order
SET status = 'approved', _updated_at = now()
WHERE status = 'confirmed'
  AND status NOT IN ('pending', 'approved', 'completed');

-- ============================================================
-- 3) 修正 2：销售单表头金额 + 应收金额
--    以明细 SUM 为权威值重算表头（而非硬编码 7970，避免明细变动后不同步）。
-- ============================================================
UPDATE sales_order h
SET total_amount = agg.item_total,
    _updated_at = now()
FROM (
  SELECT order_id, SUM(amount) AS item_total
  FROM sales_order_item
  WHERE order_id = (SELECT id FROM sales_order WHERE order_no = 'SEED-SO-2026-001')
  GROUP BY order_id
) agg
WHERE h.id = agg.order_id
  AND h.total_amount <> agg.item_total;

-- 应收同步：以修正后的出库业务金额为准
UPDATE receivable r
SET amount = agg.item_total,
    balance = agg.item_total - COALESCE(r.received_amount, 0),
    _updated_at = now()
FROM (
  SELECT so.id AS order_id, SUM(soi.amount) AS item_total
  FROM sales_order so
  JOIN sales_order_item soi ON soi.order_id = so.id
  WHERE so.order_no = 'SEED-SO-2026-001'
  GROUP BY so.id
) agg
WHERE r.biz_no = 'SEED-OB-2026-001'
  AND r.biz_type = 'sales_outbound'
  AND r.amount <> agg.item_total;

-- ============================================================
-- 4) 后置校验
-- ============================================================
DO $$
DECLARE
  v_pay   bigint;
  v_rcpt  bigint;
  v_omni  bigint;
  v_diff  numeric;
  v_ar    numeric;
  v_ar_bal numeric;
BEGIN
  SELECT count(*) INTO v_pay  FROM finance_payment  WHERE status NOT IN ('draft','approved');
  SELECT count(*) INTO v_rcpt FROM finance_receipt WHERE status NOT IN ('draft','approved');
  SELECT count(*) INTO v_omni FROM omni_order      WHERE status NOT IN ('pending','approved','completed');

  -- 销售单表头与明细差异（应为 0）
  SELECT abs(h.total_amount - COALESCE(agg.item_total,0)) INTO v_diff
  FROM sales_order h
  LEFT JOIN (SELECT order_id, SUM(amount) AS item_total FROM sales_order_item GROUP BY order_id) agg
    ON agg.order_id = h.id
  WHERE h.order_no = 'SEED-SO-2026-001';

  SELECT amount, balance INTO v_ar, v_ar_bal FROM receivable WHERE receivable_no='SEED-AR-2026-001';

  IF v_pay > 0 OR v_rcpt > 0 OR v_omni > 0 THEN
    RAISE EXCEPTION '[0052] 状态归一化未完成: payment=% receipt=% omni=%', v_pay, v_rcpt, v_omni;
  END IF;
  IF v_diff > 0.01 THEN
    RAISE EXCEPTION '[0052] 销售单表头与明细仍不一致，差额=%', v_diff;
  END IF;

  RAISE NOTICE '[0052] 完成：3 张表状态已归一化；SEED-SO-2026-001 表头=明细；应收 amount=% balance=%',
    v_ar, v_ar_bal;
END $$;

-- ============================================================
-- 回滚说明：
--   -- 状态归一化不可逆（confirmed 与 approved 业务等价，无需回滚）。
--   -- 金额修正回滚需依赖备份：BAK/erp_db_20261007_124847.dump
--      （该备份为 0043 之前状态，含原始 4485）。
--   UPDATE sales_order SET total_amount = 4485 WHERE order_no='SEED-SO-2026-001';
--   UPDATE receivable SET amount=4485, balance=4485 WHERE receivable_no='SEED-AR-2026-001';
-- ============================================================
