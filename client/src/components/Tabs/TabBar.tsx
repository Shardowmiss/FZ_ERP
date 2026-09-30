import React, { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, LogOut, User } from 'lucide-react';
import { useTabs, type TabItem } from '@client/src/contexts/TabsContext';
import { useAuth } from '@client/src/contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';

const TabBar: React.FC = () => {
  const { tabs, activeKey, switchTab, closeTab, closeOthers, closeAll, closeRight } = useTabs();
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabKey: string;
  } | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateArrows = () => {
      setShowLeftArrow(el.scrollLeft > 2);
      setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    updateArrows();
    el.addEventListener('scroll', updateArrows);
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      ro.disconnect();
    };
  }, [tabs.length]);

  useEffect(() => {
    const activeEl = document.querySelector<HTMLElement>(`[data-tab-key="${activeKey}"]`);
    if (activeEl && scrollRef.current) {
      const container = scrollRef.current;
      const elLeft = activeEl.offsetLeft;
      const elRight = elLeft + activeEl.offsetWidth;
      const viewLeft = container.scrollLeft;
      const viewRight = viewLeft + container.clientWidth;
      if (elLeft < viewLeft) {
        container.scrollTo({ left: elLeft - 8, behavior: 'smooth' });
      } else if (elRight > viewRight) {
        container.scrollTo({ left: elRight - container.clientWidth + 8, behavior: 'smooth' });
      }
    }
  }, [activeKey, location.pathname]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      setContextMenu(null);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const scroll = (dir: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = scrollRef.current.clientWidth * 0.6;
    scrollRef.current.scrollBy({
      left: dir === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  const handleContextMenu = (e: React.MouseEvent, tabKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, tabKey });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleCloseOthers = () => {
    closeOthers(activeKey);
  };

  return (
    <div className="hidden md:flex items-center h-9 bg-gray-50 border-b border-gray-200 flex-shrink-0 relative">
      {showLeftArrow && (
        <button
          type="button"
          onClick={() => scroll('left')}
          className="flex items-center justify-center w-6 h-9 text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
          title="向左滚动"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex-1 flex items-center overflow-x-auto scrollbar-hide px-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab: TabItem, index: number) => {
          const isActive = tab.key === activeKey;
          const isFirst = index === 0;
          return (
            <div
              key={tab.key}
              data-tab-key={tab.key}
              onClick={() => switchTab(tab.key)}
              onContextMenu={(e) => handleContextMenu(e, tab.key)}
              title={tab.label}
              className={`group relative flex items-center h-7 px-3 text-xs cursor-pointer select-none flex-shrink-0 transition-colors ${
                isActive
                  ? 'bg-white text-gray-800 border border-b-0 border-gray-200 rounded-t font-medium'
                  : 'bg-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              } ${!isFirst && !isActive ? 'border-l border-gray-200 last:border-r' : ''}`}
              style={{ minWidth: 0 }}
            >
              <span className="truncate max-w-[120px]">{tab.label}</span>
              {tab.closable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.key);
                  }}
                  className={`ml-1.5 flex-shrink-0 rounded-sm transition-opacity ${
                    isActive
                      ? 'opacity-60 hover:opacity-100 hover:bg-gray-200'
                      : 'opacity-0 group-hover:opacity-60 hover:bg-gray-200'
                  }`}
                  title="关闭"
                >
                  <X size={12} />
                </button>
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>

      {showRightArrow && (
        <button
          type="button"
          onClick={() => scroll('right')}
          className="flex items-center justify-center w-6 h-9 text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0"
          title="向右滚动"
        >
          <ChevronRight size={14} />
        </button>
      )}

      <div className="flex items-center h-full flex-shrink-0 border-l border-gray-200 pl-1 pr-2">
        <button
          type="button"
          onClick={handleCloseOthers}
          className="flex items-center justify-center w-7 h-7 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
          title="关闭其他标签"
        >
          <X size={14} />
        </button>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUserMenuOpen(!userMenuOpen);
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

          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg py-1 text-xs min-w-[120px] z-50">
              <div className="px-3 py-2 text-gray-400 border-b border-gray-100">
                <div className="text-gray-700 font-medium truncate">
                  {user?.name || user?.username}
                </div>
                <div className="text-[11px] truncate">{user?.username || ''}</div>
              </div>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-600 flex items-center gap-2"
                onClick={handleLogout}
              >
                <LogOut size={12} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded shadow-lg py-1 text-xs min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 hover:text-blue-600"
            onClick={() => closeTab(contextMenu.tabKey)}
          >
            关闭当前
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 hover:text-blue-600"
            onClick={() => closeOthers(contextMenu.tabKey)}
          >
            关闭其他
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-blue-50 hover:text-blue-600"
            onClick={() => closeRight(contextMenu.tabKey)}
          >
            关闭右侧
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 hover:bg-red-50 hover:text-red-600"
            onClick={closeAll}
          >
            关闭全部
          </button>
        </div>
      )}
    </div>
  );
};

export default TabBar;
