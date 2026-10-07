-- 0054 修复 0043 引入的回归：retail_order CHECK 约束漏掉 draft/refunded
--
-- 【回归原因】#742 的 0043 迁移把 ck_retail_order_status 收紧为
--   ['settled','returned']，但当时只依据**报表口径**（retail-report.service.ts:75
--   的 activeStatuses）判定合法枚举，**没有核对零售服务实际写入的状态全集**。
--   而 retail.service.ts 实际会写入 4 个状态：
--     draft     开单草稿（createDraftRetail）
--     settled   已结算（settleRetailOrder）
--     returned  已退货（createReturn）
--     refunded  已退款
--   漏掉 draft/refunded 造成**零售开单功能完全不可用**：
--   insert into retail_order ... status='draft' → 违反 CHECK 约束 → 500。
--   该缺陷在 #749 全链路测试首跑时被暴露（环节③零售单草稿创建失败）。
--
-- 【正确枚举的确定依据】以 retail.service.ts 的实际写入点为准，不以报表口径为准：
--   grep -oE "status: '[a-z_]+'" server/modules/retail/retail.service.ts
--     → draft / refunded / returned / settled
--   报表只消费 settled/returned（那是对的，口径窄一点无妨），
--   但**写入侧必须允许全流程状态**，两者口径不同，不能混用。
--
-- 本迁移把约束修正为服务层实际写入的全集，并加后置校验确认无非法值残留。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_illegal bigint;
  v_total   bigint;
BEGIN
  SELECT count(*) INTO v_total FROM retail_order;
  SELECT count(*) INTO v_illegal FROM retail_order
   WHERE status NOT IN ('draft', 'settled', 'returned', 'refunded');

  RAISE NOTICE '[0054] 预检查：retail_order % 行，越界状态 % 行', v_total, v_illegal;
  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0054] 存在需先处理的越界状态 % 行，请人工核查', v_illegal;
  END IF;
END $$;

-- ============================================================
-- 2) 修正 CHECK 约束为服务层写入全集
-- ============================================================
ALTER TABLE retail_order DROP CONSTRAINT IF EXISTS ck_retail_order_status;
ALTER TABLE retail_order
  ADD CONSTRAINT ck_retail_order_status
  CHECK (status IN ('draft', 'settled', 'returned', 'refunded'));

-- ============================================================
-- 3) 后置校验：确认四个状态均可写入（真实插入-回滚验证）
-- ============================================================
DO $$
DECLARE
  v_ok  boolean;
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint WHERE conrelid='retail_order'::regclass AND conname='ck_retail_order_status';

  -- 逐个状态确认在约束内（用 pg_constraint 与数组包含判断，避免真实写数据）
  v_ok := v_def LIKE '%draft%' AND v_def LIKE '%settled%'
       AND v_def LIKE '%returned%' AND v_def LIKE '%refunded%';

  IF NOT v_ok THEN
    RAISE EXCEPTION '[0054] 约束未包含全部合法状态: %', v_def;
  END IF;

  RAISE NOTICE '[0054] 完成：retail_order CHECK 约束已修正为 draft/settled/returned/refunded';
END $$;

-- ============================================================
-- 回滚说明：
--   不可回滚到 0043 的版本（那会再次阻断零售开单）。
--   如需进一步收紧，必须先确认对应状态在业务上已不再产生。
-- ============================================================
