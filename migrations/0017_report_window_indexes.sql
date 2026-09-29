-- 0017 报表时间窗配套索引（P1-c④）。
--
-- 背景：P1-c④ 给报表/分析/看板强制注入了时间下界（见 server/common/report-window.ts），
-- 但**没有索引的时间下界等于白做**——PG 能用 Index Cond 缩小扫描起点，
-- 却仍要回表/顺序扫描整个区间。本迁移补齐两条真正会被新逻辑用到的索引。
--
-- 说明：
--   · 这两条索引只服务于"报表列表 + 透视 + BI 钻取"三条读路径，写入侧无额外代价
--     （零售单/调拨单的下单动作本就要写这两张表的时间列）。
--   · 均为 CREATE INDEX IF NOT EXISTS，幂等，可重复执行。
--   · 未包含 sales_outbound_item(sku_id)：它只服务于 analytics.forecast，
--     而 forecast 依赖长历史口径、本轮不注入时间窗，现在建索引属于给用不上的查询付账。

-- 1) inventory_transfer.transfer_date
--    getTransferReport 此前唯一的恒定过滤只有 item_type='sku'（低选择性），
--    加了时间下界后仍会全表扫；这是评估报告里标记的唯一"缺索引最严重"的报表。
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_transfer_date
  ON inventory_transfer (transfer_date);

-- 2) retail_order.sale_date
--    现有复合索引是 (store_id, sale_date)，只能按门店前缀命中；
--    报表/透视的零售分支不带 store_id 过滤时会退化成全索引扫描。
CREATE INDEX IF NOT EXISTS idx_retail_order_sale_date
  ON retail_order (sale_date);

-- 3) （可选，默认关闭）观察索引是否被真用到，数据量上量后可复查：
--    EXPLAIN (ANALYZE) SELECT ... WHERE transfer_date >= '2026-01-01' ...
--    若出现 Seq Scan 说明 optimizer 认为全扫更划算（小表/统计信息过期），先跑 ANALYZE。
