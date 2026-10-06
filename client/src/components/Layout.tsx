import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import TabBar from '@client/src/components/Tabs/TabBar';
import TabPageCache from '@client/src/components/Tabs/TabPageCache';
import { useTabs } from '@client/src/contexts/TabsContext';
import { useSystemConfig } from '@client/src/contexts/SystemConfigContext';
import WelcomePage from '@client/src/pages/Welcome/WelcomePage';
import { useNavigate } from 'react-router-dom';
// 菜单图标已随 menuItems 迁至 config/menuConfig，此处仅保留布局自身用到的图标
import {
  Shirt, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeftOpen, LogOut,
} from 'lucide-react';
import { useAuth } from '@client/src/contexts/AuthContext';
import { useT } from '@client/src/i18n';
import { LanguageSwitcher } from '@client/src/components/LanguageSwitcher';
// 菜单定义已抽到独立模块（页签栏需复用 path -> icon 映射，避免 Layout/TabBar 循环依赖）
import { menuItems, type MenuItem } from '@client/src/config/menuConfig';


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
          <Shirt className="text-primary/70 flex-shrink-0" size={24} />
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
                        ? 'bg-primary text-white'
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
                                ? 'text-primary/70 bg-gray-800 border-l-2 border-primary/70'
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
                                ? 'text-primary/70 bg-gray-700'
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
            <div className="h-full p-5 bg-gray-50">
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
