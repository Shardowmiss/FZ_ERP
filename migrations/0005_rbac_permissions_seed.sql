-- ============================================================
-- 0005 RBAC 权限种子
-- 问题：原系统前端 app.tsx 引用了 ~54 个权限码，但库内无任何 rbac_permission 记录，
--       导致所有受保护路由在 protectedWith 校验时因 hasMenu(code)=false 而 403 锁死。
-- 本脚本幂等（ON CONFLICT DO NOTHING）地写入全部权限码，并创建 super_admin 角色持有全部权限。
-- ============================================================

-- 1) 写入全部权限码（type 统一为 api）
INSERT INTO rbac_permission (id, code, name, type, _created_at, _updated_at)
VALUES
  (gen_random_uuid(), 'dashboard',            '仪表盘',           'api', now(), now()),
  (gen_random_uuid(), 'base:style',           '基础-款式',        'api', now(), now()),
  (gen_random_uuid(), 'base:sku',             '基础-SKU',         'api', now(), now()),
  (gen_random_uuid(), 'base:material',        '基础-物料',        'api', now(), now()),
  (gen_random_uuid(), 'base:customer',        '基础-客户',        'api', now(), now()),
  (gen_random_uuid(), 'base:supplier',        '基础-供应商',      'api', now(), now()),
  (gen_random_uuid(), 'base:warehouse',       '基础-仓库',        'api', now(), now()),
  (gen_random_uuid(), 'purchase:order',       '采购-订单',        'api', now(), now()),
  (gen_random_uuid(), 'purchase:inbound',     '采购-入库',        'api', now(), now()),
  (gen_random_uuid(), 'purchase:return',      '采购-退货',        'api', now(), now()),
  (gen_random_uuid(), 'purchase:reconciliation','采购-对账',      'api', now(), now()),
  (gen_random_uuid(), 'production:bom',       '生产-BOM',         'api', now(), now()),
  (gen_random_uuid(), 'production:material_order',  '生产-物料订单','api', now(), now()),
  (gen_random_uuid(), 'production:material_inbound', '生产-物料入库','api', now(), now()),
  (gen_random_uuid(), 'production:mrp',       '生产-MRP',         'api', now(), now()),
  (gen_random_uuid(), 'production:cost',      '生产-成本',        'api', now(), now()),
  (gen_random_uuid(), 'production:work_order','生产-工单',        'api', now(), now()),
  (gen_random_uuid(), 'production:material_issue', '生产-发料',   'api', now(), now()),
  (gen_random_uuid(), 'production:finish_receipt','生产-成品入库', 'api', now(), now()),
  (gen_random_uuid(), 'sales:order',          '销售-订单',        'api', now(), now()),
  (gen_random_uuid(), 'sales:outbound',       '销售-出库',        'api', now(), now()),
  (gen_random_uuid(), 'sales:return',         '销售-退货',        'api', now(), now()),
  (gen_random_uuid(), 'sales:reconciliation', '销售-对账',        'api', now(), now()),
  (gen_random_uuid(), 'sales:view',           '销售-查看',        'api', now(), now()),
  (gen_random_uuid(), 'inventory:flow',       '库存-流水',        'api', now(), now()),
  (gen_random_uuid(), 'inventory:query',      '库存-查询',        'api', now(), now()),
  (gen_random_uuid(), 'inventory:inbound',    '库存-入库',        'api', now(), now()),
  (gen_random_uuid(), 'inventory:outbound',   '库存-出库',        'api', now(), now()),
  (gen_random_uuid(), 'inventory:transfer',   '库存-调拨',        'api', now(), now()),
  (gen_random_uuid(), 'inventory:stocktake',  '库存-盘点',        'api', now(), now()),
  (gen_random_uuid(), 'finance:receivable',   '财务-应收',        'api', now(), now()),
  (gen_random_uuid(), 'finance:payable',      '财务-应付',        'api', now(), now()),
  (gen_random_uuid(), 'finance:receipt',      '财务-收款',        'api', now(), now()),
  (gen_random_uuid(), 'finance:payment',      '财务-付款',        'api', now(), now()),
  (gen_random_uuid(), 'finance:profit',       '财务-利润',        'api', now(), now()),
  (gen_random_uuid(), 'system:permission',    '系统-权限',        'api', now(), now()),
  (gen_random_uuid(), 'system:user',          '系统-用户',        'api', now(), now()),
  (gen_random_uuid(), 'system:role',          '系统-角色',        'api', now(), now()),
  (gen_random_uuid(), 'system:operation_log', '系统-操作日志',    'api', now(), now()),
  (gen_random_uuid(), 'system:config',        '系统-配置',        'api', now(), now()),
  (gen_random_uuid(), 'tradeshow:preorder',   '展会-预购',        'api', now(), now()),
  (gen_random_uuid(), 'tradeshow:allocation', '展会-配货',        'api', now(), now()),
  (gen_random_uuid(), 'report:garment_purchase','报表-成衣采购',  'api', now(), now()),
  (gen_random_uuid(), 'report:material_purchase','报表-物料采购', 'api', now(), now()),
  (gen_random_uuid(), 'report:sales',         '报表-销售',        'api', now(), now()),
  (gen_random_uuid(), 'report:retail',        '报表-零售',        'api', now(), now()),
  (gen_random_uuid(), 'report:inventory',     '报表-库存',        'api', now(), now()),
  (gen_random_uuid(), 'report:transfer',      '报表-调拨',        'api', now(), now()),
  (gen_random_uuid(), 'report:stockmovement', '报表-库存变动',    'api', now(), now()),
  (gen_random_uuid(), 'report:pivot',         '报表-透视分析',    'api', now(), now()),
  (gen_random_uuid(), 'retail:view',          '零售-查看',        'api', now(), now()),
  (gen_random_uuid(), 'pos:cashier',          'POS-收银',         'api', now(), now()),
  (gen_random_uuid(), 'pricing:manage',       '价格-管理',        'api', now(), now()),
  (gen_random_uuid(), 'base:dealer',          '基础-经销商',      'api', now(), now()),
  (gen_random_uuid(), 'base:store',           '基础-门店',        'api', now(), now()),
  (gen_random_uuid(), 'member:manage',        '会员-管理',        'api', now(), now()),
  (gen_random_uuid(), 'omni:manage',          '全渠道-管理',      'api', now(), now()),
  (gen_random_uuid(), 'subcontract:manage',   '委外-管理',        'api', now(), now()),
  (gen_random_uuid(), 'tradeshow:manage',     '展会-管理',        'api', now(), now())
ON CONFLICT (code) DO NOTHING;

-- 2) 创建超级管理员角色（固定 UUID 便于下方授权引用）
INSERT INTO rbac_role (id, code, name, description, status, _created_at, _updated_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'super_admin', '超级管理员', '持有全部权限，可见全部门店数据', 'active', now(), now())
ON CONFLICT (code) DO NOTHING;

-- 3) 将全部权限授予超级管理员角色
INSERT INTO rbac_role_permission (id, role_id, permission_id)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', p.id
FROM rbac_permission p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4) 将某用户设为超级管理员（请按需替换下面的用户 UUID；
--    也可在“系统-用户”页面为该用户分配 super_admin 角色）：
-- INSERT INTO rbac_user_role (id, user_id, role_id)
-- VALUES (gen_random_uuid(), '<实际管理员用户ID>', '11111111-1111-1111-1111-111111111111')
-- ON CONFLICT (user_id, role_id) DO NOTHING;
