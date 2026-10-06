import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabs, getTabInfoFromPath } from '@client/src/contexts/TabsContext';
import { useAuth } from '@client/src/contexts/AuthContext';
import { computeKeepAliveKeys, DEFAULT_MAX_KEEP_ALIVE } from './keepAliveStrategy';
import { routePermissions, exactMap, editPageMap } from '@client/src/config/menuConfig';

import WelcomePage from '@client/src/pages/Welcome/WelcomePage';
import NotFound from '@client/src/pages/NotFound/NotFound';

// M3：exactMap / editPageMap / routePermissions 现由 config/menuConfig 的
// routeComponents 单一真相源派生，点菜单即对应 registry 中的组件，杜绝漏接 <NotFound/>。

function getPermissionForPath(pathname: string): string | null {
  for (const [p, perm] of Object.entries(routePermissions).sort((a, b) => b[0].length - a[0].length)) {
    if (pathname === p || pathname.startsWith(p + '/')) {
      return perm;
    }
  }
  return null;
}

function getRouteComponent(pathname: string): React.ComponentType | null {
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

  // 互斥判定激活页签：优先按 activeKey 命中，未命中才回退到「由当前 location 解析出的页签」。
  // 原因：activeKey 由 TabsProvider 在 effect 中推进，会比 location 滞后一拍；
  // 若两个条件各自命中不同页签，会出现两个页签同时 display:block 叠加，
  // 后挂载的旧页盖住新页，表现为「点了菜单没切换」。这里强制只有一个激活项。
  const effectiveActiveKey =
    tabs.find((t) => t.key === activeKey)?.key ??
    tabs.find((t) => t.key === activeTabInfo.key && t.path === location.pathname)?.key;

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
        const isActive = tab.key === effectiveActiveKey;
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
