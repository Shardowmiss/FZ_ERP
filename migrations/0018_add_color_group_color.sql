-- 0018 颜色组关系化（P1-1 / M1）。
--
-- 背景：B.1 评估确认颜色/尺码当前「双轨并存」——color_group.colors 是 jsonb 数组，
-- 而尺码组早已关系化（size_group_size 关联表）。颜色组缺关联表，导致组关系无单一真相、
-- 事务数据无法经 color_group 反查主数据。本迁移补齐 color_group_color，对齐 size_group_size。
--
-- 收口策略（详见 B1_颜色尺码双轨统一_评估.md · P1-1）：
--   · 关联表 color_group_color 为「组关系」单一真相；
--   · color_group.colors(jsonb) 降级为「由关联表派生」的镜像，写后由 service 重建；
--   · color-group.service 的 create/update 在写 jsonb 的同时维护关联表并做一致性断言。
--
-- 幂等：CREATE TABLE / INDEX 均带 IF NOT EXISTS，可重复执行。

CREATE TABLE IF NOT EXISTS color_group_color (
  color_group_id uuid NOT NULL REFERENCES color_group (id) ON DELETE CASCADE,
  color_id       uuid NOT NULL REFERENCES color (id)     ON DELETE CASCADE,
  sort_order     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (color_group_id, color_id)
);

CREATE INDEX IF NOT EXISTS idx_color_group_color_color
  ON color_group_color (color_id);
