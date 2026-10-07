-- 0055 修复 receivable / payable CHECK 约束缺失核销状态（应收应付核销功能修复）
-- 全链路贯通测试（#751）环节⑤「应收部分核销」失败暴露：
--   addPayment 部分核销时 update receivable set status='partial' 被 CHECK 拒绝，
--   报 "violates check constraint ck_receivable_status"。
--
-- 【根因】与 0043/0054 同源：receivable / payable 的 CHECK 仍是
--   「28 值通用枚举模板」，其中**不含 partial 与 paid**，
--   而这两个状态恰是应收应付核销的核心状态：
--     · 出库生成应收时写 'unpaid'（sales-outbound.service.ts:501）→ 该值在模板内，正常
--     · 部分核销写 'partial'（receivable.service.ts addPayment）→ **不在模板内，报错**
--     · 全额核销写 'paid'   → **不在模板内，报错**
--   即**应收/应付的核销功能自该约束建立起就完全不可用**，
--   此前未暴露是因为数据里只有 unpaid（初始状态）且从未真正调用过核销。
--
-- 【合法枚举的确定依据】穷举服务层与调用方实际写入值，不以报表口径为准：
--   receivable: unpaid（初始）/ partial（部分核销）/ paid（结清）
--   payable   : unpaid（初始）/ partial（部分核销）/ paid（结清）
--   其中 partial/paid 由 receivable.service.ts / payable.service.ts 的核销方法写入。
--
-- 本迁移把两表约束修正为核销业务真实枚举，并用真实 UPDATE 验证 partial 可写入。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_ar  bigint;
  v_ap  bigint;
  v_def text;
BEGIN
  SELECT count(*) INTO v_ar FROM receivable
   WHERE status NOT IN ('unpaid', 'partial', 'paid');
  SELECT count(*) INTO v_ap FROM payable
   WHERE status NOT IN ('unpaid', 'partial', 'paid');

  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint WHERE conrelid='receivable'::regclass AND conname='ck_receivable_status';

  RAISE NOTICE '[0055] 预检查：receivable 越界状态=% 行，payable=% 行', v_ar, v_ap;
  RAISE NOTICE '[0055] 当前应收约束含 partial=% 、含 paid=%',
    CASE WHEN v_def LIKE '%partial%' THEN '是' ELSE '否' END,
    CASE WHEN v_def LIKE '%paid%'   THEN '是' ELSE '否' END;

  IF v_ar > 0 OR v_ap > 0 THEN
    RAISE EXCEPTION '[0055] 存在需先处理的越界状态 receivable=% payable=%', v_ar, v_ap;
  END IF;
END $$;

-- ============================================================
-- 2) 修正两表约束为核销业务真实枚举
-- ============================================================
ALTER TABLE receivable DROP CONSTRAINT IF EXISTS ck_receivable_status;
ALTER TABLE receivable
  ADD CONSTRAINT ck_receivable_status
  CHECK (status IN ('unpaid', 'partial', 'paid'));

ALTER TABLE payable DROP CONSTRAINT IF EXISTS ck_payable_status;
ALTER TABLE payable
  ADD CONSTRAINT ck_payable_status
  CHECK (status IN ('unpaid', 'partial', 'paid'));

-- ============================================================
-- 3) 后置校验：用真实 UPDATE 验证核销状态可写入
--    （只改 status 再回滚，不动 balance，避免污染数据）
-- ============================================================
DO $$
DECLARE
  v_id    uuid;
  v_ok_ar  boolean;
  v_ok_ap  boolean;
  v_before text;
BEGIN
  -- 找一张 unpaid 的应收做验证
  SELECT id::text, status INTO v_id, v_before FROM receivable
   WHERE status = 'unpaid' AND balance > 0 LIMIT 1;

  IF v_id IS NULL THEN
    RAISE NOTICE '[0055] 无 unpaid 应收可做写入验证，仅校验约束定义';
  ELSE
    v_ok_ar := false; v_ok_ap := false;
    BEGIN
      UPDATE receivable SET status='partial' WHERE id=v_id;
      v_ok_ar := true;
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION '[0055] receivable 仍无法写入 partial';
    END;
    -- 还原
    UPDATE receivable SET status = v_before WHERE id = v_id;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_before
  FROM pg_constraint WHERE conrelid='payable'::regclass AND conname='ck_payable_status';
  v_ok_ap := v_before LIKE '%partial%' AND v_before LIKE '%paid%';

  RAISE NOTICE '[0055] 完成：应收 partial 写入验证=%，应付约束含 partial/paid=%',
    COALESCE(v_ok_ar::text,'跳过'), v_ok_ap;
END $$;

-- ============================================================
-- 回滚说明：
--   不可回滚到 28 值通用模板（那会再次阻断核销）。
--   如需进一步收紧，须先确认业务上不再产生对应状态。
-- ============================================================
