-- ============================================================
-- 0060 透视分析个人模板（report_pivot_template）
--
-- 【原状】透视分析的「模板」是前端硬编码常量（client/src/pages/report/
--   pivot-utils.ts:80 的 TEMPLATES，4 个预设），存在三个问题：
--     ① 业务人员无法保存自己的分析格式，只能改代码才能加模板；
--     ② 所有人共享同一份，无法按岗位/习惯定制；
--     ③ 刷新页面后上次查询条件全丢（rows/cols/values/筛选/时间窗全在 useState）。
--
-- 【本次提供】
--   1) 保存为我的模板：用户可把当前配置命名保存，仅自己可见/可用/可删。
--   2) 记住我最后一次查询：is_last_used 标记，自动覆盖，无需手动保存。
--
-- 【设计要点】
--   · owner_user_id 用 user_profile 类型，与全库审计列约定一致（不是裸 uuid）。
--     ⚠ 本项目已踩坑：0057 把审计列建成 uuid 导致退货功能 100% 失败，
--       此处显式对齐 user_profile。
--   · 查询配置整体存 jsonb：透视配置结构（数据源/行列/指标/筛选/时间窗）
--     会随语义层演进而增字段，jsonb 免迁移；关键查询字段另抽为列便于过滤排序。
--   · 唯一约束 (owner_user_id, name)：同一用户内模板名唯一，不同用户可重名。
--   · is_last_used 保证每用户至多一条"最后一次"，用部分唯一索引在 DB 层兜住。
--   · 不做「模板共享」：用户明确要求"每个用户都允许保存自己的格式"，
--     共享可后续按 owner_user_id IS NULL 的系统模板扩展，此处不预埋歧义。
--
-- 幂等：IF NOT EXISTS，可重复执行。
-- ============================================================

CREATE TABLE IF NOT EXISTS report_pivot_template (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 归属用户（user_profile 与全库审计列一致；不可用裸 uuid，参见 0057/0058 教训）
  owner_user_id  user_profile NOT NULL,
  name           varchar(100) NOT NULL,
  -- 完整查询配置（dataSource/rows/cols/values/filters/时间窗/排序…）整体存 jsonb。
  -- 抽成列的仅是高频过滤字段，便于列表页排序与筛选；其余随语义层演进免迁移。
  config         jsonb NOT NULL,
  -- 冗余的关键字段（列表页展示与「同名模板识别」用）
  data_source    varchar(50) NOT NULL,
  -- 是否为「我最后一次查询」：每个用户至多一条，新查询自动覆盖旧的
  is_last_used   boolean NOT NULL DEFAULT false,
  remark         text,
  -- System field: Creation time (auto-filled, do not modify)
  _created_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by    user_profile,
  -- System field: Update time (auto-filled, do not modify)
  _updated_at    timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by    user_profile,

  -- 同一用户内模板名唯一（不同用户可重名）
  CONSTRAINT uk_report_pivot_template_owner_name UNIQUE (owner_user_id, name),
  -- 每用户至多一条「最后一次查询」，DB 层兜住（应用层亦做了先清后写）
  CONSTRAINT ck_report_pivot_template_name_not_blank CHECK (length(trim(name)) > 0)
);

-- 每用户至多一条 is_last_used=true（部分唯一索引，DB 级保证）
CREATE UNIQUE INDEX IF NOT EXISTS uk_report_pivot_template_last_used
  ON report_pivot_template (owner_user_id)
  WHERE is_last_used = true;

-- 列表页按「我的模板 + 最近使用在前」查询
CREATE INDEX IF NOT EXISTS idx_report_pivot_template_owner_created
  ON report_pivot_template (owner_user_id, _created_at DESC);

-- ------------------------------------------------------------
-- 后置校验
-- ------------------------------------------------------------
DO $$
DECLARE
  v_dup_last bigint;
BEGIN
  SELECT count(*) INTO v_dup_last
  FROM (
    SELECT owner_user_id FROM report_pivot_template
    WHERE is_last_used = true
    GROUP BY owner_user_id HAVING count(*) > 1
  ) t;

  IF v_dup_last > 0 THEN
    RAISE EXCEPTION '[0060] 存在 % 个用户有多条「最后一次查询」，违反唯一性约束', v_dup_last;
  END IF;

  RAISE NOTICE '[0060] 完成：report_pivot_template 已就绪，个人模板与「记住最后一次查询」可用';
END $$;

-- ============================================================
-- 回滚说明：
--   DROP TABLE IF EXISTS report_pivot_template;
--   ⚠ 回滚将丢失全部用户已保存的个人模板与「最后一次查询」记录，
--     且前端会退回到「仅前端硬编码 TEMPLATES、无持久化」的状态。
-- ============================================================
