import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import TabBar from '@client/src/components/Tabs/TabBar';
import TabPageCache from '@client/src/components/Tabs/TabPageCache';
import { useTabs } from '@client/src/contexts/TabsContext';
import { useSystemConfig } from '@client/src/contexts/SystemConfigContext';
import WelcomePage from '@client/src/pages/Welcome/WelcomePage';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Shirt, Warehouse, ShoppingCart, ShoppingBag,
  Package, DollarSign, Settings, ChevronDown, ChevronRight,
  Layers, Users, Factory, Palette, Ruler, NotebookPen,
  ArrowLeftRight, ClipboardList, AlertTriangle, FileText,
  TrendingUp, CalendarDays, PanelLeftClose, PanelLeftOpen,
  BarChart3, Truck,
} from 'lucide-react';
import { useAuth } from '@client/src/contexts/AuthContext';
import { LogOut } from 'lucide-react';
import { useT } from '@client/src/i18n';
import { LanguageSwitcher } from '@client/src/components/LanguageSwitcher';

interface MenuChildItem {
  key: string;
  label: string;
  path: string;
  permission?: string;
}

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  permission?: string;
  children?: MenuChildItem[];
  path?: string;
}

const menuItems: MenuItem[] = [
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
      { key: 'subcontract-main', label: '委外管理', path: '/subcontract', permission: 'subcontract:manage' },
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
      { key: 'retail-report', label: '零售报表', path: '/retail/report', permission: 'sales:order' },
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
      { key: 'report-inventory', label: '库存查询', path: '/report/inventory', permission: 'report:inventory' },
      { key: 'report-transfer', label: '调拨查询', path: '/report/transfer', permission: 'report:transfer' },
      { key: 'report-stock-movement', label: '进销存查询', path: '/report/stock-movement', permission: 'report:stockmovement' },
      { key: 'report-pivot', label: '透视分析', path: '/report/pivot', permission: 'report:pivot' },
      { key: 'analytics-forecast', label: 'AI销量预测', path: '/analytics/forecast', permission: 'dashboard:view' },
      { key: 'analytics-lifecycle', label: '商品生命周期', path: '/analytics/lifecycle', permission: 'dashboard:view' },
      { key: 'analytics-bi', label: '自助BI钻取', path: '/analytics/bi', permission: 'dashboard:view' },
      { key: 'analytics-mobile-dashboard', label: '移动老板看板', path: '/analytics/mobile-dashboard', permission: 'dashboard:view' },
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
];

const STORAGE_KEY = 'erp_sidebar_collapsed';

const Layout: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, hasMenu, logout } = useAuth();
  const { tabs } = useTabs();
  const hasTabs = tabs.length > 0;
  const t = useT();

  const filteredMenuItems = useMemo(() => {
    return menuItems
      .map((item) => {
        if (item.children) {
          const visibleChildren = item.children.filter(
            (child) => !child.permission || hasMenu(child.permission),
          );
          if (visibleChildren.length === 0) return null;
          return { ...item, children: visibleChildren };
        }
        if (item.permission && !hasMenu(item.permission)) return null;
        return item;
      })
      .filter((item): item is MenuItem => item !== null);
  }, [hasMenu]);

  const { config } = useSystemConfig();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      // ignore
    }
    return config.sidebarCollapsed;
  });

  const [openKeys, setOpenKeys] = useState<string[]>(
    filteredMenuItems
      .filter((m) => m.children?.some((c) => location.pathname.startsWith(c.path)))
      .map((m) => m.key),
  );

  const [hoveredKey, setHoveredKey] = useState<string>('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore
    }
  }, [collapsed]);

  useEffect(() => {
    setOpenKeys((prev) => {
      const activeKeys = filteredMenuItems
        .filter((m) => m.children?.some((c) => location.pathname.startsWith(c.path)))
        .map((m) => m.key);
      const merged = new Set([...prev, ...activeKeys]);
      return Array.from(merged);
    });
  }, [location.pathname, filteredMenuItems]);

  const toggleMenu = (key: string) => {
    setOpenKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const sidebarWidth = collapsed ? 'w-16' : 'w-[220px]';

  return (
    <div className="flex h-screen w-screen bg-gray-50 overflow-hidden">
      <aside
        className={`${sidebarWidth} bg-gray-800 text-gray-300 flex flex-col flex-shrink-0 transition-all duration-200`}
      >
        <div
          className={`h-14 flex items-center ${
            collapsed ? 'justify-center px-2' : 'px-4'
          } border-b border-gray-700 overflow-hidden`}
        >
          <Shirt className="text-blue-400 flex-shrink-0" size={24} />
          <span
            className={`text-white font-semibold text-lg whitespace-nowrap transition-all ${
              collapsed
                ? 'opacity-0 w-0 ml-0 min-w-0 overflow-hidden flex-shrink-0'
                : 'ml-2'
            }`}
          >
            {t('app.title')}
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {filteredMenuItems.map((item) => (
            <div key={item.key} className="relative">
              {item.path ? (
                <NavLink
                  to={item.path}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `flex items-center ${
                      collapsed ? 'justify-center px-2' : 'px-4'
                    } py-2.5 text-sm cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-gray-700 hover:text-white'
                    }`
                  }
                >
                   <span>{item.icon}</span>
                   <span
                     className={`transition-all ${
                       collapsed
                         ? 'opacity-0 w-0 ml-0 min-w-0 overflow-hidden flex-shrink-0'
                         : 'ml-3'
                     }`}
                   >
                     {item.label}
                   </span>
                 </NavLink>
               ) : (
                <div className="w-full">
                  <div
                    className={`flex items-center ${
                      collapsed ? 'justify-center px-2' : 'justify-between px-4'
                    } py-2.5 text-sm cursor-pointer hover:bg-gray-700 hover:text-white transition-colors`}
                    onClick={() => !collapsed && toggleMenu(item.key)}
                    onMouseEnter={() => collapsed && setHoveredKey(item.key)}
                    onMouseLeave={() => collapsed && setHoveredKey('')}
                    title={collapsed ? item.label : undefined}
                  >
                     <div className="flex items-center w-full min-w-0">
                       <span className="flex-shrink-0 flex items-center justify-center w-5">{item.icon}</span>
                       <div
                         className={`flex items-center transition-all ${
                           collapsed
                             ? 'opacity-0 w-0 ml-0 overflow-hidden flex-shrink-0 min-w-0'
                             : 'w-full min-w-0'
                         }`}
                       >
                         <span className={`flex-shrink-0 ${collapsed ? '' : 'ml-3'}`}>
                           {item.label}
                         </span>
                         <span className="ml-auto flex items-center">
                           {openKeys.includes(item.key) ? (
                             <ChevronDown size={16} />
                           ) : (
                             <ChevronRight size={16} />
                           )}
                         </span>
                       </div>
                     </div>
                  </div>
                  {!collapsed && openKeys.includes(item.key) && item.children && (
                      <div key="submenu" className="bg-gray-900">
                      {item.children.map((child) => (
                        <NavLink
                          key={child.key}
                          to={child.path}
                          className={({ isActive }) =>
                            `flex items-center pl-12 pr-4 py-2 text-sm cursor-pointer transition-colors ${
                              isActive
                                ? 'text-blue-400 bg-gray-800 border-l-2 border-blue-400'
                                : 'text-gray-400 hover:text-white hover:bg-gray-700'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                  {collapsed && hoveredKey === item.key && item.children && (
                      <div key="hover-popup" className="absolute left-16 top-0 z-50 bg-gray-800 text-gray-300 rounded shadow-lg border border-gray-700 min-w-[160px] py-1">
                      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-700">
                        {item.label}
                      </div>
                      {item.children.map((child) => (
                        <NavLink
                          key={child.key}
                          to={child.path}
                          className={({ isActive }) =>
                            `block px-4 py-2 text-sm transition-colors ${
                              isActive
                                ? 'text-blue-400 bg-gray-700'
                                : 'text-gray-300 hover:text-white hover:bg-gray-700'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="border-t border-gray-700">
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className={`w-full flex items-center ${
              collapsed ? 'justify-center' : 'justify-end'
            } px-4 py-2.5 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors text-sm`}
            title={collapsed ? t('app.expandMenu') : t('app.collapseMenu')}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
             <span
               className={`transition-all ${
                 collapsed
                   ? 'opacity-0 w-0 ml-0 min-w-0 overflow-hidden flex-shrink-0'
                   : 'ml-2'
               }`}
             >
               {t('app.collapseMenu')}
             </span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        {hasTabs ? (
          <TabBar />
        ) : (
          <div className="hidden md:flex h-9 bg-white border-b border-gray-200 items-center justify-end px-4 flex-shrink-0">
            <WelcomeTopBar />
          </div>
        )}

        <main className="flex-1 overflow-hidden">
          {!hasTabs ? (
            <WelcomePage />
          ) : (
            <div className="h-full p-5">
              <ErrorBoundary
            key={location.pathname}
            fallbackRender={({ error, resetErrorBoundary }) => (
              <div style={{ padding: 20 }}>
                <h2 style={{ color: '#dc2626', fontSize: 18, marginBottom: 10 }}>
                  Page Render Error
                </h2>
                <p><strong>Message:</strong> {(error as Error).message}</p>
                <p><strong>Name:</strong> {(error as Error).name}</p>
                <details open>
                  <summary style={{ cursor: 'pointer', margin: '10px 0', fontWeight: 600 }}>Stack Trace</summary>
                  <pre style={{
                    background: '#f3f4f6',
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    overflow: 'auto',
                    maxHeight: 400,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {(error as Error).stack || 'N/A'}
                  </pre>
                </details>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Component Stack</summary>
                  <pre style={{
                    background: '#f3f4f6',
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    overflow: 'auto',
                    maxHeight: 400,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {(error as Error & { componentStack?: string }).componentStack || 'N/A'}
                  </pre>
                </details>
                <button
                  onClick={resetErrorBoundary}
                  style={{
                    marginTop: 16,
                    padding: '6px 14px',
                    background: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </div>
            )}
          >
            <TabPageCache />
            </ErrorBoundary>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

const WelcomeTopBar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const t = useT();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="flex items-center gap-2 px-2 py-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
      >
        <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs font-medium">
          {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
        </div>
        <span className="text-xs max-w-[80px] truncate">
          {user?.name || user?.username || '用户'}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg py-1 text-xs min-w-[150px] z-50">
          <div className="px-3 py-2 text-gray-400 border-b border-gray-100">
            <div className="text-gray-700 font-medium truncate">
              {user?.name || user?.username}
            </div>
            <div className="text-[11px] truncate">{user?.username || ''}</div>
          </div>
          <LanguageSwitcher />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-600 flex items-center gap-2"
            onClick={handleLogout}
          >
            <LogOut size={12} />
            {t('topbar.logout')}
          </button>
        </div>
      )}
    </div>
  );
};

export default Layout;
