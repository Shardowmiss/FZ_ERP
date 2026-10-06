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
import { menuLabelMap } from '../config/menuConfig';

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

export function getTabInfoFromPath(pathname: string): Omit<TabItem, 'closable'> {
  const labelMap = menuLabelMap;
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
  // BUG FIX（单击不切换）：activeKey 原先只由 activeKeyRef.current 推导，而 ref 在
  // useEffect 内被改写时不会触发重渲染 —— 点击菜单导航后，若目标页签已存在且
  // path/label 未变（needsUpdate=false，setTabs 不调用），整个树不会重渲染，
  // 画面就停在旧页签上；只有再点一次（router 产生新 location 触发渲染）才切换。
  // 因此改用 state 作为渲染真相源，ref 仅保留给回调/setTabs updater 内同步读取。
  const [activeKeyState, setActiveKeyState] = useState<string>(initial.current.activeKey);
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
      // 关键：必须驱动 state，否则「页签已存在且无字段变更」时不会重渲染
      setActiveKeyState(tabInfo.key);
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
      setActiveKeyState(tabInfo.key);
    }
    isInitial.current = false;
  }, [location.pathname, maxTabs]);

  useEffect(() => {
    saveTabsToStorage(tabs, activeKeyRef.current);
  }, [tabs]);

  // 兜底同步：关闭页签等操作在 setTabs updater 内只改了 ref（updater 必须是纯函数，
  // 不能在里面 setState）。tabs 变化后把 ref 镜像回 state，保证 activeKey 一定驱动重渲染。
  useEffect(() => {
    setActiveKeyState((prev) => (prev === activeKeyRef.current ? prev : activeKeyRef.current));
  }, [tabs]);

  const switchTab = useCallback(
    (key: string) => {
      const tab = tabs.find((t) => t.key === key);
      if (tab) {
        activeKeyRef.current = key;
        setActiveKeyState(key);
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
        setActiveKeyState(tab.key);
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
      setActiveKeyState(tab.key);
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
          setActiveKeyState(key);
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
    tabs.find((t) => t.key === activeKeyState)?.key ||
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
