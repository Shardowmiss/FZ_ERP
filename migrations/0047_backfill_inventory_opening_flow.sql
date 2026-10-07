-- 0047 补建库存期初流水，使存量可追溯（幂等）
-- 巡检发现（business-audit-report-2026-10-07 P1）：
--   inventory_stock 有 652 行存量（合计 3,234 件），但 inventory_flow 仅 3 行
--   （全部为 garment_purchase_inbound，合计 12 件）→ 649 行存量（99.5%）
--   没有任何流水支撑，流水账事实失效：
--     · 无法按仓库/SKU/时间追溯库存来源
--     · 账实不符时无法定位差异产生时点
--     · 库存周转/周转天数等分析指标失真
--
-- 为何用 stocktake_adjust 作为期初类型：
--   inventory_flow.flow_type 的 CHECK 约束只允许 20 个业务类型
--   （finish_in / garment_purchase_inbound / purchase_inbound / retail_outbound /
--     transfer_in / transfer_out / stocktake_adjust / production_* / subcontract_* 等），
--   **没有 opening / 期初类型**。直接插入 'opening' 会被 CHECK 拒绝。
--   stocktake_adjust（盘点调整）正是「账实核对后确认存量」的标准语义，
--   与期初建账的业务含义一致，且在既有枚举内，故选用它。
--
-- 幂等：以 biz_no = 'OPENING-' || sku_code || '-' || warehouse_code 作为唯一标识，
--       重复执行时 NOT EXISTS 过滤，不会重复入账。
--       （inventory_flow 无唯一约束，故用 NOT EXISTS 而非 ON CONFLICT。）

-- ============================================================
-- 1) 预检查
-- ============================================================
DO $$
DECLARE
  v_stock_rows  bigint;
  v_stock_qty   numeric;
  v_flow_rows   bigint;
  v_need        bigint;
BEGIN
  SELECT count(*), COALESCE(sum(quantity), 0)
    INTO v_stock_rows, v_stock_qty
  FROM inventory_stock
  WHERE COALESCE(quantity, 0) <> 0;

  SELECT count(*) INTO v_flow_rows FROM inventory_flow;

  SELECT count(*) INTO v_need
  FROM inventory_stock s
  WHERE COALESCE(s.quantity, 0) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM inventory_flow f
      WHERE f.sku_id = s.sku_id AND f.warehouse_id = s.warehouse_id
    );

  RAISE NOTICE '[0047] 预检查：存量行 %（合计 % 件），现有流水 % 行，需补期初流水 % 行',
    v_stock_rows, v_stock_qty, v_flow_rows, v_need;
END $$;

-- ============================================================
-- 2) 补建期初流水
--    口径：quantity 原样取自 inventory_stock.quantity（不假设正负，保持原值），
--          direction = 'in'（期初建账视为入库方向），
--          biz_date 取该 SKU 在该仓最早的业务日期，无法判定时用当前日期。
-- ============================================================
INSERT INTO inventory_flow (
  flow_type,
  biz_no,
  direction,
  item_type,
  sku_id,
  style_no,
  color,
  size,
  color_id,
  size_id,
  warehouse_id,
  warehouse_name,
  quantity,
  operator,
  remark,
  biz_date,
  _created_at,
  _updated_at
)
SELECT
  'stocktake_adjust',
  'OPENING-' || COALESCE(s.sku_code, s.sku_id::text) || '-' || COALESCE(w.code, s.warehouse_id::text),
  'in',
  'sku',
  s.sku_id,
  s.sku_code,
  s.color,
  s.size,
  s.color_id,
  s.size_id,
  s.warehouse_id,
  COALESCE(s.warehouse_name, w.name, s.warehouse_id::text),
  s.quantity,
  'system',
  '迁移0047期初建账：由 inventory_stock 存量反推，原始业务单据已不可考',
  COALESCE(
    (SELECT min(f2.biz_date) FROM inventory_flow f2
      WHERE f2.sku_id = s.sku_id AND f2.warehouse_id = s.warehouse_id),
    CURRENT_DATE
  ),
  now(),
  now()
FROM inventory_stock s
LEFT JOIN warehouse w ON w.id = s.warehouse_id
WHERE COALESCE(s.quantity, 0) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM inventory_flow f
    WHERE f.sku_id = s.sku_id
      AND f.warehouse_id = s.warehouse_id
  );

-- ============================================================
-- 3) 后置校验：核对「流水累计」与「存量」是否一致
-- ============================================================
DO $$
DECLARE
  v_uncovered bigint;
  v_diff_qty   numeric;
  v_new_flow   bigint;
BEGIN
  -- 仍无流水支撑的存量行数
  SELECT count(*) INTO v_uncovered
  FROM inventory_stock s
  WHERE COALESCE(s.quantity, 0) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM inventory_flow f
      WHERE f.sku_id = s.sku_id AND f.warehouse_id = s.warehouse_id
    );

  -- 流水累计(in-out) 与存量 的差异总量
  SELECT COALESCE(SUM(ABS(
      COALESCE(f.net, 0) - COALESCE(s.qty, 0)
  )), 0) INTO v_diff_qty
  FROM (
    SELECT sku_id, warehouse_id,
           SUM(CASE WHEN direction = 'in' THEN quantity ELSE -quantity END) AS net
    FROM inventory_flow
    GROUP BY sku_id, warehouse_id
  ) f
  FULL JOIN (
    SELECT sku_id, warehouse_id, SUM(quantity) AS qty
    FROM inventory_stock
    GROUP BY sku_id, warehouse_id
  ) s
    ON s.sku_id = f.sku_id AND s.warehouse_id = f.warehouse_id;

  SELECT count(*) INTO v_new_flow FROM inventory_flow WHERE flow_type = 'stocktake_adjust';

  RAISE NOTICE '[0047] 完成：无流水支撑存量行=% ；期初流水累计=% 条（stocktake_adjust 总计 % 条）',
    v_uncovered, v_new_flow, v_new_flow;
  RAISE NOTICE '[0047] 注意：流水净额与存量差异总量=% （历史进销存未完整记账所致，属存量数据固有事实，本次不做强行平账）',
    v_diff_qty;
END $$;

-- ============================================================
-- 回滚说明：
--   DELETE FROM inventory_flow
--    WHERE flow_type = 'stocktake_adjust'
--      AND operator = 'system'
--      AND remark LIKE '迁移0047期初建账%';
--   （按 remark 精确定位，只删本迁移生成行，不影响真实盘点调整流水）
-- ============================================================
