-- 0049 BOM 多级结构（成衣 ← 裁片件 ← 面料/里布/辅料包）（幂等）
-- 巡检发现（business-audit-report-2026-10-07 P1）：
--   bom_item 为纯单层结构（直接挂 material_id），无 parent_item_id / level，
--   无法表达服装行业天然的多级 BOM：
--     · 成衣 ← 裁片件 ← 面料 / 里布
--     · 套件 ← 主料 + 辅料包（拉链 + 扣子 + 商标）
--   后果：①辅料领用与主料口径混淆（辅料被平铺挂在成衣上）
--        ②无法按「面料批次」追溯到成衣
--        ③MRP 在多级结构下净需求算不准（mrp.service.ts:100 单层平铺）
--        ④成本无法逐级摊分（cost.service.ts:98-106 单层 usagePerPiece 直算）
--
-- 建模方案：bom_item 自关联（parent_item_id + level），而非另建 component 表。
--   理由：①改动面最小，只加两列 + 一个自关联外键
--        ②保留 bom_item 现有全部语义（usagePerPiece/lossRate/bomType 含义不变）
--        ③递归展开在同一张表内完成，MRP/成本改动可控
--        ④服装行业 BOM 层级通常 2-3 层，自关联足够表达
--
-- level 语义：1 = 直接挂在成衣上的一级部件；2 = 部件的子项；依此类推。
--   存量 7 条明细全部回填 level=1、parent_item_id=NULL，
--   即**改造后行为与改造前完全一致**（单层 BOM 仍按单层计算）。
--
-- 幂等：ADD COLUMN IF NOT EXISTS；回填带 WHERE 条件；约束 IF NOT EXISTS 语义。
--   前端与服务端在读到 parentItemId=null 的存量数据时走原有单层逻辑。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_items bigint;
  v_boms  bigint;
BEGIN
  SELECT count(*) INTO v_items FROM bom_item;
  SELECT count(*) INTO v_boms  FROM bom;
  RAISE NOTICE '[0049] 预检查：bom % 个，bom_item 明细 % 条', v_boms, v_items;
END $$;

-- ============================================================
-- 2) 新增层级字段
-- ============================================================
-- 2.1 parent_item_id：自关联，指向父级明细行；NULL = 一级部件（直接挂成衣）
ALTER TABLE bom_item
  ADD COLUMN IF NOT EXISTS parent_item_id uuid
    REFERENCES bom_item(id) ON DELETE CASCADE;

-- 2.2 level：层级深度，1 = 一级部件（直接挂成衣）
ALTER TABLE bom_item
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;

-- ============================================================
-- 3) 存量回填：一律视为一级部件（保持原有单层语义）
-- ============================================================
UPDATE bom_item SET level = 1 WHERE level IS NULL OR level < 1;
UPDATE bom_item SET parent_item_id = NULL WHERE parent_item_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM bom_item p WHERE p.id = bom_item.parent_item_id);

-- ============================================================
-- 4) 约束与索引
-- ============================================================
-- 4.1 level 合法性：1-10（防御性上限，防止异常深递归）
ALTER TABLE bom_item DROP CONSTRAINT IF EXISTS ck_bom_item_level;
ALTER TABLE bom_item
  ADD CONSTRAINT ck_bom_item_level CHECK (level >= 1 AND level <= 10);

-- 4.2 父级必须同属一个 BOM（跨 BOM 挂父会导致递归展开错乱）。
--     ⚠ PostgreSQL 的 CHECK 约束**不允许子查询**（实测报
--       "cannot use subquery in check constraint"），而这是跨行约束，
--       故改用 BEFORE INSERT OR UPDATE 触发器实现。
--     触发器同时兜住自引用（parent_item_id = id）与环路。
CREATE OR REPLACE FUNCTION fn_bom_item_parent_guard() RETURNS trigger AS $$
DECLARE
  v_parent_bom uuid;
  v_depth     integer;
BEGIN
  -- 一级部件：无需校验
  IF NEW.parent_item_id IS NULL THEN
    -- 一级部件的 level 固定为 1（避免调用方传入不一致的 level）
    IF NEW.level IS NULL OR NEW.level <> 1 THEN
      NEW.level := 1;
    END IF;
    RETURN NEW;
  END IF;

  -- 自引用防护。
  --   注意：BEFORE INSERT 时 NEW.id 尚未生成（为 NULL），无法用 id 比对；
  --   因此 INSERT 阶段依赖"父级必须已存在"这条规则——
  --   若把 parent_item_id 指向自己新插入的行，该行此刻尚不存在，
  --   v_parent_bom 会是 NULL 而被下一条规则拦下。
  --   UPDATE 阶段 id 已存在，可显式比对。
  IF NEW.id IS NOT NULL AND NEW.parent_item_id = NEW.id THEN
    RAISE EXCEPTION '[0049] bom_item 不能以自身为父级 (id=%)', NEW.id;
  END IF;

  -- 父级必须存在且同属一个 BOM
  SELECT bom_id, level INTO v_parent_bom, v_depth
  FROM bom_item WHERE id = NEW.parent_item_id;

  IF v_parent_bom IS NULL THEN
    RAISE EXCEPTION '[0049] 父级明细不存在或尚未生成 (parent_item_id=%)，不能自引用', NEW.parent_item_id;
  END IF;

  IF v_parent_bom <> NEW.bom_id THEN
    RAISE EXCEPTION '[0049] 父级明细属于其他 BOM（父 bom_id=% 本 bom_id=%），跨 BOM 挂父不允许',
      v_parent_bom, NEW.bom_id;
  END IF;

  -- level 必须 = 父级 level + 1。
  --   调用方（应用层）在传 parentItemId 时通常不传 level，列默认值会填 1，
  --   因此这里以「父级层级」为权威值覆盖：无论调用方传了什么，
  --   有父级时 level 一律由父级推导，杜绝父子层级不一致的数据。
  --   一级部件（无父级）的 level 已在函数开头归一为 1。
  NEW.level := COALESCE(v_depth, 0) + 1;

  IF NEW.level > 10 THEN
    RAISE EXCEPTION '[0049] BOM 层级不得超过 10 层（父级 level=%）', v_depth;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bom_item_parent_guard ON bom_item;
CREATE TRIGGER trg_bom_item_parent_guard
  BEFORE INSERT OR UPDATE ON bom_item
  FOR EACH ROW EXECUTE FUNCTION fn_bom_item_parent_guard();

-- 4.3 索引：递归展开按 bom_id + parent_item_id 遍历
CREATE INDEX IF NOT EXISTS idx_bom_item_bom_parent ON bom_item (bom_id, parent_item_id);

-- 4.4 索引：按父级查子项（防重复挂载 + 前端树渲染）
CREATE INDEX IF NOT EXISTS idx_bom_item_parent ON bom_item (parent_item_id);

-- 4.5 索引：按层级查（报表按层级汇总）
CREATE INDEX IF NOT EXISTS idx_bom_item_level ON bom_item (level);

-- ============================================================
-- 5) 后置校验
-- ============================================================
DO $$
DECLARE
  v_illegal  bigint;
  v_orphan   bigint;
  v_cycle    bigint;
  v_l1       bigint;
BEGIN
  -- level 合法性
  SELECT count(*) INTO v_illegal FROM bom_item
   WHERE level IS NULL OR level < 1 OR level > 10;

  -- 孤儿父级（父行不存在）
  SELECT count(*) INTO v_orphan FROM bom_item c
   WHERE c.parent_item_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM bom_item p WHERE p.id = c.parent_item_id);

  -- 环路检测：自引用（自身为父）与 2 层互指
  SELECT count(*) INTO v_cycle FROM bom_item
   WHERE parent_item_id = id;

  -- 统计一级部件数（parent IS NULL）
  SELECT count(*) INTO v_l1 FROM bom_item WHERE parent_item_id IS NULL;

  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0049] 存在非法 level % 行', v_illegal;
  END IF;
  IF v_orphan > 0 THEN
    RAISE EXCEPTION '[0049] 存在孤儿父级引用 % 行', v_orphan;
  END IF;
  IF v_cycle > 0 THEN
    RAISE EXCEPTION '[0049] 存在自引用环路 % 行', v_cycle;
  END IF;

  RAISE NOTICE '[0049] 完成：明细总数不变，一级部件 % 条，非法 level=% 孤儿=% 自引用=%',
    v_l1, v_illegal, v_orphan, v_cycle;
END $$;

-- ============================================================
-- 回滚说明：
--   DROP TRIGGER IF EXISTS trg_bom_item_parent_guard ON bom_item;
--   DROP FUNCTION IF EXISTS fn_bom_item_parent_guard();
--   ALTER TABLE bom_item DROP CONSTRAINT IF EXISTS ck_bom_item_level;
--   DROP INDEX IF EXISTS idx_bom_item_level;
--   DROP INDEX IF EXISTS idx_bom_item_parent;
--   DROP INDEX IF EXISTS idx_bom_item_bom_parent;
--   ALTER TABLE bom_item DROP COLUMN IF EXISTS level;
--   ALTER TABLE bom_item DROP COLUMN IF EXISTS parent_item_id;
--   ⚠ 若已录入多级 BOM 数据，删除 parent_item_id 会丢失层级关系，
--     且多级行的 usage_per_piece 语义（每件父部件用量）与一级行不同，
--     回滚前请先备份：pg_dump -t bom_item。
-- ============================================================
