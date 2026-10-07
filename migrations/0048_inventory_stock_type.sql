-- 0048 库存类型维度（正常/残次/样品/尾货/清仓）——服装零售核心能力（幂等）
-- 巡检发现（business-audit-report-2026-10-07 P0-4）：
--   inventory_stock 无任何类型列，且唯一索引 idx_inventory_stock_sku_wh
--   结构上锁死「一个 SKU 在一个仓库只有一行数量」，导致：
--     · 瑕疵款退货只能当正品回库 → 污染可售库存、虚增毛利
--     · 样品/展示品占用正品库存
--     · 季末尾货无法单独定价清理
--     · 残次率无统计口径
--     · 门店盘点实物与账面必然长期不符
--
-- 改造策略（低风险优先）：
--   1) stock_type 默认 'normal'，存量 652 行全部回填 normal
--      → 现有业务行为完全不变，零回归风险；
--   2) 唯一索引从 (sku_id, warehouse_id) 扩展为
--      (sku_id, warehouse_id, stock_type)，使同一 SKU 在同一仓
--      可并存「正常品 10 件 + 残次品 2 件」；
--   3) 取值收敛为服装零售通行五类，CHECK 约束防止写入非法值
--      （沿用 0043 收紧 retail_order.status 的做法）。
--
-- 为什么只改这一张表就够：
--   经全量盘点，18 个业务 service（采购/销售/零售/调拨/盘点/生产/委外/订货会）
--   的库存增减全部汇聚到 StockService.changeStock / batchChangeStock
--   这一个写入入口，因此只要 StockChangeItem 支持携带 stockType，
--   上下游即可透传，无需逐个改造业务模块。
--
-- 幂等：ADD COLUMN IF NOT EXISTS + 存量回填带 WHERE stock_type IS NULL 条件；
--       索引重建前先检测是否已含 stock_type 列，重复执行安全。

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_rows bigint;
  v_has_col boolean;
BEGIN
  SELECT count(*) INTO v_rows FROM inventory_stock;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_stock' AND column_name = 'stock_type'
  ) INTO v_has_col;

  RAISE NOTICE '[0048] 预检查：inventory_stock % 行；stock_type 列已存在=%', v_rows, v_has_col;
END $$;

-- ============================================================
-- 2) 新增 stock_type 列
-- ============================================================
ALTER TABLE inventory_stock
  ADD COLUMN IF NOT EXISTS stock_type varchar(20) NOT NULL DEFAULT 'normal';

-- ============================================================
-- 3) 存量回填（幂等：只补 NULL；NOT NULL DEFAULT 已兜底，此处防御性处理）
-- ============================================================
UPDATE inventory_stock
SET stock_type = 'normal'
WHERE stock_type IS NULL OR stock_type = '';

-- ============================================================
-- 4) 重建唯一索引，纳入 stock_type
--    ⚠ 重要：inventory_stock 上存在**两个**唯一索引，改造必须同时处理，
--      否则第二个仍会阻止同 SKU 同仓并存多种类型（试跑实测踩到）：
--        ① idx_inventory_stock_sku_wh      (sku_id, warehouse_id)
--        ② uk_inventory_stock_warehouse_sku (warehouse_id, sku_id)  ← 列顺序相反
--      ② 由 schema.ts:2396 声明，同样是唯一索引，须一并替换为含 stock_type 的版本。
--    必须先删旧索引再建新索引，否则唯一约束会阻止改造目标达成。
-- ============================================================
-- 4.1 删除两个旧唯一索引（IF EXISTS 保证重复执行安全）
DROP INDEX IF EXISTS idx_inventory_stock_sku_wh;
DROP INDEX IF EXISTS uk_inventory_stock_warehouse_sku;

-- 4.2 建新唯一索引（含 stock_type，使同 SKU 同仓可并存多种类型）
--     注意：用 CREATE UNIQUE INDEX IF NOT EXISTS 而非 CONCURRENTLY，
--     因表仅 652 行，锁表耗时可忽略；CONCURRENTLY 不能在事务内执行。
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_sku_wh_type
  ON inventory_stock (sku_id, warehouse_id, stock_type);

-- 4.3 保留 (warehouse_id, sku_id) 的唯一性语义（列顺序与旧②一致），
--     同样纳入 stock_type，兼容既有按 warehouse_id 前缀的查询/约束用途。
CREATE UNIQUE INDEX IF NOT EXISTS uk_inventory_stock_warehouse_sku_type
  ON inventory_stock (warehouse_id, sku_id, stock_type);

-- 4.4 补一个按类型查询的普通索引（报表/盘点按类型筛选会用）
CREATE INDEX IF NOT EXISTS idx_inventory_stock_type
  ON inventory_stock (stock_type);

-- ============================================================
-- 5) CHECK 约束：五类合法值
--    normal 正常品 / defective 残次品 / sample 样品
--    leftover 尾货 / clearance 清仓
-- ============================================================
ALTER TABLE inventory_stock DROP CONSTRAINT IF EXISTS ck_inventory_stock_type;
ALTER TABLE inventory_stock
  ADD CONSTRAINT ck_inventory_stock_type
  CHECK (stock_type IN ('normal', 'defective', 'sample', 'leftover', 'clearance'));

-- ============================================================
-- 6) 后置校验
-- ============================================================
DO $$
DECLARE
  v_illegal bigint;
  v_normal  bigint;
  v_idx1    boolean;
  v_idx2    boolean;
  v_old1    boolean;
  v_old2    boolean;
  v_dup     bigint;
BEGIN
  SELECT count(*) INTO v_illegal FROM inventory_stock
   WHERE stock_type NOT IN ('normal','defective','sample','leftover','clearance');
  SELECT count(*) INTO v_normal FROM inventory_stock WHERE stock_type = 'normal';

  -- 确认两个新唯一索引均已建成
  SELECT EXISTS (SELECT 1 FROM pg_indexes
    WHERE tablename='inventory_stock' AND indexname='idx_inventory_stock_sku_wh_type') INTO v_idx1;
  SELECT EXISTS (SELECT 1 FROM pg_indexes
    WHERE tablename='inventory_stock' AND indexname='uk_inventory_stock_warehouse_sku_type') INTO v_idx2;

  -- 确认两个旧唯一索引已移除（否则多类型并存仍会被阻止）
  SELECT EXISTS (SELECT 1 FROM pg_indexes
    WHERE tablename='inventory_stock' AND indexname='idx_inventory_stock_sku_wh') INTO v_old1;
  SELECT EXISTS (SELECT 1 FROM pg_indexes
    WHERE tablename='inventory_stock' AND indexname='uk_inventory_stock_warehouse_sku') INTO v_old2;

  SELECT count(*) INTO v_dup FROM (
    SELECT sku_id, warehouse_id, stock_type
    FROM inventory_stock
    GROUP BY sku_id, warehouse_id, stock_type
    HAVING count(*) > 1
  ) t;

  IF v_illegal > 0 THEN
    RAISE EXCEPTION '[0048] 存在非法 stock_type % 行', v_illegal;
  END IF;
  IF NOT (v_idx1 AND v_idx2) THEN
    RAISE EXCEPTION '[0048] 新唯一索引未全部建成 (idx1=% idx2=%)', v_idx1, v_idx2;
  END IF;
  IF v_old1 OR v_old2 THEN
    RAISE EXCEPTION '[0048] 旧唯一索引仍存在 (idx_sku_wh=% warehouse_sku=%)，多类型并存会被阻止', v_old1, v_old2;
  END IF;
  IF v_dup > 0 THEN
    RAISE EXCEPTION '[0048] 存在重复 (sku,warehouse,stock_type) 组合 % 组', v_dup;
  END IF;

  RAISE NOTICE '[0048] 完成：normal=% 行，非法=% 行；新唯一索引 2 个已生效，旧索引已移除，无重复组合',
    v_normal, v_illegal;
END $$;

-- ============================================================
-- 回滚说明：
--   ALTER TABLE inventory_stock DROP CONSTRAINT IF EXISTS ck_inventory_stock_type;
--   DROP INDEX IF EXISTS idx_inventory_stock_type;
--   DROP INDEX IF EXISTS uk_inventory_stock_warehouse_sku_type;
--   DROP INDEX IF EXISTS idx_inventory_stock_sku_wh_type;
--   -- 仅当无同 (sku,warehouse) 多类型行时才能重建旧索引：
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_sku_wh
--     ON inventory_stock (sku_id, warehouse_id);
--   CREATE UNIQUE INDEX IF NOT EXISTS uk_inventory_stock_warehouse_sku
--     ON inventory_stock (warehouse_id, sku_id);
--   ALTER TABLE inventory_stock DROP COLUMN IF EXISTS stock_type;
--   ⚠ 列一旦 DROP，残次品/样品/尾货的分类信息将永久丢失。
--     生产环境回滚前务必先备份（pg_dump），或先导出
--     SELECT * FROM inventory_stock WHERE stock_type <> 'normal'。
-- ============================================================
