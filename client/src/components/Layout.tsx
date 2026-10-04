import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, RefreshCw, Users, Tag, Package,
  Clock, BarChart3, Truck, Link2, Settings, ScanLine, LogOut
} from 'lucide-react';
import OfflineBanner from './OfflineBanner';
import { useOffline } from '../contexts/OfflineContext';
import { useAuth, type EmployeeRole } from '../contexts/AuthContext';
import { STORE_ID, STORE_NAME } from '../lib/store';

const navGroups = [
  {
    title: '收银',
    items: [
      { path: '/pos', label: '收银开单', icon: ShoppingCart },
      { path: '/return', label: '退换货', icon: RefreshCw },
    ]
  },
  {
    title: '运营',
    items: [
      { path: '/members', label: '会员中心', icon: Users },
      { path: '/promotions', label: '促销管理', icon: Tag },
      { path: '/inventory', label: '门店库存', icon: Package },
      { path: '/shift', label: '交接班', icon: Clock },
    ]
  },
  {
    title: '决策',
    items: [
      { path: '/dashboard', label: '店长看板', icon: BarChart3 },
      { path: '/omnichannel', label: '全渠道履约', icon: Truck },
    ]
  },
  {
    title: '系统',
    items: [
      { path: '/erp-sync', label: 'ERP对接中心', icon: Link2 },
      { path: '/settings', label: '系统设置', icon: Settings },
    ]
  },
];

function OfflineStatusBar() {
  const {
    networkState,
    pendingCount,
    isSyncing,
    syncProgress,
    justSynced,
    syncNow,
    effectivelyOffline,
  } = useOffline();

  const isOnline = !effectivelyOffline;

  // 在线且无待同步且不同步中 → 显示小绿点
  if (isOnline && pendingCount === 0 && !isSyncing && !justSynced) {
    return (
      <div className="h-6 flex items-center justify-end px-4 bg-white border-b border-pos-line-soft">
        <span className="flex items-center gap-1.5 text-[11px] text-pos-ok">
          <span className="w-2 h-2 rounded-full bg-pos-ok animate-pulse" />
          网络正常
        </span>
      </div>
    );
  }

  return (
    <OfflineBanner
      pendingCount={pendingCount}
      onSyncNow={() => void syncNow()}
      isSyncing={isSyncing}
      syncProgress={syncProgress}
      justSynced={justSynced}
      isOnline={networkState.isOnline && networkState.isServerReachable}
      compact
    />
  );
}

const ROLE_LABEL: Record<EmployeeRole, string> = {
  cashier: '收银员',
  manager: '店长',
  supervisor: '督导',
};

function EmployeeBadge() {
  const { employee, logout } = useAuth();
  const navigate = useNavigate();
  if (!employee) return null;
  const initial = employee.name.slice(0, 1);
  const onLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-full bg-pos-accent-light flex items-center justify-center text-pos-accent text-sm font-semibold">
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-pos-ink truncate">{employee.name}</div>
        <div className="text-[11px] text-pos-ink-3">{ROLE_LABEL[employee.role]} · 当班中</div>
      </div>
      <button
        onClick={onLogout}
        title="退出登录"
        className="p-1.5 rounded-md text-pos-ink-3 hover:text-pos-danger hover:bg-pos-danger/10 transition-colors"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}

const Layout = () => {
  const location = useLocation();

  return (
    <div className="flex h-screen w-screen bg-pos-paper overflow-hidden">
      <aside className="w-56 bg-white text-pos-ink border-r border-pos-line flex flex-col flex-shrink-0 shadow-xs">
        <div className="px-5 py-4 border-b border-pos-line-soft">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-pos-accent flex items-center justify-center">
              <ScanLine size={18} className="text-white" />
            </div>
            <div>
              <div className="font-serif font-bold text-base leading-tight text-pos-ink">我的POS</div>
              <div className="text-[10px] text-pos-ink-3 leading-tight">智慧门店</div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-pos-line-soft bg-pos-paper/50">
          <div className="text-[11px] text-pos-ink-3 mb-1">当前门店</div>
          <div className="text-sm font-semibold text-pos-ink">{STORE_NAME}</div>
          <div className="text-[11px] text-pos-ink-3 mt-0.5">{STORE_ID}</div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {navGroups.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-5 text-[10px] font-semibold text-pos-ink-3 uppercase tracking-wider mb-1.5">
                {group.title}
              </div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-5 py-2.5 text-sm font-medium transition-colors relative ${location.pathname === item.path ||(item.path !== '/pos' && location.pathname.startsWith(item.path))? 'bg-pos-accent-light text-pos-accent': 'text-pos-ink-2 hover:text-pos-ink hover:bg-pos-paper'}`
                    }
                  >
                    <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full transition-all ${location.pathname === item.path ||(item.path !== '/pos' && location.pathname.startsWith(item.path))? 'bg-pos-accent' : 'bg-transparent'}`} />
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-pos-line bg-pos-paper/50">
          <EmployeeBadge />
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
        <OfflineStatusBar />
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default Layout;
