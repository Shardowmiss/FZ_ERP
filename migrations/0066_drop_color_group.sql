-- 0066_drop_color_group.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- 彻底下线「颜色组」模块（产品决策 2026-10-12）。
--
-- 背景：颜色组在产品中只承担「款号选色的中介」，且款号侧的颜色信息最终都以
-- SKU 行的 color_id 落地。改为**颜色只在 SKU 层选择**后，款号不再绑定颜色组，
-- 该中介与两张表一并移除。
--
-- 影响面：
--   * style.color_group_id（NOT NULL，现存 22 个款号全部引用）→ 删除列与外键
--   * color_group_color（18 行）→ 删除
--   * color_group（10 行）→ 删除
--   * color 表**保留**（颜色本身是有效主数据，166 个 SKU 均引用）
--
-- 数据安全性：SKU 行自带 color_id，本次不触碰 sku 表 ⇒ 已生成的 166 个 SKU
-- 颜色不受影响；仅丢失「款号规划了哪些颜色」这一层信息。
--
-- 回滚：用同目录上级的备份 erp_db_pre_colorGroup_drop_20261012_0959.dump
--       `pg_restore -h 127.0.0.1 -p 5434 -U erp -d erp_db --clean <dump>`
--
-- 注意：权限目录里 base:color-group 及其动作码的清理由应用启动期的
--       ensureRbacCatalog prune 完成（shared/menu-permission.ts 已移除该菜单，
--       并在 PERMISSION_CODE_MIGRATION 登记「旧码 → 空数组」做 prune 前授权平移）。
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) 款号 → 颜色组：先解外键，再删列（NOT NULL 列必须显式 DROP COLUMN）
ALTER TABLE style DROP CONSTRAINT IF EXISTS style_color_group_id_fkey;
ALTER TABLE style DROP COLUMN IF EXISTS color_group_id;

-- 2) 颜色组关系表先于主表删除（其外键指向 color_group）
DROP TABLE IF EXISTS color_group_color;
DROP TABLE IF EXISTS color_group;

COMMIT;
