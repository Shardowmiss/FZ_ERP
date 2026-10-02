import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabs, getTabInfoFromPath } from '@client/src/contexts/TabsContext';
import { useAuth } from '@client/src/contexts/AuthContext';
import { computeKeepAliveKeys, DEFAULT_MAX_KEEP_ALIVE } from './keepAliveStrategy';

import DashboardPage from '@client/src/pages/Dashboard/DashboardPage';
import WelcomePage from '@client/src/pages/Welcome/WelcomePage';

const StylePage = React.lazy(() => import('@client/src/pages/base/StylePage'));
const SkuPage = React.lazy(() => import('@client/src/pages/base/SkuPage'));
const ColorGroupPage = React.lazy(() => import('@client/src/pages/base/ColorGroupPage'));
const SizeGroupPage = React.lazy(() => import('@client/src/pages/base/SizeGroupPage'));
const MaterialPage = React.lazy(() => import('@client/src/pages/base/MaterialPage'));
const CustomerPage = React.lazy(() => import('@client/src/pages/base/CustomerPage'));
const MergeAuditPage = React.lazy(() => import('@client/src/pages/base/MergeAuditPage'));
const SupplierPage = React.lazy(() => import('@client/src/pages/base/SupplierPage'));
const WarehousePage = React.lazy(() => import('@client/src/pages/base/WarehousePage'));
const StyleAttrDefPage = React.lazy(() => import('@client/src/pages/base/StyleAttrDefPage'));
const DealerPage = React.lazy(() => import('@client/src/pages/base/DealerPage'));
const StorePage = React.lazy(() => import('@client/src/pages/base/StorePage'));
const BomPage = React.lazy(() => import('@client/src/pages/bom/BomPage'));
const GarmentPurchaseOrderPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseOrderPage'));
const GarmentPurchaseInboundPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseInboundPage'));
const GarmentPurchaseReturnPage = React.lazy(() => import('@client/src/pages/purchase/GarmentPurchaseReturnPage'));
const PurchaseOrderPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseOrderPage'));
const PurchaseInboundPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseInboundPage'));
const PurchaseReturnPage = React.lazy(() => import('@client/src/pages/purchase/PurchaseReturnPage'));
const ReconciliationPage = React.lazy(() => import('@client/src/pages/purchase/ReconciliationPage'));
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
const ReceivablePage = React.lazy(() => import('@client/src/pages/finance/ReceivablePage'));
const PayablePage = React.lazy(() => import('@client/src/pages/finance/PayablePage'));
const ReceiptPage = React.lazy(() => import('@client/src/pages/finance/ReceiptPage'));
const PaymentPage = React.lazy(() => import('@client/src/pages/finance/PaymentPage'));
const ProfitPage = React.lazy(() => import('@client/src/pages/finance/ProfitPage'));
const MonthClosePage = React.lazy(() => import('@client/src/pages/finance/MonthClosePage'));

const NotFound = React.lazy(() => import('@client/src/pages/NotFound/NotFound'));

// 孤儿页面补接：菜单/路由已注册，但 exactMap 漏接会导致点菜单渲染 <NotFound/>。
// 下列组件均为真实已构建页面，与 app.tsx 的 <Route> 一一对应（三处同步原则）。
const ColorPage = React.lazy(() => import('@client/src/pages/base/ColorPage'));
const SizePage = React.lazy(() => import('@client/src/pages/base/SizePage'));
const SizeGroupRelationPage = React.lazy(() => import('@client/src/pages/base/SizeGroupRelationPage'));
const ReplenishSuggestionPage = React.lazy(() => import('@client/src/pages/inventory/ReplenishSuggestionPage'));
const ReplenishPlanPage = React.lazy(() => import('@client/src/pages/inventory/ReplenishPlanPage'));
const ReplenishTemplatePage = React.lazy(() => import('@client/src/pages/inventory/ReplenishTemplatePage'));
const BarcodePage = React.lazy(() => import('@client/src/pages/inventory/BarcodePage'));
const MobileStocktakePage = React.lazy(() => import('@client/src/pages/inventory/MobileStocktakePage'));
const SubcontractPage = React.lazy(() => import('@client/src/pages/subcontract/SubcontractPage'));
const ForecastPage = React.lazy(() => import('@client/src/pages/analytics/ForecastPage'));
const LifecyclePage = React.lazy(() => import('@client/src/pages/analytics/LifecyclePage'));
const BIPage = React.lazy(() => import('@client/src/pages/analytics/BIPage'));
const MobileDashboardPage = React.lazy(() => import('@client/src/pages/analytics/MobileDashboardPage'));
const OmniPage = React.lazy(() => import('@client/src/pages/omni/OmniPage'));
const MemberPage = React.lazy(() => import('@client/src/pages/member/MemberPage'));
const MemberMergeAuditPage = React.lazy(() => import('@client/src/pages/member/MemberMergeAuditPage'));

const CodeRulePage = React.lazy(() => import('@client/src/pages/system/CodeRulePage'));
const UserManagePage = React.lazy(() => import('@client/src/pages/system/UserManagePage'));
const RoleManagePage = React.lazy(() => import('@client/src/pages/system/RoleManagePage'));
const PermissionManagePage = React.lazy(() => import('@client/src/pages/system/PermissionManagePage'));
const OperationLogPage = React.lazy(() => import('@client/src/pages/system/OperationLogPage'));
const SystemConfigPage = React.lazy(() => import('@client/src/pages/system/SystemConfigPage'));
const TradeShowPage = React.lazy(() => import('@client/src/pages/trade-show/TradeShowPage'));
const PreOrderPage = React.lazy(() => import('@client/src/pages/trade-show/PreOrderPage'));
const PreOrderSummaryPage = React.lazy(() => import('@client/src/pages/trade-show/PreOrderSummaryPage'));
const AllocationPage = React.lazy(() => import('@client/src/pages/trade-show/AllocationPage'));
const PivotAnalysisPage = React.lazy(() => import('@client/src/pages/report/PivotAnalysisPage'));
const GarmentPurchaseReportPage = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.GarmentPurchaseReportPage })),
);
const MaterialPurchaseReportPage = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.MaterialPurchaseReportPage })),
);
const SalesReportPage = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.SalesReportPage })),
);
const RetailReportPageComp = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.RetailReportPage })),
);
const InventoryReportPage = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.InventoryReportPage })),
);
const TransferReportPage = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.TransferReportPage })),
);
const StockMovementPage = React.lazy(() =>
  import('@client/src/pages/report').then(m => ({ default: m.StockMovementPage })),
);

const routePermissions: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/base/style': 'base:style',
  '/base/sku': 'base:sku',
  '/base/color-group': 'base:style',
  '/base/size-group': 'base:sku',
  '/base/material': 'base:material',
  '/base/customer': 'base:customer',
  '/base/merge-audit': 'md:merge',
  '/base/supplier': 'base:supplier',
  '/base/warehouse': 'base:warehouse',
  '/base/style-attribute': 'base:style',
  '/base/dealer': 'base:dealer',
  '/base/store': 'base:store',
  '/bom': 'base:material',
  '/production/bom': 'production:bom',
  '/purchase/order': 'purchase:order',
  '/purchase/inbound': 'purchase:inbound',
  '/purchase/return': 'purchase:return',
  '/purchase/garment-order': 'purchase:order',
  '/purchase/garment-inbound': 'purchase:inbound',
  '/purchase/garment-return': 'purchase:return',
  '/purchase/reconciliation': 'purchase:reconciliation',
  '/production/material-purchase-order': 'production:material_order',
  '/production/material-purchase-inbound': 'production:material_inbound',
  '/production/mrp': 'production:mrp',
  '/production/cost': 'production:cost',
  '/production/work-order': 'production:work_order',
  '/production/material-issue': 'production:material_issue',
  '/production/finish-receipt': 'production:finish_receipt',
  '/sales/order': 'sales:order',
  '/sales/outbound': 'sales:outbound',
  '/sales/return': 'sales:return',
  '/sales/reconciliation': 'sales:reconciliation',
  '/retail/order': 'sales:order',
  '/retail/return': 'sales:return',
  '/retail/report': 'sales:order',
  '/inventory/query': 'inventory:query',
  '/inventory/flow': 'inventory:flow',
  '/inventory/inbound': 'inventory:inbound',
  '/inventory/outbound': 'inventory:outbound',
  '/inventory/transfer': 'inventory:transfer',
  '/inventory/stocktake': 'inventory:stocktake',
  '/inventory/warning': 'inventory:warning',
  '/inventory/replenish-plan': 'inventory:replenish-plan',
  '/inventory/replenish-template': 'inventory:replenish-template',
  '/finance/receivable': 'finance:receivable',
  '/finance/payable': 'finance:payable',
  '/finance/receipt': 'finance:receipt',
  '/finance/payment': 'finance:payment',
  '/finance/profit': 'finance:profit',
  '/finance/month-close': 'finance:profit',
  '/system/code-rule': 'system:permission',
  '/system/user': 'system:user',
  '/system/role': 'system:role',
  '/system/permission': 'system:permission',
  '/system/operation-log': 'system:operation_log',
  '/system/config': 'system:config',
  '/trade-show/list': 'tradeshow:preorder',
  '/trade-show/pre-order': 'tradeshow:preorder',
  '/trade-show/summary': 'tradeshow:preorder',
  '/trade-show/allocation': 'tradeshow:allocation',
  '/report/garment-purchase': 'report:garment_purchase',
  '/report/material-purchase': 'report:material_purchase',
  '/report/sales': 'report:sales',
  '/report/retail': 'report:retail',
  '/report/inventory': 'report:inventory',
  '/report/transfer': 'report:transfer',
  '/report/stock-movement': 'report:stockmovement',
  '/report/pivot': 'report:pivot',
  '/product/color': 'base:color',
  '/product/size': 'base:size',
  '/product/size-group-relation': 'base:size',
  '/product/code-rule': 'system:permission',
  '/inventory/replenish': 'inventory:warning',
  '/inventory/barcode': 'inventory:query',
  '/inventory/mobile-stocktake': 'inventory:stocktake',
  '/subcontract': 'inventory:query',
  '/analytics/forecast': 'dashboard:view',
  '/analytics/lifecycle': 'dashboard:view',
  '/analytics/bi': 'dashboard:view',
  '/omni': 'sales:view',
  '/member': 'retail:view',
  '/base/member-merge-audit': 'member:merge',
};

function getPermissionForPath(pathname: string): string | null {
  for (const [p, perm] of Object.entries(routePermissions).sort((a, b) => b[0].length - a[0].length)) {
    if (pathname === p || pathname.startsWith(p + '/')) {
      return perm;
    }
  }
  return null;
}

function getRouteComponent(pathname: string): React.ComponentType | null {
  const exactMap: Record<string, React.ComponentType> = {
    '/dashboard': DashboardPage,
    '/base/style': StylePage,
    '/base/sku': SkuPage,
    '/base/color-group': ColorGroupPage,
    '/base/size-group': SizeGroupPage,
    '/base/material': MaterialPage,
    '/base/supplier': SupplierPage,
    '/base/warehouse': WarehousePage,
    '/base/style-attribute': StyleAttrDefPage,
    '/base/dealer': DealerPage,
    '/base/store': StorePage,
    '/base/customer': CustomerPage,
    '/base/merge-audit': MergeAuditPage,
    '/bom': BomPage,
    '/production/bom': ProductionBomPage,
    '/purchase/order': PurchaseOrderPage,
    '/purchase/inbound': PurchaseInboundPage,
    '/purchase/return': PurchaseReturnPage,
    '/purchase/garment-order': GarmentPurchaseOrderPage,
    '/purchase/garment-inbound': GarmentPurchaseInboundPage,
    '/purchase/garment-return': GarmentPurchaseReturnPage,
    '/purchase/reconciliation': ReconciliationPage,
    '/production/material-purchase-order': MaterialPurchaseOrderPage,
    '/production/material-purchase-inbound': MaterialPurchaseInboundPage,
    '/production/mrp': MrpPage,
    '/production/cost': ProductionCostPage,
    '/production/work-order': WorkOrderPage,
    '/production/material-issue': MaterialIssuePage,
    '/production/finish-receipt': FinishReceiptPage,
    '/sales/order': SalesOrderPage,
    '/sales/outbound': SalesOutboundPage,
    '/sales/return': SalesReturnPage,
    '/sales/reconciliation': SalesReconciliationPage,
    '/retail/order': RetailOrderPage,
    '/retail/return': RetailReturnPage,
    '/retail/report': RetailReportPage,
    '/inventory/query': InventoryQueryPage,
    '/inventory/flow': InventoryFlowPage,
    '/inventory/inbound': InventoryInboundPage,
    '/inventory/outbound': InventoryOutboundPage,
    '/inventory/transfer': InventoryTransferPage,
    '/inventory/stocktake': InventoryStocktakePage,
    '/inventory/warning': InventoryWarningPage,
    '/finance/receivable': ReceivablePage,
    '/finance/payable': PayablePage,
    '/finance/receipt': ReceiptPage,
    '/finance/payment': PaymentPage,
    '/finance/profit': ProfitPage,
    '/finance/month-close': MonthClosePage,
    '/system/code-rule': CodeRulePage,
    '/system/user': UserManagePage,
    '/system/role': RoleManagePage,
    '/system/permission': PermissionManagePage,
    '/system/operation-log': OperationLogPage,
    '/system/config': SystemConfigPage,
    '/trade-show/list': TradeShowPage,
    '/trade-show/pre-order': PreOrderPage,
    '/trade-show/summary': PreOrderSummaryPage,
    '/trade-show/allocation': AllocationPage,
    '/report/pivot': PivotAnalysisPage,
    '/report/garment-purchase': GarmentPurchaseReportPage,
    '/report/material-purchase': MaterialPurchaseReportPage,
    '/report/sales': SalesReportPage,
    '/report/retail': RetailReportPageComp,
    '/report/inventory': InventoryReportPage,
    '/report/transfer': TransferReportPage,
    '/report/stock-movement': StockMovementPage,
    '/product/color': ColorPage,
    '/product/size': SizePage,
    '/product/size-group-relation': SizeGroupRelationPage,
    '/product/code-rule': CodeRulePage,
    '/inventory/replenish': ReplenishSuggestionPage,
    '/inventory/replenish-plan': ReplenishPlanPage,
    '/inventory/replenish-template': ReplenishTemplatePage,
    '/inventory/barcode': BarcodePage,
    '/inventory/mobile-stocktake': MobileStocktakePage,
    '/subcontract': SubcontractPage,
    '/analytics/forecast': ForecastPage,
    '/analytics/lifecycle': LifecyclePage,
    '/analytics/bi': BIPage,
    '/analytics/mobile-dashboard': MobileDashboardPage,
    '/omni': OmniPage,
    '/member': MemberPage,
    '/base/member-merge-audit': MemberMergeAuditPage,
  };

  const editPageMap: Record<string, () => Promise<{ default: React.ComponentType }>> = {
    '/purchase/order/': () => import('@client/src/pages/purchase/PurchaseOrderEditPage'),
    '/purchase/inbound/': () => import('@client/src/pages/purchase/PurchaseInboundEditPage'),
    '/purchase/return/': () => import('@client/src/pages/purchase/PurchaseReturnEditPage'),
    '/purchase/garment-order/': () => import('@client/src/pages/purchase/GarmentPurchaseOrderEditPage'),
    '/purchase/garment-inbound/': () => import('@client/src/pages/purchase/GarmentPurchaseInboundEditPage'),
    '/purchase/garment-return/': () => import('@client/src/pages/purchase/GarmentPurchaseReturnEditPage'),
    '/production/material-purchase-order/': () => import('@client/src/pages/production/MaterialPurchaseOrderEditPage'),
    '/production/material-purchase-inbound/': () => import('@client/src/pages/production/MaterialPurchaseInboundEditPage'),
    '/production/work-order/': () => import('@client/src/pages/production/WorkOrderEditPage'),
    '/production/material-issue/': () => import('@client/src/pages/production/MaterialIssueEditPage'),
    '/production/finish-receipt/': () => import('@client/src/pages/production/FinishReceiptEditPage'),
    '/sales/order/': () => import('@client/src/pages/sales/SalesOrderEditPage'),
    '/sales/outbound/': () => import('@client/src/pages/sales/SalesOutboundEditPage'),
    '/sales/return/': () => import('@client/src/pages/sales/SalesReturnEditPage'),
    '/retail/order/': () => import('@client/src/pages/retail/RetailOrderEditPage'),
    '/retail/return/': () => import('@client/src/pages/retail/RetailReturnEditPage'),
    '/inventory/inbound/': () => import('@client/src/pages/inventory/InventoryInboundEditPage'),
    '/inventory/outbound/': () => import('@client/src/pages/inventory/InventoryOutboundEditPage'),
    '/inventory/transfer/': () => import('@client/src/pages/inventory/InventoryTransferEditPage'),
    '/inventory/stocktake/': () => import('@client/src/pages/inventory/InventoryStocktakeEditPage'),
    '/finance/receipt/': () => import('@client/src/pages/finance/ReceiptEditPage'),
    '/finance/payment/': () => import('@client/src/pages/finance/PaymentEditPage'),
  };

  if (exactMap[pathname]) return exactMap[pathname];

  for (const [prefix, loader] of Object.entries(editPageMap).sort((a, b) => b[0].length - a[0].length)) {
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      const rest = pathname.slice(prefix.length);
      if (rest === 'new' || rest.endsWith('/edit')) {
        const Comp = React.lazy(loader);
        return Comp;
      }
    }
  }

  return null;
}

const TabPageCache: React.FC = () => {
  const { tabs, activeKey } = useTabs();
  const location = useLocation();
  const { hasPermission } = useAuth();
  const [mountedKeys, setMountedKeys] = useState<Set<string>>(new Set(['dashboard']));
  const editComponentsRef = useRef<Map<string, React.ComponentType>>(new Map());
  // C.2：记录 tab 激活先后顺序（索引 0 = 最近），供 LRU 淘汰使用
  const recencyRef = useRef<string[]>(['dashboard']);

  useEffect(() => {
    // 1) 更新激活顺序：当前 activeKey 提到最前
    if (activeKey) {
      recencyRef.current = [
        activeKey,
        ...recencyRef.current.filter((k) => k !== activeKey),
      ].slice(0, DEFAULT_MAX_KEEP_ALIVE * 2);
    }
    // 2) 计算保持挂载的 key：以 recency 为序保留最近 N 个，并强制保留
    //    dashboard 与当前激活 tab（避免可见页被误淘汰）。
    setMountedKeys(
      new Set(
        computeKeepAliveKeys({
          openTabKeys: tabs.map((t) => t.key),
          activeKey,
          recency: recencyRef.current,
          max: DEFAULT_MAX_KEEP_ALIVE,
          alwaysKeep: ['dashboard'],
        }),
      ),
    );
  }, [tabs, activeKey]);

  const activeTabInfo = getTabInfoFromPath(location.pathname);

  const renderPage = (tabKey: string, tabPath: string) => {
    const perm = getPermissionForPath(tabPath);
    if (perm && !hasPermission(perm)) {
      return <div className="p-10 text-center text-gray-400">无权限访问</div>;
    }

    const Comp = getRouteComponent(tabPath);
    if (!Comp) {
      return <NotFound />;
    }

    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-sm">加载中...</div>
          </div>
        }
      >
        <Comp />
      </Suspense>
    );
  };

  return (
    <div className="relative w-full h-full">
      {location.pathname === '/welcome' && (
        <div className="absolute inset-0 overflow-auto">
          <WelcomePage />
        </div>
      )}
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey || (tab.key === activeTabInfo.key && tab.path === location.pathname);
        const shouldMount = mountedKeys.has(tab.key);
        if (!shouldMount) return null;
        return (
          <div
            key={tab.key}
            className="absolute inset-0 overflow-auto"
            style={{ display: isActive ? 'block' : 'none' }}
          >
            {renderPage(tab.key, tab.path)}
          </div>
        );
      })}
    </div>
  );
};

export default TabPageCache;
