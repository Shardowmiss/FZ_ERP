import React from 'react';
import { MENU_STRUCTURE, buildPermissionCatalog } from '@shared/menu-permission';
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

const MODULE_ICONS: Record<string, React.ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  product: <NotebookPen size={18} />,
  channel: <Truck size={18} />,
  purchase: <ShoppingCart size={18} />,
  production: <Factory size={18} />,
  sales: <ShoppingBag size={18} />,
  inventory: <Package size={18} />,
  'channel-replenish': <Truck size={18} />,
  finance: <DollarSign size={18} />,
  report: <BarChart3 size={18} />,
  'trade-show': <CalendarDays size={18} />,
  member: <Users size={18} />,
  'data-governance': <ArrowLeftRight size={18} />,
  system: <Settings size={18} />,
  'pos-pricing': <CreditCard size={18} />,
  'distribution-portal': <ArrowLeftRight size={18} />,
};

/**
 * 菜单项由共享单一真相源 MENU_STRUCTURE（见 shared/menu-permission.ts）派生，仅在此注入 lucide 图标。
 * 菜单增删子项 → 侧栏、路由门禁、权限目录同步更新，无需双份维护（消除「散乱」与漂移）。
 */
export const menuItems: MenuItem[] = MENU_STRUCTURE.map((mod) => ({
  key: mod.key,
  label: mod.label,
  icon: MODULE_ICONS[mod.key] ?? <FileText size={18} />,
  ...(mod.path ? { path: mod.path } : {}),
  ...(mod.children.length
    ? {
        children: mod.children.map((c) => ({
          key: c.key,
          label: c.label,
          path: c.path,
          ...(c.permission ? { permission: c.permission } : {}),
        })),
      }
    : {}),
}));


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
const DistributionPortalPage = React.lazy(() => import('@client/src/pages/distribution/DistributionPortalPage'));
const MyPurchaseOrdersPage = React.lazy(() => import('@client/src/pages/distribution/MyPurchaseOrdersPage'));
const MyPurchaseReturnsPage = React.lazy(() => import('@client/src/pages/distribution/MyPurchaseReturnsPage'));
const PortalReconciliationPage = React.lazy(() => import('@client/src/pages/distribution/PortalReconciliationPage'));
const MyPartnersPage = React.lazy(() => import('@client/src/pages/distribution/MyPartnersPage'));

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
  '/dashboard': { component: DashboardPage, permission: 'dashboard:view' },
  '/base/style': { component: StylePage, permission: 'base:style' },
  '/base/sku': { component: SkuPage, permission: 'base:sku' },
  '/base/color-group': { component: ColorGroupPage, permission: 'base:color-group' },
  '/base/size-group': { component: SizeGroupPage, permission: 'base:size-group' },
  '/base/material': { component: MaterialPage, permission: 'base:material' },
  '/base/supplier': { component: SupplierPage, permission: 'base:supplier' },
  // /base/warehouse 已下线：仓库管理模块不存在（无菜单入口），仓库维护随「店仓合一」
  // 归入 /base/store（base:store）。仓库实体仍被入库/出库/调拨页面作为下拉使用
  // （GET /api/base/warehouse/options），不依赖权限码，故下线路由不影响这些页面。
  '/base/product-import': { component: ProductImportPage, permission: 'base:import' },
  '/base/style-attribute': { component: StyleAttrDefPage, permission: 'base:style-attribute' },
  '/base/dealer': { component: DealerPage, permission: 'base:dealer' },
  '/base/store': { component: StorePage, permission: 'base:store' },
  '/base/merge-audit': { component: MergeAuditPage, permission: 'md:merge' },
  '/product/code-rule': { component: CodeRulePage, permission: 'base:code-rule' },
  '/product/color': { component: ColorPage, permission: 'base:color' },
  '/product/size': { component: SizePage, permission: 'base:size' },
  '/product/size-group-relation': { component: SizeGroupRelationPage, permission: 'base:size-group' },
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
  '/retail/order': { component: RetailOrderPage, permission: 'sales:retail', edit: () => import('@client/src/pages/retail/RetailOrderEditPage') },
  '/retail/return': { component: RetailReturnPage, permission: 'sales:retail_return', edit: () => import('@client/src/pages/retail/RetailReturnEditPage') },
  '/retail/report': { component: RetailReportPage, permission: 'report:retail_report' },
  '/inventory/query': { component: InventoryQueryPage, permission: 'inventory:query' },
  '/inventory/flow': { component: InventoryFlowPage, permission: 'inventory:flow' },
  '/inventory/inbound': { component: InventoryInboundPage, permission: 'inventory:inbound', edit: () => import('@client/src/pages/inventory/InventoryInboundEditPage') },
  '/inventory/outbound': { component: InventoryOutboundPage, permission: 'inventory:outbound', edit: () => import('@client/src/pages/inventory/InventoryOutboundEditPage') },
  '/inventory/transfer': { component: InventoryTransferPage, permission: 'inventory:transfer', edit: () => import('@client/src/pages/inventory/InventoryTransferEditPage') },
  '/inventory/stocktake': { component: InventoryStocktakePage, permission: 'inventory:stocktake', edit: () => import('@client/src/pages/inventory/InventoryStocktakeEditPage') },
  '/inventory/warning': { component: InventoryWarningPage, permission: 'inventory:warning' },
  '/inventory/replenish': { component: ReplenishSuggestionPage, permission: 'inventory:replenish' },
  '/inventory/replenish-plan': { component: ReplenishPlanPage, permission: 'inventory:replenish-plan' },
  '/inventory/replenish-template': { component: ReplenishTemplatePage, permission: 'inventory:replenish-template' },
  '/inventory/barcode': { component: BarcodePage, permission: 'inventory:barcode' },
  '/inventory/mobile-stocktake': { component: MobileStocktakePage, permission: 'inventory:stocktake_mobile' },
  // orphan：吊牌打印 / 唯一码溯源，仅深链可达（吊牌打印使用独立码 inventory:hangtag）
  '/inventory/hangtag-print': { component: HangtagPrintPage, permission: 'inventory:hangtag' },
  '/inventory/unique-code-trace': { component: UniqueCodeTracePage, permission: 'inventory:unique_code' },
  // 委外管理：后端守卫为 subcontract:manage，此前路由错挂 inventory:query（页面能进、接口 403）
  '/subcontract': { component: SubcontractPage, permission: 'subcontract:manage' },
  '/analytics/forecast': { component: ForecastPage, permission: 'analytics:forecast' },
  '/analytics/lifecycle': { component: LifecyclePage, permission: 'analytics:lifecycle' },
  '/analytics/bi': { component: BIPage, permission: 'analytics:bi' },
  '/omni': { component: OmniPage, permission: 'omni:manage' },
  // H2：POS收银 —— 门禁 pos:cashier（store_manager 持有，super_admin 自动全有）
  '/pos/cashier': { component: PosCashierPage, permission: 'pos:cashier' },
  // H3：价格管理 —— 门禁 pricing:manage
  '/pricing': { component: PricingPage, permission: 'pricing:manage' },
  // —— 分销门户（经销商视角：我的采购单/退货单/对账/节点，数据按 rbac_user_partner 子树隔离）——
  '/distribution/portal': { component: DistributionPortalPage, permission: 'distribution:portal_overview' },
  '/distribution/portal/purchase-orders': { component: MyPurchaseOrdersPage, permission: 'distribution:portal_po' },
  '/distribution/portal/purchase-returns': { component: MyPurchaseReturnsPage, permission: 'distribution:portal_pr' },
  '/distribution/portal/reconciliation': { component: PortalReconciliationPage, permission: 'distribution:portal_recon' },
  '/distribution/portal/partners': { component: MyPartnersPage, permission: 'distribution:portal_partners' },
  '/member': { component: MemberPage, permission: 'member:manage' },
  '/member/manage': { component: MemberManagePage, permission: 'member:manage' },
  '/member/level': { component: MemberLevelPage, permission: 'member:level' },
  '/base/member-merge-audit': { component: MemberMergeAuditPage, permission: 'member:merge' },
  '/finance/receivable': { component: ReceivablePage, permission: 'finance:receivable' },
  '/finance/payable': { component: PayablePage, permission: 'finance:payable' },
  '/finance/receipt': { component: ReceiptPage, permission: 'finance:receipt', edit: () => import('@client/src/pages/finance/ReceiptEditPage') },
  '/finance/payment': { component: PaymentPage, permission: 'finance:payment', edit: () => import('@client/src/pages/finance/PaymentEditPage') },
  '/finance/profit': { component: ProfitPage, permission: 'finance:profit' },
  '/finance/month-close': { component: MonthClosePage, permission: 'finance:month_close' },
  '/system/user': { component: UserManagePage, permission: 'system:user' },
  '/system/role': { component: RoleManagePage, permission: 'system:role' },
  '/system/permission': { component: PermissionManagePage, permission: 'system:permission' },
  '/system/operation-log': { component: OperationLogPage, permission: 'system:operation_log' },
  '/system/config': { component: SystemConfigPage, permission: 'system:config' },
  '/trade-show/theme': { component: ThemePage, permission: 'tradeshow:theme' },
  '/trade-show/list': { component: TradeShowPage, permission: 'tradeshow:manage' },
  '/trade-show/pre-order': { component: PreOrderPage, permission: 'tradeshow:preorder' },
  '/trade-show/summary': { component: PreOrderSummaryPage, permission: 'tradeshow:preorder' },
  '/trade-show/allocation': { component: AllocationPage, permission: 'tradeshow:allocation' },
  '/report/garment-purchase': { component: GarmentPurchaseReportPage, permission: 'report:purchase' },
  '/report/material-purchase': { component: MaterialPurchaseReportPage, permission: 'report:purchase' },
  '/report/sales': { component: SalesReportPageComp, permission: 'report:sales' },
  '/report/retail': { component: RetailReportPageComp, permission: 'report:retail' },
  '/report/inventory': { component: InventoryReportPage, permission: 'report:inventory' },
  '/report/transfer': { component: TransferReportPage, permission: 'report:transfer' },
  '/report/stock-movement': { component: StockMovementPage, permission: 'report:stockmovement' },
  '/report/pivot': { component: PivotAnalysisPage, permission: 'report:pivot' },
  // 语义层管理用 system:config（配置权限）而非 report:pivot（使用权限）：
  // 能查数≠ 能改全局口径，后者只应给管理员/实施。菜单项挂在系统配置下同此口径。
  '/report/pivot/semantics': { component: PivotSemanticAdminPage, permission: 'report:semantic' },
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
 * 说明：/base/warehouse 已随仓库管理模块下线移除。
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
 * - 错误：routeComponents 声明的权限码不在权威权限目录中 → 权限树无法授权该码，
 *         门禁将永久拒绝（页面对任何人都不可达）。这类漂移只能靠此自检兜住。
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

  // 权限码一致性：路由声明的资源码必须存在于 buildPermissionCatalog() 的输出，
  // 否则权限树里根本没有这个节点、角色无从勾选 → 页面永远打不开。
  const catalogCodes = new Set(buildPermissionCatalog().map((e) => e.code));
  const seen = new Set<string>();
  for (const [p, entry] of Object.entries(routeComponents)) {
    const perm = entry.permission;
    if (!perm || seen.has(perm)) continue;
    seen.add(perm);
    if (!catalogCodes.has(perm)) {
      errors.push(
        `路由 ${p} 声明的权限码 ${perm} 不在权限目录（MENU_STRUCTURE/EXTRA_PERMISSIONS）中，` +
          `权限树无法授权该码 → 门禁永久拒绝`,
      );
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
