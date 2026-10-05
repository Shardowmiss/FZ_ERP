-- ===========================================================================
-- Wave 2-2 指标 / 数据仓库层（物化视图，纯 PG 零新基础设施）
-- ---------------------------------------------------------------------------
-- 三张分析型物化视图 + 统一刷新函数（SECURITY DEFINER 规避平台 anon_ 无
-- REFRESH MATERIALIZED VIEW 权限的坑）。
--
-- 设计要点：
--   · 门店销量 = retail_order(status IN 'settled','returned') JOIN store JOIN
--     retail_order_item；会员维度从 retail_order.member_id 取（varchar，非空即会员单）。
--   · 门店库存 = inventory_stock JOIN store(warehouse_id)；金额用盘点维护的 amount 列。
--   · 会员汇总 = member 按 level 聚合，排除软删(_deleted_at)与已合并(merged_into)；
--     合并方余额已并入存活方，排除避免双计（P0-3 铁律：合并禁删被合并方）。
--   · 刷新函数用 SECURITY DEFINER：app 以 erp 角色调用即可，无需把 REFRESH 权限授 anon_。
--   · 本文件不改动任何业务表，故无需改动 schema.ts / 平台 db-schema-sync；erp_test 由
--     scripts/setup-test-db.sh 复刻结构自动带入（数据为空，由测试内 refresh 填充）。
-- ===========================================================================

-- ---------- 1) mv_store_sales_daily：门店日销量 ----------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_store_sales_daily AS
SELECT
  o.sale_date                                                            AS sale_date,
  s.id                                                                   AS store_id,
  s.code                                                                 AS store_code,
  s.name                                                                 AS store_name,
  s.store_type                                                           AS store_type,
  s.dealer_id                                                            AS dealer_id,
  count(DISTINCT o.id)                                                   AS order_count,
  count(DISTINCT CASE WHEN o.member_id IS NOT NULL THEN o.id END)        AS member_order_count,
  COALESCE(sum(i.quantity), 0)                                           AS item_qty,
  COALESCE(sum(i.tag_price * i.quantity), 0)                             AS tag_amount,
  COALESCE(sum(i.tag_price * i.quantity - i.line_amount), 0)             AS discount_amount,
  COALESCE(sum(i.line_amount), 0)                                        AS net_amount
FROM retail_order o
JOIN store s ON s.id = o.store_id
LEFT JOIN retail_order_item i ON i.retail_id = o.id
WHERE o.status IN ('settled', 'returned')
GROUP BY o.sale_date, s.id, s.code, s.name, s.store_type, s.dealer_id;

-- 点查支撑（按门店/日期区间过滤是仪表盘最高频路径）
CREATE UNIQUE INDEX IF NOT EXISTS uk_mv_store_sales_daily
  ON mv_store_sales_daily (sale_date, store_id);
CREATE INDEX IF NOT EXISTS idx_mv_store_sales_daily_store
  ON mv_store_sales_daily (store_id, sale_date);

-- ---------- 2) mv_inventory_by_store：门店库存 ----------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_inventory_by_store AS
SELECT
  s.id                                                                   AS store_id,
  s.code                                                                 AS store_code,
  s.name                                                                 AS store_name,
  s.store_type                                                           AS store_type,
  inv.sku_id                                                             AS sku_id,
  inv.sku_code                                                           AS sku_code,
  inv.style_no                                                           AS style_no,
  inv.color                                                              AS color,
  inv.size                                                               AS size,
  inv.color_id                                                           AS color_id,
  inv.size_id                                                            AS size_id,
  COALESCE(sum(inv.quantity), 0)                                         AS quantity,
  COALESCE(sum(inv.in_transit_qty), 0)                                   AS in_transit_qty,
  COALESCE(sum(inv.amount), 0)                                           AS amount
FROM inventory_stock inv
JOIN store s ON s.warehouse_id = inv.warehouse_id
GROUP BY s.id, s.code, s.name, s.store_type,
         inv.sku_id, inv.sku_code, inv.style_no, inv.color, inv.size,
         inv.color_id, inv.size_id;

CREATE UNIQUE INDEX IF NOT EXISTS uk_mv_inventory_by_store
  ON mv_inventory_by_store (store_id, sku_id, color, size);
CREATE INDEX IF NOT EXISTS idx_mv_inventory_by_store_sku
  ON mv_inventory_by_store (sku_id, style_no);

-- ---------- 3) mv_member_summary：会员汇总（按等级） ----------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_member_summary AS
SELECT
  m.level                                                                AS level,
  count(*)                                                               AS member_count,
  COALESCE(sum(m.total_spent), 0)                                        AS total_spent,
  COALESCE(sum(m.points), 0)                                             AS points,
  COALESCE(sum(m.order_count), 0)                                        AS order_count,
  COALESCE(sum(m.stored_value), 0)                                       AS stored_value
FROM member m
WHERE m._deleted_at IS NULL
  AND m.merged_into IS NULL
GROUP BY m.level;

CREATE UNIQUE INDEX IF NOT EXISTS uk_mv_member_summary
  ON mv_member_summary (level);

-- ---------- 4) 统一刷新函数（SECURITY DEFINER 规避 anon_ 无 REFRESH 权限） ----------
CREATE OR REPLACE FUNCTION refresh_metrics_materialized_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW mv_store_sales_daily;
  REFRESH MATERIALIZED VIEW mv_inventory_by_store;
  REFRESH MATERIALIZED VIEW mv_member_summary;
END;
$$;

-- ---------- 5) 权限（平台以 SET ROLE anon_ 执行查询，新建 public 对象须补 GRANT） ----------
GRANT USAGE ON SCHEMA public TO anon_;
GRANT SELECT ON mv_store_sales_daily  TO anon_;
GRANT SELECT ON mv_inventory_by_store TO anon_;
GRANT SELECT ON mv_member_summary      TO anon_;
GRANT EXECUTE ON FUNCTION refresh_metrics_materialized_views() TO anon_;
