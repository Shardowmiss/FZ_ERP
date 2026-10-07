-- 0051 尺码尺寸维度（服装行业人体尺寸，幂等）
-- 巡检发现（business-audit-report-2026-10-07 P1-4）：
--   size 表仅有 code / name / sortOrder / status / remark，
--   全库检索 height|weight|胸围|腰围|臀围|身高|体重 **零命中**，
--   尺码只能作为纯字符串码存在，导致服装数字化管理的基础数据缺失：
--     · 无法按顾客体型（身高/体重/三围）推荐合适尺码
--     · 无法核对面料缩水后的成衣尺寸变化
--     · 无法关联尺码表给消费者查看
--     · 无法做oversize / 修身版型建议
--
-- 字段设计（对齐服装行业「号」体系，即国标 GB/T 1335 常用成人尺码）：
--   body_height  人体身高（cm）—— 「号」维度，上衣 165/84A 中的 165
--   body_weight  人体体重（kg）—— 上下装通用
--   chest         胸围（cm）      —— 上衣「A」后的数字（84A 的 84）
--   waist         腰围（cm）      —— 裤装核心维度
--   hip           臀围（cm）      —— 裤装/裙装
--   shoulder      肩宽（cm）      —— 上装版型
--   length        衣长（cm）      —— 成衣实测维度（分款号，非尺码固有）
--   neck          领围（cm）      —— 衬衫/连衣裙领口
--   sleeve        袖长（cm）      —— 上装
--   inseam        裤内长（cm）    —— 裤装
--
-- 说明：均为「建议基准值」，同一尺码在不同款式可通过 style 覆盖；
--   留 NULL 表示该维度不适用（如均码无胸腰臀，S/M/L 上衣不填 inseam）。
--
-- 存量回填：按服装行业通用号型基准填入 S/M/L/XL/XXL/XS 六档，
--   Y/Z（童装）与均码不做臆测填充，保持 NULL 待业务补录。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_sizes bigint;
BEGIN
  SELECT count(*) INTO v_sizes FROM size;
  RAISE NOTICE '[0051] 预检查：size 表 % 行', v_sizes;
END $$;

-- ============================================================
-- 2) 新增尺寸列
-- ============================================================
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS body_height numeric(5,1);   -- 人体身高 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS body_weight numeric(5,1);   -- 人体体重 kg
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS chest numeric(5,1);         -- 胸围 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS waist numeric(5,1);         -- 腰围 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS hip numeric(5,1);           -- 臀围 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS shoulder numeric(5,1);      -- 肩宽 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS neck numeric(5,1);          -- 领围 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS sleeve numeric(5,1);        -- 袖长 cm
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS length_cm numeric(5,1);     -- 衣长 cm（避免与 level 语义混淆）
ALTER TABLE size
  ADD COLUMN IF NOT EXISTS inseam numeric(5,1);        -- 裤内长 cm

-- ============================================================
-- 3) 存量回填：成人上装六档行业基准（GB/T 1335 常用号型）
--    童装 Y/Z 与均码不臆测，保持 NULL。
-- ============================================================
UPDATE size SET body_height=155, body_weight=50,  chest=84, waist=68, hip=90, shoulder=37, neck=36, sleeve=58, length_cm=64, inseam=76 WHERE code='XS';
UPDATE size SET body_height=160, body_weight=55,  chest=88, waist=72, hip=94, shoulder=38, neck=37, sleeve=59, length_cm=66, inseam=77 WHERE code='S';
UPDATE size SET body_height=165, body_weight=60,  chest=92, waist=76, hip=98, shoulder=39, neck=38, sleeve=60, length_cm=68, inseam=78 WHERE code='M';
UPDATE size SET body_height=170, body_weight=68,  chest=96, waist=80, hip=102, shoulder=40, neck=39, sleeve=61, length_cm=70, inseam=79 WHERE code='L';
UPDATE size SET body_height=175, body_weight=76,  chest=100, waist=84, hip=106, shoulder=41, neck=40, sleeve=62, length_cm=72, inseam=80 WHERE code='XL';
UPDATE size SET body_height=180, body_weight=85,  chest=104, waist=89, hip=110, shoulder=42, neck=41, sleeve=63, length_cm=74, inseam=81 WHERE code='XXL';

-- ============================================================
-- 4) 约束与索引
-- ============================================================
-- 4.1 人体尺寸合理性校验：身高 80-250cm、体重 20-200kg、三围 30-200cm
--     （超范围视为录入错误；NULL 允许，表示该维度不适用）
ALTER TABLE size DROP CONSTRAINT IF EXISTS ck_size_body_height;
ALTER TABLE size
  ADD CONSTRAINT ck_size_body_height
  CHECK (body_height IS NULL OR (body_height >= 80 AND body_height <= 250));

ALTER TABLE size DROP CONSTRAINT IF EXISTS ck_size_body_weight;
ALTER TABLE size
  ADD CONSTRAINT ck_size_body_weight
  CHECK (body_weight IS NULL OR (body_weight >= 20 AND body_weight <= 200));

-- 三围统一约束（胸/腰/臀/肩/领/袖/衣长/裤内长同规则）
ALTER TABLE size DROP CONSTRAINT IF EXISTS ck_size_measurements;
ALTER TABLE size
  ADD CONSTRAINT ck_size_measurements
  CHECK (
    (chest    IS NULL OR (chest    >= 30 AND chest    <= 200)) AND
    (waist    IS NULL OR (waist    >= 30 AND waist    <= 200)) AND
    (hip      IS NULL OR (hip      >= 30 AND hip      <= 200)) AND
    (shoulder IS NULL OR (shoulder >= 30 AND shoulder <= 200)) AND
    (neck     IS NULL OR (neck     >= 30 AND neck     <= 200)) AND
    (sleeve   IS NULL OR (sleeve   >= 30 AND sleeve   <= 200)) AND
    (length_cm IS NULL OR (length_cm >= 30 AND length_cm <= 200)) AND
    (inseam   IS NULL OR (inseam   >= 30 AND inseam   <= 200))
  );

-- 4.2 索引：按身高/体重区间筛尺码（体型推荐的核心查询）
CREATE INDEX IF NOT EXISTS idx_size_body_height ON size (body_height);
CREATE INDEX IF NOT EXISTS idx_size_body_weight ON size (body_weight);

-- ============================================================
-- 5) 后置校验
-- ============================================================
DO $$
DECLARE
  v_illegal  bigint;
  v_filled   bigint;
  v_no_meas  bigint;
BEGIN
  SELECT count(*) INTO v_illegal FROM size
   WHERE (body_height IS NOT NULL AND (body_height < 80 OR body_height > 250))
      OR (body_weight IS NOT NULL AND (body_weight < 20 OR body_weight > 200));

  SELECT count(*) INTO v_filled FROM size WHERE body_height IS NOT NULL;
  SELECT count(*) INTO v_no_meas FROM size WHERE body_height IS NULL;

  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0051] 存在越界人体尺寸 % 行', v_illegal;
  END IF;

  RAISE NOTICE '[0051] 完成：已回填基准尺寸 % 个尺码，未填写（待业务补录）% 个，越界=% 行',
    v_filled, v_no_meas, v_illegal;
END $$;

-- ============================================================
-- 回滚说明：
--   ALTER TABLE size DROP CONSTRAINT IF EXISTS ck_size_measurements;
--   ALTER TABLE size DROP CONSTRAINT IF EXISTS ck_size_body_weight;
--   ALTER TABLE size DROP CONSTRAINT IF EXISTS ck_size_body_height;
--   DROP INDEX IF EXISTS idx_size_body_weight;
--   DROP INDEX IF EXISTS idx_size_body_height;
--   ALTER TABLE size DROP COLUMN IF EXISTS inseam;
--   ALTER TABLE size DROP COLUMN IF EXISTS length_cm;
--   ALTER TABLE size DROP COLUMN IF EXISTS sleeve;
--   ALTER TABLE size DROP COLUMN IF EXISTS neck;
--   ALTER TABLE size DROP COLUMN IF EXISTS shoulder;
--   ALTER TABLE size DROP COLUMN IF EXISTS hip;
--   ALTER TABLE size DROP COLUMN IF EXISTS waist;
--   ALTER TABLE size DROP COLUMN IF EXISTS chest;
--   ALTER TABLE size DROP COLUMN IF EXISTS body_weight;
--   ALTER TABLE size DROP COLUMN IF EXISTS body_height;
--   ⚠ 本迁移回填的是「行业通用基准值」，若企业已有实测型号数据，
--     回滚将丢失这些值。生产环境回滚前请先备份：pg_dump -t size。
-- ============================================================
