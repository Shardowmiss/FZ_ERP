/**
 * 菜单 / 权限 单一真相源（跨端共享，纯 TS，无 React / Node 依赖）。
 *
 * 解决「权限目录散乱」根因：原先 rbac.service 的 PERMISSION_CATALOG 是一份平铺数组，
 * 与菜单的两层结构不对齐，且菜单分组（如渠道管理）与权限码前缀（base:）错配，
 * 导致同一资源码被多个子菜单复用（如 inventory:query 被 5 个子菜单共用）时无法归并。
 *
 * 本模块把权限目录抽象成三层：
 *   1) catalog（功能模块容器，对应一级菜单，DB 存 type='catalog'（受 ck_rbac_permission_type 约束），
 *      身份由 code 前缀 `mod:` 唯一标识，避免与真实权限码冲突）
 *   2) menu  （子菜单 / 资源，code = 菜单项 permission 码，即控制器真正校验的码）
 *   3) action（菜单中的功能，code = `${资源码}:${动作}`，如 `base:style:create`）
 *
 * rbac.service 通过 buildPermissionCatalog() 生成三层目录行；client 的 menuConfig.tsx
 * 通过 MENU_STRUCTURE 派生侧栏与路由。两者同源 → 菜单增删自动同步权限结构，无需手写双份。
 *
 * 动作子码（第三层）默认按资源类型给出标准集合（CRUD 或 只读 view），其中
 * purchase:inbound / sales:order 两组已存在「真实按动作鉴权」的控制器
 * （@CheckPermission('purchase:inbound:approve') 等），其动作集合与此保持一致。
 * 其余资源的动作子码为「结构性」节点：控制器目前仍校验资源级粗码，而权限守卫的
 * 父子继承（见 permission.guard / rbac.service.checkPermission）保证「持有粗码即拥有全部动作」零回归；
 * 后续要把某资源细化到动作级鉴权，只需把对应控制器的 @CheckPermission 从粗码改为 `:动作` 子码，
 * 结构层无需任何改动。
 *
 * ── 2026-10-11 第二轮：权限码 ↔ 后端守卫 全面对齐 ──────────────────────────────
 * 背景（用户报障）：「权限配置与登录后的实际功能不一致」，且「有些功能模块没进权限配置」。
 * 逐条实读源码后确认根因分三类：
 *   A) 菜单声明码 ≠ 后端真实守卫码。例：零售单菜单写 sales:order，实际接口
 *      /api/retail 的守卫却是 retail:view（会员运营的码）→ 持 sales:order 者页面能开、接口 403；
 *      反向持 retail:view 者却能操作零售单。同类还有 补货建议（菜单 inventory:warning /
 *      接口守卫 inventory:inbound）、订货会主单（菜单 tradeshow:preorder / 接口 tradeshow:manage）、
 *      移动盘点+条码（菜单 inventory:query / 接口 inventory:stocktake）。
 *   B) 一码多菜单复用 → 权限树吞并，其余功能「看不到」（款号属性维护即此因）。
 *   C) 有菜单+有路由但后端完全无守卫 → 任何登录用户都能调（报表 7 个查询端点等）。
 * 处置：本轮把「菜单 permission」严格对齐到「该页面实际调用接口的 @CheckPermission 码」，
 *      并为无守卫端点补守卫；拆码带来的授权变化由 scripts/sync-permission-split.cjs 幂等补授。
 * 少数「同一资源多个入口页」场景（尺码组/尺码组与尺码关系、成衣/面辅料采购查询共用一个端点）
 * 保留复用，属有意设计，已在 scripts/check-permission-sync.cjs 的 ALLOWED_REUSE 中白名单声明。
 */

/**
 * 权限节点类型。
 * 注意：rbac_permission 表存在 CHECK 约束 ck_rbac_permission_type，仅允许
 * (api, menu, button, data, group, catalog)。因此「功能模块」节点复用既有的
 * 'catalog' 类型（语义即“顶层分类容器”），而非新增值——避免改表/迁移。模块身份由
 * code 前缀 `mod:` 唯一标识（见 MODULE_CODE_PREFIX），与具体 type 字符串解耦。
 */
export type PermissionType = 'catalog' | 'menu' | 'group' | 'api';

/** 模块码命名空间前缀（避免与真实权限码如 `dashboard` 冲突） */
export const MODULE_CODE_PREFIX = 'mod:';

export type ActionKey =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'approve'
  | 'accept'
  | 'void'
  | 'print'
  // 第三层动作的语义补全（#807）：采购订单 / 面辅料采购订单 / 全渠道订单 / 预订单
  // 页面上的「提交」是独立的业务动作（提交后进审核），既不是 create 也不是 approve，
  // 缺了它就只能把按钮挂在 create 上 → 只授了「提交」的角色反而点不到按钮。
  | 'submit'
  // 第三层动作语义补全（#811 Batch B）：销售/采购单据的「复核 / 记账 / 驳回」自定义路由
  // （/:id/audit、/:id/book、/:id/reject）此前守卫为资源粗码，补码后可将守卫细化为动作级。
  // audit=复核（audited 态流转）、book=记账（booked 态）、reject=驳回（预订单）。
  | 'audit'
  | 'book'
  | 'reject';

export const ACTION_LABELS: Record<ActionKey, string> = {
  view: '查看',
  create: '新增',
  edit: '编辑',
  delete: '删除',
  approve: '审核',
  accept: '验收',
  void: '作废',
  print: '打印',
  submit: '提交',
  audit: '复核',
  book: '记账',
  reject: '驳回',
};

/**
 * 标准 CRUD 动作集合（默认）
 *
 * ⚠️ 铁律（#807 起）：**只要某资源在页面上做了动作级门控，就必须在此显式声明 `actions`**，
 * 且集合必须覆盖页面门控用到的每一个动作码。原因：
 *   1) 前端 `CanButton(main:action)` / `usePageActions` 走 `hasPermission`（严格父→子），
 *      目录里不存在的 `${码}:${动作}` 恒 false ⇒ 按钮对**所有人**（含超管）消失；
 *   2) `buildPermissionCatalog()` Pass1 的动作集以**首个声明者**为准，省略即落回本默认值，
 *      于是 `approve`/`void`/`submit` 这类非 CRUD 动作会被整体漏掉。
 * 落库前用 `NODE_OPTIONS= node scripts/check-permission-sync.cjs` 对账。
 */
export const DEFAULT_ACTIONS: ActionKey[] = ['view', 'create', 'edit', 'delete'];
/** 只读资源动作集合 */
export const READONLY_ACTIONS: ActionKey[] = ['view'];

export interface MenuChildDef {
  key: string;
  label: string;
  path: string;
  /** 控制器真正校验的权限码（资源级） */
  permission: string;
  /** 显式声明动作集合；省略则按 readOnly 给默认值 */
  actions?: ActionKey[];
  /** 是否资源分组（已有真实按动作鉴权，如采购入库/销售订单） */
  group?: boolean;
  /** 只读资源 → 仅 view 动作 */
  readOnly?: boolean;
}

export interface MenuModuleDef {
  key: string;
  label: string;
  /** 一级模块的 sortOrder（决定权限树顶层顺序） */
  sortOrder: number;
  /** 一级模块自身是否可直接点击（如「数据看板」无子菜单） */
  path?: string;
  children: MenuChildDef[];
}

/**
 * 菜单结构（与 client/src/config/menuConfig.tsx 的 menuItems 对齐）。
 * 这是「菜单 ↔ 权限结构」同步的唯一数据来源：菜单增删子项，权限树自动跟随。
 */
export const MENU_STRUCTURE: MenuModuleDef[] = [
  {
    key: 'dashboard',
    label: '数据看板',
    sortOrder: 0,
    path: '/dashboard',
    children: [],
  },
  {
    key: 'product',
    label: '商品资料',
    sortOrder: 1,
    children: [
      { key: 'style', label: '款号管理', path: '/base/style', permission: 'base:style' },
      { key: 'sku', label: 'SKU管理', path: '/base/sku', permission: 'base:sku' },
      { key: 'color', label: '颜色', path: '/product/color', permission: 'base:color' },
      // 尺码组 / 尺码组与尺码关系：同一业务域（尺码组维护），合并到一个独立资源码。
      // 此前尺码组错挂 base:sku、关系页错挂 base:size，导致权限树里「看不到尺码组」，
      // 且后端守卫（base:style / base:size）与菜单声明（base:sku）三方不一致。
      { key: 'size-group', label: '尺码组', path: '/base/size-group', permission: 'base:size-group' },
      { key: 'size', label: '尺码', path: '/product/size', permission: 'base:size' },
      { key: 'size-group-relation', label: '尺码组与尺码关系', path: '/product/size-group-relation', permission: 'base:size-group' },
      // 款号属性维护 / 款号编码规则：此前均复用 base:style，权限树被归并到同一条目：
      // 「款号属性维护」在权限管理里根本看不到。独立成码后各自可单独授权。
      { key: 'style-attribute', label: '款号属性维护', path: '/base/style-attribute', permission: 'base:style-attribute' },
      { key: 'code-rule', label: '款号编码规则', path: '/product/code-rule', permission: 'base:code-rule' },
      { key: 'product-import', label: '批量导入', path: '/base/product-import', permission: 'base:import', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
    ],
  },
  {
    key: 'channel',
    label: '渠道管理',
    sortOrder: 2,
    children: [
      { key: 'supplier', label: '供应商管理', path: '/base/supplier', permission: 'base:supplier' },
      { key: 'dealer', label: '经销商管理', path: '/base/dealer', permission: 'base:dealer' },
      { key: 'store', label: '店仓管理', path: '/base/store', permission: 'base:store' },
    ],
  },
  {
    key: 'purchase',
    label: '采购管理',
    sortOrder: 3,
    children: [
      { key: 'garment-purchase-order', label: '采购订单', path: '/purchase/garment-order', permission: 'purchase:order', actions: ['view', 'create', 'edit', 'delete', 'submit', 'approve', 'audit', 'book', 'accept', 'void'] },
      {
        key: 'garment-purchase-inbound',
        label: '采购入库',
        path: '/purchase/garment-inbound',
        permission: 'purchase:inbound',
        group: true,
        actions: ['view', 'create', 'edit', 'approve', 'accept', 'void', 'delete'],
      },
      { key: 'garment-purchase-return', label: '采购退货', path: '/purchase/garment-return', permission: 'purchase:return', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'purchase-reconciliation', label: '采购对账', path: '/purchase/reconciliation', permission: 'purchase:reconciliation', actions: ['view', 'create'] },
    ],
  },
  {
    key: 'production',
    label: '生产管理',
    sortOrder: 4,
    children: [
      { key: 'prod-bom', label: 'BOM管理', path: '/production/bom', permission: 'production:bom' },
      { key: 'material', label: '面辅料管理', path: '/base/material', permission: 'base:material' },
      { key: 'material-purchase-order', label: '面辅料采购订单', path: '/production/material-purchase-order', permission: 'production:material_order', actions: ['view', 'create', 'edit', 'delete', 'submit', 'approve', 'void'] },
      { key: 'material-purchase-inbound', label: '面辅料入库', path: '/production/material-purchase-inbound', permission: 'production:material_inbound', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'mrp', label: 'MRP运算', path: '/production/mrp', permission: 'production:mrp' },
      { key: 'prod-cost', label: '成本核算', path: '/production/cost', permission: 'production:cost' },
      { key: 'work-order', label: '生产工单', path: '/production/work-order', permission: 'production:work_order', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'material-issue', label: '领料单', path: '/production/material-issue', permission: 'production:material_issue', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'finish-receipt', label: '完工入库单', path: '/production/finish-receipt', permission: 'production:finish_receipt', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      // 委外管理：控制器守卫为 subcontract:manage（12 处），此前菜单错挂 inventory:query
      // → 页面可达但每个写接口都 403。此处与后端对齐。
      // #811 Batch B：显式声明动作集，使 :approve / :void 子码进目录（供守卫细化）。
      { key: 'subcontract-main', label: '委外管理', path: '/subcontract', permission: 'subcontract:manage', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    sortOrder: 5,
    children: [
      {
        key: 'sales-order',
        label: '销售订单',
        path: '/sales/order',
        permission: 'sales:order',
        group: true,
        actions: ['view', 'create', 'edit', 'approve', 'audit', 'book', 'delete', 'void', 'print'],
      },
      { key: 'sales-outbound', label: '销售出库', path: '/sales/outbound', permission: 'sales:outbound', group: true, actions: ['view', 'create', 'edit', 'approve', 'audit', 'book', 'accept', 'delete', 'void', 'print'] },
      { key: 'sales-return', label: '销售退货', path: '/sales/return', permission: 'sales:return', group: true, actions: ['view', 'create', 'edit', 'approve', 'audit', 'book', 'accept', 'delete', 'void', 'print'] },
      { key: 'sales-reconciliation', label: '销售对账', path: '/sales/reconciliation', permission: 'sales:reconciliation', actions: ['view', 'create'] },
      // 零售单 / 零售退货单：此前菜单错挂 sales:order / sales:return，但它们实际调用的
      // /api/retail、/api/retail/return 守卫是 retail:view（会员运营的码）→ 双向不一致。
      // 独立成码后与后端守卫（retail.controller）严格对齐。
      { key: 'retail-order', label: '零售单', path: '/retail/order', permission: 'sales:retail', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'retail-return', label: '零售退货单', path: '/retail/return', permission: 'sales:retail_return', actions: ['view', 'create', 'edit', 'delete', 'void'] },
      { key: 'omni-main', label: '全渠道订单', path: '/omni', permission: 'omni:manage', actions: ['view', 'create', 'edit', 'delete', 'submit', 'audit'] },
    ],
  },
  {
    key: 'inventory',
    label: '库存管理',
    sortOrder: 6,
    children: [
      { key: 'inv-query', label: '库存查询', path: '/inventory/query', permission: 'inventory:query' },
      { key: 'inv-flow', label: '库存流水', path: '/inventory/flow', permission: 'inventory:flow', readOnly: true },
      { key: 'inv-inbound', label: '入库单', path: '/inventory/inbound', permission: 'inventory:inbound' },
      { key: 'inv-outbound', label: '出库单', path: '/inventory/outbound', permission: 'inventory:outbound' },
      { key: 'inv-transfer', label: '调拨单', path: '/inventory/transfer', permission: 'inventory:transfer', actions: ['view', 'create', 'edit', 'delete', 'approve', 'accept', 'void'] },
      { key: 'inv-stocktake', label: '盘点单', path: '/inventory/stocktake', permission: 'inventory:stocktake', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'inv-warning', label: '库存预警', path: '/inventory/warning', permission: 'inventory:warning' },
      // 条码/批次：此前挂 inventory:query，但其接口（GET /api/inventory/batch、
      // POST /api/inventory/barcode/generate）在 inventory-mobile.controller 下守卫为
      // inventory:stocktake → 三方不一致。独立成码 inventory:barcode 并与后端对齐。
      { key: 'inv-barcode', label: '条码/批次', path: '/inventory/barcode', permission: 'inventory:barcode' },
      { key: 'inv-mobile-stocktake', label: '移动盘点', path: '/inventory/mobile-stocktake', permission: 'inventory:stocktake_mobile' },
      // 吊牌打印：独立成码。此前挂 inventory:query，导致任何持「库存查询」者都能改
      // 唯一码参数、增删模板（后端起见，hangtag.controller 已改为 class 级 inventory:hangtag 守卫）。
      { key: 'inv-hangtag-print', label: '吊牌打印', path: '/inventory/hangtag-print', permission: 'inventory:hangtag' },
      // 唯一码溯源页为纯前端展示（无后端调用），独立成码以便在权限树中可见、可单独授权。
      { key: 'inv-unique-code-trace', label: '唯一码溯源', path: '/inventory/unique-code-trace', permission: 'inventory:unique_code', readOnly: true },
    ],
  },
  {
    key: 'channel-replenish',
    label: '补货管理',
    sortOrder: 7,
    children: [
      // 补货建议（采购向）：此前菜单 inventory:warning，但其接口 /api/inventory/replenish
      // 的守卫却是 inventory:inbound → 持 inventory:warning 者页面能开、接口 403。独立成码。
      { key: 'inv-replenish', label: '补货建议（采购向）', path: '/inventory/replenish', permission: 'inventory:replenish' },
      { key: 'replenish-plan', label: '补货计划（门店向）', path: '/inventory/replenish-plan', permission: 'inventory:replenish-plan' },
      { key: 'replenish-template', label: '补货模板（门店向）', path: '/inventory/replenish-template', permission: 'inventory:replenish-template' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    sortOrder: 8,
    children: [
      { key: 'receivable', label: '应收管理', path: '/finance/receivable', permission: 'finance:receivable' },
      { key: 'payable', label: '应付管理', path: '/finance/payable', permission: 'finance:payable' },
      { key: 'receipt', label: '收款单', path: '/finance/receipt', permission: 'finance:receipt', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'payment', label: '付款单', path: '/finance/payment', permission: 'finance:payment', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
      { key: 'profit', label: '毛利分析', path: '/finance/profit', permission: 'finance:profit' },
      // 月结管理：此前与毛利分析共用 finance:profit（权限树只显示一条），且后端
      // month-close.controller 用的也是 finance:profit → 毛利/月结无法分别授权。独立成码。
      { key: 'month-close', label: '月结管理', path: '/finance/month-close', permission: 'finance:month_close', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
    ],
  },
  {
    key: 'report',
    label: '报表中心',
    sortOrder: 9,
    children: [
      // 成衣/面辅料采购查询：两者共用同一个后端端点 GET /api/report/purchase，
      // 属「同一资源两个入口页」，有意复用同一码（见 ALLOWED_REUSE）。
      { key: 'report-garment-purchase', label: '成衣采购查询', path: '/report/garment-purchase', permission: 'report:purchase', readOnly: true },
      { key: 'report-material-purchase', label: '面辅料采购查询', path: '/report/material-purchase', permission: 'report:purchase', readOnly: true },
      { key: 'report-sales', label: '销售查询', path: '/report/sales', permission: 'report:sales', readOnly: true },
      { key: 'report-retail', label: '零售查询', path: '/report/retail', permission: 'report:retail', readOnly: true },
      // 零售报表：此前挂 sales:order（与销售订单复用），实际接口是
      // GET /api/retail/report/summary（retail-report.controller）。独立成码。
      { key: 'retail-report', label: '零售报表', path: '/retail/report', permission: 'report:retail_report' },
      { key: 'report-inventory', label: '库存查询', path: '/report/inventory', permission: 'report:inventory', readOnly: true },
      { key: 'report-transfer', label: '调拨查询', path: '/report/transfer', permission: 'report:transfer', readOnly: true },
      { key: 'report-stock-movement', label: '进销存查询', path: '/report/stock-movement', permission: 'report:stockmovement', readOnly: true },
      { key: 'report-pivot', label: '透视分析', path: '/report/pivot', permission: 'report:pivot', readOnly: true },
      // 透视字段配置：此前挂 system:config（与系统配置复用，权限树看不到），
      // 其接口为 /api/report/pivot/semantic-admin（4 个端点）。独立成码并与后端对齐。
      { key: 'report-pivot-semantics', label: '透视字段配置', path: '/report/pivot/semantics', permission: 'report:semantic' },
      // AI销量预测 / 商品生命周期 / 自助BI钻取：此前三者共用 dashboard:view，
      // 权限树只显示一条。各自接口为 /api/analytics/{forecast,lifecycle,bi}，独立成码。
      { key: 'analytics-forecast', label: 'AI销量预测', path: '/analytics/forecast', permission: 'analytics:forecast', readOnly: true },
      { key: 'analytics-lifecycle', label: '商品生命周期', path: '/analytics/lifecycle', permission: 'analytics:lifecycle', readOnly: true },
      { key: 'analytics-bi', label: '自助BI钻取', path: '/analytics/bi', permission: 'analytics:bi', readOnly: true },
    ],
  },
  {
    key: 'trade-show',
    label: '订货会管理',
    sortOrder: 10,
    children: [
      { key: 'trade-show-theme', label: '订货会主题', path: '/trade-show/theme', permission: 'tradeshow:theme' },
      // 订货会主单：此前挂 tradeshow:preorder（与预订单复用），但其接口
      // /api/trade-show（trade-show.controller）守卫为 tradeshow:manage → 不一致。对齐后端。
      { key: 'trade-show-list', label: '订货会主单', path: '/trade-show/list', permission: 'tradeshow:manage', actions: ['view', 'create', 'edit', 'delete', 'void'] },
      { key: 'pre-order', label: '预订单', path: '/trade-show/pre-order', permission: 'tradeshow:preorder', actions: ['view', 'create', 'edit', 'delete', 'submit', 'void', 'reject'] },
      { key: 'pre-order-summary', label: '预订汇总', path: '/trade-show/summary', permission: 'tradeshow:preorder' },
      { key: 'allocation', label: '配货管理', path: '/trade-show/allocation', permission: 'tradeshow:allocation', actions: ['view', 'create', 'edit', 'delete', 'approve', 'void'] },
    ],
  },
  {
    key: 'member',
    label: '会员私域',
    sortOrder: 11,
    children: [
      // 会员运营：此前挂 retail:view，但其接口走 /api/member（member.controller 守卫
      // member:manage）与 member:merge → 页面能开、接口 403。对齐后端 member:manage。
      //
      // 注意：本项与「会员管理」共用 member:manage，而 buildPermissionCatalog 的 Pass 1
      // 以**首个**出现者决定该码的动作集合。会员运营页本身有新增/编辑会员能力，
      // 故必须显式声明完整 CRUD；若标 readOnly 会把共享码压成仅 :view，
      // 导致 member:manage:create/edit/delete 被 prune 掉（真实回归，已踩过一次）。
      {
        key: 'member-main',
        label: '会员运营',
        path: '/member',
        permission: 'member:manage',
        actions: ['view', 'create', 'edit', 'delete'],
      },
      { key: 'member-manage', label: '会员管理', path: '/member/manage', permission: 'member:manage' },
      { key: 'member-level', label: '会员等级', path: '/member/level', permission: 'member:level' },
    ],
  },
  {
    key: 'data-governance',
    label: '数据治理',
    sortOrder: 12,
    children: [
      { key: 'merge-audit', label: '合并审计', path: '/base/merge-audit', permission: 'md:merge', readOnly: true },
      { key: 'member-merge-audit', label: '会员合并审计', path: '/base/member-merge-audit', permission: 'member:merge', readOnly: true },
    ],
  },
  {
    key: 'system',
    label: '系统管理',
    sortOrder: 13,
    children: [
      { key: 'user', label: '用户管理', path: '/system/user', permission: 'system:user' },
      { key: 'role', label: '角色管理', path: '/system/role', permission: 'system:role' },
      { key: 'permission', label: '权限管理', path: '/system/permission', permission: 'system:permission' },
      { key: 'operation-log', label: '操作日志', path: '/system/operation-log', permission: 'system:operation_log', readOnly: true },
      { key: 'config', label: '系统配置', path: '/system/config', permission: 'system:config' },
    ],
  },
  {
    key: 'pos-pricing',
    label: 'POS与价格',
    sortOrder: 14,
    children: [
      { key: 'pos-cashier', label: 'POS收银', path: '/pos/cashier', permission: 'pos:cashier' },
      { key: 'pricing', label: '价格管理', path: '/pricing', permission: 'pricing:manage' },
    ],
  },
  {
    key: 'distribution-portal',
    label: '分销门户',
    sortOrder: 15,
    children: [
      // 分销门户 5 个子页此前全部共用 distribution:portal（权限树只显示一条），
      // 且后端 distribution-portal.controller 7 个端点完全无守卫 → 任何登录用户
      // 都能确认采购单 / 绑定分销节点。按端点拆分并与后端守卫对齐。
      { key: 'portal-overview', label: '门户概览', path: '/distribution/portal', permission: 'distribution:portal_overview', readOnly: true },
      { key: 'portal-po', label: '我的采购单', path: '/distribution/portal/purchase-orders', permission: 'distribution:portal_po' },
      { key: 'portal-pr', label: '我的采购退货单', path: '/distribution/portal/purchase-returns', permission: 'distribution:portal_pr', readOnly: true },
      { key: 'portal-recon', label: '应收应付对账', path: '/distribution/portal/reconciliation', permission: 'distribution:portal_recon', readOnly: true },
      { key: 'portal-partners', label: '我的分销节点', path: '/distribution/portal/partners', permission: 'distribution:portal_partners' },
    ],
  },
];

/**
 * 跨模块共享资源码 → 规范归属模块。
 * 这些码被多个一级菜单的子菜单复用（如 inventory:query 被库存/委外复用），
 * 权限树按「资源」归并到唯一模块，避免同一码重复挂树。
 * 未在此声明的共享码默认归属「首次出现」的模块。
 */
const CANONICAL_MODULE: Record<string, string> = {
  'inventory:query': 'inventory',
  'inventory:warning': 'inventory',
  'inventory:stocktake': 'inventory',
  'inventory:barcode': 'inventory',
  'inventory:unique_code': 'inventory',
  'inventory:stocktake_mobile': 'inventory',
  'inventory:replenish': 'channel-replenish',
  'sales:order': 'sales',
  'sales:return': 'sales',
  'sales:retail': 'sales',
  'sales:retail_return': 'sales',
  'system:config': 'system',
  'finance:month_close': 'finance',
  'report:purchase': 'report',
  'report:retail_report': 'report',
  'report:semantic': 'report',
  'analytics:forecast': 'report',
  'analytics:lifecycle': 'report',
  'analytics:bi': 'report',
  'tradeshow:preorder': 'trade-show',
  'tradeshow:manage': 'trade-show',
  'distribution:portal_overview': 'distribution-portal',
  'distribution:portal_po': 'distribution-portal',
  'distribution:portal_pr': 'distribution-portal',
  'distribution:portal_recon': 'distribution-portal',
  'distribution:portal_partners': 'distribution-portal',
  'member:manage': 'member',
};

/**
 * 目录中「菜单未覆盖、但控制器仍校验」的额外权限码（保留以避免既有授权/门禁失效）。
 * 这些码不参与菜单自动同步，集中声明于此；作为叶子节点保留（不生成动作子码）。
 *
 * 清理原则（2026-10-11）：凡「无菜单 + 无路由 + 后端无守卫」三项全无的码一律删除，
 * 已移除 base:warehouse（仓库管理）、sales:view（销售-查看）、product:barcode（商品-条形码管理）
 * —— 这三者对应的功能模块在系统中已不存在（或已被店仓管理取代）。删除由
 * rbac.service.ensureRbacCatalog 的 prune 步骤同步到 rbac_permission 表及角色授权。
 *
 * 第二轮补充：retail:view 已从菜单移除（会员运营改挂 member:manage、零售单改挂 sales:retail），
 * 且后端 retail.controller 守卫同步改为 sales:retail / sales:retail_return，
 * 故 retail:view 不再需要保留（prune 会自动清理）。
 */
const EXTRA_PERMISSIONS: { code: string; name: string; module: string }[] = [
  { code: 'dashboard', name: '仪表盘(根)', module: 'dashboard' },
  // 数据看板 / 指标层：analytics.controller 与 metrics.controller 仍以 dashboard:view 守卫，
  // 但拆分后菜单已不再声明此码（三个分析页改为 analytics:*），故在此保留，避免被 prune 掉导致接口 403。
  { code: 'dashboard:view', name: '数据看板-查看', module: 'dashboard' },
  { code: 'pos:receiver:manage', name: 'POS接收-补偿管理', module: 'pos-pricing' },
];

/**
 * 权限码「重命名 / 拆分」映射：旧码 → 承接它的新码列表。
 *
 * 用于 ensureRbacCatalog 的 prune 步骤——删除旧码**之前**先把持有旧码的角色平移授权到新码。
 * 为什么必须：prune 会连 rbac_role_permission 一起删，若无迁移，拆码就等于静默剥夺授权。
 * 真实事故（2026-10-11）：把 distribution:portal 拆成 5 个子码后，dealer 角色
 * 因旧码授权被连带删除而丢失整个分销门户访问，且事后无法追溯谁曾持有。
 *
 * 动作子码无需逐一登记：迁移时会先查自身，未命中则回退到父码映射并追加相同后缀
 * （如 `distribution:portal:view` → 父 `distribution:portal` → `...:view`）。
 */
export const PERMISSION_CODE_MIGRATION: Record<string, string[]> = {
  // 分销门户：1 个粗码 → 5 个子页独立码
  'distribution:portal': [
    'distribution:portal_overview',
    'distribution:portal_po',
    'distribution:portal_pr',
    'distribution:portal_recon',
    'distribution:portal_partners',
  ],
  // 采购查询：成衣 / 面辅料 两个码 → 合并为 report:purchase（共用同一端点）
  'report:garment_purchase': ['report:purchase'],
  'report:material_purchase': ['report:purchase'],
  // 零售：retail:view（会员运营的旧码）→ 零售单 / 零售退货单 真实守卫码
  'retail:view': ['sales:retail', 'sales:retail_return'],
  // 商品资料拆码（第一轮治理）
  'base:style': ['base:style-attribute', 'base:code-rule'],
  'base:sku': ['base:size-group'],
  'base:size': ['base:size-group'],
  // 颜色组下线（2026-10-12）：该模块整体移除，颜色改为「只在 SKU 层选择」。
  // 无后继码 ⇒ 登记为空数组，使持有者的旧授权在 prune 前被显式平移掉并留审计日志。
  'base:color-group': [],
};

export interface CatalogEntry {
  code: string;
  name: string;
  type: PermissionType;
  parent?: string;
  sortOrder: number;
}

/**
 * 生成三层权限目录（module → menu → action）。
 * rbac.service.ensureRbacCatalog 用其替换手写 PERMISSION_CATALOG。
 */
export function buildPermissionCatalog(): CatalogEntry[] {
  interface Acc {
    module: string;
    label: string;
    actions: ActionKey[];
    group: boolean;
  }

  // Pass 1：归集每个资源码 → 规范模块 + 元数据（处理共享码归并）
  const acc = new Map<string, Acc>();

  for (const mod of MENU_STRUCTURE) {
    mod.children.forEach((child) => {
      const existing = acc.get(child.permission);
      const canonical = CANONICAL_MODULE[child.permission];
      if (!existing) {
        acc.set(child.permission, {
          module: mod.key,
          label: child.label,
          actions: child.actions ?? (child.readOnly ? READONLY_ACTIONS : DEFAULT_ACTIONS),
          group: !!child.group,
        });
      } else if (canonical === mod.key) {
        // 当前模块是该码的规范归属 → 接管（label/actions 以规范模块为准）
        existing.module = mod.key;
        existing.label = child.label;
      }
    });
  }

  // 额外码并入（叶子，不给动作子码，避免与真实码如 dashboard:view 冲突）
  for (const ex of EXTRA_PERMISSIONS) {
    if (!acc.has(ex.code)) {
      acc.set(ex.code, {
        module: ex.module,
        label: ex.name,
        actions: [],
        group: false,
      });
    }
  }

  // 资源码在所属模块 children 中的位置（确定 sortOrder）
  const childOrderIndex = new Map<string, number>();
  for (const mod of MENU_STRUCTURE) {
    mod.children.forEach((c, i) => {
      if (!childOrderIndex.has(c.permission)) childOrderIndex.set(c.permission, i);
    });
  }

  // 模块 sortOrder（含额外码可能引入的模块）
  const moduleSort = new Map<string, number>();
  for (const m of MENU_STRUCTURE) moduleSort.set(m.key, m.sortOrder);
  for (const ex of EXTRA_PERMISSIONS) {
    if (!moduleSort.has(ex.module)) moduleSort.set(ex.module, 900 + moduleSort.size);
  }

  const sortedModules = [...moduleSort.entries()].sort((a, b) => a[1] - b[1]);

  const entries: CatalogEntry[] = [];

  for (const [modKey] of sortedModules) {
    const modDef = MENU_STRUCTURE.find((m) => m.key === modKey);
    const modLabel = modDef?.label ?? modKey;
    const modSort = moduleSort.get(modKey) ?? 0;

    // 1) 模块节点（复用约束允许的 'catalog' 类型，语义=顶层分类容器；
    //    module 身份由 code 前缀 mod: 唯一标识，UI 用此前缀识别）
    entries.push({
      code: MODULE_CODE_PREFIX + modKey,
      name: modLabel,
      type: 'catalog',
      parent: undefined,
      sortOrder: modSort,
    });

    // 2) 该模块下的资源节点 + 3) 动作子节点
    const codesInModule = [...acc.entries()].filter(([, v]) => v.module === modKey);
    codesInModule.sort((a, b) => {
      const ia = childOrderIndex.get(a[0]) ?? 0;
      const ib = childOrderIndex.get(b[0]) ?? 0;
      return ia - ib;
    });

    codesInModule.forEach(([code, meta], i) => {
      entries.push({
        code,
        name: meta.label,
        type: meta.group ? 'group' : 'api',
        parent: MODULE_CODE_PREFIX + modKey,
        sortOrder: i,
      });
      meta.actions.forEach((act, j) => {
        entries.push({
          code: `${code}:${act}`,
          name: ACTION_LABELS[act],
          type: 'api',
          parent: code,
          sortOrder: j + 1,
        });
      });
    });
  }

  return entries;
}
