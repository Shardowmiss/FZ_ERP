-- 0020: sku 复合唯一键由 (style_id, color, size) 改为 (style_id, color_id, size_id) (B.1 / P1-3 M4)
-- 前提：M3 已为 sku 加可空 color_id/size_id 外键列；M5 回填已把现有 sku 行的
--       color_id/size_id 按 color/size 串映射到主数据（color_id 是 color 的确定性函数，
--       故 (style_id,color,size) 不重复 ⇒ (style_id,color_id,size_id) 也不重复）。
-- 故本迁移不会触发唯一冲突。

DROP INDEX IF EXISTS idx_sku_style_color_size;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_style_color_id_size_id
  ON sku (style_id, color_id, size_id);
