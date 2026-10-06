-- 0042 销售订单来源字段（手动新增 / 订货会 / 补货计划）
-- 业务背景：销售订单现支持手动新增（代表下级经销商对上级经销商的预定单/补货单），
-- 与订货会、补货计划产生的订单除「来源」不同外逻辑一致。需新增来源列以区分来源。
-- 同时把历史上以非法状态 'approved' 落地的订货会配货单修正为合法终态 'booked' 并打来源标记。

-- 1) 新增来源列（默认 manual = 本功能新增的手动单）
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS source_type varchar(20) NOT NULL DEFAULT 'manual';
ALTER TABLE sales_order ADD COLUMN IF NOT EXISTS source_no varchar(50);

-- 2) 数据回填：
-- 2.1 订货会配货单：历史上以非法状态 'approved' 落地，统一修正为合法终态 'booked'，
--     来源标记为 trade_show；source_no 从 remark「订货会配货单 <allocationNo> 自动生成」解析。
UPDATE sales_order
SET status = 'booked',
    source_type = 'trade_show',
    source_no = CASE
      WHEN remark ~ '订货会配货单 .+ 自动生成'
        THEN (regexp_match(remark, '订货会配货单 (.+?) 自动生成'))[1]
      ELSE NULL
    END
WHERE status = 'approved';

-- 2.2 补货计划自动生成的草稿单：标记来源为 replenish_plan（其余保持默认 manual）。
UPDATE sales_order
SET source_type = 'replenish_plan'
WHERE source_type = 'manual'
  AND remark = '补货管理自动生成（经销商销售单）';
