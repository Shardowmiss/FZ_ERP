import React, { useCallback, useEffect } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { logger } from '@lark-apaas/client-toolkit/logger';

import '@client/src/api/request-interceptor';

import { AuthProvider } from './contexts/AuthContext';
import { TabsProvider } from './contexts/TabsContext';
import { SystemConfigProvider } from './contexts/SystemConfigContext';
import { LanguageProvider } from './i18n';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/Login/Login';
import ForbiddenPage from './pages/Forbidden/Forbidden';
import DashboardPage from './pages/Dashboard/DashboardPage';
import WelcomePage from './pages/Welcome/WelcomePage';
import NotFound from './pages/NotFound/NotFound';

const StylePage = React.lazy(() => import('./pages/base/StylePage'));
const SkuPage = React.lazy(() => import('./pages/base/SkuPage'));
const ColorGroupPage = React.lazy(() => import('./pages/base/ColorGroupPage'));
const SizeGroupPage = React.lazy(() => import('./pages/base/SizeGroupPage'));
const MaterialPage = React.lazy(() => import('./pages/base/MaterialPage'));
const SupplierPage = React.lazy(() => import('./pages/base/SupplierPage'));
const WarehousePage = React.lazy(() => import('./pages/base/WarehousePage'));
const StyleAttrDefPage = React.lazy(() => import('./pages/base/StyleAttrDefPage'));
const DealerPage = React.lazy(() => import('./pages/base/DealerPage'));
const StorePage = React.lazy(() => import('./pages/base/StorePage'));
const MergeAuditPage = React.lazy(() => import('./pages/base/MergeAuditPage'));
const ColorPage = React.lazy(() => import('./pages/base/ColorPage'));
const SizePage = React.lazy(() => import('./pages/base/SizePage'));
const SizeGroupRelationPage = React.lazy(() => import('./pages/base/SizeGroupRelationPage'));

const BomPage = React.lazy(() => import('./pages/bom/BomPage'));

const GarmentPurchaseOrderPage = React.lazy(() => import('./pages/purchase/GarmentPurchaseOrderPage'));
const GarmentPurchaseOrderEditPage = React.lazy(() => import('./pages/purchase/GarmentPurchaseOrderEditPage'));
const GarmentPurchaseInboundPage = React.lazy(() => import('./pages/purchase/GarmentPurchaseInboundPage'));
const GarmentPurchaseInboundEditPage = React.lazy(() => import('./pages/purchase/GarmentPurchaseInboundEditPage'));
const GarmentPurchaseReturnPage = React.lazy(() => import('./pages/purchase/GarmentPurchaseReturnPage'));
const GarmentPurchaseReturnEditPage = React.lazy(() => import('./pages/purchase/GarmentPurchaseReturnEditPage'));

const ProductionBomPage = React.lazy(() => import('./pages/production/BomPage'));
const MaterialPurchaseOrderPage = React.lazy(() => import('./pages/production/MaterialPurchaseOrderPage'));
const MaterialPurchaseOrderEditPage = React.lazy(() => import('./pages/production/MaterialPurchaseOrderEditPage'));
const MaterialPurchaseInboundPage = React.lazy(() => import('./pages/production/MaterialPurchaseInboundPage'));
const MaterialPurchaseInboundEditPage = React.lazy(() => import('./pages/production/MaterialPurchaseInboundEditPage'));
const MrpPage = React.lazy(() => import('./pages/production/MrpPage'));
const ProductionCostPage = React.lazy(() => import('./pages/production/ProductionCostPage'));
const WorkOrderPage = React.lazy(() => import('./pages/production/WorkOrderPage'));
const WorkOrderEditPage = React.lazy(() => import('./pages/production/WorkOrderEditPage'));
const MaterialIssuePage = React.lazy(() => import('./pages/production/MaterialIssuePage'));
const MaterialIssueEditPage = React.lazy(() => import('./pages/production/MaterialIssueEditPage'));
const FinishReceiptPage = React.lazy(() => import('./pages/production/FinishReceiptPage'));
const FinishReceiptEditPage = React.lazy(() => import('./pages/production/FinishReceiptEditPage'));

const PurchaseOrderPage = React.lazy(() => import('./pages/purchase/PurchaseOrderPage'));
const PurchaseOrderEditPage = React.lazy(() => import('./pages/purchase/PurchaseOrderEditPage'));
const PurchaseInboundPage = React.lazy(() => import('./pages/purchase/PurchaseInboundPage'));
const PurchaseInboundEditPage = React.lazy(() => import('./pages/purchase/PurchaseInboundEditPage'));
const PurchaseReturnPage = React.lazy(() => import('./pages/purchase/PurchaseReturnPage'));
const PurchaseReturnEditPage = React.lazy(() => import('./pages/purchase/PurchaseReturnEditPage'));
const PurchaseReconciliationPage = React.lazy(() => import('./pages/purchase/ReconciliationPage'));

const SalesOrderPage = React.lazy(() => import('./pages/sales/SalesOrderPage'));
const SalesOrderEditPage = React.lazy(() => import('./pages/sales/SalesOrderEditPage'));
const SalesOutboundPage = React.lazy(() => import('./pages/sales/SalesOutboundPage'));
const SalesOutboundEditPage = React.lazy(() => import('./pages/sales/SalesOutboundEditPage'));
const SalesReturnPage = React.lazy(() => import('./pages/sales/SalesReturnPage'));
const SalesReturnEditPage = React.lazy(() => import('./pages/sales/SalesReturnEditPage'));
const SalesReconciliationPage = React.lazy(() => import('./pages/sales/ReconciliationPage'));

const InventoryQueryPage = React.lazy(() => import('./pages/inventory/InventoryQueryPage'));
const InventoryFlowPage = React.lazy(() => import('./pages/inventory/InventoryFlowPage'));
const InventoryInboundPage = React.lazy(() => import('./pages/inventory/InventoryInboundPage'));
const InventoryOutboundPage = React.lazy(() => import('./pages/inventory/InventoryOutboundPage'));
const InventoryTransferPage = React.lazy(() => import('./pages/inventory/InventoryTransferPage'));
const InventoryStocktakePage = React.lazy(() => import('./pages/inventory/InventoryStocktakePage'));
const InventoryWarningPage = React.lazy(() => import('./pages/inventory/InventoryWarningPage'));
const ReplenishSuggestionPage = React.lazy(() => import('./pages/inventory/ReplenishSuggestionPage'));
const ReplenishPlanPage = React.lazy(() => import('./pages/inventory/ReplenishPlanPage'));
const ReplenishTemplatePage = React.lazy(() => import('./pages/inventory/ReplenishTemplatePage'));
const BarcodePage = React.lazy(() => import('./pages/inventory/BarcodePage'));
const MobileStocktakePage = React.lazy(() => import('./pages/inventory/MobileStocktakePage'));
const HangtagPrintPage = React.lazy(() => import('./pages/inventory/HangtagPrintPage'));
const UniqueCodeTracePage = React.lazy(() => import('./pages/inventory/UniqueCodeTracePage'));
const UniqueCodePublicTracePage = React.lazy(() => import('./pages/inventory/UniqueCodePublicTracePage'));
const SubcontractPage = React.lazy(() => import('./pages/subcontract/SubcontractPage'));
const ForecastPage = React.lazy(() => import('./pages/analytics/ForecastPage'));
const LifecyclePage = React.lazy(() => import('./pages/analytics/LifecyclePage'));
const BIPage = React.lazy(() => import('./pages/analytics/BIPage'));
const MobileDashboardPage = React.lazy(() => import('./pages/analytics/MobileDashboardPage'));
const OmniPage = React.lazy(() => import('./pages/omni/OmniPage'));
const PosCashierPage = React.lazy(() => import('./pages/pos/CashierPage'));
const PricingPage = React.lazy(() => import('./pages/pricing/PriceListPage'));
const MemberPage = React.lazy(() => import('./pages/member/MemberPage'));
const MemberManagePage = React.lazy(() => import('./pages/member/MemberManagePage'));
const MemberLevelPage = React.lazy(() => import('./pages/member/MemberLevelPage'));
const MemberMergeAuditPage = React.lazy(() => import('./pages/member/MemberMergeAuditPage'));
const InventoryInboundEditPage = React.lazy(() => import('./pages/inventory/InventoryInboundEditPage'));
const InventoryOutboundEditPage = React.lazy(() => import('./pages/inventory/InventoryOutboundEditPage'));
const InventoryTransferEditPage = React.lazy(() => import('./pages/inventory/InventoryTransferEditPage'));
const InventoryStocktakeEditPage = React.lazy(() => import('./pages/inventory/InventoryStocktakeEditPage'));

const ReceivablePage = React.lazy(() => import('./pages/finance/ReceivablePage'));
const PayablePage = React.lazy(() => import('./pages/finance/PayablePage'));
const ReceiptPage = React.lazy(() => import('./pages/finance/ReceiptPage'));
const ReceiptEditPage = React.lazy(() => import('./pages/finance/ReceiptEditPage'));
const PaymentPage = React.lazy(() => import('./pages/finance/PaymentPage'));
const PaymentEditPage = React.lazy(() => import('./pages/finance/PaymentEditPage'));
const ProfitPage = React.lazy(() => import('./pages/finance/ProfitPage'));
const MonthClosePage = React.lazy(() => import('./pages/finance/MonthClosePage'));
const CodeRulePage = React.lazy(() => import('./pages/system/CodeRulePage'));
const UserManagePage = React.lazy(() => import('./pages/system/UserManagePage'));
const RoleManagePage = React.lazy(() => import('./pages/system/RoleManagePage'));
const PermissionManagePage = React.lazy(() => import('./pages/system/PermissionManagePage'));
const OperationLogPage = React.lazy(() => import('./pages/system/OperationLogPage'));
const SystemConfigPage = React.lazy(() => import('./pages/system/SystemConfigPage'));

const TradeShowPage = React.lazy(() => import('./pages/trade-show/TradeShowPage'));
const PreOrderPage = React.lazy(() => import('./pages/trade-show/PreOrderPage'));
const PreOrderSummaryPage = React.lazy(() => import('./pages/trade-show/PreOrderSummaryPage'));
const AllocationPage = React.lazy(() => import('./pages/trade-show/AllocationPage'));
const ThemePage = React.lazy(() => import('./pages/trade-show/ThemePage'));
const RetailOrderPage = React.lazy(() => import('./pages/retail/RetailOrderPage'));
const RetailOrderEditPage = React.lazy(() => import('./pages/retail/RetailOrderEditPage'));
const RetailReturnPage = React.lazy(() => import('./pages/retail/RetailReturnPage'));
const RetailReturnEditPage = React.lazy(() => import('./pages/retail/RetailReturnEditPage'));
const RetailReportPage = React.lazy(() => import('./pages/retail/RetailReportPage'));
const PivotAnalysisPage = React.lazy(() => import('./pages/report/PivotAnalysisPage'));

const PurchaseReportPage = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.PurchaseReportPage })),
);
const GarmentPurchaseReportPage = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.GarmentPurchaseReportPage })),
);
const MaterialPurchaseReportPage = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.MaterialPurchaseReportPage })),
);
const SalesReportPageComp = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.SalesReportPage })),
);
const RetailReportPageComp = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.RetailReportPage })),
);
const InventoryReportPage = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.InventoryReportPage })),
);
const TransferReportPage = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.TransferReportPage })),
);
const StockMovementPage = React.lazy(() =>
  import('./pages/report').then(m => ({ default: m.StockMovementPage })),
);

function useGlobalErrorHandler() {
  useEffect(() => {
    const RELOAD_KEY = '__global_error_reload_count';
    const MAX_RELOADS = 2;
    const DOM_KEYWORDS = [
      'removeChild',
      'Failed to execute',
      'NotFoundError',
      'The node to be removed',
      'The node before which',
      'appendChild',
      'insertBefore',
      'contains the source',
      'Failed to set',
      'hydrat',
    ];

    function isDomError(msg: string): boolean {
      return DOM_KEYWORDS.some((kw) => msg.includes(kw));
    }

    function getCount(): number {
      try {
        return Number(sessionStorage.getItem(RELOAD_KEY) || '0');
      } catch {
        return 0;
      }
    }

    function increment(): void {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(getCount() + 1));
      } catch {
        // ignore
      }
    }

    function maybeReload(message: string): boolean {
      if (!isDomError(message)) return false;
      const count = getCount();
      if (count >= MAX_RELOADS) return false;
      increment();
      logger.error(
        `[GlobalErrorHandler] DOM error, reloading (${count + 1}/${MAX_RELOADS}): ${message}`,
      );
      window.location.reload();
      return true;
    }

    function handleError(event: ErrorEvent): void {
      const msg = event.message || '';
      const isKeyUndefined =
        (msg.includes('key') && msg.includes('length') && msg.includes('undefined')) ||
        /Cannot read properties of undefined.*\bkey\b.*length/.test(msg) ||
        /key\.length.*undefined/.test(msg);
      if (isKeyUndefined) {
        logger.error(`[GlobalErrorHandler] Suppressed key.undefined error: ${msg}`);
        event.preventDefault();
        return;
      }
      maybeReload(msg);
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent): void {
      const reason = event.reason;
      const msg =
        reason?.message || (typeof reason === 'string' ? reason : String(reason || ''));
      maybeReload(msg);
    }

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
}

const protectedWith = (
  element: React.ReactNode,
  permission?: string,
): React.ReactElement => (
  <ProtectedRoute permission={permission}>{element}</ProtectedRoute>
);

const RoutesComponent = () => {
  useGlobalErrorHandler();
  return (
    <LanguageProvider>
    <AuthProvider>
    <SystemConfigProvider>
      <ErrorBoundary
        onError={(error: Error) => {
          const msg = error.message || '';
          const name = error.name || '';
          const domErrorKeywords = [
            'removeChild',
            'Failed to execute',
            'NotFoundError',
            'The node to be removed',
            'The node before which',
            'appendChild',
            'insertBefore',
            'contains the source',
            'Failed to set',
            'hydrat',
          ];
          const isDomError = domErrorKeywords.some(
            (kw: string) => msg.includes(kw) || name.includes(kw),
          );
          if (!isDomError) return;

          logger.error(
            `[ErrorBoundary] DOM reconciliation error: ${msg}\nComponent stack: ${(error as Error & { componentStack?: string }).componentStack || 'N/A'}\nJS stack: ${error.stack || 'N/A'}`,
          );

          const STORAGE_KEY = '__error_reload_count';
          const MAX_RETRIES = 2;
          let count = 0;
          try {
            const stored = window.sessionStorage.getItem(STORAGE_KEY);
            if (stored) count = parseInt(stored, 10) || 0;
          } catch {
            // sessionStorage unavailable, skip auto-reload
            return;
          }

          if (count >= MAX_RETRIES) return;

          logger.error(
            `[ErrorBoundary] DOM reconciliation error detected (retry ${count + 1}/${MAX_RETRIES}), reloading page: ${msg}`,
          );

          try {
            window.sessionStorage.setItem(STORAGE_KEY, String(count + 1));
          } catch {
            // ignore
          }
          window.location.reload();
        }}
        fallbackRender={({ error, resetErrorBoundary }) => (
          <div style={{
            padding: 24,
            background: '#fff',
            minHeight: '100vh',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 99999,
            position: 'relative',
          }}>
            <h1 style={{ color: '#dc2626', fontSize: 20, marginBottom: 12, fontWeight: 600 }}>
              Render Error - Debug Info
            </h1>
            <p style={{ marginBottom: 8 }}><strong>Message:</strong> {(error as Error).message}</p>
            <p style={{ marginBottom: 8 }}><strong>Name:</strong> {(error as Error).name}</p>
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>Component Stack:</p>
              <pre style={{
                background: '#f3f4f6',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 300,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {(error as Error & { componentStack?: string }).componentStack || 'N/A'}
              </pre>
            </div>
            <div style={{ marginTop: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>JS Stack:</p>
              <pre style={{
                background: '#f3f4f6',
                padding: 12,
                borderRadius: 6,
                fontSize: 12,
                overflow: 'auto',
                maxHeight: 300,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {(error as Error).stack || 'N/A'}
              </pre>
            </div>
            <button
              onClick={resetErrorBoundary}
              style={{
                marginTop: 20,
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Try Again
            </button>
          </div>
        )}
      >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/403" element={<ForbiddenPage />} />
        {/*
         * 公开溯源页：消费者 / 门店扫码直达，无需登录。
         * 必须置于 ProtectedRoute 之外（与 /login 同级），否则会被鉴权拦截。
         * 对应后端 @Public() 的 GET /api/trace-public/:code 与 /api/trace-public/qr/:code。
         */}
        <Route path="/trace/:code" element={<UniqueCodePublicTracePage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <TabsProvider>
                <Layout />
              </TabsProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route
            path="welcome"
            element={protectedWith(<WelcomePage />)}
          />
          <Route
            path="dashboard"
            element={protectedWith(<DashboardPage />, 'dashboard')}
          />

          <Route
            path="base/style"
            element={protectedWith(<StylePage />, 'base:style')}
          />
          <Route
            path="base/sku"
            element={protectedWith(<SkuPage />, 'base:sku')}
          />
          <Route
            path="base/size-group"
            element={protectedWith(<SizeGroupPage />, 'base:sku')}
          />
          <Route
            path="base/material"
            element={protectedWith(<MaterialPage />, 'base:material')}
          />
          <Route
            path="base/supplier"
            element={protectedWith(<SupplierPage />, 'base:supplier')}
          />
          <Route
            path="base/style-attribute"
            element={protectedWith(<StyleAttrDefPage />, 'base:style')}
          />
          <Route
            path="base/dealer"
            element={protectedWith(<DealerPage />, 'base:dealer')}
          />
          <Route
            path="base/store"
            element={protectedWith(<StorePage />, 'base:store')}
          />
          <Route
            path="base/merge-audit"
            element={protectedWith(<MergeAuditPage />, 'md:merge')}
          />
          <Route
            path="product/code-rule"
            element={protectedWith(<CodeRulePage />, 'base:style')}
          />
          <Route
            path="product/color"
            element={protectedWith(<ColorPage />, 'base:color')}
          />
          <Route
            path="product/size"
            element={protectedWith(<SizePage />, 'base:size')}
          />
          <Route
            path="product/size-group-relation"
            element={protectedWith(<SizeGroupRelationPage />, 'base:size')}
          />

          <Route
            path="bom"
            element={protectedWith(<BomPage />, 'base:material')}
          />

          <Route
            path="purchase/garment-order"
            element={protectedWith(<GarmentPurchaseOrderPage />, 'purchase:order')}
          />
          <Route
            path="purchase/garment-order/new"
            element={protectedWith(<GarmentPurchaseOrderEditPage />, 'purchase:order')}
          />
          <Route
            path="purchase/garment-order/:id/edit"
            element={protectedWith(<GarmentPurchaseOrderEditPage />, 'purchase:order')}
          />
          <Route
            path="purchase/garment-inbound"
            element={protectedWith(
              <GarmentPurchaseInboundPage />,
              'purchase:inbound',
            )}
          />
          <Route
            path="purchase/garment-inbound/new"
            element={protectedWith(<GarmentPurchaseInboundEditPage />, 'purchase:inbound')}
          />
          <Route
            path="purchase/garment-inbound/:id/edit"
            element={protectedWith(<GarmentPurchaseInboundEditPage />, 'purchase:inbound')}
          />
          <Route
            path="purchase/garment-return"
            element={protectedWith(<GarmentPurchaseReturnPage />, 'purchase:return')}
          />
          <Route
            path="purchase/garment-return/new"
            element={protectedWith(<GarmentPurchaseReturnEditPage />, 'purchase:return')}
          />
          <Route
            path="purchase/garment-return/:id/edit"
            element={protectedWith(<GarmentPurchaseReturnEditPage />, 'purchase:return')}
          />

          <Route
            path="production/bom"
            element={protectedWith(<ProductionBomPage />, 'production:bom')}
          />
          <Route
            path="production/material-purchase-order"
            element={protectedWith(<MaterialPurchaseOrderPage />, 'production:material_order')}
          />
          <Route
            path="production/material-purchase-order/new"
            element={protectedWith(<MaterialPurchaseOrderEditPage />, 'production:material_order')}
          />
          <Route
            path="production/material-purchase-order/:id/edit"
            element={protectedWith(<MaterialPurchaseOrderEditPage />, 'production:material_order')}
          />
          <Route
            path="production/material-purchase-inbound"
            element={protectedWith(<MaterialPurchaseInboundPage />, 'production:material_inbound')}
          />
          <Route
            path="production/material-purchase-inbound/new"
            element={protectedWith(<MaterialPurchaseInboundEditPage />, 'production:material_inbound')}
          />
          <Route
            path="production/material-purchase-inbound/:id/edit"
            element={protectedWith(<MaterialPurchaseInboundEditPage />, 'production:material_inbound')}
          />
          <Route
            path="production/mrp"
            element={protectedWith(<MrpPage />, 'production:mrp')}
          />
          <Route
            path="production/cost"
            element={protectedWith(<ProductionCostPage />, 'production:cost')}
          />
          <Route
            path="production/work-order"
            element={protectedWith(<WorkOrderPage />, 'production:work_order')}
          />
          <Route
            path="production/work-order/new"
            element={protectedWith(<WorkOrderEditPage />, 'production:work_order')}
          />
          <Route
            path="production/work-order/:id/edit"
            element={protectedWith(<WorkOrderEditPage />, 'production:work_order')}
          />
          <Route
            path="production/material-issue"
            element={protectedWith(<MaterialIssuePage />, 'production:material_issue')}
          />
          <Route
            path="production/material-issue/new"
            element={protectedWith(<MaterialIssueEditPage />, 'production:material_issue')}
          />
          <Route
            path="production/material-issue/:id/edit"
            element={protectedWith(<MaterialIssueEditPage />, 'production:material_issue')}
          />
          <Route
            path="production/finish-receipt"
            element={protectedWith(<FinishReceiptPage />, 'production:finish_receipt')}
          />
          <Route
            path="production/finish-receipt/new"
            element={protectedWith(<FinishReceiptEditPage />, 'production:finish_receipt')}
          />
          <Route
            path="production/finish-receipt/:id/edit"
            element={protectedWith(<FinishReceiptEditPage />, 'production:finish_receipt')}
          />

          <Route
            path="purchase/order"
            element={protectedWith(<PurchaseOrderPage />, 'purchase:order')}
          />
          <Route
            path="purchase/order/new"
            element={protectedWith(<PurchaseOrderEditPage />, 'purchase:order')}
          />
          <Route
            path="purchase/order/:id/edit"
            element={protectedWith(<PurchaseOrderEditPage />, 'purchase:order')}
          />
          <Route
            path="purchase/inbound"
            element={protectedWith(
              <PurchaseInboundPage />,
              'purchase:inbound',
            )}
          />
          <Route
            path="purchase/inbound/new"
            element={protectedWith(<PurchaseInboundEditPage />, 'purchase:inbound')}
          />
          <Route
            path="purchase/inbound/:id/edit"
            element={protectedWith(<PurchaseInboundEditPage />, 'purchase:inbound')}
          />
          <Route
            path="purchase/return"
            element={protectedWith(<PurchaseReturnPage />, 'purchase:return')}
          />
          <Route
            path="purchase/return/new"
            element={protectedWith(<PurchaseReturnEditPage />, 'purchase:return')}
          />
          <Route
            path="purchase/return/:id/edit"
            element={protectedWith(<PurchaseReturnEditPage />, 'purchase:return')}
          />
          <Route
            path="purchase/reconciliation"
            element={protectedWith(<PurchaseReconciliationPage />, 'purchase:reconciliation')}
          />

          <Route
            path="sales/order"
            element={protectedWith(<SalesOrderPage />, 'sales:order')}
          />
          <Route
            path="sales/order/new"
            element={protectedWith(<SalesOrderEditPage />, 'sales:order')}
          />
          <Route
            path="sales/order/:id/edit"
            element={protectedWith(<SalesOrderEditPage />, 'sales:order')}
          />
          <Route
            path="sales/outbound"
            element={protectedWith(<SalesOutboundPage />, 'sales:outbound')}
          />
          <Route
            path="sales/outbound/new"
            element={protectedWith(<SalesOutboundEditPage />, 'sales:outbound')}
          />
          <Route
            path="sales/outbound/:id/edit"
            element={protectedWith(<SalesOutboundEditPage />, 'sales:outbound')}
          />
          <Route
            path="sales/return"
            element={protectedWith(<SalesReturnPage />, 'sales:return')}
          />
          <Route
            path="sales/return/new"
            element={protectedWith(<SalesReturnEditPage />, 'sales:return')}
          />
          <Route
            path="sales/return/:id/edit"
            element={protectedWith(<SalesReturnEditPage />, 'sales:return')}
          />
          <Route
            path="sales/reconciliation"
            element={protectedWith(<SalesReconciliationPage />, 'sales:reconciliation')}
          />

          <Route
            path="inventory/query"
            element={protectedWith(
              <InventoryQueryPage />,
              'inventory:query',
            )}
          />
          <Route
            path="inventory/flow"
            element={protectedWith(<InventoryFlowPage />, 'inventory:flow')}
          />
          <Route
            path="inventory/inbound"
            element={protectedWith(
              <InventoryInboundPage />,
              'inventory:inbound',
            )}
          />
          <Route
            path="inventory/outbound"
            element={protectedWith(
              <InventoryOutboundPage />,
              'inventory:outbound',
            )}
          />
          <Route
            path="inventory/transfer"
            element={protectedWith(
              <InventoryTransferPage />,
              'inventory:transfer',
            )}
          />
          <Route
            path="inventory/stocktake"
            element={protectedWith(
              <InventoryStocktakePage />,
              'inventory:stocktake',
            )}
          />
          <Route
            path="inventory/warning"
            element={protectedWith(
              <InventoryWarningPage />,
              'inventory:warning',
            )}
          />
          <Route
            path="inventory/replenish"
            element={protectedWith(
              <ReplenishSuggestionPage />,
              'inventory:warning',
            )}
          />
          <Route
            path="inventory/replenish-plan"
            element={protectedWith(
              <ReplenishPlanPage />,
              'inventory:replenish-plan',
            )}
          />
          <Route
            path="inventory/replenish-template"
            element={protectedWith(
              <ReplenishTemplatePage />,
              'inventory:replenish-template',
            )}
          />
          <Route
            path="inventory/barcode"
            element={protectedWith(<BarcodePage />, 'inventory:query')}
          />
          <Route
            path="inventory/hangtag-print"
            element={protectedWith(<HangtagPrintPage />, 'inventory:query')}
          />
          <Route
            path="inventory/unique-code-trace"
            element={protectedWith(<UniqueCodeTracePage />, 'inventory:query')}
          />
          <Route
            path="inventory/mobile-stocktake"
            element={protectedWith(
              <MobileStocktakePage />,
              'inventory:stocktake',
            )}
          />
          <Route
            path="subcontract"
            element={protectedWith(<SubcontractPage />, 'inventory:query')}
          />
          <Route
            path="analytics/forecast"
            element={protectedWith(<ForecastPage />, 'dashboard:view')}
          />
          <Route
            path="analytics/lifecycle"
            element={protectedWith(<LifecyclePage />, 'dashboard:view')}
          />
          <Route
            path="analytics/bi"
            element={protectedWith(<BIPage />, 'dashboard:view')}
          />
          <Route
            path="analytics/mobile-dashboard"
            element={protectedWith(<MobileDashboardPage />)}
          />
          <Route
            path="omni"
            element={protectedWith(<OmniPage />, 'omni:manage')}
          />
          <Route
            path="member"
            element={protectedWith(<MemberPage />, 'retail:view')}
          />
          <Route
            path="member/manage"
            element={protectedWith(<MemberManagePage />, 'member:manage')}
          />
          <Route
            path="member/level"
            element={protectedWith(<MemberLevelPage />, 'member:level')}
          />
          <Route
            path="base/member-merge-audit"
            element={protectedWith(<MemberMergeAuditPage />, 'member:merge')}
          />
          <Route
            path="inventory/inbound/new"
            element={protectedWith(<InventoryInboundEditPage />, 'inventory:inbound')}
          />
          <Route
            path="inventory/inbound/:id/edit"
            element={protectedWith(<InventoryInboundEditPage />, 'inventory:inbound')}
          />
          <Route
            path="inventory/outbound/new"
            element={protectedWith(<InventoryOutboundEditPage />, 'inventory:outbound')}
          />
          <Route
            path="inventory/outbound/:id/edit"
            element={protectedWith(<InventoryOutboundEditPage />, 'inventory:outbound')}
          />
          <Route
            path="inventory/transfer/new"
            element={protectedWith(<InventoryTransferEditPage />, 'inventory:transfer')}
          />
          <Route
            path="inventory/transfer/:id/edit"
            element={protectedWith(<InventoryTransferEditPage />, 'inventory:transfer')}
          />
          <Route
            path="inventory/stocktake/new"
            element={protectedWith(<InventoryStocktakeEditPage />, 'inventory:stocktake')}
          />
          <Route
            path="inventory/stocktake/:id/edit"
            element={protectedWith(<InventoryStocktakeEditPage />, 'inventory:stocktake')}
          />

          <Route
            path="finance/receivable"
            element={protectedWith(<ReceivablePage />, 'finance:receivable')}
          />
          <Route
            path="finance/payable"
            element={protectedWith(<PayablePage />, 'finance:payable')}
          />
          <Route
            path="finance/receipt"
            element={protectedWith(<ReceiptPage />, 'finance:receipt')}
          />
          <Route
            path="finance/receipt/new"
            element={protectedWith(<ReceiptEditPage />, 'finance:receipt')}
          />
          <Route
            path="finance/receipt/:id/edit"
            element={protectedWith(<ReceiptEditPage />, 'finance:receipt')}
          />
          <Route
            path="finance/payment"
            element={protectedWith(<PaymentPage />, 'finance:payment')}
          />
          <Route
            path="finance/payment/new"
            element={protectedWith(<PaymentEditPage />, 'finance:payment')}
          />
          <Route
            path="finance/payment/:id/edit"
            element={protectedWith(<PaymentEditPage />, 'finance:payment')}
          />
          <Route
            path="finance/profit"
            element={protectedWith(<ProfitPage />, 'finance:profit')}
          />
          <Route
            path="finance/month-close"
            element={protectedWith(<MonthClosePage />, 'finance:profit')}
          />

          <Route
            path="system/user"
            element={protectedWith(<UserManagePage />, 'system:user')}
          />
          <Route
            path="system/role"
            element={protectedWith(<RoleManagePage />, 'system:role')}
          />
          <Route
            path="system/permission"
            element={protectedWith(<PermissionManagePage />, 'system:permission')}
          />
          <Route
            path="system/operation-log"
            element={protectedWith(<OperationLogPage />, 'system:operation_log')}
          />
          <Route
            path="system/config"
            element={protectedWith(<SystemConfigPage />, 'system:config')}
          />

          <Route
            path="trade-show/theme"
            element={protectedWith(<ThemePage />, 'tradeshow:theme')}
          />
          <Route
            path="trade-show/list"
            element={protectedWith(<TradeShowPage />, 'tradeshow:preorder')}
          />
          <Route
            path="trade-show/pre-order"
            element={protectedWith(<PreOrderPage />, 'tradeshow:preorder')}
          />
          <Route
            path="trade-show/summary"
            element={protectedWith(
              <PreOrderSummaryPage />,
              'tradeshow:preorder',
            )}
          />
          <Route
            path="trade-show/allocation"
            element={protectedWith(<AllocationPage />, 'tradeshow:allocation')}
          />

          <Route
            path="retail/order"
            element={protectedWith(<RetailOrderPage />, 'sales:order')}
          />
          <Route
            path="retail/order/new"
            element={protectedWith(<RetailOrderEditPage />, 'sales:order')}
          />
          <Route
            path="retail/order/:id/edit"
            element={protectedWith(<RetailOrderEditPage />, 'sales:order')}
          />
          <Route
            path="retail/return"
            element={protectedWith(<RetailReturnPage />, 'sales:return')}
          />
          <Route
            path="retail/return/new"
            element={protectedWith(<RetailReturnEditPage />, 'sales:return')}
          />
          <Route
            path="retail/return/:id/edit"
            element={protectedWith(<RetailReturnEditPage />, 'sales:return')}
          />
          <Route
            path="retail/report"
            element={protectedWith(<RetailReportPage />, 'sales:order')}
          />

          <Route
            path="report/garment-purchase"
            element={protectedWith(<GarmentPurchaseReportPage />, 'report:garment_purchase')}
          />
          <Route
            path="report/material-purchase"
            element={protectedWith(<MaterialPurchaseReportPage />, 'report:material_purchase')}
          />
          <Route
            path="report/sales"
            element={protectedWith(<SalesReportPageComp />, 'report:sales')}
          />
          <Route
            path="report/retail"
            element={protectedWith(<RetailReportPageComp />, 'report:retail')}
          />
          <Route
            path="report/inventory"
            element={protectedWith(<InventoryReportPage />, 'report:inventory')}
          />
          <Route
            path="report/transfer"
            element={protectedWith(<TransferReportPage />, 'report:transfer')}
          />
          <Route
            path="report/stock-movement"
            element={protectedWith(<StockMovementPage />, 'report:stockmovement')}
          />
            <Route
              path="report/pivot"
              element={protectedWith(<PivotAnalysisPage />, 'report:pivot')}
            />
            <Route
              path="pos/cashier"
              element={protectedWith(<PosCashierPage />)}
            />
            <Route
              path="pricing"
              element={protectedWith(<PricingPage />)}
            />
          </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </ErrorBoundary>
    </SystemConfigProvider>
    </AuthProvider>
    </LanguageProvider>
  );
};

export default RoutesComponent;
