-- =============================================================================
-- 多级分销会话留存修复（P0-1）：补齐经销商的「供应商身份」主数据
-- -----------------------------------------------------------------------------
-- 背景（根因已由真实数据定位）：
--   DistributionMirrorService.resolveMirrorContext 在解析「上级的供应商身份」时，
--   若 supplier 表中查不到 partner_id = 上级dealer.id 的记录，会直接 return null，
--   导致镜像被静默标记 mirror_status='skipped'，下游采购单一张都不会生成。
--   实测：42/45 条 supplier 已绑定 partner_id，但仍有 39 个「有下级」的经销商
--   缺少供应商身份；12 张已记账销售单全部 skipped，镜像产出为 0。
--
-- 本迁移做两件事：
--   1) 一次性回填：为每个「有下级且尚无供应商身份」的经销商创建 supplier 记录，
--      partner_id 指回该经销商，code 延续现有 GYS#### 编号体系（动态续号，不冲突）。
--   2) 幂等：基于 NOT EXISTS 去重，重复执行不会产生第二条；已存在的节点不被改动。
--
-- 注意：本迁移只补「作为卖方」所需的供应商身份。下游买方身份无需补——
--   镜像生成的采购单直接以 dealer.id 作为 downstream_org_id，不依赖 customer 主数据
--   （customer 表已在 0028_drop_customer.sql 中整体下线）。
-- =============================================================================

BEGIN;

-- ---------- 1. 回填缺失的供应商身份 ----------
-- 编号策略：取现有 GYS#### 的最大序号为基数，按 (level, code) 稳定排序依次续号，
--           保证同一份数据重复执行得到相同结果，且不会撞已有 code。
WITH missing AS (
  SELECT
    d.id                                   AS dealer_id,
    d.code                                 AS dealer_code,
    d.name                                 AS dealer_name,
    d.contact_person,
    d.phone,
    d.phone_hmac,
    d.address,
    row_number() OVER (ORDER BY d.level, d.code) AS rn
  FROM dealer d
  WHERE EXISTS (
          SELECT 1 FROM dealer c WHERE c.parent_id = d.id   -- 有下级 ⇒ 需要卖方身份
        )
    AND NOT EXISTS (
          SELECT 1
          FROM supplier s
          WHERE s.partner_id = d.id
            AND s._deleted_at IS NULL                        -- 软删的不算已存在
        )
),
seq AS (
  SELECT COALESCE(
           max(substring(code FROM 4)::int),
           0
         ) AS base
  FROM supplier
  WHERE code ~ '^GYS[0-9]+$'
)
INSERT INTO supplier (
  id, code, name, contact_person, phone, phone_hmac, address,
  supply_category, remark, status, partner_id
)
SELECT
  gen_random_uuid(),
  'GYS' || lpad((seq.base + missing.rn)::text, 4, '0'),
  missing.dealer_name,
  missing.contact_person,
  missing.phone,
  missing.phone_hmac,
  missing.address,
  '分销供货',
  '多级分销：' || missing.dealer_name || ' 的供应商身份（自动回填）',
  'active',
  missing.dealer_id
FROM missing, seq;

COMMIT;

-- ---------- 2. 校验：不应再有「有下级却无供应商身份」的节点 ----------
-- SELECT count(*) AS still_missing
-- FROM dealer d
-- WHERE EXISTS (SELECT 1 FROM dealer c WHERE c.parent_id = d.id)
--   AND NOT EXISTS (SELECT 1 FROM supplier s WHERE s.partner_id = d.id AND s._deleted_at IS NULL);
-- 期望结果：0
