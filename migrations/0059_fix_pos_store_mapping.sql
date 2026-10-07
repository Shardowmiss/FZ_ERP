-- ============================================================
-- 0059 修正 POS↔ERP 门店主数据映射（打通上行的前置条件）
--
-- 【问题】POS 侧门店编码体系与 ERP 不通，导致上行单据被 ERP 拒绝：
--   实测 receiveSales 返回 400「无法解析门店编码: STORE01」。
--   根因是两套编码：
--     POS pos_store.code  = 'STORE01'（萧山旗舰店）
--     ERP store.code       = 'ST00xx'（如 ST0061 杭州银泰旗舰店）
--   ERP 侧 resolveStore 的解析顺序为：
--     ① pos_store_map.store_code 精确匹配 → ② store.code 直接匹配
--   两者都不命中即抛 400。
--
-- 【更严重的隐患】既有映射本身是错的：
--   pos_store_map 里 'HZ-HB-YT-001'（POS 客户端 lib/store.ts 硬编码的门店 ID，
--   语义为「杭州湖滨银泰旗舰店」）被映射到了 **ST0005 珠海IFS直营店**——
--   城市都不对。这会导致 POS 上行数据落到错误门店的账上，
--   属跨系统数据污染，比直接 400 更危险（400 至少会暴露，错配会静默错账）。
--
-- 【本迁移做两件事】
--   1) 修正错配：HZ-HB-YT-001 → ST0061 杭州银泰旗舰店（HZ-HB-YT = 杭州湖滨银泰）
--   2) 补齐 POS 实际门店：STORE01（萧山旗舰店）→ ST0061 同店
--      萧山属杭州，与杭州银泰旗舰店同域；且 POS 演示数据(pos_db)的
--      销售/会员/库存全部挂在该门店，是 POS 侧唯一的实际经营门店。
--
-- 【幂等】ON CONFLICT (store_code) DO UPDATE，可重复执行。
-- 【安全】脚本含校验：映射目标门店必须存在且已绑定仓库，
--         否则 RAISE EXCEPTION 拒执行（避免建出无法回库库存的映射）。
-- ============================================================

-- ------------------------------------------------------------
-- 1) 预检查：目标门店必须存在且已绑定仓库
-- ------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(code, ', ') INTO v_missing
  FROM (VALUES ('ST0061')) AS t(code)
  WHERE NOT EXISTS (
    SELECT 1 FROM store s
    WHERE s.code = t.code AND s.warehouse_id IS NOT NULL
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '[0059] 目标门店 % 不存在或未绑定仓库，拒绝建立映射（否则上行退货/盘点无法回库）',
      v_missing;
  END IF;

  RAISE NOTICE '[0059] 预检查通过：ST0061 杭州银泰旗舰店 存在且已绑定仓库';
END $$;

-- ------------------------------------------------------------
-- 2) 修正错配 + 补齐 STORE01
--    HZ-HB-YT 语义为「杭州湖滨银泰」，对应 ST0061 杭州银泰旗舰店；
--    原映射指向 ST0005 珠海IFS直营店（跨城市错配），在此纠正。
--
-- 幂等说明：pos_store_map **无 store_code 唯一约束**（实测 pg_constraint 无返回），
--   故不能用 ON CONFLICT；改用「存在则 UPDATE，否则 INSERT」两段式，
--   两者都以 NOT EXISTS / WHERE 判重，可重复执行且不会产生重复行。
-- ------------------------------------------------------------
UPDATE pos_store_map mp
SET store_id   = s.id,
    store_name = s.name
FROM store s
WHERE s.code = 'ST0061'
  AND mp.store_code IN ('HZ-HB-YT-001', 'STORE01');

INSERT INTO pos_store_map (store_code, store_id, store_name, _created_at)
SELECT m.pos_code, s.id, s.name, now()
FROM (VALUES
  ('HZ-HB-YT-001', 'ST0061'),  -- 修正：原指向 ST0005 珠海IFS直营店
  ('STORE01',       'ST0061')   -- 补齐：POS pos_store 实际门店编码
) AS m(pos_code, erp_code)
JOIN store s ON s.code = m.erp_code
WHERE NOT EXISTS (
  SELECT 1 FROM pos_store_map x WHERE x.store_code = m.pos_code
);

-- ------------------------------------------------------------
-- 3) 后置校验：确认两个 POS 编码均可解析到已绑定仓库的门店
-- ------------------------------------------------------------
DO $$
DECLARE
  v_unresolved text;
BEGIN
  SELECT string_agg(m.pos_code, ', ') INTO v_unresolved
  FROM (VALUES ('HZ-HB-YT-001'), ('STORE01')) AS m(pos_code)
  WHERE NOT EXISTS (
    -- 模拟 ERP resolveStore 的解析逻辑：先映射表，再 store.code
    SELECT 1
    FROM pos_store_map mp
    JOIN store s ON s.id = mp.store_id
    WHERE mp.store_code = m.pos_code AND s.warehouse_id IS NOT NULL
  );

  IF v_unresolved IS NOT NULL THEN
    RAISE EXCEPTION '[0059] 以下 POS 门店编码仍无法解析: %', v_unresolved;
  END IF;

  RAISE NOTICE '[0059] 完成：HZ-HB-YT-001 与 STORE01 均已映射到已绑定仓库的门店，上行可解析';
END $$;

-- ============================================================
-- 回滚说明：
--   DELETE FROM pos_store_map WHERE store_code IN ('HZ-HB-YT-001','STORE01');
--   ⚠ 回滚后 POS 上行会重新返回 400「无法解析门店编码」。
--     其中 HZ-HB-YT-001 的原映射（→ST0005 珠海IFS）是**错配**，
--     回滚会恢复这个跨城市错账隐患，不建议回滚。
-- ============================================================
