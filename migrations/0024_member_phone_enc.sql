-- 0024 会员手机号字段级加密（P0-2）
--
-- 背景：member.phone 长期以明文存储，违反等保/个保法对手机号等 PII 的加密存储要求。
--   本迁移落地「可搜索加密」结构：
--     · phone        加宽至 255，改为存储 AES-256-GCM 密文（前缀 enc::，便于幂等回填）
--     · phone_hmac   新增，存储 HMAC-SHA256(phone) 确定性指纹，用于按手机号搜索/去重/
--                     一致性校验（避免对密文直接比较，也避免泄露明文）
--   加密/解密/HMAC 由应用层 server/common/crypto/field-encryption.ts 完成；
--   存量明文由 scripts/backfill-member-phone-enc.cjs 回填。
--
-- 幂等：可重复执行（IF NOT EXISTS / 条件 DROP / 无害 ALTER）。

-- 1) 移除对明文 phone 的无用索引（密文不可直接搜索，索引无意义）
DROP INDEX IF EXISTS idx_member_phone;

-- 2) phone 加宽（varchar(50) -> varchar(255)，仅元数据变更，不重写表）
ALTER TABLE member ALTER COLUMN phone TYPE varchar(255);

-- 3) 新增 HMAC 查询列
ALTER TABLE member ADD COLUMN IF NOT EXISTS phone_hmac varchar(64);

-- 4) 索引：切换到「HMAC 查询列」（支持按手机号去重/一致性校验）
CREATE INDEX IF NOT EXISTS idx_member_phone_hmac ON member (phone_hmac);

-- 5) 数据字典注释（scripts/gen-data-dict 会读取 COMMENT）
COMMENT ON COLUMN member.phone IS '会员手机号（AES-256-GCM 密文，前缀 enc::；不再存放明文）';
COMMENT ON COLUMN member.phone_hmac IS '手机号 HMAC-SHA256 确定性指纹（用于搜索/去重/一致性校验，不可反解）';
