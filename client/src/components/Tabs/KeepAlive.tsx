import React, { Suspense, useMemo, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTabs, getTabInfoFromPath } from '@client/src/contexts/TabsContext';

interface KeepAliveProps {
  children: React.ReactNode;
}

const KeepAlive: React.FC<KeepAliveProps> = ({ children }) => {
  const { tabs, activeKey } = useTabs();
  const location = useLocation();
  const cacheRef = useRef<Map<string, React.ReactNode>>(new Map());

  const activeTabInfo = useMemo(() => getTabInfoFromPath(location.pathname), [location.pathname]);

  useEffect(() => {
    const key = activeTabInfo.key;
    if (!cacheRef.current.has(key)) {
      cacheRef.current.set(key, children);
    }
    const validKeys = new Set(tabs.map((t) => t.key));
    for (const k of cacheRef.current.keys()) {
      if (!validKeys.has(k)) {
        cacheRef.current.delete(k);
      }
    }
  }, [activeTabInfo.key, children, tabs]);

  const cachedChildren = cacheRef.current.get(activeTabInfo.key) || children;

  return (
    <div className="relative w-full h-full">
      {tabs.map((tab) => {
        const isActive = tab.key === activeKey || tab.key === activeTabInfo.key;
        const content = tab.key === activeTabInfo.key ? cachedChildren : cacheRef.current.get(tab.key);
        if (!content && !isActive) return null;
        return (
          <div
            key={tab.key}
            className="absolute inset-0 overflow-auto"
            style={{ display: isActive ? 'block' : 'none' }}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
};

export default KeepAlive;
