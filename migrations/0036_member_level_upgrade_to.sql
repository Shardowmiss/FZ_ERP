-- 0036 会员等级升级设定：member_level 增加 upgrade_to（达到本等级后升级到的目标等级 code）
-- 配套变更：
--   server/database/schema.ts  memberLevel.upgradeTo
--   shared/api.interface.ts    MemberLevel.upgradeTo
--   server/modules/member/member-level.service.ts  mapRow/create/update 同步
-- 业务链：会员卡(normal)→银卡(silver)→金卡(gold)→钻石卡(diamond)；空表示顶级不再升级。
-- 仅新增可空列，不影响既有数据与现有表权限（列继承表的 GRANT）。

ALTER TABLE member_level ADD COLUMN IF NOT EXISTS upgrade_to varchar(30);
