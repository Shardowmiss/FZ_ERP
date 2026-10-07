-- 0050 上市日期与季末清货识别（服装零售核心指标，幂等）
-- 巡检发现（business-audit-report-2026-10-07 P1-5）：
--   style 已有 season / wave / year 三字段（季节与年份），但**无 launch_date 上市日期**
--   （全库检索 launchDate / launch_date / 上市日期 零命中），导致服装零售最核心的
--   几个指标无法计算：
--     · 上市首周售罄率（上市 7 天内销量 / 首单备货量）
--     · 上市天数（当前日期 - 上市日期，用于判定新品/老品）
--     · 季末清货时点（过季 N 天自动触发清货折扣建议）
--     · 订货会节奏复盘（上新节奏与实际售罄周期）
--
-- 本迁移只加字段与索引，不改动任何既有计算逻辑，属纯增量。
--
-- 字段说明：
--   launch_date  上市日期。存量数据可由 wave 推导者回填（如 wave='2026AW' → 当年 9 月 1 日，
--               取该季的典型上市起始日），推导不出的留 NULL 由业务补录。
--   clearance_days 季末清货阈值（天）。超过「上市日期 + clearance_days」即视为过季，
--               用于清货折扣建议。默认 90 天（服装行业春夏/秋冬两季的常见周期）。
--               置 0 或 NULL 表示不做自动清货判定。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_styles bigint;
  v_wave   bigint;
BEGIN
  SELECT count(*) INTO v_styles FROM style;
  SELECT count(*) INTO v_wave FROM style WHERE wave IS NOT NULL AND wave <> '';
  RAISE NOTICE '[0050] 预检查：style % 行，其中有 wave 可推导上市日期的 % 行', v_styles, v_wave;
END $$;

-- ============================================================
-- 2) 新增字段
-- ============================================================
ALTER TABLE style
  ADD COLUMN IF NOT EXISTS launch_date date;

ALTER TABLE style
  ADD COLUMN IF NOT EXISTS clearance_days integer NOT NULL DEFAULT 90;

-- ============================================================
-- 3) 存量回填：由 wave 推导上市日期
--    wave 格式为「年份+季节」，如 2026AW（0046 已归一化）：
--      SP 春 → 当年 01-01
--      SU 夏 → 当年 05-01
--      AW 秋冬 → 当年 09-01
--      WI 冬 → 当年 11-01
--    推导不出的保持 NULL，由业务补录。
-- ============================================================
UPDATE style
SET launch_date = make_date(
      CAST(LEFT(wave, 4) AS integer),
      CASE
        WHEN UPPER(RIGHT(wave, 2)) = 'SP' THEN 1
        WHEN UPPER(RIGHT(wave, 2)) = 'SU' THEN 5
        WHEN UPPER(RIGHT(wave, 2)) = 'AW' THEN 9
        WHEN UPPER(RIGHT(wave, 2)) = 'WI' THEN 11
      END,
      1
    )
WHERE launch_date IS NULL
  AND wave ~ '^(19|20)[0-9]{2}(SP|SU|AW|WI)$';

-- ============================================================
-- 4) 约束与索引
-- ============================================================
-- 4.1 clearance_days 合法性：0-365（0/NULL = 不做自动清货判定）
ALTER TABLE style DROP CONSTRAINT IF EXISTS ck_style_clearance_days;
ALTER TABLE style
  ADD CONSTRAINT ck_style_clearance_days
  CHECK (clearance_days IS NULL OR (clearance_days >= 0 AND clearance_days <= 365));

-- 4.2 索引：按上市日期排序（新品/老品筛选、季末清货扫描）
CREATE INDEX IF NOT EXISTS idx_style_launch_date ON style (launch_date);

-- 4.3 复合索引：季节 + 上市日期（报表常用「某季某上市区间」筛选）
CREATE INDEX IF NOT EXISTS idx_style_season_launch ON style (season, launch_date);

-- ============================================================
-- 5) 后置校验
-- ============================================================
DO $$
DECLARE
  v_illegal   bigint;
  v_launched  bigint;
  v_overdue   bigint;
BEGIN
  SELECT count(*) INTO v_illegal FROM style
   WHERE clearance_days IS NOT NULL AND (clearance_days < 0 OR clearance_days > 365);

  SELECT count(*) INTO v_launched FROM style WHERE launch_date IS NOT NULL;

  -- 当前已过季（上市日期 + clearance_days < 今天）的款数
  SELECT count(*) INTO v_overdue FROM style
   WHERE launch_date IS NOT NULL
     AND launch_date + clearance_days < CURRENT_DATE;

  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0050] 存在非法 clearance_days % 行', v_illegal;
  END IF;

  RAISE NOTICE '[0050] 完成：已回填上市日期 % 款，当前已过季 % 款，非法 clearance_days=% 行',
    v_launched, v_overdue, v_illegal;
END $$;

-- ============================================================
-- 回滚说明：
--   ALTER TABLE style DROP CONSTRAINT IF EXISTS ck_style_clearance_days;
--   DROP INDEX IF EXISTS idx_style_season_launch;
--   DROP INDEX IF EXISTS idx_style_launch_date;
--   ALTER TABLE style DROP COLUMN IF EXISTS clearance_days;
--   ALTER TABLE style DROP COLUMN IF EXISTS launch_date;
--   ⚠ launch_date 为业务补录数据，删除后无法还原（wave 推导的除外，可重跑本迁移重建）。
-- ============================================================
