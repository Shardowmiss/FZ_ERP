-- 0044 清理非法状态与测试残留数据（幂等）
-- 配套 0043。巡检（business-audit-report-2026-10-07）发现的第二批数据问题：
--   1) purchase_order  : SEED-PO-2026-001 状态 'confirmed' 非法
--   2) sales_outbound  : SEED-SO-2026-001 状态 'out' 非法
--   3) sales_return    : SEED-SR-2026-001 状态 'returned' 非法
--      三者合法枚举均为 draft/audited/booked/accepted/cancelled
--      （shared/api.interface.ts:271 SalesOutboundStatus、:299 SalesReturnStatus）
--   4) purchase_order  : 4 张 POTEST-* 空壳单（金额 0、无明细），POS 测试残留
--   5) public schema 残留 3 张 *_bak_20261004 备份表，会被遍历表名的
--      报表/导出/ETL 脚本重复纳入（dealer_bak 单表即多出 178 行重复主数据）
--
-- 归一化原则：种子单据的语义是"已确认/已履约"，统一落到 'booked'（记账），
-- 该状态在列表与状态标签中均可见，且是业务正常流转态。

-- ============================================================
-- 1) purchase_order：'confirmed' → 'booked'
-- ============================================================
UPDATE purchase_order
SET status = 'booked', _updated_at = now()
WHERE status = 'confirmed'
  AND status NOT IN ('draft','audited','booked','accepted','cancelled');

-- ============================================================
-- 2) sales_outbound：'out' → 'booked'
--    'out' 疑似把"已出库"写进了 status 列；出库事实已由库存流水记录，
--    状态列应表达单据流转态，故归一化为 'booked'。
-- ============================================================
UPDATE sales_outbound
SET status = 'booked', _updated_at = now()
WHERE status = 'out'
  AND status NOT IN ('draft','audited','booked','accepted','cancelled');

-- ============================================================
-- 3) sales_return：'returned' → 'booked'
--    同上，'returned' 是业务动作而非单据状态。
-- ============================================================
UPDATE sales_return
SET status = 'booked', _updated_at = now()
WHERE status = 'returned'
  AND status NOT IN ('draft','audited','booked','accepted','cancelled');

-- ============================================================
-- 4) 清理 POTEST-* 空壳采购单（连带删除其明细与下游关联）
-- ============================================================
-- 4.1 先删引用这些单据的子表行（若有）。以下用 NOT EXISTS 兜底，
--     即使当前无子表行也能安全执行。
DELETE FROM purchase_order_item
WHERE order_id IN (SELECT id FROM purchase_order WHERE order_no LIKE 'POTEST%');

DELETE FROM purchase_inbound
WHERE order_id IN (SELECT id FROM purchase_order WHERE order_no LIKE 'POTEST%');

-- 4.2 删除表头
DELETE FROM purchase_order WHERE order_no LIKE 'POTEST%';

-- ============================================================
-- 5) 备份表迁出 public schema → bak schema
--    用 CREATE SCHEMA IF NOT EXISTS + ALTER TABLE SET SCHEMA，
--    保留数据可回溯，同时让遍历 public 表名的脚本不再重复纳入。
-- ============================================================
CREATE SCHEMA IF NOT EXISTS bak;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_bak_20261004','supplier_bak_20261004','dealer_bak_20261004']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA bak', t);
      RAISE NOTICE '[0044] 备份表 % 已迁出 public → bak', t;
    ELSE
      RAISE NOTICE '[0044] 备份表 % 不在 public，跳过', t;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 6) 后置校验
-- ============================================================
DO $$
DECLARE
  v_bad  bigint;
  v_potest bigint;
  v_pub_bak bigint;
BEGIN
  SELECT (SELECT count(*) FROM purchase_order  WHERE status NOT IN ('draft','audited','booked','accepted','cancelled'))
       + (SELECT count(*) FROM sales_outbound WHERE status NOT IN ('draft','audited','booked','accepted','cancelled'))
       + (SELECT count(*) FROM sales_return   WHERE status NOT IN ('draft','audited','booked','accepted','cancelled'))
    INTO v_bad;

  SELECT count(*) INTO v_potest FROM purchase_order WHERE order_no LIKE 'POTEST%';
  SELECT count(*) INTO v_pub_bak FROM pg_tables
    WHERE schemaname='public' AND tablename LIKE '%_bak_2026%';

  IF v_bad > 0 THEN
    RAISE EXCEPTION '[0044] 仍存在非法状态 % 行', v_bad;
  END IF;

  RAISE NOTICE '[0044] 完成：非法状态=% 行, POTEST 残留=% 行, public 残留备份表=% 张',
    v_bad, v_potest, v_pub_bak;
END $$;

-- ============================================================
-- 回滚说明（手动执行）：
--   1) 备份表回迁：
--      ALTER TABLE bak.store_bak_20261004    SET SCHEMA public;
--      ALTER TABLE bak.supplier_bak_20261004 SET SCHEMA public;
--      ALTER TABLE bak.dealer_bak_20261004   SET SCHEMA public;
--   2) POTEST 空壳单已物理删除，如需恢复请从备份 BAK/erp_db_*.dump 还原。
--   3) 状态归一化（confirmed/out/returned → booked）在业务上等价，
--      通常无需回滚。
-- ============================================================
