-- =============================================================================
-- 服装ERP 性能治理（P1-1）：补全明细表/头表外键缺失索引
-- 目标：
--   明细表外键（头→明细 JOIN 的高频过滤/回查列）此前仅建 FK 约束而无 B-tree 索引，
--   导致"按单据查明细""按订单查出库"等查询在大数据量下退化为顺序扫描（全表扫明细）。
--   本迁移为以下 5 个外键列补索引：
--     1. inventory_transfer_item.transfer_id       调拨头→明细
--     2. sales_outbound_item.outbound_id           出库头→明细
--     3. sales_order_item.order_id                 销售订单→明细
--     4. purchase_inbound_item.inbound_id          采购入库头→明细
--     5. sales_outbound.order_id                   销售订单→出库（头表反向 JOIN）
-- 全部 DDL 幂等（IF NOT EXISTS），可重复执行。
--
-- 注意（生产环境）：CREATE INDEX 默认在事务内获取短暂锁并阻塞写入；对超大表，
--   建议在低峰期改用 CREATE INDEX CONCURRENTLY（不能在事务块内执行）：
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS ... ;
--   本文件使用普通 CREATE INDEX 以便与既有迁移批处理流程兼容。
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_inventory_transfer_item_transfer_id
  ON inventory_transfer_item (transfer_id);

CREATE INDEX IF NOT EXISTS idx_sales_outbound_item_outbound_id
  ON sales_outbound_item (outbound_id);

CREATE INDEX IF NOT EXISTS idx_sales_order_item_order_id
  ON sales_order_item (order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_inbound_item_inbound_id
  ON purchase_inbound_item (inbound_id);

CREATE INDEX IF NOT EXISTS idx_sales_outbound_order_id
  ON sales_outbound (order_id);
