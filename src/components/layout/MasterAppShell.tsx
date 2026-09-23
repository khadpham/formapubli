'use client';

import React, { useState } from 'react';
import { AppSidebar } from './AppSidebar';
import { ExecutiveDashboard } from '@/components/dashboard/ExecutiveDashboard';
import { PosCheckoutTerminal } from '@/components/pos/PosCheckoutTerminal';
import { StockOverviewMatrix } from '@/components/StockOverviewMatrix';
import { SalesLedgerView } from '@/components/sales/SalesLedgerView';
import { PendingOrdersView } from '@/components/sales/PendingOrdersView';
import { PartnersListView } from '@/components/partners/PartnersListView';
import { CustomersListView } from '@/components/customers/CustomersListView';
import { SettingsRbacView } from '@/components/settings/SettingsRbacView';
import { AnalyticsStudio } from '@/components/studio/AnalyticsStudio';
import { Menu, Shield, Sparkles, ShoppingCart, Boxes, Receipt, LayoutDashboard } from 'lucide-react';
import { LoginModal } from '@/components/auth/LoginModal';
import { CopilotDrawer } from '@/components/copilot/CopilotDrawer';
import { matchNavShortcut, matchActionShortcut, getShortcutLabel } from '@/lib/keyboard';
import { UserRole, USER_ROLES } from '@/lib/roles';

interface MasterAppShellProps {
  matrixBooks: any[];
  warehouseList: any[];
  partnerList: any[];
  ledgerList: any[];
  dbStatus: string;
  initialSession?: { role: UserRole; actorId: string; fullName?: string; expiresAt: number } | null;
  requiresAuth?: boolean;
}

export function MasterAppShell({
  matrixBooks,
  warehouseList,
  partnerList,
  ledgerList,
  dbStatus,
  initialSession = null,
  requiresAuth = false,
}: MasterAppShellProps) {
  const [session, setSession] = useState(initialSession);
  const [showLoginModal, setShowLoginModal] = useState(requiresAuth || !initialSession);
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [currentRole, setCurrentRole] = useState<UserRole>(initialSession?.role || 'ROLE_OWNER');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  // Copilot 3 trang thai: closed (bong bong) • mini (chat nho goc phai) • full (drawer phai).
  const [copilotView, setCopilotView] = useState<'closed' | 'mini' | 'full'>('closed');
  // Don nhap tu Copilot (prepare_sale_draft) → op vao gio POS khi qua tab POS.
  const [posDraft, setPosDraft] = useState<{
    nonce: number;
    items: Array<{ editionId: string; quantity: number }>;
    customerName?: string;
    phone?: string;
    address?: string;
    note?: string;
  } | null>(null);

  const handleApplyDraft = (draft: { items: Array<{ editionId: string; quantity: number }>; customerName?: string; phone?: string; address?: string; note?: string }) => {
    setPosDraft({ ...draft, nonce: Date.now() });
    if (roleConfig.allowedNavItems.includes('pos')) {
      setCurrentTab('pos');
    }
  };

  // Go-live: vai trò = phiên đăng nhập thật, đã xóa mô phỏng vai trò.

  // Thẩm quyền dùng Copilot: ROLE_OWNER hoặc ROLE_MANAGER (CEO vận hành)
  const canUseCopilot = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';

  // Cập nhật currentRole khi session thay đổi
  React.useEffect(() => {
    if (session?.role) {
      setCurrentRole(session.role);
    }
  }, [session]);

  const roleConfig = USER_ROLES[currentRole];

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
      setShowLoginModal(true);
      window.location.reload();
    }
  };

  // Nếu vai trò hiện tại không được phép truy cập tab này, tự chuyển về tab đầu tiên được phép
  React.useEffect(() => {
    if (!roleConfig.allowedNavItems.includes(currentTab)) {
      setCurrentTab(roleConfig.allowedNavItems[0]);
    }
  }, [currentRole, currentTab, roleConfig]);


  // Phím tắt bàn phím toàn cục:
  // - Windows: Alt + 1..8 (chuyển Tab), Alt + C (Copilot)
  // - macOS: Option + 1..8 (chuyển Tab), Option + C (Copilot)
  React.useEffect(() => {
    const handleGlobalNavShortcuts = (e: KeyboardEvent) => {
      // Phím tắt mở Copilot (Alt+C trên Win, Option+C trên Mac)
      if (matchActionShortcut(e, 'KeyC')) {
        e.preventDefault();
        if (canUseCopilot) {
          setCopilotView((prev) => (prev === 'closed' ? 'mini' : 'closed'));
        }
        return;
      }

      // Phím tắt chuyển Tab 1..8 (tự động nhận diện Win Alt+1..8 và Mac Option/Cmd+1..8)
      const digit = matchNavShortcut(e);
      if (digit) {
        const keyMap: Record<string, string> = {
          '1': 'dashboard',
          '2': 'pos',
          '3': 'inventory',
          '4': 'sales',
          '5': 'partners',
          '6': 'customers',
          '7': 'studio',
          '8': 'settings',
        };

        const targetTab = keyMap[digit];
        if (targetTab) {
          e.preventDefault();
          if (roleConfig.allowedNavItems.includes(targetTab)) {
            setCurrentTab(targetTab);
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalNavShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalNavShortcuts);
  }, [roleConfig, canUseCopilot]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Vertical Sidebar Navigation */}
      <AppSidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentRole={currentRole}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenCopilot={() => setCopilotView('mini')}
        onLogout={session ? handleLogout : undefined}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        {/* Top Bar for Mobile & Quick Status */}
        <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 md:px-8 flex items-center justify-between gap-4">
          {/* Mobile: chỉ tên trang (mở menu bằng nút Menu ở dock đáy) */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 text-sm hidden sm:inline">
                Khung Vận Hành:
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 flex items-center gap-1.5">
                {currentTab === 'dashboard' && 'Bảng Quản Trị'}
                {currentTab === 'pos' && 'Quầy Bán Hàng POS'}
                {currentTab === 'inventory' && 'Kho Hàng & Thẻ Kho'}
                {currentTab === 'sales' && 'Doanh Số & Sổ Kép'}
                {currentTab === 'partners' && 'Đối Tác & Đại Lý'}
                {currentTab === 'customers' && 'Độc Giả CRM'}
                {currentTab === 'studio' && 'Phân Tích & Dự Báo'}
                {currentTab === 'settings' && 'Cài Đặt'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* AI Copilot: chỉ desktop (mobile dùng bong bóng nổi góc) */}
            {canUseCopilot && (
              <button
                onClick={() => setCopilotView('mini')}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 shadow-xs transition-all active:scale-95 cursor-pointer"
                title="Mở Executive AI Copilot (Alt+C)"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
                <span className="hidden sm:inline">AI Copilot</span>
                <span className="text-[10px] px-1 rounded bg-indigo-200/60 text-indigo-800 font-mono hidden md:inline">
                  Alt+C
                </span>
              </button>
            )}

            {/* Role badge: chỉ desktop (mỗi máy đã đăng nhập role cố định) */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${roleConfig.badgeBg} ${roleConfig.badgeColor}`}
              title={roleConfig.label}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>{roleConfig.label}</span>
            </div>

            {/* Connection Status */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Edge: {dbStatus}</span>
            </div>
          </div>
        </header>


        {/* Dynamic View Body */}
        <main className="p-3 sm:p-4 md:p-8 max-w-7xl w-full mx-auto flex-1 pb-32 lg:pb-8">
          {currentTab === 'dashboard' && (
            <ExecutiveDashboard
              currentRole={currentRole}
              onNavigateTab={setCurrentTab}
            />
          )}

          {currentTab === 'pos' && (
            <PosCheckoutTerminal
              books={matrixBooks}
              currentRole={currentRole}
              externalDraft={posDraft}
              onDraftApplied={() => setPosDraft(null)}
              onOrderCompleted={() => {
                // Refresh data if needed
              }}
            />
          )}

          {currentTab === 'inventory' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
                    Kho Hàng & Thẻ Kho
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Kho 1 - Âu Cơ | Kho 2 - Quỳnh Mai | Kho 3 - Hội Chợ. Append-only Ledger chống âm kho tuyệt đối.
                  </p>
                </div>
              </div>
              <StockOverviewMatrix
                initialBooks={matrixBooks}
                warehouses={warehouseList}
                initialLedger={ledgerList}
                partners={partnerList}
                currentRole={currentRole}
              />
            </div>
          )}

          {currentTab === 'sales' && (
            <SalesLedgerView currentRole={currentRole} />
          )}

          {currentTab === 'sales' && (
            <PendingOrdersView currentRole={currentRole} />
          )}

          {currentTab === 'partners' && (
            <PartnersListView partners={partnerList} currentRole={currentRole} />
          )}

          {currentTab === 'customers' && <CustomersListView />}

          {currentTab === 'settings' && (
            <SettingsRbacView sessionRole={session?.role} />
          )}

          {currentTab === 'studio' && (
            <AnalyticsStudio currentRole={currentRole} />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Dock */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 px-2">
        <div className="flex items-center justify-around max-w-md mx-auto">
          {roleConfig.allowedNavItems.includes('dashboard') && (
            <button
              onClick={() => setCurrentTab('dashboard')}
              className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all min-h-[44px] ${
                currentTab === 'dashboard'
                  ? 'text-indigo-600 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span className="text-[10px] mt-0.5 tracking-tight">Tổng quan</span>
            </button>
          )}

          {roleConfig.allowedNavItems.includes('pos') && (
            <button
              onClick={() => setCurrentTab('pos')}
              className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all min-h-[44px] ${
                currentTab === 'pos'
                  ? 'text-indigo-600 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShoppingCart className="w-5 h-5" />
              <span className="text-[10px] mt-0.5 tracking-tight">Quầy POS</span>
            </button>
          )}

          {roleConfig.allowedNavItems.includes('inventory') && (
            <button
              onClick={() => setCurrentTab('inventory')}
              className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all min-h-[44px] ${
                currentTab === 'inventory'
                  ? 'text-indigo-600 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Boxes className="w-5 h-5" />
              <span className="text-[10px] mt-0.5 tracking-tight">Kho hàng</span>
            </button>
          )}

          {roleConfig.allowedNavItems.includes('sales') && (
            <button
              onClick={() => setCurrentTab('sales')}
              className={`flex flex-col items-center justify-center flex-1 py-1 rounded-xl transition-all min-h-[44px] ${
                currentTab === 'sales'
                  ? 'text-indigo-600 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Receipt className="w-5 h-5" />
              <span className="text-[10px] mt-0.5 tracking-tight">Đơn hàng</span>
            </button>
          )}

          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="flex flex-col items-center justify-center flex-1 py-1 rounded-xl text-slate-500 hover:text-slate-800 transition-all min-h-[44px]"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] mt-0.5 tracking-tight">Menu</span>
          </button>
        </div>
      </nav>

      {/* Login Modal ca làm việc */}
      {showLoginModal && (
        <LoginModal
          isClosable={!requiresAuth && !!session}
          onLoginSuccess={(newSession) => {
            setSession(newSession);
            setCurrentRole(newSession.role);
            setShowLoginModal(false);
            window.location.reload();
          }}
          onCancel={() => {
            if (!requiresAuth && !!session) {
              setShowLoginModal(false);
            }
          }}
        />
      )}

      {/* Bong bong Copilot goc phai duoi — hien khi dong, mo mini 1 cham */}
      {canUseCopilot && copilotView === 'closed' && (
        <button
          onClick={() => setCopilotView('mini')}
                title={`Mở Executive AI Copilot (${getShortcutLabel('C', { alt: true })})`}
          className="fixed bottom-32 right-4 lg:bottom-6 lg:right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-xl shadow-indigo-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <Sparkles className="w-6 h-6 animate-pulse" />
        </button>
      )}

      {/* Executive AI Copilot: mini chat + full drawer */}
      <CopilotDrawer
        currentRole={currentRole}
        isOpen={copilotView !== 'closed'}
        mode={copilotView === 'full' ? 'full' : 'mini'}
        onMinimize={() => setCopilotView('mini')}
        onExpand={() => setCopilotView('full')}
        onClose={() => setCopilotView('closed')}
        onApplyDraft={handleApplyDraft}
      />
    </div>
  );
}

