import React from 'react';
import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Package, DollarSign,
  Settings, Users, Factory, NotebookPen, ArrowLeftRight,
  CalendarDays, BarChart3, Truck, FileText, CreditCard,
} from 'lucide-react';

/**
 * 菜单 + 路由 单一真相源。
 *
 * 原先 menuItems 定义在 Layout.tsx 内部，页签栏想复用图标就只能反向 import Layout，
 * 形成 Layout -> TabBar -> Layout 的循环依赖（模块求值顺序下 menuItems 会是 TDZ）。
 * 因此抽到独立模块：Layout 负责渲染侧栏，TabBar 负责取 path -> icon 映射。
 *
 * 路由可达性原本由三套独立手写映射维护，极易漂移：
 *   1) 本文件的 menuItems（侧栏可见性 + 页签标题）
 *   2) TabPageCache 的 exactMap / editPageMap / routePermissions（页签内容渲染）
 *   3) app.tsx 的 <Routes>（URL 深链 / 兜底）
 * M3 之后：本文件新增 routeComponents 注册表作为**路由唯一真相源**，
 * TabPageCache 与 app.tsx 均从它派生，新增页面只在一处登记。
 */

export interface MenuChildItem {
  key: string;
  label: string;
  path: string;
  permission?: string;
}

export interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  children?: MenuChildItem[];
  path?: string;
}

export const menuItems: MenuItem[] = [
  {
    key: 'dashboard',
    label: '数据看板',
    icon: <LayoutDashboard size={18} />,
    path: '/dashboard',
    permission: 'dashboard',
  },
  {
    key: 'product',
    label: '商品资料',
    icon: <NotebookPen size={18} />,
    children: [
      { key: 'style', label: '款号管理', path: '/base/style', permission: 'base:style' },
      { key: 'sku', label: 'SKU管理', path: '/base/sku', permission: 'base:sku' },
      { key: 'color', label: '颜色', path: '/product/color', permission: 'base:color' },
      { key: 'size-group', label: '尺码组', path: '/base/size-group', permission: 'base:sku' },
      { key: 'size', label: '尺码', path: '/product/size', permission: 'base:size' },
      { key: 'size-group-relation', label: '尺码组与尺码关系', path: '/product/size-group-relation', permission: 'base:size' },
      { key: 'style-attribute', label: '款号属性维护', path: '/base/style-attribute', permission: 'base:style' },
      // 原用 system:permission（系统权限），会让「有系统权限=有编码规则」，属误授；改用款号码
      { key: 'code-rule', label: '款号编码规则', path: '/product/code-rule', permission: 'base:style' },
      { key: 'product-import', label: '批量导入', path: '/base/product-import', permission: 'base:import' },
    ],
  },
  {
    key: 'channel',
    // 用户明确要求：菜单名称改回「渠道管理」（供应商/经销商/店仓统一归入渠道）
    label: '渠道管理',
    icon: <Truck size={18} />,
    children: [
      { key: 'supplier', label: '供应商管理', path: '/base/supplier', permission: 'base:supplier' },
      { key: 'dealer', label: '经销商管理', path: '/base/dealer', permission: 'base:dealer' },
      { key: 'store', label: '店仓管理', path: '/base/store', permission: 'base:store' },
    ],
  },
  {
    key: 'purchase',
    label: '采购管理',
    icon: <ShoppingCart size={18} />,
    children: [
      { key: 'garment-purchase-order', label: '采购订单', path: '/purchase/garment-order', permission: 'purchase:order' },
      { key: 'garment-purchase-inbound', label: '采购入库', path: '/purchase/garment-inbound', permission: 'purchase:inbound' },
      { key: 'garment-purchase-return', label: '采购退货', path: '/purchase/garment-return', permission: 'purchase:return' },
      { key: 'purchase-reconciliation', label: '采购对账', path: '/purchase/reconciliation', permission: 'purchase:reconciliation' },
    ],
  },
  {
    key: 'production',
    label: '生产管理',
    icon: <Factory size={18} />,
    children: [
      { key: 'prod-bom', label: 'BOM管理', path: '/production/bom', permission: 'production:bom' },
      { key: 'material', label: '面辅料管理', path: '/base/material', permission: 'base:material' },
      { key: 'material-purchase-order', label: '面辅料采购订单', path: '/production/material-purchase-order', permission: 'production:material_order' },
      { key: 'material-purchase-inbound', label: '面辅料入库', path: '/production/material-purchase-inbound', permission: 'production:material_inbound' },
      { key: 'mrp', label: 'MRP运算', path: '/production/mrp', permission: 'production:mrp' },
      { key: 'prod-cost', label: '成本核算', path: '/production/cost', permission: 'production:cost' },
      { key: 'work-order', label: '生产工单', path: '/production/work-order', permission: 'production:work_order' },
      { key: 'material-issue', label: '领料单', path: '/production/material-issue', permission: 'production:material_issue' },
      { key: 'finish-receipt', label: '完工入库单', path: '/production/finish-receipt', permission: 'production:finish_receipt' },
      { key: 'subcontract-main', label: '委外管理', path: '/subcontract', permission: 'inventory:query' },
    ],
  },
  {
    key: 'sales',
    label: '销售管理',
    icon: <ShoppingBag size={18} />,
    children: [
      { key: 'sales-order', label: '销售订单', path: '/sales/order', permission: 'sales:order' },
      { key: 'sales-outbound', label: '销售出库', path: '/sales/outbound', permission: 'sales:outbound' },
      { key: 'sales-return', label: '销售退货', path: '/sales/return', permission: 'sales:return' },
      { key: 'sales-reconciliation', label: '销售对账', path: '/sales/reconciliation', permission: 'sales:reconciliation' },
      { key: 'retail-order', label: '零售单', path: '/retail/order', permission: 'sales:order' },
      { key: 'retail-return', label: '零售退货单', path: '/retail/return', permission: 'sales:return' },
      { key: 'omni-main', label: '全渠道订单', path: '/omni', permission: 'omni:manage' },
    ],
  },
  {
    key: 'inventory',
    label: '库存管理',
    icon: <Package size={18} />,
    children: [
      { key: 'inv-query', label: '库存查询', path: '/inventory/query', permission: 'inventory:query' },
      { key: 'inv-flow', label: '库存流水', path: '/inventory/flow', permission: 'inventory:flow' },
      { key: 'inv-inbound', label: '入库单', path: '/inventory/inbound', permission: 'inventory:inbound' },
      { key: 'inv-outbound', label: '出库单', path: '/inventory/outbound', permission: 'inventory:outbound' },
      { key: 'inv-transfer', label: '调拨单', path: '/inventory/transfer', permission: 'inventory:transfer' },
      { key: 'inv-stocktake', label: '盘点单', path: '/inventory/stocktake', permission: 'inventory:stocktake' },
      { key: 'inv-warning', label: '库存预警', path: '/inventory/warning', permission: 'inventory:warning' },
      { key: 'inv-barcode', label: '条码/批次', path: '/inventory/barcode', permission: 'inventory:query' },
      { key: 'inv-mobile-stocktake', label: '移动盘点', path: '/inventory/mobile-stocktake', permission: 'inventory:stocktake' },
      { key: 'inv-hangtag-print', label: '吊牌打印', path: '/inventory/hangtag-print', permission: 'inventory:query' },
      { key: 'inv-unique-code-trace', label: '唯一码溯源', path: '/inventory/unique-code-trace', permission: 'inventory:query' },
    ],
  },
  {
    key: 'channel-replenish',
    // 补货类入口集中于此，并在名称上标明业务方向：
    // 「补货建议」是上游采购向（安全库存法 → 采购单），「补货计划/模板」是下游门店向（铺货）。
    label: '补货管理',
    icon: <Truck size={18} />,
    children: [
      { key: 'inv-replenish', label: '补货建议（采购向）', path: '/inventory/replenish', permission: 'inventory:warning' },
      { key: 'replenish-plan', label: '补货计划（门店向）', path: '/inventory/replenish-plan', permission: 'inventory:replenish-plan' },
      { key: 'replenish-template', label: '补货模板（门店向）', path: '/inventory/replenish-template', permission: 'inventory:replenish-template' },
    ],
  },
  {
    key: 'finance',
    label: '财务管理',
    icon: <DollarSign size={18} />,
    children: [
      { key: 'receivable', label: '应收管理', path: '/finance/receivable', permission: 'finance:receivable' },
      { key: 'payable', label: '应付管理', path: '/finance/payable', permission: 'finance:payable' },
      { key: 'receipt', label: '收款单', path: '/finance/receipt', permission: 'finance:receipt' },
      { key: 'payment', label: '付款单', path: '/finance/payment', permission: 'finance:payment' },
      { key: 'profit', label: '毛利分析', path: '/finance/profit', permission: 'finance:profit' },
      { key: 'month-close', label: '月结管理', path: '/finance/month-close', permission: 'finance:profit' },
    ],
  },
  {
    key: 'report',
    label: '报表中心',
    icon: <BarChart3 size={18} />,
    children: [
      { key: 'report-garment-purchase', label: '成衣采购查询', path: '/report/garment-purchase', permission: 'report:garment_purchase' },
      { key: 'report-material-purchase', label: '面辅料采购查询', path: '/report/material-purchase', permission: 'report:material_purchase' },
      { key: 'report-sales', label: '销售查询', path: '/report/sales', permission: 'report:sales' },
      { key: 'report-retail', label: '零售查询', path: '/report/retail', permission: 'report:retail' },
      { key: 'retail-report', label: '零售报表', path: '/retail/report', permission: 'sales:order' },
      { key: 'report-inventory', label: '库存查询', path: '/report/inventory', permission: 'report:inventory' },
      { key: 'report-transfer', label: '调拨查询', path: '/report/transfer', permission: 'report:transfer' },
      { key: 'report-stock-movement', label: '进销存查询', path: '/report/stock-movement', permission: 'report:stockmovement' },
      { key: 'report-pivot', label: '透视分析', path: '/report/pivot', permission: 'report:pivot' },
      { key: 'report-pivot-semantics', label: '透视字段配置', path: '/report/pivot/semantics', permission: 'system:config' },
      { key: 'analytics-forecast', label: 'AI销量预测', path: '/analytics/forecast', permission: 'dashboard:view' },
      { key: 'analytics-lifecycle', label: '商品生命周期', path: '/analytics/lifecycle', permission: 'dashboard:view' },
      { key: 'analytics-bi', label: '自助BI钻取', path: '/analytics/bi', permission: 'dashboard:view' },
    ],
  },
  {
    key: 'trade-show',
    label: '订货会管理',
    icon: <CalendarDays size={18} />,
    children: [
      { key: 'trade-show-theme', label: '订货会主题', path: '/trade-show/theme', permission: 'tradeshow:theme' },
      { key: 'trade-show-list', label: '订货会主单', path: '/trade-show/list', permission: 'tradeshow:preorder' },
      { key: 'pre-order', label: '预订单', path: '/trade-show/pre-order', permission: 'tradeshow:preorder' },
      { key: 'pre-order-summary', label: '预订汇总', path: '/trade-show/summary', permission: 'tradeshow:preorder' },
      { key: 'allocation', label: '配货管理', path: '/trade-show/allocation', permission: 'tradeshow:allocation' },
    ],
  },
  {
    key: 'member',
    label: '会员私域',
    icon: <Users size={18} />,
    children: [
      { key: 'member-main', label: '会员运营', path: '/member', permission: 'retail:view' },
      { key: 'member-manage', label: '会员管理', path: '/member/manage', permission: 'member:manage' },
      { key: 'member-level', label: '会员等级', path: '/member/level', permission: 'member:level' },
    ],
  },
  {
    key: 'data-governance',
    label: '数据治理',
    icon: <ArrowLeftRight size={18} />,
    children: [
      { key: 'merge-audit', label: '合并审计', path: '/base/merge-audit', permission: 'md:merge' },
      { key: 'member-merge-audit', label: '会员合并审计', path: '/base/member-merge-audit', permission: 'member:merge' },
    ],
  },
  {
    key: 'system',
    label: '系统管理',
    icon: <Settings size={18} />,
    children: [
      { key: 'user', label: '用户管理', path: '/system/user', permission: 'system:user' },
      { key: 'role', label: '角色管理', path: '/system/role', permission: 'system:role' },
      { key: 'permission', label: '权限管理', path: '/system/permission', permission: 'system:permission' },
      { key: 'operation-log', label: '操作日志', path: '/system/operation-log', permission: 'system:operation_log' },
      { key: 'config', label: '系统配置', path: '/system/config', permission: 'system:config' },
    ],
  },
  {
    key: 'pos-pricing',
    label: 'POS与价格',
    icon: <CreditCard size={18} />,
    children: [
      // H2/H3：原为「不可达死路由」误判，实为真实功能，经 M3 单源注册后可达。
      // 迭代B RBAC 硬化：门禁码 pos:cashier / pricing:manage 已在 rbac.service 目录登记，
      // 由 store_manager 持有、super_admin 自动全有；菜单与路由均加门禁，无权限者不可见/不可访问。
      { key: 'pos-cashier', label: 'POS收银', path: '/pos/cashier', permission: 'pos:cashier' },
      { key: 'pricing', label: '价格管理', path: '/pricing', permission: 'pricing:manage' },
    ],
  },
];

/** 一级菜单（含 path，无 children）的 path -> icon */
const topLevelIconMap: Record<string, React.ReactNode> = {};
/** 二级菜单的 path -> icon（取所属一级菜单图标） */
const childIconMap: Record<string, React.ReactNode> = {};

for (const item of menuItems) {
  if (item.children) {
    for (const child of item.children) {
      childIconMap[child.path] = item.icon;
    }
  } else if (item.path) {
    topLevelIconMap[item.path] = item.icon;
  }
}

/** 兜底图标：菜单未覆盖的路径（如 /welcome、详情子路由） */
const fallbackIcon = <FileText size={14} />;

/**
 * 按页签路径取对应功能模块图标。
 * 详情页签路径形如 /sales/order/{id}，需按最长前缀回退到所属模块路径。
 */
export function getMenuIconByPath(path: string): React.ReactNode {
  if (!path) return fallbackIcon;
  if (topLevelIconMap[path]) return topLevelIconMap[path];
  if (childIconMap[path]) return childIconMap[path];

  const candidates = [...Object.keys(childIconMap), ...Object.keys(topLevelIconMap)].sort(
    (a, b) => b.length - a.length,
  );
  for (const p of candidates) {
    if (path === p || path.startsWith(p + '/')) {
      return childIconMap[p] ?? topLevelIconMap[p] ?? fallbackIcon;
    }
  }
  return fallbackIcon;
}

/* ============================================================================
 * 路由唯一真相源（M3）
 * ----------------------------------------------------------------------------
 * routeComponents 取代了原先 TabPageCache.exactMap / editPageMap / routePermissions
 * 与 app.tsx 约 80 个手写 <Route> 三处重复的硬编码。
 *   - component : 列表/详情页（懒加载）
 *   - permission: 访问所需权限码；缺省 = 登录即可
 *   - edit      : 编辑子路由 loader（new / :id/edit），存在即生成编辑路由
 * 新增页面：在下方登记一行即可，TabPageCache 与 app.tsx 自动派生。
 * 注意：orphan 路由（/bom、/purchase/order 等）虽不在 menuItems，但属真实页面
 *       （仅深链/编辑子路由可达），须保留以保证行为不回退。
 * ========================================================================== */

// —— 列表/详情页（懒加载）——
const DashboardPage = React.lazy(() => import('@client/src/pages/Dashboard/DashboardPage'));
const StylePage = React.lazy(() => import('@client/src/pages/base/StylePage'));
const SkuPage = React.lazy(() => import('@client/src/pages/base/SkuPage'));
const ColorGroupPage = React.lazy(() => import('@client/src/pages/base/ColorGroupPage'));
const SizeGroupPage = React.lazy(() => import('@client/src/pages/base/SizeGroupPage'));
const MaterialPage = React.lazy(() => import('@client/src/pages/base/MaterialPage'));
const MergeAuditPage = React.lazy(() => import('@client/src/pages/base/MergeAuditPage'));
const SupplierPage = React.lazy(() => import('@client/src/pages/base/SupplierPage'));
const WarehousePage = React.lazy(() => import('@client/src/pages/base/WarehousePage'));
const ProductImportPage = React.lazy(() => import('@client/src/pages/base/ProductImportPage'));
const StyleAttrDefPage = React.lazy(() => import('@client/src/pages/base/StyleAttrDefPage'));
const DealerPage = React.lazy(() => import('@client/src/pages/base/DealerPage'));
const StorePage = React.lazy(() => import('@client/src/pages/base/StorePage'));
const ColorPage = React.lazy(() => import('@client/src/pages/base/ColorPage'));
const SizePage = React.lazy(() => import('@client/src/pages/base/SizePage'));
const SizeGroupRelationPage = React.lazy(() => import('@client/src/pages/base/SizeGroupRelationPage'));
const BomPage = React.lazy(() => import('@client/src/pages/bom/BomPage'));
const CodeRulePage = React.lazy(() => import('@client/src/pages/system/CodeRulePage'));

const GarmentPurchaseOrderPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseOrderPage'));
const GarmentPurchaseInboundPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseInboundPage'));
const GarmentPurchaseReturnPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseReturnPage'));
const PurchaseOrderPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseOrderPage'));
const PurchaseInboundPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseInboundPage'));
const PurchaseReturnPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseReturnPage'));
const PurchaseReconciliationPage = React.lazy(() => import('@client/src/pages/purchase/ReconciliationPage'));

const ProductionBomPage = React.lazy(() => import('@client/src/pages/production/BomPage'));
const MaterialPurchaseOrderPage = React.lazy(() => import('@client/src/pages/production/MaterialPurchaseOrderPage'));
const MaterialPurchaseInboundPage = React.lazy(() => import('@client/src/pages/production/MaterialPurchaseInboundPage'));
const MrpPage = React.lazy(() => import('@client/src/pages/production/MrpPage'));
const ProductionCostPage = React.lazy(() => import('@client/src/pages/production/ProductionCostPage'));
const WorkOrderPage = React.lazy(() => import('@client/src/pages/production/WorkOrderPage'));
const MaterialIssuePage = React.lazy(() => import('@client/src/pages/production/MaterialIssuePage'));
const FinishReceiptPage = React.lazy(() => import('@client/src/pages/production/FinishReceiptPage'));

const SalesOrderPage = React.lazy(() => import('@client/src/pages/sales/SalesOrderPage'));
const SalesOutboundPage = React.lazy(() => import('@client/src/pages/sales/SalesOutboundPage'));
const SalesReturnPage = React.lazy(() => import('@client/src/pages/sales/SalesReturnPage'));
const SalesReconciliationPage = React.lazy(() => import('@client/src/pages/sales/ReconciliationPage'));

const RetailOrderPage = React.lazy(() => import('@client/src/pages/retail/RetailOrderPage'));
const RetailReturnPage = React.lazy(() => import('@client/src/pages/retail/RetailReturnPage'));
const RetailReportPage = React.lazy(() => import('@client/src/pages/retail/RetailReportPage'));

const InventoryQueryPage = React.lazy(() => import('@client/src/pages/inventory/InventoryQueryPage'));
const InventoryFlowPage = React.lazy(() => import('@client/src/pages/inventory/InventoryFlowPage'));
const InventoryInboundPage = React.lazy(() => import('@client/src/pages/inventory/InventoryInboundPage'));
const InventoryOutboundPage = React.lazy(() => import('@client/src/pages/inventory/InventoryOutboundPage'));
const InventoryTransferPage = React.lazy(() => import('@client/src/pages/inventory/InventoryTransferPage'));
const InventoryStocktakePage = React.lazy(() => import('@client/src/pages/inventory/InventoryStocktakePage'));
const InventoryWarningPage = React.lazy(() => import('@client/src/pages/inventory/InventoryWarningPage'));
const ReplenishSuggestionPage = React.lazy(() => import('@client/src/pages/inventory/ReplenishSuggestionPage'));
const ReplenishPlanPage = React.lazy(() => import('@client/src/pages/inventory/ReplenishPlanPage'));
const ReplenishTemplatePage = React.lazy(() => import('@client/src/pages/inventory/ReplenishTemplatePage'));
const BarcodePage = React.lazy(() => import('@client/src/pages/inventory/BarcodePage'));
const HangtagPrintPage = React.lazy(() => import('@client/src/pages/inventory/HangtagPrintPage'));
const UniqueCodeTracePage = React.lazy(() => import('@client/src/pages/inventory/UniqueCodeTracePage'));
const MobileStocktakePage = React.lazy(() => import('@client/src/pages/inventory/MobileStocktakePage'));

const SubcontractPage = React.lazy(() => import('@client/src/pages/subcontract/SubcontractPage'));
const ForecastPage = React.lazy(() => import('@client/src/pages/analytics/ForecastPage'));
const LifecyclePage = React.lazy(() => import('@client/src/pages/analytics/LifecyclePage'));
const BIPage = React.lazy(() => import('@client/src/pages/analytics/BIPage'));
const OmniPage = React.lazy(() => import('@client/src/pages/omni/OmniPage'));
const PosCashierPage = React.lazy(() => import('@client/src/pages/pos/CashierPage'));
const PricingPage = React.lazy(() => import('@client/src/pages/pricing/PriceListPage'));

const MemberPage = React.lazy(() => import('@client/src/pages/member/MemberPage'));
const MemberManagePage = React.lazy(() => import('@client/src/pages/member/MemberManagePage'));
const MemberLevelPage = React.lazy(() => import('@client/src/pages/member/MemberLevelPage'));
const MemberMergeAuditPage = React.lazy(() => import('@client/src/pages/member/MemberMergeAuditPage'));

const ReceivablePage = React.lazy(() => import('@client/src/pages/finance/ReceivablePage'));
const PayablePage = React.lazy(() => import('@client/src/pages/finance/PayablePage'));
const ReceiptPage = React.lazy(() => import('@client/src/pages/finance/ReceiptPage'));
const PaymentPage = React.lazy(() => import('@client/src/pages/finance/PaymentPage'));
const ProfitPage = React.lazy(() => import('@client/src/pages/finance/ProfitPage'));
const MonthClosePage = React.lazy(() => import('@client/src/pages/finance/MonthClosePage'));

const UserManagePage = React.lazy(() => import('@client/src/pages/system/UserManagePage'));
const RoleManagePage = React.lazy(() => import('@client/src/pages/system/RoleManagePage'));
const PermissionManagePage = React.lazy(() => import('@client/src/pages/system/PermissionManagePage'));
const OperationLogPage = React.lazy(() => import('@client/src/pages/system/OperationLogPage'));
const SystemConfigPage = React.lazy(() => import('@client/src/pages/system/SystemConfigPage'));

const TradeShowPage = React.lazy(() => import('@client/src/pages/trade-show/TradeShowPage'));
const PreOrderPage = React.lazy(() => import('@client/src/pages/trade-show/PreOrderPage'));
const PreOrderSummaryPage = React.lazy(() => import('@client/src/pages/trade-show/PreOrderSummaryPage'));
const AllocationPage = React.lazy(() => import('@client/src/pages/trade-show/AllocationPage'));
const ThemePage = React.lazy(() => import('@client/src/pages/trade-show/ThemePage'));

const PivotAnalysisPage = React.lazy(() => import('@client/src/pages/report/PivotAnalysisPage'));
const PivotSemanticAdminPage = React.lazy(() => import('@client/src/pages/report/PivotSemanticAdminPage'));
const GarmentPurchaseReportPage = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.GarmentPurchaseReportPage })));
const MaterialPurchaseReportPage = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.MaterialPurchaseReportPage })));
const SalesReportPageComp = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.SalesReportPage })));
const RetailReportPageComp = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.RetailReportPage })));
const InventoryReportPage = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.InventoryReportPage })));
const TransferReportPage = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.TransferReportPage })));
const StockMovementPage = React.lazy(() =>
  import('@client/src/pages/report').then((m) => ({ default: m.StockMovementPage })));

// —— 编辑子路由（懒加载）——
const GarmentPurchaseOrderEditPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseOrderEditPage'));
const GarmentPurchaseInboundEditPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseInboundEditPage'));
const GarmentPurchaseReturnEditPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseReturnEditPage'));
const PurchaseOrderEditPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseOrderEditPage'));
const PurchaseInboundEditPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseInboundEditPage'));
const PurchaseReturnEditPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseReturnEditPage'));
const MaterialPurchaseOrderEditPage = React.lazy(() => import('@client/src/pages/production/MaterialPurchaseOrderEditPage'));
const MaterialPurchaseInboundEditPage = React.lazy(() => import('@client/src/pages/production/MaterialPurchaseInboundEditPage'));
const WorkOrderEditPage = React.lazy(() => import('@client/src/pages/production/WorkOrderEditPage'));
const MaterialIssueEditPage = React.lazy(() => import('@client/src/pages/production/MaterialIssueEditPage'));
const FinishReceiptEditPage = React.lazy(() => import('@client/src/pages/production/FinishReceiptEditPage'));
const SalesOrderEditPage = React.lazy(() => import('@client/src/pages/sales/SalesOrderEditPage'));
const SalesOutboundEditPage = React.lazy(() => import('@client/src/pages/sales/SalesOutboundEditPage'));
const SalesReturnEditPage = React.lazy(() => import('@client/src/pages/sales/SalesReturnEditPage'));
const RetailOrderEditPage = React.lazy(() => import('@client/src/pages/retail/RetailOrderEditPage'));
const RetailReturnEditPage = React.lazy(() => import('@client/src/pages/retail/RetailReturnEditPage'));
const InventoryInboundEditPage = React.lazy(() => import('@client/src/pages/inventory/InventoryInboundEditPage'));
const InventoryOutboundEditPage = React.lazy(() => import('@client/src/pages/inventory/InventoryOutboundEditPage'));
const InventoryTransferEditPage = React.lazy(() => import('@client/src/pages/inventory/InventoryTransferEditPage'));
const InventoryStocktakeEditPage = React.lazy(() => import('@client/src/pages/inventory/InventoryStocktakeEditPage'));
const ReceiptEditPage = React.lazy(() => import('@client/src/pages/finance/ReceiptEditPage'));
const PaymentEditPage = React.lazy(() => import('@client/src/pages/finance/PaymentEditPage'));

export interface RouteEntry {
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  permission?: string;
  edit?: () => Promise<{ default: React.ComponentType<any> }>;
}

export const routeComponents: Record<string, RouteEntry> = {
  '/dashboard': { component: DashboardPage, permission: 'dashboard' },
  '/base/style': { component: StylePage, permission: 'base:style' },
  '/base/sku': { component: SkuPage, permission: 'base:sku' },
  '/base/color-group': { component: ColorGroupPage, permission: 'base:style' },
  '/base/size-group': { component: SizeGroupPage, permission: 'base:sku' },
  '/base/material': { component: MaterialPage, permission: 'base:material' },
  '/base/supplier': { component: SupplierPage, permission: 'base:supplier' },
  '/base/warehouse': { component: WarehousePage, permission: 'base:warehouse' },
  '/base/product-import': { component: ProductImportPage, permission: 'base:import' },
  '/base/style-attribute': { component: StyleAttrDefPage, permission: 'base:style' },
  '/base/dealer': { component: DealerPage, permission: 'base:dealer' },
  '/base/store': { component: StorePage, permission: 'base:store' },
  '/base/merge-audit': { component: MergeAuditPage, permission: 'md:merge' },
  '/product/code-rule': { component: CodeRulePage, permission: 'base:style' },
  '/product/color': { component: ColorPage, permission: 'base:color' },
  '/product/size': { component: SizePage, permission: 'base:size' },
  '/product/size-group-relation': { component: SizeGroupRelationPage, permission: 'base:size' },
  // orphan：legacy BOM 页（与 /production/bom 不同组件），仅深链可达
  '/bom': { component: BomPage, permission: 'base:material' },
  '/purchase/garment-order': { component: GarmentPurchaseOrderPage, permission: 'purchase:order', edit: () => import('@client/src/pages/purchase/GarmentPurchaseOrderEditPage') },
  '/purchase/garment-inbound': { component: GarmentPurchaseInboundPage, permission: 'purchase:inbound', edit: () => import('@client/src/pages/purchase/GarmentPurchaseInboundEditPage') },
  '/purchase/garment-return': { component: GarmentPurchaseReturnPage, permission: 'purchase:return', edit: () => import('@client/src/pages/purchase/GarmentPurchaseReturnEditPage') },
  '/production/bom': { component: ProductionBomPage, permission: 'production:bom' },
  '/production/material-purchase-order': { component: MaterialPurchaseOrderPage, permission: 'production:material_order', edit: () => import('@client/src/pages/production/MaterialPurchaseOrderEditPage') },
  '/production/material-purchase-inbound': { component: MaterialPurchaseInboundPage, permission: 'production:material_inbound', edit: () => import('@client/src/pages/production/MaterialPurchaseInboundEditPage') },
  '/production/mrp': { component: MrpPage, permission: 'production:mrp' },
  '/production/cost': { component: ProductionCostPage, permission: 'production:cost' },
  '/production/work-order': { component: WorkOrderPage, permission: 'production:work_order', edit: () => import('@client/src/pages/production/WorkOrderEditPage') },
  '/production/material-issue': { component: MaterialIssuePage, permission: 'production:material_issue', edit: () => import('@client/src/pages/production/MaterialIssueEditPage') },
  '/production/finish-receipt': { component: FinishReceiptPage, permission: 'production:finish_receipt', edit: () => import('@client/src/pages/production/FinishReceiptEditPage') },
  // orphan：面辅料采购订单/入库/退货（与 garment-* 不同组件），仅深链可达
  '/purchase/order': { component: PurchaseOrderPage, permission: 'purchase:order', edit: () => import('@client/src/pages/purchase/PurchaseOrderEditPage') },
  '/purchase/inbound': { component: PurchaseInboundPage, permission: 'purchase:inbound', edit: () => import('@client/src/pages/purchase/PurchaseInboundEditPage') },
  '/purchase/return': { component: PurchaseReturnPage, permission: 'purchase:return', edit: () => import('@client/src/pages/purchase/PurchaseReturnEditPage') },
  '/purchase/reconciliation': { component: PurchaseReconciliationPage, permission: 'purchase:reconciliation' },
  '/sales/order': { component: SalesOrderPage, permission: 'sales:order', edit: () => import('@client/src/pages/sales/SalesOrderEditPage') },
  '/sales/outbound': { component: SalesOutboundPage, permission: 'sales:outbound', edit: () => import('@client/src/pages/sales/SalesOutboundEditPage') },
  '/sales/return': { component: SalesReturnPage, permission: 'sales:return', edit: () => import('@client/src/pages/sales/SalesReturnEditPage') },
  '/sales/reconciliation': { component: SalesReconciliationPage, permission: 'sales:reconciliation' },
  '/retail/order': { component: RetailOrderPage, permission: 'sales:order', edit: () => import('@client/src/pages/retail/RetailOrderEditPage') },
  '/retail/return': { component: RetailReturnPage, permission: 'sales:return', edit: () => import('@client/src/pages/retail/RetailReturnEditPage') },
  '/retail/report': { component: RetailReportPage, permission: 'sales:order' },
  '/inventory/query': { component: InventoryQueryPage, permission: 'inventory:query' },
  '/inventory/flow': { component: InventoryFlowPage, permission: 'inventory:flow' },
  '/inventory/inbound': { component: InventoryInboundPage, permission: 'inventory:inbound', edit: () => import('@client/src/pages/inventory/InventoryInboundEditPage') },
  '/inventory/outbound': { component: InventoryOutboundPage, permission: 'inventory:outbound', edit: () => import('@client/src/pages/inventory/InventoryOutboundEditPage') },
  '/inventory/transfer': { component: InventoryTransferPage, permission: 'inventory:transfer', edit: () => import('@client/src/pages/inventory/InventoryTransferEditPage') },
  '/inventory/stocktake': { component: InventoryStocktakePage, permission: 'inventory:stocktake', edit: () => import('@client/src/pages/inventory/InventoryStocktakeEditPage') },
  '/inventory/warning': { component: InventoryWarningPage, permission: 'inventory:warning' },
  '/inventory/replenish': { component: ReplenishSuggestionPage, permission: 'inventory:warning' },
  '/inventory/replenish-plan': { component: ReplenishPlanPage, permission: 'inventory:replenish-plan' },
  '/inventory/replenish-template': { component: ReplenishTemplatePage, permission: 'inventory:replenish-template' },
  '/inventory/barcode': { component: BarcodePage, permission: 'inventory:query' },
  '/inventory/mobile-stocktake': { component: MobileStocktakePage, permission: 'inventory:stocktake' },
  // orphan：吊牌打印 / 唯一码溯源，仅深链可达
  '/inventory/hangtag-print': { component: HangtagPrintPage, permission: 'inventory:query' },
  '/inventory/unique-code-trace': { component: UniqueCodeTracePage, permission: 'inventory:query' },
  '/subcontract': { component: SubcontractPage, permission: 'inventory:query' },
  '/analytics/forecast': { component: ForecastPage, permission: 'dashboard:view' },
  '/analytics/lifecycle': { component: LifecyclePage, permission: 'dashboard:view' },
  '/analytics/bi': { component: BIPage, permission: 'dashboard:view' },
  '/omni': { component: OmniPage, permission: 'omni:manage' },
  // H2：POS收银 —— 门禁 pos:cashier（store_manager 持有，super_admin 自动全有）
  '/pos/cashier': { component: PosCashierPage, permission: 'pos:cashier' },
  // H3：价格管理 —— 门禁 pricing:manage
  '/pricing': { component: PricingPage, permission: 'pricing:manage' },
  '/member': { component: MemberPage, permission: 'retail:view' },
  '/member/manage': { component: MemberManagePage, permission: 'member:manage' },
  '/member/level': { component: MemberLevelPage, permission: 'member:level' },
  '/base/member-merge-audit': { component: MemberMergeAuditPage, permission: 'member:merge' },
  '/finance/receivable': { component: ReceivablePage, permission: 'finance:receivable' },
  '/finance/payable': { component: PayablePage, permission: 'finance:payable' },
  '/finance/receipt': { component: ReceiptPage, permission: 'finance:receipt', edit: () => import('@client/src/pages/finance/ReceiptEditPage') },
  '/finance/payment': { component: PaymentPage, permission: 'finance:payment', edit: () => import('@client/src/pages/finance/PaymentEditPage') },
  '/finance/profit': { component: ProfitPage, permission: 'finance:profit' },
  '/finance/month-close': { component: MonthClosePage, permission: 'finance:profit' },
  '/system/user': { component: UserManagePage, permission: 'system:user' },
  '/system/role': { component: RoleManagePage, permission: 'system:role' },
  '/system/permission': { component: PermissionManagePage, permission: 'system:permission' },
  '/system/operation-log': { component: OperationLogPage, permission: 'system:operation_log' },
  '/system/config': { component: SystemConfigPage, permission: 'system:config' },
  '/trade-show/theme': { component: ThemePage, permission: 'tradeshow:theme' },
  '/trade-show/list': { component: TradeShowPage, permission: 'tradeshow:preorder' },
  '/trade-show/pre-order': { component: PreOrderPage, permission: 'tradeshow:preorder' },
  '/trade-show/summary': { component: PreOrderSummaryPage, permission: 'tradeshow:preorder' },
  '/trade-show/allocation': { component: AllocationPage, permission: 'tradeshow:allocation' },
  '/report/garment-purchase': { component: GarmentPurchaseReportPage, permission: 'report:garment_purchase' },
  '/report/material-purchase': { component: MaterialPurchaseReportPage, permission: 'report:material_purchase' },
  '/report/sales': { component: SalesReportPageComp, permission: 'report:sales' },
  '/report/retail': { component: RetailReportPageComp, permission: 'report:retail' },
  '/report/inventory': { component: InventoryReportPage, permission: 'report:inventory' },
  '/report/transfer': { component: TransferReportPage, permission: 'report:transfer' },
  '/report/stock-movement': { component: StockMovementPage, permission: 'report:stockmovement' },
  '/report/pivot': { component: PivotAnalysisPage, permission: 'report:pivot' },
  // 语义层管理用 system:config（配置权限）而非 report:pivot（使用权限）：
  // 能查数≠ 能改全局口径，后者只应给管理员/实施。菜单项挂在系统配置下同此口径。
  '/report/pivot/semantics': { component: PivotSemanticAdminPage, permission: 'system:config' },
};

/** path -> 列表/详情组件（TabPageCache 渲染用） */
export const exactMap: Record<string, React.ComponentType<any>> = Object.fromEntries(
  Object.entries(routeComponents)
    .filter(([, v]) => v.component)
    .map(([k, v]) => [k, v.component as React.ComponentType<any>]),
);

/** 列表路径前缀 -> 编辑页 loader（TabPageCache 编辑子路由用） */
export const editPageMap: Record<string, () => Promise<{ default: React.ComponentType<any> }>> = Object.fromEntries(
  Object.entries(routeComponents)
    .filter(([, v]) => v.edit)
    .map(([k, v]) => [k + '/', v.edit as () => Promise<{ default: React.ComponentType<any> }>]),
);

/** path -> 权限码（TabPageCache 渲染鉴权用） */
export const routePermissions: Record<string, string> = Object.fromEntries(
  Object.entries(routeComponents)
    .filter(([, v]) => v.permission)
    .map(([k, v]) => [k, v.permission as string]),
);

/**
 * path -> 页签标题（替代 TabsContext 内第四套硬编码标签，迭代A 收口）。
 * 单一真相源：优先取 menuItems（与菜单、路由同源，杜绝漂移）；
 * 再补 routeComponents 有但菜单无的 orphan 路由标签（routeComponents 无 label 概念，需显式声明）。
 * 副作用：/base/warehouse 由此自动归一为菜单权威值「仓库管理」（消旧硬编码「仓库档案」漂移）；
 * 另自动补上旧 map 漏接的 /base/product-import、/inventory/hangtag-print、/inventory/unique-code-trace。
 */
export const menuLabelMap: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const collect = (items: MenuItem[]) => {
    for (const it of items) {
      if (it.path) m[it.path] = it.label;
      if (it.children) collect(it.children as MenuItem[]);
    }
  };
  collect(menuItems);
  // orphan 路由（仅深链可达，菜单未登记）：routeComponents 有组件但无 label，须显式声明
  Object.assign(m, {
    '/bom': 'BOM管理',
    '/purchase/order': '面辅料采购订单',
    '/purchase/inbound': '面辅料采购入库',
    '/purchase/return': '面辅料采购退货',
  });
  return m;
})();

/**
 * 路由-菜单一致性自检（仅开发期执行）。
 * - 错误：菜单 path 在 routeComponents 缺失组件 → 点击将渲染 <NotFound/>（回归阻断级）
 * - 告警：routeComponents 有但菜单无 → 孤儿路由（仅深链可达，保留但提示漂移）
 */
export function validateRouteMenuConsistency(): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const menuPaths = new Set<string>();
  const collect = (items: MenuItem[]) => {
    for (const it of items) {
      if (it.path) menuPaths.add(it.path);
      if (it.children) collect(it.children as MenuItem[]);
    }
  };
  collect(menuItems);

  for (const p of menuPaths) {
    const entry = routeComponents[p];
    if (!entry || !entry.component) {
      errors.push(`菜单路径 ${p} 在 routeComponents 中缺失组件（点击将渲染 <NotFound/>）`);
    }
  }
  for (const p of Object.keys(routeComponents)) {
    if (!menuPaths.has(p)) {
      warnings.push(`路由 ${p} 无对应菜单项（孤儿路由，不影响可达性）`);
    }
  }
  return { errors, warnings };
}

const DEV = (import.meta as any).env?.DEV;
if (DEV) {
  const { errors, warnings } = validateRouteMenuConsistency();
  warnings.forEach((w) => console.warn('[route-registry] ' + w));
  if (errors.length) {
    console.error('[route-registry] 路由-菜单一致性错误:\n' + errors.join('\n'));
  }
}
