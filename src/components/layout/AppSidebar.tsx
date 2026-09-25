'use client';

import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Receipt,
  Users,
  BookOpenCheck,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  LogOut,
  X,
  FlaskConical,
  Sparkles,
} from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface AppSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentRole: UserRole;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  isNavigationDisabled?: boolean;
  onCloseMobile: () => void;
  onOpenCopilot?: () => void;
  onLogout?: () => void;
}

export function AppSidebar({
  currentTab,
  onSelectTab,
  currentRole,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  isNavigationDisabled = false,
  onCloseMobile,
  onOpenCopilot,
  onLogout,
}: AppSidebarProps) {
  const roleConfig = USER_ROLES[currentRole];
  const canUseCopilot = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  const [isMobileViewport, setIsMobileViewport] = React.useState<boolean | null>(null);
  const sidebarRef = React.useRef<HTMLElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const onCloseMobileRef = React.useRef(onCloseMobile);

  React.useEffect(() => {
    onCloseMobileRef.current = onCloseMobile;
  }, [onCloseMobile]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      setIsMobileViewport(false);
      return;
    }
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = () => setIsMobileViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  React.useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const shouldBeInert = isMobileViewport === null || (isMobileViewport && !isMobileOpen);
    if (shouldBeInert) sidebar.setAttribute('inert', '');
    else sidebar.removeAttribute('inert');
    return () => {
      if (shouldBeInert) sidebar.removeAttribute('inert');
    };
  }, [isMobileViewport, isMobileOpen]);

  React.useEffect(() => {
    if (!isMobileViewport || !isMobileOpen) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const mainContent = document.getElementById('app-main-content');
    mainContent?.setAttribute('inert', '');
    mainContent?.setAttribute('aria-hidden', 'true');
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>(focusableSelector) || []);
    getFocusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseMobileRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      mainContent?.removeAttribute('inert');
      mainContent?.removeAttribute('aria-hidden');
      restoreFocusRef.current?.focus();
    };
  }, [isMobileOpen, isMobileViewport]);

  const navItems = [
    {
      id: 'dashboard',
      label: 'Tổng Quan Toàn Cảnh',
      icon: LayoutDashboard,
      shortcut: 'Alt+1',
      color: 'text-indigo-600',
    },
    {
      id: 'pos',
      label: 'Quầy Bán Hàng POS',
      icon: ShoppingCart,
      shortcut: 'Alt+2',
      color: 'text-emerald-600',
    },
    {
      id: 'inventory',
      label: 'Kho Hàng & Thẻ Kho',
      icon: Boxes,
      shortcut: 'Alt+3',
      color: 'text-amber-600',
    },
    {
      id: 'sales',
      label: 'Doanh Số & Sổ Kép',
      icon: Receipt,
      shortcut: 'Alt+4',
      color: 'text-sky-600',
    },
    {
      id: 'partners',
      label: 'Đối Tác & Đại Lý',
      icon: Users,
      shortcut: 'Alt+5',
      color: 'text-purple-600',
    },
    {
      id: 'customers',
      label: 'Độc Giả & Gói Mùa',
      icon: BookOpenCheck,
      shortcut: 'Alt+6',
      color: 'text-rose-600',
    },
    {
      id: 'studio',
      label: 'Phân Tích & Dự Báo',
      icon: FlaskConical,
      shortcut: 'Alt+7',
      color: 'text-violet-600',
    },
    {
      id: 'settings',
      label: 'Cài Đặt',
      icon: Settings,
      shortcut: 'Alt+8',
      color: 'text-slate-600',
    },
  ];

  const visibleNavItems = roleConfig.allowedNavItems.flatMap((id) => {
    const item = navItems.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <button
          type="button"
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden transition-opacity"
          aria-label="Đóng menu"
        />
      )}

      {/* Sidebar Container */}
      <aside
        ref={sidebarRef}
        role={isMobileViewport ? 'dialog' : undefined}
        aria-modal={isMobileViewport && isMobileOpen ? true : undefined}
        aria-label="Menu điều hướng"
         aria-hidden={isMobileViewport === null || (isMobileViewport && !isMobileOpen) ? true : undefined}
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-900 text-slate-100 border-r border-slate-800 transition-all duration-300 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'w-20' : 'w-72'} pt-[env(safe-area-inset-top)]`}
      >
        {/* Header Branding */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-800">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-500/30 shrink-0">
              f
            </div>
            {!isCollapsed && (
              <div className="flex flex-col truncate">
                <span className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
                  formapubli <span className="text-indigo-400 font-mono text-xs">OS</span>
                </span>
                <span className="text-[10px] text-slate-400 truncate">Hệ Điều Hành Xuất Bản 3-in-1</span>
              </div>
            )}
          </div>

          {/* Close on Mobile */}
          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Đóng menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role Selector Card — Go-live: hiển thị vai trò phiên đăng nhập thật (read-only), đã xóa mô phỏng */}
        <div className="p-3 border-b border-slate-800">
          {!isCollapsed ? (
            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  Vai trò đăng nhập
                </span>
              </div>
              <div className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-medium">
                {roleConfig.label}
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                {roleConfig.description}
              </p>
            </div>
          ) : (
            <button
              type="button"
              title={`Vai trò: ${roleConfig.label} — bấm để mở rộng menu`}
              aria-label={`Vai trò hiện tại: ${roleConfig.label}. Bấm để mở rộng menu.`}
              className="w-full flex items-center justify-center p-2 rounded-xl bg-slate-800 text-indigo-400 cursor-pointer hover:bg-slate-700"
              onClick={onToggleCollapse}
            >
              <Shield className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation Items List */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            const isFirstVisibleItem = item.id === visibleNavItems[0]?.id;
            const isFirstManagementItem = item.id === 'partners';
            let mobileGroup: string | null = null;
            if (isFirstVisibleItem && item.id === 'dashboard') mobileGroup = 'Vận Hành';
            if (isFirstVisibleItem && item.id === 'pos') mobileGroup = 'POS';
            if (isFirstVisibleItem && item.id === 'inventory') mobileGroup = 'Kho';
            if (isFirstVisibleItem && item.id === 'sales') mobileGroup = 'Bán hàng';
            if (isFirstManagementItem) mobileGroup = 'Quản Trị';
            if (item.id === 'settings') mobileGroup = 'Chung';

            return (
              <React.Fragment key={item.id}>
                {mobileGroup && (
                  <p className="lg:hidden px-3 pt-3 pb-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
                    {mobileGroup}
                  </p>
                )}
                <button
                  type="button"
                  disabled={isNavigationDisabled}
                  onClick={() => {
                    if (isNavigationDisabled) return;
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  title={isCollapsed ? `${item.label} (${item.shortcut})` : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl font-medium text-sm transition-all duration-200 min-h-[48px] ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  } ${isCollapsed ? 'justify-center px-0' : ''} ${isNavigationDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 ${
                      isActive ? 'text-white' : item.color
                    }`}
                  />
                  {!isCollapsed && (
                    <div className="flex items-center justify-between flex-1 truncate gap-2">
                      <span className="truncate">{item.label}</span>
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded font-mono font-medium hidden sm:inline ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-800 text-slate-400 border border-slate-700/60'
                        }`}
                      >
                        {item.shortcut}
                      </span>
                    </div>
                  )}
                </button>
              </React.Fragment>
            );
          })}

          {/* AI Executive Copilot Quick Trigger (Chỉ hiển thị cho OWNER & MANAGER) */}
          {canUseCopilot && onOpenCopilot && (
            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                disabled={isNavigationDisabled}
                onClick={() => {
                  if (isNavigationDisabled) return;
                  onOpenCopilot();
                  onCloseMobile();
                }}
                title={isCollapsed ? 'Executive Copilot (Alt+C)' : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 border border-indigo-500/30 bg-gradient-to-r from-indigo-950/60 to-slate-900 text-indigo-200 hover:text-white hover:border-indigo-500/60 hover:from-indigo-900/80 ${
                  isCollapsed ? 'justify-center px-0' : ''
                }`}
              >
                <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 animate-pulse" />
                {!isCollapsed && (
                  <div className="flex items-center justify-between flex-1 truncate gap-2">
                    <span className="truncate font-semibold text-white">AI Copilot</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 hidden sm:inline">
                      Alt+C
                    </span>
                  </div>
                )}
              </button>
            </div>
          )}
        </nav>

        {/* Footer info & Collapse button */}
        <div className="p-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-slate-800 flex flex-col gap-2">
          {!isCollapsed && (
            <div className="flex items-center justify-between px-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Cloudflare D1 Edge
              </span>
              <span className="font-mono text-slate-500">v0.2.0</span>
            </div>
          )}

          <button
            onClick={onToggleCollapse}
            className="hidden lg:flex items-center justify-center gap-2 w-full py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span>Thu gọn Menu</span>
              </>
            )}
          </button>

          {onLogout && (
            <button
              type="button"
              disabled={isNavigationDisabled}
              onClick={() => {
                if (isNavigationDisabled) return;
                onLogout?.();
              }}
              title="Đăng xuất ca làm việc"
              className={`flex items-center gap-2 w-full py-2 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-slate-800 text-xs font-semibold transition-colors ${
                isCollapsed ? 'justify-center px-0' : 'px-3'
              }`}
            >
              <LogOut className="w-4 h-4 shrink-0" />
              {!isCollapsed && <span>Đăng xuất</span>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
