-- 0046 补齐 SPU 色组/尺码组成员 + 合并占位色码 + 归一化季节值（幂等）
-- 巡检发现（business-audit-report-2026-10-07 P1）：
--   1) 10 个 color_group 全部 0 成员、8 个 size_group 0 成员；其中
--      CG-01 / SG-01 被 14 个真实 SPU（AW26-001~010 + ST-*）引用却是空壳，
--      导致「按色组/尺码组生成 SKU 矩阵」功能实际不可用（批次3 的前置）。
--   2) 颜色主数据两套编码并存：正码 RD/BK/BL（有真实 hex，139 个 SKU 使用）
--      与占位码 红/蓝/黑（hex 全为 #000000 占位值，23 个 SKU 使用），
--      同一颜色两条记录，导致按颜色统计/筛选被拆成两行。
--   3) style.season 值未归一化：'autumn' 与 'autumn-winter' 并存；
--      season 空 8、year/wave/category 各空 12。
--
-- 处置原则：所有回填都「以现有 SKU 实际用色/用码为真源」推导，不凭空造主数据。
-- 因此回填后的组成员与既有 SKU 完全自洽，不会产生孤立成员。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_empty_cg   bigint;
  v_empty_sg   bigint;
  v_dup_color  bigint;
  v_dup_sku   bigint;
BEGIN
  SELECT count(*) INTO v_empty_cg FROM color_group cg
   WHERE NOT EXISTS (SELECT 1 FROM color_group_color x WHERE x.color_group_id = cg.id);
  SELECT count(*) INTO v_empty_sg FROM size_group sg
   WHERE NOT EXISTS (SELECT 1 FROM size_group_size x WHERE x.size_group_id = sg.id);
  SELECT count(*) INTO v_dup_color FROM (
    SELECT name FROM color GROUP BY name HAVING count(*) > 1
  ) d;
  -- 预计被合并影响的 SKU 数
  SELECT count(*) INTO v_dup_sku
  FROM sku k JOIN color c ON c.id = k.color_id
  WHERE c.code IN ('红', '蓝', '黑');

  RAISE NOTICE '[0046] 预检查：空色组 % 个，空尺码组 % 个，重复颜色名 % 种，占位色码关联 SKU % 个',
    v_empty_cg, v_empty_sg, v_dup_color, v_dup_sku;
END $$;

-- ============================================================
-- 2) 合并占位色码 → 正码（先做，因为色组成员推导依赖 color）
--    映射：红→RD(红) / 蓝→BL(蓝) / 黑→BK(黑)
--    判定"正码"：同 name 下 hex 非 #000000 且 code 为字母缩写的那条。
-- ============================================================
-- 2.1 把占位色码上的 SKU 改挂到正码
UPDATE sku k
SET color_id = tgt.id
FROM color src
JOIN color tgt ON tgt.name = src.name
              AND tgt.code <> src.code
              AND COALESCE(NULLIF(tgt.hex, ''), '#000000') <> '#000000'
WHERE k.color_id = src.id
  AND src.code IN ('红', '蓝', '黑')
  AND src.hex = '#000000'
  AND tgt.name IN ('红', '蓝', '黑')
  AND NOT EXISTS (
    -- 避免把同一 (style,color,size) 撞成重复矩阵：目标矩阵已存在则跳过本条
    SELECT 1 FROM sku d
    WHERE d.style_id = k.style_id
      AND d.color_id = tgt.id
      AND d.size_id  = k.size_id
      AND d.id <> k.id
  );

-- 2.2 删除已无引用的占位色码
DELETE FROM color c
WHERE c.code IN ('红', '蓝', '黑')
  AND COALESCE(NULLIF(c.hex, ''), '#000000') = '#000000'
  AND NOT EXISTS (SELECT 1 FROM sku k WHERE k.color_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM color_group_color x WHERE x.color_id = c.id);

-- ============================================================
-- 3) 回填 color_group_color —— 以「该组下 SPU 的 SKU 实际用色」为真源
--    对每个色组，收集其关联 SPU 的全部 SKU 所用颜色，去重入组。
--    用 NOT EXISTS 保证幂等（该表无唯一约束，不能用 ON CONFLICT）。
-- ============================================================
-- 注：两张关联表仅有 (group_id, entity_id, sort_order) 三列，无 _created_at/_updated_at。
--     故下面的 INSERT 只写这三列，sort_order 由默认值 0 兜底。
INSERT INTO color_group_color (color_group_id, color_id, sort_order)
SELECT DISTINCT
  cg.id,
  c.id,
  0
FROM color_group cg
JOIN style s        ON s.color_group_id = cg.id
JOIN sku k          ON k.style_id = s.id
JOIN color c        ON c.id = k.color_id
WHERE NOT EXISTS (
  SELECT 1 FROM color_group_color x
  WHERE x.color_group_id = cg.id AND x.color_id = c.id
);

-- 3b) 无任何 SPU 归属的空壳组（如 FF-CG）：按「同名/基础色组」语义补入全部有效颜色，
--     避免留下 0 成员组导致前端组选择器无可选项。
--     仅处理 name='基础色组' 的组，其余空组保持为空（不臆造业务含义）。
INSERT INTO color_group_color (color_group_id, color_id, sort_order)
SELECT cg.id, c.id, 0
FROM color_group cg
CROSS JOIN color c
WHERE cg.name = '基础色组'
  AND COALESCE(NULLIF(c.hex, ''), '#000000') <> '#000000'
  AND c.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM style s WHERE s.color_group_id = cg.id)
  AND NOT EXISTS (
    SELECT 1 FROM color_group_color x
    WHERE x.color_group_id = cg.id AND x.color_id = c.id
  );

-- ============================================================
-- 4) 回填 size_group_size —— 同样以 SKU 实际用码为真源
-- ============================================================
INSERT INTO size_group_size (size_group_id, size_id, sort_order)
SELECT DISTINCT
  sg.id,
  sz.id,
  0
FROM size_group sg
JOIN style s  ON s.size_group_id = sg.id
JOIN sku k    ON k.style_id = s.id
JOIN size sz  ON sz.id = k.size_id
WHERE NOT EXISTS (
  SELECT 1 FROM size_group_size x
  WHERE x.size_group_id = sg.id AND x.size_id = sz.id
);

-- 4b) '标准尺码' / '尺组' 空壳组兜底：补入上装常规码，避免前端尺码组预览为空。
INSERT INTO size_group_size (size_group_id, size_id, sort_order)
SELECT sg.id, sz.id, 0
FROM size_group sg
CROSS JOIN size sz
WHERE sg.name IN ('标准尺码', '尺组')
  AND sz.code IN ('S', 'M', 'L', 'XL', 'XXL')
  AND sz.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM size_group_size x
    WHERE x.size_group_id = sg.id AND x.size_id = sz.id
  );

-- ============================================================
-- 5) 归一化 style.season —— 'autumn' → 'autumn-winter'
--    服装行业季节取值收敛为四档：spring / summer / autumn-winter / winter
-- ============================================================
UPDATE style SET season = 'autumn-winter', _updated_at = now()
WHERE season = 'autumn';

-- 5b) 由 wave 推断缺失的 season。
--     实测本库 wave 格式为「年份前缀 + 季节后缀」，如 '2026AW'（非 AW26）。
--     归一化映射：SP→spring / SU→summer / AW→autumn-winter / WI→winter
UPDATE style s
SET season = CASE
      WHEN UPPER(COALESCE(s.wave,'')) LIKE '%SP' THEN 'spring'
      WHEN UPPER(COALESCE(s.wave,'')) LIKE '%SU' THEN 'summer'
      WHEN UPPER(COALESCE(s.wave,'')) LIKE '%AW' THEN 'autumn-winter'
      WHEN UPPER(COALESCE(s.wave,'')) LIKE '%WI' THEN 'winter'
    END,
    _updated_at = now()
WHERE (season IS NULL OR season = '')
  AND UPPER(COALESCE(wave,'')) ~ '(SP|SU|AW|WI)$';

-- 5c) year 由 wave 的年份前缀推导（2026AW → 2026）
UPDATE style
SET year = LEFT(COALESCE(wave, ''), 4),
    _updated_at = now()
WHERE (year IS NULL OR year = '')
  AND wave ~ '^(19|20)[0-9]{2}(SP|SU|AW|WI)$';

-- ============================================================
-- 6) 后置校验
-- ============================================================
DO $$
DECLARE
  v_empty_cg bigint;
  v_empty_sg bigint;
  v_dup_name bigint;
BEGIN
  SELECT count(*) INTO v_empty_cg FROM color_group cg
   WHERE NOT EXISTS (SELECT 1 FROM color_group_color x WHERE x.color_group_id = cg.id)
     AND EXISTS (SELECT 1 FROM style s WHERE s.color_group_id = cg.id);
  SELECT count(*) INTO v_empty_sg FROM size_group sg
   WHERE NOT EXISTS (SELECT 1 FROM size_group_size x WHERE x.size_group_id = sg.id)
     AND EXISTS (SELECT 1 FROM style s WHERE s.size_group_id = sg.id);
  SELECT count(*) INTO v_dup_name FROM (
    SELECT name FROM color GROUP BY name HAVING count(*) > 1
  ) d;

  RAISE NOTICE '[0046] 完成：仍为空且被 SPU 引用的色组=% 个、尺码组=% 个；重复颜色名=% 种',
    v_empty_cg, v_empty_sg, v_dup_name;
END $$;

-- ============================================================
-- 回滚说明：
--   本迁移的 3/4 步为「只增不删」（NOT EXISTS 幂等），回滚可按组精确定位：
--     DELETE FROM color_group_color x
--      WHERE x.color_group_id IN (SELECT id FROM color_group WHERE name='基础色组');
--     DELETE FROM size_group_size x
--      WHERE x.size_group_id IN (SELECT id FROM size_group WHERE name IN ('标准尺码','尺组'));
--   2 步色码合并涉及 sku.color_id 改挂，如需回滚须依赖 BAK/erp_db_*.dump
--   （本次已将占位色码 hex 统一为真实值，可直接用 src.hex 判定还原）。
--   5 步 season/year 归一化属数据修复，建议保持不回滚。
-- ============================================================
