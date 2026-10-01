-- 0025 会员合并（P0-3）：mergedInto/mergedAt 打标列 + member_merge_log 审计/回滚表
--
-- 背景：P0-3 主数据合并引擎（切片 A：member）需要把「手机号重复」的重复会员合并为一条 survivor。
--   历史教训：曾因下行覆盖把 member.stored_value 清零造成资金事故。本迁移只建「合并所需的存储结构」，
--   不实现合并逻辑（逻辑见 server/modules/member/member-merge.service.ts）。
--
--   资金安全约定（务必遵守）：
--     · 被合并会员**绝不删除**（member 无 _deleted_at；member_wallet_event / member_point 均 onDelete cascade，
--       删除会级联清空钱包流水 = 资金事故）。合并只改指依赖行到 survivor + 打标(mergedInto/mergedAt)。
--     · 积分/储值经 member_wallet_event 账本事件原子累加；回滚依据 member_merge_log 的 moved_* 精确反向。
--
-- 幂等：可重复执行（IF NOT EXISTS / DO BLOCK 条件建约束 / 无害 GRANT）。

-- 1) member 加合并打标列（自愈引用：删 survivor 时 merged_into 自动置空）
ALTER TABLE member ADD COLUMN IF NOT EXISTS merged_into uuid;
ALTER TABLE member ADD COLUMN IF NOT EXISTS merged_at timestamptz;

-- 2) 自愈引用 FK（self-reference，指向自身 id）。避免并发 add 报错，用 DO BLOCK 条件建。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'member_merged_into_fkey'
  ) THEN
    ALTER TABLE member ADD CONSTRAINT member_merged_into_fkey
      FOREIGN KEY (merged_into) REFERENCES member(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) 索引：加速「已合并成员」过滤与合并回滚扫描
CREATE INDEX IF NOT EXISTS idx_member_merged_into ON member (merged_into);

-- 4) 合并审计/回滚日志表（合并操作的唯一审计来源 + 回滚唯一依据）
CREATE TABLE IF NOT EXISTS member_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id varchar(40) NOT NULL,
  survivor_id uuid NOT NULL,
  merged_id uuid NOT NULL,
  merged_member_no varchar(50),
  merged_name varchar(100),
  merged_phone_hmac varchar(64),
  moved_points integer NOT NULL DEFAULT 0,
  moved_stored_value numeric NOT NULL DEFAULT '0',
  reason text,
  operator varchar(64),
  reversed_at timestamptz,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT member_merge_log_survivor_fkey FOREIGN KEY (survivor_id) REFERENCES member(id) ON DELETE RESTRICT,
  CONSTRAINT member_merge_log_merged_fkey FOREIGN KEY (merged_id) REFERENCES member(id) ON DELETE RESTRICT
);

-- 5) 索引：按 run 整批回滚、按 survivor/merged 反查
CREATE INDEX IF NOT EXISTS idx_member_merge_log_run ON member_merge_log (run_id);
CREATE INDEX IF NOT EXISTS idx_member_merge_log_survivor ON member_merge_log (survivor_id);
CREATE INDEX IF NOT EXISTS idx_member_merge_log_merged ON member_merge_log (merged_id);

-- 6) 平台权限：新 public 对象须补 GRANT 给 anon_（平台以 SET ROLE anon_ 查询，缺权限触发 42501）
GRANT SELECT, INSERT, UPDATE, DELETE ON member_merge_log TO anon_;

-- 7) 数据字典注释（scripts/gen-data-dict 会读取 COMMENT）
COMMENT ON COLUMN member.merged_into IS 'P0-3 主数据合并：被合并方指向存活方 member.id（绝不删除被合并会员，仅打标）';
COMMENT ON COLUMN member.merged_at IS 'P0-3 主数据合并：合并时间';
COMMENT ON TABLE member_merge_log IS 'P0-3 会员合并审计/回滚日志：记录谁合并进谁、转移积分/储值、操作人、原因，供 reverse() 回滚';
COMMENT ON COLUMN member_merge_log.moved_points IS '从被合并方转移到 survivor 的积分';
COMMENT ON COLUMN member_merge_log.moved_stored_value IS '从被合并方转移到 survivor 的储值（单位=分）';
COMMENT ON COLUMN member_merge_log.reversed_at IS 'reverse() 成功回滚后置位，避免重复回滚';

-- 8) 补列（迭代中追加）：回滚需依据日志精确还原去重化后的展示计数器，故记录转移的消费额/订单数
ALTER TABLE member_merge_log ADD COLUMN IF NOT EXISTS moved_total_spent numeric NOT NULL DEFAULT '0';
ALTER TABLE member_merge_log ADD COLUMN IF NOT EXISTS moved_order_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN member_merge_log.moved_total_spent IS '从被合并方转移到 survivor 的累计消费额（展示计数器）';
COMMENT ON COLUMN member_merge_log.moved_order_count IS '从被合并方转移到 survivor 的订单数（展示计数器）';
