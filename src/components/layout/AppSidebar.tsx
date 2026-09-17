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
  X,
  FlaskConical,
  Sparkles,
} from 'lucide-react';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface AppSidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenCopilot?: () => void;
}

export function AppSidebar({
  currentTab,
  onSelectTab,
  currentRole,
  onRoleChange,
  isCollapsed,
  onToggleCollapse,
  isMobileOpen,
  onCloseMobile,
  onOpenCopilot,
}: AppSidebarProps) {
  const roleConfig = USER_ROLES[currentRole];
  const canUseCopilot = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

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
      label: 'Phân Quyền & Cài Đặt',
      icon: Settings,
      shortcut: 'Alt+8',
      color: 'text-slate-600',
    },
  ];

  const visibleNavItems = navItems.filter((item) =>
    roleConfig.allowedNavItems.includes(item.id)
  );

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 flex flex-col bg-slate-900 text-slate-100 border-r border-slate-800 transition-all duration-300 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${isCollapsed ? 'w-20' : 'w-72'}`}
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
            onClick={onCloseMobile}
            className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Role Selector Card */}
        <div className="p-3 border-b border-slate-800">
          {!isCollapsed ? (
            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5 text-indigo-400" />
                  Mô phỏng Vai trò (RBAC)
                </span>
              </div>
              <select
                value={currentRole}
                onChange={(e) => onRoleChange(e.target.value as UserRole)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-medium focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
              >
                {Object.values(USER_ROLES).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 leading-tight">
                {roleConfig.description}
              </p>
            </div>
          ) : (
            <div
              title={`Vai trò: ${roleConfig.label}`}
              className="flex items-center justify-center p-2 rounded-xl bg-slate-800 text-indigo-400 cursor-pointer"
              onClick={onToggleCollapse}
            >
              <Shield className="w-5 h-5" />
            </div>
          )}
        </div>

        {/* Navigation Items List */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                title={isCollapsed ? `${item.label} (${item.shortcut})` : undefined}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl font-medium text-sm transition-all duration-200 min-h-[48px] ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                } ${isCollapsed ? 'justify-center px-0' : ''}`}
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
            );
          })}

          {/* AI Executive Copilot Quick Trigger (Chỉ hiển thị cho OWNER & MANAGER) */}
          {canUseCopilot && onOpenCopilot && (
            <div className="pt-2 border-t border-slate-800/80">
              <button
                onClick={() => {
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
        <div className="p-3 border-t border-slate-800 flex flex-col gap-2">
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
        </div>
      </aside>
    </>
  );
}
