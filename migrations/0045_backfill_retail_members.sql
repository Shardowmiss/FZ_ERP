-- 0045 补建零售会员档案并回填消费统计（幂等）
-- 巡检发现（business-audit-report-2026-10-07 P1）：
--   retail_order 中 189 单带会员号（187 个不同会员，合计 354,571 元），
--   但 member 表仅 13 行且全为测试/审计数据（FFM1000 / M1000 / SMOKE_A / AUDIT_A），
--   两套编码零交集 → 会员消费统计、频次分析、积分统计对这 189 单全部返回 0。
--
-- 为何不修改 retail_order.member_id：
--   member 表 phone 为加密串（enc::...），无法反推身份，也无法安全合并；
--   AW26M#### 是上游业务既有的真实会员编码，改零售单会破坏与上游的对应关系。
--   故选择「按零售单聚合补建会员档案」，让既有 35.4 万元交易立即可统计。
--
-- 补建口径（全部来自 retail_order 真实交易，可复核）：
--   total_spent       = 该会员所有 settled/returned 零售单的 total_amount 之和
--   order_count       = 该会员零售单笔数
--   last_purchase_date= 最近一次零售日期
--   level             = 按 member_level.cumulative 门槛自动定级
--                       （normal 0 / silver 5000 / gold 20000 / diamond 50000）
--   points            = 按 1 元消费 = 1 积分（与 POS 侧 pos_points_log 口径一致）
--   name              = 会员号后缀派生（AW26M#### → 会员####），因原始姓名不可得
--   phone             = 留空，不伪造（member.phone 允许 NULL）
--
-- 幂等：ON CONFLICT (member_no) DO NOTHING，已存在的会员不覆盖；
--       回填 UPDATE 仅作用于本迁移新建的会员（remark 标记），可重复执行。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_orphan bigint;
  v_amount numeric;
  v_exist  bigint;
BEGIN
  SELECT count(DISTINCT r.member_id), COALESCE(SUM(r.total_amount), 0)
    INTO v_orphan, v_amount
  FROM retail_order r
  WHERE r.member_id IS NOT NULL AND r.member_id <> ''
    AND NOT EXISTS (SELECT 1 FROM member m WHERE m.member_no = r.member_id);

  SELECT count(*) INTO v_exist FROM member;

  RAISE NOTICE '[0045] 预检查：member 表现有 % 行；零售单中未建档会员 % 个，涉及金额 %',
    v_exist, v_orphan, v_amount;
END $$;

-- ============================================================
-- 2) 补建会员档案（按零售单聚合，一个会员一行）
-- ============================================================
INSERT INTO member (
  member_no,
  name,
  level,
  total_spent,
  order_count,
  points,
  last_purchase_date,
  status,
  remark,
  _created_at,
  _updated_at
)
SELECT
  agg.member_no,
  '会员' || lpad(agg.seq::text, 4, '0')          AS name,
  agg.level,
  agg.total_spent,
  agg.order_count,
  agg.points,
  agg.last_purchase_date,
  'active',
  '迁移0045按零售单补建（原始姓名/手机号不可得）',
  now(),
  now()
FROM (
  SELECT
    r.member_id                                                   AS member_no,
    SUM(r.total_amount)                                           AS total_spent,
    COUNT(*)                                                      AS order_count,
    MAX(r.sale_date)                                              AS last_purchase_date,
    FLOOR(COALESCE(SUM(r.total_amount), 0))::int                  AS points,
    -- 按 member_level 的 cumulative 门槛定级（门槛来自 0031 迁移的等级表）
    CASE
      WHEN COALESCE(SUM(r.total_amount), 0) >= 50000 THEN 'diamond'
      WHEN COALESCE(SUM(r.total_amount), 0) >= 20000 THEN 'gold'
      WHEN COALESCE(SUM(r.total_amount), 0) >= 5000  THEN 'silver'
      ELSE 'normal'
    END                                                          AS level,
    ROW_NUMBER() OVER (ORDER BY SUM(r.total_amount) DESC, r.member_id) AS seq
  FROM retail_order r
  WHERE r.member_id IS NOT NULL
    AND r.member_id <> ''
    AND r.status IN ('settled', 'returned')     -- 与报表口径一致，只统计已结算/已退货
    AND NOT EXISTS (SELECT 1 FROM member m WHERE m.member_no = r.member_id)
  GROUP BY r.member_id
) agg
ON CONFLICT (member_no) DO NOTHING;

-- ============================================================
-- 3) 回填消费统计到既有会员（对已存在的会员补齐 total_spent/order_count/points）
--    说明：M1000~M1004 已有演示数据（total_spent=4776），这里按零售单真值覆盖，
--    保证 member 表与 retail_order 口径一致。限定在 member_no 形如 AW26M% 的会员，
--    不触碰 FFM/M/SMOKE/AUDIT 等测试数据。
-- ============================================================
-- （第 2 步已用 ON CONFLICT DO NOTHING 跳过既有会员，故此处无需额外 UPDATE；
--   保留说明以明确口径：本次只补建、不覆盖既有会员，避免破坏 POS 侧已建档数据。）

-- ============================================================
-- 4) 写入积分流水（member_point），使积分变动可审计
--    列口径依 member.service.ts:201 adjustPoints()：
--      member_id / change_type / change_value / balance / remark
--      （无 source / balance_after 列，勿照抄其他表结构）
-- ============================================================
INSERT INTO member_point (
  member_id,
  change_type,
  change_value,
  balance,
  remark,
  _created_at,
  _updated_at
)
SELECT
  m.id,
  'migration',
  FLOOR(m.total_spent)::int,
  FLOOR(m.total_spent)::int,
  '迁移0045按零售单回填历史积分',
  now(),
  now()
FROM member m
WHERE m.remark = '迁移0045按零售单补建（原始姓名/手机号不可得）'
  AND m.total_spent > 0
  AND NOT EXISTS (
    SELECT 1 FROM member_point p
    WHERE p.member_id = m.id AND p.change_type = 'migration'
  );

-- ============================================================
-- 5) 后置校验
-- ============================================================
DO $$
DECLARE
  v_left  bigint;   -- 仍未建档的零售会员数
  v_new   bigint;   -- 本次新建会员数
  v_amt   numeric;
BEGIN
  SELECT count(DISTINCT r.member_id)
    INTO v_left
  FROM retail_order r
  WHERE r.member_id IS NOT NULL AND r.member_id <> ''
    AND NOT EXISTS (SELECT 1 FROM member m WHERE m.member_no = r.member_id);

  SELECT count(*) INTO v_new
  FROM member WHERE remark = '迁移0045按零售单补建（原始姓名/手机号不可得）';

  SELECT COALESCE(SUM(total_spent), 0) INTO v_amt
  FROM member WHERE remark = '迁移0045按零售单补建（原始姓名/手机号不可得）';

  IF v_left > 0 THEN
    RAISE EXCEPTION '[0045] 仍有 % 个零售会员未建档', v_left;
  END IF;

  RAISE NOTICE '[0045] 完成：新建会员 % 个，累计消费 %，未建档残留 % 个',
    v_new, v_amt, v_left;
END $$;

-- ============================================================
-- 回滚说明（手动执行）：
--   DELETE FROM member_point WHERE change_type = 'migration'
--                        AND remark = '迁移0045按零售单回填历史积分';
--   DELETE FROM member
--    WHERE remark = '迁移0045按零售单补建（原始姓名/手机号不可得）';
--   （按 remark 精确定位，只删本迁移生成的行，不影响既有会员）
-- ============================================================
