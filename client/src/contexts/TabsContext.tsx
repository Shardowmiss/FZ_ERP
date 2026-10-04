import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSystemConfig } from './SystemConfigContext';

export interface TabItem {
  key: string;
  label: string;
  path: string;
  closable: boolean;
}

interface TabsContextType {
  tabs: TabItem[];
  activeKey: string;
  openTab: (tab: Omit<TabItem, 'closable'> & { closable?: boolean }) => void;
  closeTab: (key: string) => void;
  closeOthers: (key: string) => void;
  closeAll: () => void;
  closeRight: (key: string) => void;
  switchTab: (key: string) => void;
  refreshTabLabel: (pathname: string, label: string) => void;
}

const TabsContext = createContext<TabsContextType | null>(null);

const STORAGE_KEY = 'erp_tabs_state';

const DASHBOARD_KEY = '/dashboard';
const DASHBOARD_PATH = '/dashboard';
const DASHBOARD_LABEL = '数据看板';

function getMenuLabelMap(): Record<string, string> {
  return {
    '/dashboard': DASHBOARD_LABEL,
    '/base/style': '款号管理',
    '/base/sku': 'SKU管理',
    '/base/color-group': '颜色组',
    '/base/size-group': '尺码组',
    '/base/material': '面辅料管理',
    '/base/supplier': '供应商管理',
    '/base/warehouse': '仓库档案',
    '/base/dealer': '经销商管理',
    '/base/store': '店仓管理',
    '/base/merge-audit': '合并审计',
    '/base/member-merge-audit': '会员合并审计',
    '/base/style-attribute': '款号属性维护',
    '/bom': 'BOM管理',
    '/production/bom': 'BOM管理',
    '/purchase/order': '面辅料采购订单',
    '/purchase/inbound': '面辅料采购入库',
    '/purchase/return': '面辅料采购退货',
    '/purchase/garment-order': '采购订单',
    '/purchase/garment-inbound': '采购入库',
    '/purchase/garment-return': '采购退货',
    '/purchase/reconciliation': '采购对账',
    '/production/material-purchase-order': '面辅料采购订单',
    '/production/material-purchase-inbound': '面辅料入库',
    '/production/mrp': 'MRP运算',
    '/production/cost': '成本核算',
    '/production/work-order': '生产工单',
    '/production/material-issue': '领料单',
    '/production/finish-receipt': '完工入库单',
    '/sales/order': '销售订单',
    '/sales/outbound': '销售出库',
    '/sales/return': '销售退货',
    '/sales/reconciliation': '销售对账',
    '/retail/order': '零售单',
    '/retail/return': '零售退货单',
    '/retail/report': '零售报表',
    '/inventory/query': '库存查询',
    '/inventory/flow': '库存流水',
    '/inventory/inbound': '入库单',
    '/inventory/outbound': '出库单',
    '/inventory/transfer': '调拨单',
    '/inventory/stocktake': '盘点单',
    '/inventory/warning': '库存预警',
    '/finance/receivable': '应收管理',
    '/finance/payable': '应付管理',
    '/finance/receipt': '收款单',
    '/finance/payment': '付款单',
    '/finance/profit': '毛利分析',
    '/finance/month-close': '月结管理',
    '/product/code-rule': '款号编码规则',
    '/product/color': '颜色',
    '/product/size': '尺码',
    '/product/size-group-relation': '尺码组与尺码关系',
    '/system/user': '用户管理',
    '/system/role': '角色管理',
    '/system/permission': '权限管理',
    '/system/operation-log': '操作日志',
    '/system/config': '系统配置',
    '/trade-show/theme': '订货会主题',
    '/trade-show/list': '订货会主单',
    '/trade-show/pre-order': '预订单',
    '/trade-show/summary': '预订汇总',
    '/trade-show/allocation': '配货管理',
    '/report/garment-purchase': '成衣采购查询',
    '/report/material-purchase': '面辅料采购查询',
    '/report/sales': '销售查询',
    '/report/retail': '零售查询',
    '/report/inventory': '库存查询',
    '/report/transfer': '调拨查询',
    '/report/stock-movement': '进销存查询',
    '/report/pivot': '透视分析',
    // 以下路径此前漏接，标签回退为原始英文路径名
    '/inventory/barcode': '条码/批次',
    '/inventory/mobile-stocktake': '移动盘点',
    '/inventory/replenish': '补货建议（采购向）',
    '/inventory/replenish-plan': '补货计划（门店向）',
    '/inventory/replenish-template': '补货模板（门店向）',
    '/omni': '全渠道订单',
    '/subcontract': '委外管理',
    '/member': '会员运营',
    '/member/manage': '会员管理',
    '/member/level': '会员等级',
    '/analytics/forecast': 'AI销量预测',
    '/analytics/lifecycle': '商品生命周期',
    '/analytics/bi': '自助BI钻取',
    '/pos/cashier': 'POS收银',
    '/pricing': '价格管理',
  };
}

export function getTabInfoFromPath(pathname: string): Omit<TabItem, 'closable'> {
  const labelMap = getMenuLabelMap();
  const sortedPaths = Object.keys(labelMap).sort((a, b) => b.length - a.length);

  for (const menuPath of sortedPaths) {
    if (pathname === menuPath) {
      return { key: menuPath, label: labelMap[menuPath], path: pathname };
    }
    if (pathname.startsWith(menuPath + '/')) {
      const subPath = pathname.slice(menuPath.length + 1).split('?')[0];
      const baseLabel = labelMap[menuPath];
      let label = baseLabel;
      if (subPath === 'new') label = `新增${baseLabel}`;
      else if (subPath.endsWith('/edit')) label = `编辑${baseLabel}`;
      else if (subPath && !subPath.includes('/')) label = `${baseLabel}详情`;
      else label = baseLabel;

      let key = menuPath;
      if (subPath === 'new') key = `${menuPath}/new`;
      else if (subPath.endsWith('/edit')) key = `${menuPath}/${subPath.split('/')[0]}/edit`;
      else if (subPath && !subPath.includes('/')) key = `${menuPath}/${subPath}`;

      return { key, label, path: pathname };
    }
  }

  return { key: pathname, label: pathname, path: pathname };
}

function loadTabsFromStorage(rememberTabs: boolean): { tabs: TabItem[]; activeKey: string } {
  if (!rememberTabs) {
    return {
      tabs: [{ key: DASHBOARD_KEY, label: DASHBOARD_LABEL, path: DASHBOARD_PATH, closable: true }],
      activeKey: DASHBOARD_KEY,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: TabItem[]; activeKey: string };
      if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const seen = new Set<string>();
         const deduped: TabItem[] = [];
         for (const t of parsed.tabs) {
           if (!t || !t.key) continue;
           const rawKey = String(t.key);
           const normalizedKey = rawKey.startsWith('/') ? rawKey : `/${rawKey}`;
           if (seen.has(normalizedKey)) continue;
           seen.add(normalizedKey);
           const rawPath = t.path || rawKey;
           const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
           deduped.push({
             key: normalizedKey,
             label: t.label || normalizedKey,
             path: normalizedPath,
             closable: normalizedKey !== DASHBOARD_KEY ? true : false,
           });
         }
        if (deduped.length > 0) {
           const active = parsed.activeKey && seen.has(parsed.activeKey)
             ? parsed.activeKey
             : parsed.activeKey && seen.has(`/${parsed.activeKey}`)
               ? `/${parsed.activeKey}`
               : deduped[0].key;
          return { tabs: deduped, activeKey: active };
        }
      }
    }
  } catch {
    // ignore
  }
  return {
    tabs: [{ key: DASHBOARD_KEY, label: DASHBOARD_LABEL, path: DASHBOARD_PATH, closable: true }],
    activeKey: DASHBOARD_KEY,
  };
}

function saveTabsToStorage(tabs: TabItem[], activeKey: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeKey }));
  } catch {
    // ignore
  }
}

export const TabsProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { config } = useSystemConfig();
  const rememberTabs = config.rememberTabs;
  const maxTabs = Math.max(3, config.maxTabs || 10);
  const initial = useRef(loadTabsFromStorage(rememberTabs));
  const [tabs, setTabs] = useState<TabItem[]>(initial.current.tabs);
  const activeKeyRef = useRef<string>(initial.current.activeKey);
  const isInitial = useRef(true);

  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === '/' || pathname === '/login' || pathname === '/403' || pathname === '/welcome') {
      if (pathname === '/' && tabs.length > 0) {
        const activeTab = tabs.find((t) => t.key === activeKeyRef.current) || tabs[0];
        if (activeTab?.path && activeTab.path !== '/') {
          navigate(activeTab.path, { replace: true });
        }
      }
      return;
    }

    const tabInfo = getTabInfoFromPath(pathname);
    const existingIndex = tabs.findIndex((t) => t.key === tabInfo.key);

    if (existingIndex >= 0) {
      const existingTab = tabs[existingIndex];
      let needsUpdate = false;
      const updated = { ...existingTab };
      if (existingTab.path !== pathname) {
        updated.path = pathname;
        needsUpdate = true;
      }
      if (existingTab.label !== tabInfo.label && tabInfo.key === existingTab.key) {
        updated.label = tabInfo.label;
        needsUpdate = true;
      }
      if (needsUpdate) {
        setTabs((prev) => {
          const next = [...prev];
          next[existingIndex] = updated;
          return next;
        });
      }
      activeKeyRef.current = tabInfo.key;
    } else {
      const newTab: TabItem = {
        ...tabInfo,
        closable: true,
      };
      setTabs((prev) => {
        let next = [...prev, newTab];
        if (next.length > maxTabs) {
          const lruIndex = next.findIndex((t) => t.closable && t.key !== activeKeyRef.current);
          if (lruIndex >= 0) {
            next = next.filter((_, i) => i !== lruIndex);
          }
        }
        return next;
      });
      activeKeyRef.current = tabInfo.key;
    }
    isInitial.current = false;
  }, [location.pathname, maxTabs]);

  useEffect(() => {
    saveTabsToStorage(tabs, activeKeyRef.current);
  }, [tabs]);

  const switchTab = useCallback(
    (key: string) => {
      const tab = tabs.find((t) => t.key === key);
      if (tab) {
        activeKeyRef.current = key;
        saveTabsToStorage(tabs, key);
        navigate(tab.path);
      }
    },
    [tabs, navigate],
  );

  const openTab = useCallback(
    (tab: Omit<TabItem, 'closable'> & { closable?: boolean }) => {
      const existing = tabs.find((t) => t.key === tab.key);
      if (existing) {
        activeKeyRef.current = tab.key;
        saveTabsToStorage(tabs, tab.key);
        navigate(existing.path);
        return;
      }
      const newTab: TabItem = {
        key: tab.key,
        label: tab.label,
        path: tab.path,
        closable: tab.closable !== false,
      };
      setTabs((prev) => {
        let next = [...prev, newTab];
        if (next.length > maxTabs) {
          const lruIndex = next.findIndex((t) => t.closable && t.key !== tab.key);
          if (lruIndex >= 0) {
            next = next.filter((_, i) => i !== lruIndex);
          }
        }
        return next;
      });
      activeKeyRef.current = tab.key;
      navigate(tab.path);
    },
    [tabs, navigate, maxTabs],
  );

  const closeTab = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((t) => t.key === key);
        if (index < 0) return prev;
        const next = prev.filter((t) => t.key !== key);

        if (activeKeyRef.current === key) {
          if (next.length > 0) {
            const neighbor = next[Math.max(0, index - 1)] || next[next.length - 1];
            activeKeyRef.current = neighbor.key;
            setTimeout(() => navigate(neighbor.path), 0);
          } else {
            activeKeyRef.current = '';
            setTimeout(() => navigate('/welcome'), 0);
          }
        }
        return next;
      });
    },
    [navigate],
  );

  const closeOthers = useCallback(
    (key: string) => {
      setTabs((prev) => prev.filter((t) => t.key === key));
      if (activeKeyRef.current !== key) {
        const tab = tabs.find((t) => t.key === key);
        if (tab) {
          activeKeyRef.current = key;
          navigate(tab.path);
        }
      }
    },
    [tabs, navigate],
  );

  const closeAll = useCallback(() => {
    setTabs([]);
    activeKeyRef.current = '';
    navigate('/welcome');
  }, [navigate]);

  const closeRight = useCallback(
    (key: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((t) => t.key === key);
        if (index < 0) return prev;
        const next = prev.slice(0, index + 1);
        if (next.length === 0) {
          activeKeyRef.current = '';
          setTimeout(() => navigate('/welcome'), 0);
          return [];
        }
        const activeStillThere = next.some((t) => t.key === activeKeyRef.current);
        if (!activeStillThere) {
          activeKeyRef.current = key;
          const tab = prev.find((t) => t.key === key);
          if (tab) setTimeout(() => navigate(tab.path), 0);
        }
        return next;
      });
    },
    [navigate],
  );

  const refreshTabLabel = useCallback((pathname: string, label: string) => {
    const info = getTabInfoFromPath(pathname);
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === info.key);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], label };
      return next;
    });
  }, []);

  const activeKey =
    tabs.find((t) => t.key === activeKeyRef.current)?.key ||
    (tabs[0]?.key ?? DASHBOARD_KEY);

  return (
    <TabsContext.Provider
      value={{
        tabs,
        activeKey,
        openTab,
        closeTab,
        closeOthers,
        closeAll,
        closeRight,
        switchTab,
        refreshTabLabel,
      }}
    >
      {children}
    </TabsContext.Provider>
  );
};

export const useTabs = () => {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    return {
      tabs: [],
      activeKey: DASHBOARD_KEY,
      openTab: () => {},
      closeTab: () => {},
      closeOthers: () => {},
      closeAll: () => {},
      closeRight: () => {},
      switchTab: () => {},
      refreshTabLabel: () => {},
    };
  }
  return ctx;
};
