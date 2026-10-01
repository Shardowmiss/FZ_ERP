-- 0026 主数据联系手机号字段级加密（P0-2 切片 2b/2c）
--
-- 背景：store / dealer / supplier / rbac_user 的联系电话长期以明文存储，违反等保/个保法
--   对手机号等 PII 的加密存储要求。本迁移落地「可搜索加密」双列结构（与 member 1a 同范式）：
--     · phone         加宽至 255，改为存储 AES-256-GCM 密文（前缀 enc::，便于幂等回填）
--     · phone_hmac    新增，存储 HMAC-SHA256(明文) 确定性指纹，用于按值搜索/去重/一致性校验
--       （密文随机 IV 使同明文每次加密结果不同，不能直接比较；HMAC 指纹可比较且不泄露明文）
--   加密/解密/HMAC 由应用层 server/common/crypto/field-encryption.ts 完成；
--   存量明文由 scripts/backfill-pii-phone-enc.cjs 回填。
--
-- 幂等：可重复执行（IF NOT EXISTS / 条件 ALTER）。

-- ============ store ============
ALTER TABLE store ALTER COLUMN phone TYPE varchar(255);
ALTER TABLE store ADD COLUMN IF NOT EXISTS phone_hmac varchar(64);
CREATE INDEX IF NOT EXISTS idx_store_phone_hmac ON store (phone_hmac);
COMMENT ON COLUMN store.phone IS '门店联系电话（AES-256-GCM 密文，前缀 enc::；不再存放明文）';
COMMENT ON COLUMN store.phone_hmac IS '联系电话 HMAC-SHA256 确定性指纹（用于搜索/去重/一致性校验，不可反解）';

-- ============ dealer ============
ALTER TABLE dealer ALTER COLUMN phone TYPE varchar(255);
ALTER TABLE dealer ADD COLUMN IF NOT EXISTS phone_hmac varchar(64);
CREATE INDEX IF NOT EXISTS idx_dealer_phone_hmac ON dealer (phone_hmac);
COMMENT ON COLUMN dealer.phone IS '经销商联系电话（AES-256-GCM 密文，前缀 enc::；不再存放明文）';
COMMENT ON COLUMN dealer.phone_hmac IS '联系电话 HMAC-SHA256 确定性指纹（用于搜索/去重/一致性校验，不可反解）';

-- ============ supplier ============
ALTER TABLE supplier ALTER COLUMN phone TYPE varchar(255);
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS phone_hmac varchar(64);
CREATE INDEX IF NOT EXISTS idx_supplier_phone_hmac ON supplier (phone_hmac);
COMMENT ON COLUMN supplier.phone IS '供应商联系电话（AES-256-GCM 密文，前缀 enc::；不再存放明文）';
COMMENT ON COLUMN supplier.phone_hmac IS '联系电话 HMAC-SHA256 确定性指纹（用于搜索/去重/一致性校验，不可反解）';

-- ============ rbac_user ============
ALTER TABLE rbac_user ALTER COLUMN phone TYPE varchar(255);
ALTER TABLE rbac_user ADD COLUMN IF NOT EXISTS phone_hmac varchar(64);
CREATE INDEX IF NOT EXISTS idx_rbac_user_phone_hmac ON rbac_user (phone_hmac);
COMMENT ON COLUMN rbac_user.phone IS '后台用户手机号（AES-256-GCM 密文，前缀 enc::；不再存放明文）';
COMMENT ON COLUMN rbac_user.phone_hmac IS '手机号 HMAC-SHA256 确定性指纹（用于搜索/去重/一致性校验，不可反解）';
