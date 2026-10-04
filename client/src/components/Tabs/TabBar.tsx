import React, { useState, useRef, useEffect } from 'react';
import {
  X, ChevronLeft, ChevronRight, LogOut,
  MoreHorizontal, ListX, ArrowRightToLine, Trash2,
} from 'lucide-react';
import { useTabs, type TabItem } from '@client/src/contexts/TabsContext';
import { useAuth } from '@client/src/contexts/AuthContext';
import { getMenuIconByPath } from '@client/src/config/menuConfig';
import { LanguageSwitcher } from '@client/src/components/LanguageSwitcher';
import { useLocation, useNavigate } from 'react-router-dom';

/** 极简 className 拼接：过滤 falsy，避免长三元里出现 "undefined" */
const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

/** 右键菜单尺寸，用于视口内定位钳制（避免菜单被窗口边缘截断） */
const CTX_MENU_W = 176;
const CTX_MENU_H = 196;

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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

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

  // 激活页签自动滚入可视区。滚动容器自身需是定位元素（relative），
  // 子项的 offsetLeft 才是「内容坐标系」而非相对整个页签栏，否则滚动判定会失准。
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
      const target = e.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
      if (overflowRef.current && !overflowRef.current.contains(target)) {
        setOverflowOpen(false);
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
    // 钳制到视口内，避免菜单贴边时被截断
    const x = Math.min(e.clientX, window.innerWidth - CTX_MENU_W - 8);
    const y = Math.min(e.clientY, window.innerHeight - CTX_MENU_H - 8);
    setContextMenu({ x: Math.max(8, x), y: Math.max(8, y), tabKey });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleCloseOthers = () => {
    closeOthers(activeKey);
  };

  /** 中键（滚轮键）关闭页签 —— 主流编辑器/浏览器页签的通用交互 */
  const handleAuxClick = (e: React.MouseEvent, tab: TabItem) => {
    if (e.button === 1 && tab.closable) {
      e.preventDefault();
      closeTab(tab.key);
    }
  };

  const renderTabIcon = (tab: TabItem) => (
    <span
      className={cx(
        'flex items-center justify-center flex-shrink-0 transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5',
        tab.key === activeKey
          ? 'text-primary'
          : 'text-muted-foreground/70 group-hover:text-foreground/70',
      )}
    >
      {getMenuIconByPath(tab.path)}
    </span>
  );

  return (
    <div className="hidden md:flex items-center h-10 bg-white border-b border-border flex-shrink-0 relative select-none">
      {showLeftArrow && (
        <button
          type="button"
          onClick={() => scroll('left')}
          className="flex items-center justify-center w-6 h-7 ml-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0 transition-colors"
          title="向左滚动"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      <div
        ref={scrollRef}
        className="relative flex-1 flex items-center gap-0.5 h-full overflow-x-auto scrollbar-hide px-2"
        style={{ scrollbarWidth: 'none' }}
      >
        {tabs.map((tab: TabItem) => {
          const isActive = tab.key === activeKey;
          return (
            <div
              key={tab.key}
              data-tab-key={tab.key}
              role="tab"
              aria-selected={isActive}
              title={tab.label}
              onClick={() => switchTab(tab.key)}
              onAuxClick={(e) => handleAuxClick(e, tab)}
              onContextMenu={(e) => handleContextMenu(e, tab.key)}
              className={cx(
                'group relative inline-flex items-center h-full pl-2.5 pr-1.5 text-[13px] leading-none whitespace-nowrap cursor-pointer flex-shrink-0 transition-colors duration-150',
                isActive
                  ? 'text-primary font-medium bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/70',
              )}
            >
              {renderTabIcon(tab)}
              <span className="ml-1.5 truncate max-w-[140px]">{tab.label}</span>
              {tab.closable && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.key);
                  }}
                  className={cx(
                    'ml-1 flex items-center justify-center w-4 h-4 rounded-[3px] flex-shrink-0 transition-all duration-150',
                    isActive
                      ? 'text-primary/60 hover:text-primary hover:bg-primary/15'
                      : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-foreground/10',
                  )}
                  title="关闭"
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              )}
              {/* 激活指示条：贴齐页签栏底边 */}
              {isActive && (
                <span className="pointer-events-none absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full bg-primary" />
              )}
            </div>
          );
        })}
      </div>

      {showRightArrow && (
        <button
          type="button"
          onClick={() => scroll('right')}
          className="flex items-center justify-center w-6 h-7 mr-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted flex-shrink-0 transition-colors"
          title="向右滚动"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* 右侧操作区：溢出页签列表 / 关闭其他 / 用户 */}
      <div className="flex items-center h-full flex-shrink-0 gap-0.5 pl-1 pr-2 border-l border-border ml-1">
        <div className="relative" ref={overflowRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOverflowOpen(!overflowOpen);
            }}
            className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="全部页签"
          >
            <MoreHorizontal size={15} />
          </button>

          {overflowOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 z-50 max-h-[320px] overflow-y-auto">
              <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-b border-border">
                全部页签（{tabs.length}）
              </div>
              {tabs.map((tab) => (
                <div
                  key={tab.key}
                  className={cx(
                    'group flex items-center gap-2 px-2.5 py-1.5 text-[13px] cursor-pointer transition-colors',
                    tab.key === activeKey
                      ? 'text-primary bg-primary/10'
                      : 'text-foreground/80 hover:bg-muted',
                  )}
                  onClick={() => {
                    switchTab(tab.key);
                    setOverflowOpen(false);
                  }}
                >
                  <span className="flex items-center justify-center flex-shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                    {getMenuIconByPath(tab.path)}
                  </span>
                  <span className="flex-1 truncate">{tab.label}</span>
                  {tab.closable && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.key);
                      }}
                      className="flex items-center justify-center w-4 h-4 rounded-[3px] text-muted-foreground/60 hover:text-foreground hover:bg-foreground/10 flex-shrink-0"
                      title="关闭"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
              <div className="border-t border-border my-1" />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[13px] text-destructive hover:bg-destructive/10 flex items-center gap-2"
                onClick={() => {
                  closeAll();
                  setOverflowOpen(false);
                }}
              >
                <Trash2 size={13} />
                关闭全部
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleCloseOthers}
          className="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="关闭其他标签"
        >
          <ListX size={15} />
        </button>

        <div className="relative" ref={userMenuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUserMenuOpen(!userMenuOpen);
            }}
            className="flex items-center gap-2 h-7 pl-1 pr-2 rounded text-foreground/80 hover:text-foreground hover:bg-muted transition-colors"
          >
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-medium flex-shrink-0">
              {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
            </span>
            <span className="text-[13px] max-w-[88px] truncate">
              {user?.name || user?.username || '用户'}
            </span>
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-[168px] bg-popover border border-border rounded-lg shadow-lg py-1 z-50">
              <div className="px-3 py-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium flex-shrink-0">
                    {(user?.name || user?.username || 'U').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {user?.name || user?.username}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {user?.username || ''}
                    </div>
                  </div>
                </div>
              </div>
              <LanguageSwitcher />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[13px] text-foreground/80 hover:bg-muted flex items-center gap-2 transition-colors"
                onClick={handleLogout}
              >
                <LogOut size={13} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px] overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y, width: CTX_MENU_W }}
        >
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-[13px] text-foreground/80 hover:bg-muted flex items-center gap-2 transition-colors"
            onClick={() => closeTab(contextMenu.tabKey)}
          >
            <X size={13} />
            关闭当前
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-[13px] text-foreground/80 hover:bg-muted flex items-center gap-2 transition-colors"
            onClick={() => closeOthers(contextMenu.tabKey)}
          >
            <ListX size={13} />
            关闭其他
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-[13px] text-foreground/80 hover:bg-muted flex items-center gap-2 transition-colors"
            onClick={() => closeRight(contextMenu.tabKey)}
          >
            <ArrowRightToLine size={13} />
            关闭右侧
          </button>
          <div className="border-t border-border my-1" />
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-[13px] text-destructive hover:bg-destructive/10 flex items-center gap-2 transition-colors"
            onClick={closeAll}
          >
            <Trash2 size={13} />
            关闭全部
          </button>
        </div>
      )}
    </div>
  );
};

export default TabBar;
