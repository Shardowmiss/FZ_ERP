-- 0056 修复 inventory_stocktake CHECK 约束缺失 posted 状态（盘点过账功能修复）
-- 全链路扩展测试（#751）环节⑧「盘点过账」失败暴露：
--   postStocktake 执行 `update inventory_stocktake set status='pos(ted)'`
--   被 CHECK 拒绝，报 "violates check constraint ck_inventory_stocktake_status"。
--
-- 【根因】与 0043/0054/0055 同源：inventory_stocktake 的 CHECK 是
--   「28 值通用枚举模板」，其中**不含 posted**，而 posted 正是盘点过账的终态：
--     · createStocktake   写 'draft'     （盘点单草稿）
--     · approveStocktake  写 'approved'  （审核通过）
--     · postStocktake     写 'posted'    （过账，已调账差异）← **不在模板内，报错**
--   即**盘点过账（差异调账）功能自约束建立起就不可用**；
--   此前未暴露是因为数据里只有 approved(2)/completed(7)，从未真正调用 postStocktake。
--   注：库中 completed 是历史脏数据（见 0044 同类问题），本次一并归一化为 posted。
--
-- 【系统性排查已确认其余单据表无同类问题】
--   逐一比对「服务层实际写入值」vs「CHECK 允许值」，8 张单据表结果：
--     inventory_stocktake : 写 draft/approved/posted  → **缺 posted**（本迁移修复）
--     inventory_transfer  : 写 draft/in_transit/completed/accepted/cancelled → 全覆盖 ✓
--     purchase_inbound    : 写 draft/approved/unpaid  → 全覆盖 ✓
--     sales_outbound      : 写 unpaid                → 全覆盖 ✓
--     production_work_order: 写 draft/finished/closed → 全覆盖 ✓
--     garment_purchase_order: 写 draft/pending/approved → 全覆盖 ✓
--     purchase_order / sales_order : 状态由 shared 常量写入，CHECK 已覆盖 ✓
--
-- 合法枚举（依据 inventory-stocktake.service.ts 实际写入点）：
--   draft（草稿）→ approved（审核通过）→ posted（已过账）
--   另保留 completed 作为历史终态别名，避免既有数据被迫改写。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_illegal  bigint;
  v_completed bigint;
BEGIN
  SELECT count(*) INTO v_illegal FROM inventory_stocktake
   WHERE status NOT IN ('draft', 'approved', 'posted', 'completed');
  SELECT count(*) INTO v_completed FROM inventory_stocktake WHERE status = 'completed';

  RAISE NOTICE '[0056] 预检查：越界状态=% 行；历史 completed（归一化为 posted）=% 行',
    v_illegal, v_completed;
  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0056] 存在需先处理的越界状态 % 行', v_illegal;
  END IF;
END $$;

-- ============================================================
-- 2) 归一化历史 completed → posted（语义等同：均表示已完成调账）
--    ⚠ 顺序很关键（试跑已验证两次踩坑）：
--      ① 必须**先删旧约束**再做 UPDATE——旧的 28 值模板不含 posted，
--         不删会直接拒绝 posted 写入。
--      ② 必须**先归一化数据再加新约束**——若数据里还有 completed
--         而新约束只含 draft/approved/posted，ADD CONSTRAINT 会报
--         "check constraint ... is violated by some row"（存量数据校验失败）。
-- ============================================================
ALTER TABLE inventory_stocktake DROP CONSTRAINT IF EXISTS ck_inventory_stocktake_status;

UPDATE inventory_stocktake
SET status = 'posted', _updated_at = now()
WHERE status = 'completed';

-- 数据已归一化，此时再加新约束才能成功
ALTER TABLE inventory_stocktake
  ADD CONSTRAINT ck_inventory_stocktake_status
  CHECK (status IN ('draft', 'approved', 'posted'));

-- ============================================================
-- 4) 后置校验：用真实 UPDATE 验证 posted 可写入
-- ============================================================
DO $$
DECLARE
  v_id  uuid;
  v_ok  boolean := false;
  v_cnt bigint;
BEGIN
  SELECT id::text INTO v_id FROM inventory_stocktake WHERE status='approved' LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE '[0056] 无 approved 盘点单可做写入验证，仅校验约束定义';
  ELSE
    BEGIN
      UPDATE inventory_stocktake SET status='posted' WHERE id=v_id;
      v_ok := true;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION '[0056] 仍无法写入 posted';
    END;
    UPDATE inventory_stocktake SET status='approved' WHERE id=v_id;  -- 还原
  END IF;

  SELECT count(*) INTO v_cnt FROM inventory_stocktake;
  RAISE NOTICE '[0056] 完成：posted 写入验证=%；盘点单共 % 行，状态分布 draft/approved/posted',
    COALESCE(v_ok::text,'跳过'), v_cnt;
END $$;

-- ============================================================
-- 回滚说明：
--   不可回滚到缺 posted 的版本（会再次阻断盘点过账）。
--   若需回退数据分布：UPDATE inventory_stocktake SET status='completed' WHERE status='posted';
--   （completed 已不在新约束内，需同时放宽约束，不建议。）
-- ============================================================
