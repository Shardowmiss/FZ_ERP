-- 对齐 pos_db 与 schema.ts 的系统字段约定（_created_at / _created_by / _updated_at / _updated_by / deleted_at）
-- 背景：schema.ts 全表已统一为下划线前缀系统字段（见 posStyle.deletedAt 注释），
-- 但以下 8 张表在建库时仍用旧命名 created_at/updated_at，且缺失 _created_by/_updated_by/deleted_at，
-- 导致 drizzle 全表 select 报「column _created_at does not exist」→ 接口 500。
-- 本脚本幂等：仅在缺失时改名/加列；RENAME 保留 NOT NULL 与默认值，ADD 仅加可空列，不丢数据。
-- 备份：/tmp/pos_db_backup/pos_db_pre_align_*.dump

DO $$
DECLARE
  r RECORD;
  has_old boolean;
  has_new boolean;
  has_by boolean;
  has_del boolean;
BEGIN
  -- 需要补 deleted_at 的表（按 schema.ts 中定义 deletedAt 的表筛选）
  FOR r IN
    SELECT unnest(ARRAY[
      'pos_color','pos_member','pos_size','pos_sku','pos_stock','pos_style'
    ]) AS t
  LOOP
    -- 改名 created_at -> _created_at
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='created_at')
      INTO has_old;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_created_at')
      INTO has_new;
    IF has_old AND NOT has_new THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN created_at TO _created_at', r.t);
    END IF;

    -- 改名 updated_at -> _updated_at
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='updated_at')
      INTO has_old;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_updated_at')
      INTO has_new;
    IF has_old AND NOT has_new THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN updated_at TO _updated_at', r.t);
    END IF;

    -- 加 _created_by / _updated_by（user_profile 复合类型，可空）
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_created_by')
      INTO has_by;
    IF NOT has_by THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN _created_by user_profile', r.t);
    END IF;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_updated_by')
      INTO has_by;
    IF NOT has_by THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN _updated_by user_profile', r.t);
    END IF;

    -- 加 deleted_at（软删除，可空）
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='deleted_at')
      INTO has_del;
    IF NOT has_del THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN deleted_at timestamptz', r.t);
    END IF;
  END LOOP;

  -- 无 deleted_at 的表（pos_transfer / pos_transfer_item）只需改名 + 加 _created_by/_updated_by
  FOR r IN
    SELECT unnest(ARRAY['pos_transfer','pos_transfer_item']) AS t
  LOOP
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='created_at')
      INTO has_old;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_created_at')
      INTO has_new;
    IF has_old AND NOT has_new THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN created_at TO _created_at', r.t);
    END IF;

    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='updated_at')
      INTO has_old;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_updated_at')
      INTO has_new;
    IF has_old AND NOT has_new THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN updated_at TO _updated_at', r.t);
    END IF;

    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_created_by')
      INTO has_by;
    IF NOT has_by THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN _created_by user_profile', r.t);
    END IF;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_updated_by')
      INTO has_by;
    IF NOT has_by THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN _updated_by user_profile', r.t);
    END IF;
  END LOOP;

  -- pos_sync_log 已建表时带 created_at/updated_at 与 _created_at/_updated_at（见 pglite.ts DDL），
  -- 但缺 _created_by/_updated_by（drizzle 全表 select 报 42703 → erp 对接日志接口 500）。
  -- 此表不重命名、不加 deleted_at，仅补两个 _by 列。
  FOR r IN
    SELECT unnest(ARRAY['pos_sync_log']) AS t
  LOOP
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_created_by')
      INTO has_by;
    IF NOT has_by THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN _created_by user_profile', r.t);
    END IF;
    SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name=r.t AND column_name='_updated_by')
      INTO has_by;
    IF NOT has_by THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN _updated_by user_profile', r.t);
    END IF;
  END LOOP;
END $$;
