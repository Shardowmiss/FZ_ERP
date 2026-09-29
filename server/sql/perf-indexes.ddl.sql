-- P1-3 性能索引补充（幂等）
-- 背景：补货 calc 与 POS 主数据同步(real-erp.adapter) 的高频过滤列此前缺索引。
-- 现有 idx_sku_style_color_size 建在 (style_id,...) 上，不覆盖 sku.style_no 字符串列；
-- retail_order_item 仅有 retail_id 索引，补货 calc 按 sku_id 聚合时走全表扫。

-- 1) sku(style_no)：支持 real-erp.adapter.getStyles 的 WHERE style_no = ANY(...)
CREATE INDEX IF NOT EXISTS idx_sku_style_no ON public.sku (style_no);

-- 2) retail_order_item(sku_id)：支持补货 calc 的 WHERE sku_id = ANY(...) 聚合
CREATE INDEX IF NOT EXISTS idx_retail_order_item_sku ON public.retail_order_item (sku_id);

-- 3) retail_order(store_id, sale_date) 复核：已存在 idx_retail_order_store，这里仅声明幂等占位（无操作）。
-- （idx_retail_order_store 已覆盖 store_id + sale_date 复合过滤，无需重复建。）
