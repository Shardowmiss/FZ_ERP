-- 0043 零售单状态归一化 + 状态枚举收紧（幂等）
-- 巡检发现（business-audit-report-2026-10-07）：
--   1) retail_order 586 行中 585 行状态为 'completed'，而应用侧权威枚举为
--      ['settled','returned']（retail-report.service.ts:75/141/165/213、
--      retail.service.ts:548 写入 settled、schema.ts 默认值 settled）。
--      后果：门店销量报表 / 会员消费统计 / 经营看板 / 补货建议 4 个模块
--      只能读到 1 单 / 897 元，而真实数据为 586 单 / 1,151,159 元。
--   2) 表上的 CHECK 约束 ck_retail_order_status 是"全库通用枚举模板"，
--      一次性放行 28 个值（completed/draft/out/confirmed/...），
--      导致非法状态可被写入，脏数据得以长期潜伏。
--
-- 本迁移做两件事：
--   A) 把历史非法值归一化为业务合法值（幂等，可重复执行）。
--   B) 把 CHECK 约束收紧为业务真实枚举，防止再次写入非法值。

-- ============================================================
-- 0) 预检查：执行前的数据快照（只读，便于事后核对）
-- ============================================================
DO $$
DECLARE
  v_illegal bigint;
  v_total   bigint;
BEGIN
  SELECT count(*) INTO v_total FROM retail_order;
  SELECT count(*) INTO v_illegal FROM retail_order
    WHERE status NOT IN ('settled', 'returned');
  RAISE NOTICE '[0043] 预检查：retail_order 共 % 行，其中非法状态 % 行', v_total, v_illegal;
  IF v_illegal > 0 THEN
    RAISE NOTICE '[0043] 待归一化明细：';
  END IF;
END $$;

-- ============================================================
-- 1) 数据归一化：非法状态 → 业务合法状态
-- ============================================================
-- 1.1 'completed' → 'settled'
--     语义等价：零售单已完成结算。'completed' 属通用枚举模板的误用，
--     业务含义与 'settled' 一致（已收款、已完成销售），归一化不改变金额与明细。
--     注：'returned' 语义为"已退货"，不应由 completed 转换而来，故只映射到 settled。
UPDATE retail_order
SET status = 'settled',
    _updated_at = now()
WHERE status = 'completed';

-- 1.2 其余通用枚举模板值（防御性处理；若不存在则 0 行受影响）
--     'done'/'finished'/'closed'  → settled（已完成的履约终态）
UPDATE retail_order
SET status = 'settled', _updated_at = now()
WHERE status IN ('done', 'finished', 'closed');

--     'confirmed'/'approved'/'booked'/'accepted' → settled（已确认履约）
UPDATE retail_order
SET status = 'settled', _updated_at = now()
WHERE status IN ('confirmed', 'approved', 'booked', 'accepted');

--     'cancelled' 保持不变（合法业务态：已取消）
--     'returned'   保持不变（合法业务态：已退货）
--     'draft'/'pending'/'submitted'/'processing' 保持不变（在途单据）

-- ============================================================
-- 2) 收紧 CHECK 约束为业务真实枚举 ['settled','returned']
-- ============================================================
-- 先删除过宽的通用模板约束（若不存在则 IF EXISTS 跳过）
ALTER TABLE retail_order DROP CONSTRAINT IF EXISTS ck_retail_order_status;

-- 建立业务枚举约束。DEFERRABLE 不可用（CHECK 不支持），故先归一化再加约束，
-- 保证加约束时不会有存量行违反。
ALTER TABLE retail_order
  ADD CONSTRAINT ck_retail_order_status
  CHECK (status IN ('settled', 'returned'));

-- ============================================================
-- 3) 后置校验：确认归一化与约束均生效
-- ============================================================
DO $$
DECLARE
  v_illegal bigint;
  v_settled bigint;
  v_returned bigint;
  v_amount numeric;
BEGIN
  SELECT count(*) INTO v_illegal FROM retail_order
    WHERE status NOT IN ('settled', 'returned');
  SELECT count(*) INTO v_settled  FROM retail_order WHERE status = 'settled';
  SELECT count(*) INTO v_returned FROM retail_order WHERE status = 'returned';
  SELECT COALESCE(SUM(total_amount), 0) INTO v_amount FROM retail_order;

  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0043] 归一化失败：仍有 % 行非法状态', v_illegal;
  END IF;

  RAISE NOTICE '[0043] 完成：settled=% 行, returned=% 行, 金额合计=%', v_settled, v_returned, v_amount;
END $$;

-- ============================================================
-- 回滚说明（手动执行）：
--   1) 放宽约束：
--      ALTER TABLE retail_order DROP CONSTRAINT IF EXISTS ck_retail_order_status;
--      ALTER TABLE retail_order ADD CONSTRAINT ck_retail_order_status
--        CHECK (status IN ('settled','returned','draft','pending','submitted',
--               'processing','cancelled','completed','confirmed','approved',
--               'booked','accepted','done','finished','closed','returned',
--               'out','open','ongoing','unpaid','refunded','in_stock',
--               'in_transit','sold','skipped','wait_confirm','inactive',
--               'disabled','active'));
--   2) 数据回滚不可逆（completed 与 settled 在业务上等价，无需回滚）。
--      如确需还原：仅当能区分"原本就是 settled"与"由 completed 归一化而来"时，
--      才可据 _updated_at 时间窗近似回滚。生产环境建议保持归一化结果。
-- ============================================================
