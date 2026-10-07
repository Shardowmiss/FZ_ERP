-- ============================================================
-- 0058 修正 retail_return_item 的审计列类型 + 打通 ERP↔POS 上行状态
--
-- 【本迁移修两处，都是 0057 / 上次改造遗留的实际缺陷】
--
-- 缺陷①：retail_return_item._created_by / _updated_by 类型错误
--   现象：ERP 侧 createReturn 写入明细时报
--         "column \"_created_by\" is of type uuid but expression is of type user_profile"
--         即**零售退货功能 100% 失败**（不是警告，是直接抛错）。
--   根因：0057 建表时把审计列写成普通 uuid，而本库约定
--         （retail_return / retail_order_item 等同类表）统一用
--         自定义类型 user_profile。schema.ts 里用的是 userProfile()，
--         迁移与 schema 不一致 → 运行时类型冲突。
--   修复：ALTER 改为 user_profile 类型，与全库约定及 schema.ts 对齐。
--
-- 缺陷②：POS 上行 sales / stocktakes 会被状态 CHECK 拒绝
--   现象：pos-receiver.receiveSales 报
--         "violates check constraint ck_retail_order_status"
--         原因：pos-receiver 写 status='completed'，而 0054 已把
--         retail_order 约束收紧为 draft/settled/returned/refunded。
--         同理 receiveStocktake 写 'completed'，0056 已把
--         inventory_stocktake 收紧为 draft/approved/posted。
--         → **POS→ERP 上行链路全盘失败**，这正是"打通"的拦路虎。
--   注意：代码侧已同步修正为 settled / posted（见 pos-receiver.service.ts），
--         本迁移仅处理**历史遗留数据**：把此前误写入或种子数据中的
--         completed 归一化为对应表的合法终态，并加防御性校验。
--
-- 幂等：全部 IF EXISTS / IF NOT EXISTS + NOT EXISTS 过滤，可重复执行。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 修正 retail_return_item 审计列类型 uuid → user_profile
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'retail_return_item'
      AND column_name = '_created_by'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE retail_return_item
      ALTER COLUMN _created_by TYPE user_profile USING _created_by::text::user_profile;
    RAISE NOTICE '[0058] retail_return_item._created_by 已改为 user_profile';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'retail_return_item'
      AND column_name = '_updated_by'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE retail_return_item
      ALTER COLUMN _updated_by TYPE user_profile USING _updated_by::text::user_profile;
    RAISE NOTICE '[0058] retail_return_item._updated_by 已改为 user_profile';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2) 历史遗留状态归一化（代码侧已修，此处兜底存量数据）
--    retail_order: completed → settled（语义等同：均表示已完成销售）
--    inventory_stocktake: completed → posted（语义等同：均表示已完成调账）
-- ------------------------------------------------------------
UPDATE retail_order
SET status = 'settled'
WHERE status = 'completed';

UPDATE inventory_stocktake
SET status = 'posted'
WHERE status = 'completed';

-- ------------------------------------------------------------
-- 3) 后置校验：确认两表无非法状态、审计列类型已对齐
-- ------------------------------------------------------------
DO $$
DECLARE
  v_bad_retail  bigint;
  v_bad_stk     bigint;
  v_uuid_cols   bigint;
BEGIN
  SELECT count(*) INTO v_bad_retail
    FROM retail_order
   WHERE status NOT IN ('draft', 'settled', 'returned', 'refunded');

  SELECT count(*) INTO v_bad_stk
    FROM inventory_stocktake
   WHERE status NOT IN ('draft', 'approved', 'posted');

  SELECT count(*) INTO v_uuid_cols
    FROM information_schema.columns
   WHERE table_name = 'retail_return_item'
     AND column_name IN ('_created_by', '_updated_by')
     AND data_type = 'uuid';

  IF v_bad_retail > 0 THEN
    RAISE EXCEPTION '[0058] retail_order 仍有 % 行非法状态', v_bad_retail;
  END IF;
  IF v_bad_stk > 0 THEN
    RAISE EXCEPTION '[0058] inventory_stocktake 仍有 % 行非法状态', v_bad_stk;
  END IF;
  IF v_uuid_cols > 0 THEN
    RAISE EXCEPTION '[0058] retail_return_item 仍有 % 个审计列是 uuid 类型', v_uuid_cols;
  END IF;

  RAISE NOTICE '[0058] 完成：审计列已对齐 user_profile；retail_order 非法状态 % 行、inventory_stocktake 非法状态 % 行',
    v_bad_retail, v_bad_stk;
END $$;

-- ============================================================
-- 回滚说明：
--   ALTER TABLE retail_return_item
--     ALTER COLUMN _created_by TYPE uuid USING _created_by::text::uuid,
--     ALTER COLUMN _updated_by TYPE uuid USING _updated_by::text::uuid;
--   ⚠ 回滚后应用侧写入 user_profile 类型会再次报类型冲突，
--     即零售退货功能不可用。故不建议回滚。
-- ============================================================
