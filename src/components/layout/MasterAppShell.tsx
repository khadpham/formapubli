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
import { Menu, Shield, Sparkles } from 'lucide-react';
import { LoginModal } from '@/components/auth/LoginModal';
import { NotificationBell, type NotifyItem } from '@/components/notifications/NotificationBell';
import { CopilotDrawer } from '@/components/copilot/CopilotDrawer';
import { matchNavShortcut, matchActionShortcut, getShortcutLabel } from '@/lib/keyboard';
import { UserRole, USER_ROLES, getDefaultTabForRole, type RoleConfig } from '@/lib/roles';

// Chưa có phiên = không có config nào. Mảng rỗng để mọi lệnh kiểm tra
// allowedNavItems trả false, tức không tab nào mở được trước khi đăng nhập.
const NO_ROLE_CONFIG: RoleConfig = {
  id: '' as UserRole,
  label: '',
  badgeColor: '',
  badgeBg: '',
  description: '',
  allowedNavItems: [],
};

function isKnownRole(value: UserRole | null): value is UserRole {
  return !!value && Object.prototype.hasOwnProperty.call(USER_ROLES, value);
}

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
  // KHÔNG được default 'ROLE_OWNER'. Không có phiên = KHÔNG có quyền nào cả.
  // Trước đây default OWNER khiến dashboard Bảng Quản Trị render trước khi
  // biết thu ngân đăng nhập, rồi mới giới hạn lại — thu ngân thấy số liệu
  // kinh doanh trong khoảng thời gian đó.
  // GIỮ vai trò cuối khi phiên rớt (heartbeat 401) để POS không bị unmount và
  // làm mất sạch giỏ hàng — đó là lý do code cũ tách currentRole khỏi session.
  const [role, setRole] = useState<UserRole | null>(initialSession?.role ?? null);
  const currentRole: UserRole | null = isKnownRole(role) ? role : null;
  const [currentTab, setCurrentTab] = useState<string | null>(
    initialSession?.role ? getDefaultTabForRole(initialSession.role) : null
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isPosCheckoutBusy, setIsPosCheckoutBusy] = useState(false);
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

  React.useEffect(() => {
    if (!isPosCheckoutBusy) return;
    setCopilotView('closed');
    setPosDraft(null);
  }, [isPosCheckoutBusy]);

  const handleApplyDraft = (draft: { items: Array<{ editionId: string; quantity: number }>; customerName?: string; phone?: string; address?: string; note?: string }) => {
    if (isPosCheckoutBusy) return;
    setPosDraft({ ...draft, nonce: Date.now() });
    if (roleConfig.allowedNavItems.includes('pos')) {
      setCurrentTab('pos');
    }
  };

  // Go-live: vai trò = phiên đăng nhập thật, đã xóa mô phỏng vai trò.

  const roleConfig: RoleConfig = isKnownRole(currentRole) ? USER_ROLES[currentRole] : NO_ROLE_CONFIG;

  // Tab hợp lệ tính LÚC RENDER, không sửa trong useEffect. Nhờ vậy không bao
  // giờ có khung hình nào mà tab='dashboard' đi cùng role thu ngân.
  const effectiveTab: string | null = currentRole
    ? (roleConfig.allowedNavItems.includes(currentTab ?? '') ? currentTab : roleConfig.allowedNavItems[0])
    : null;

  React.useEffect(() => {
    if (currentTab !== effectiveTab) setCurrentTab(effectiveTab);
  }, [currentTab, effectiveTab]);

  // Thẩm quyền dùng Copilot: ROLE_OWNER hoặc ROLE_MANAGER (CEO vận hành)
  const canUseCopilot = currentRole === 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER';
  let mainBottomPadding = 'pb-[max(1rem,env(safe-area-inset-bottom))] lg:pb-8';
  let fabBottom = 'bottom-[max(1.5rem,env(safe-area-inset-bottom))]';
  if (effectiveTab === 'pos') {
    mainBottomPadding = canUseCopilot ? 'pb-44 lg:pb-8' : 'pb-32 lg:pb-8';
    if (canUseCopilot) fabBottom = 'bottom-[calc(max(1rem,env(safe-area-inset-bottom))_+_5.5rem)]';
  } else if (canUseCopilot) {
    mainBottomPadding = 'pb-28 lg:pb-8';
  }

  // S-01: heartbeat giữ lease cashier (5 phút/lần). 401 → mở lại login
  // (giữ nguyên giỏ/queue). Lỗi mạng/503 → im lặng thử lại kỳ sau.
  // Dọn timer khi unmount/đổi phiên. iPhone ngủ nền không đảm bảo timer —
  // mở app lại thì guard server từ chối thao tác ghi cho tới khi login mới.
  // S-OFFLINE: heartbeat thành công đóng dấu thời gian để POS biết lease
  // còn sống khi rớt mạng (client đối chiếu TTL 10 phút trước khi cho tạo
  // đơn offline mới). Xem POS checkout fallbackToOffline.
  React.useEffect(() => {
    if (session?.role !== 'ROLE_CASHIER') return;
    let alive = true;
    const beat = async () => {
      try {
        const res = await fetch('/api/auth/heartbeat', { method: 'POST' });
        if (!alive) return;
        if (res.status === 401) {
          setSession(null);
          setShowLoginModal(true);
        } else if (res.ok) {
          try {
            window.localStorage.setItem('formapubli.last_lease_ok', String(Date.now()));
          } catch {
            // private mode: bỏ qua, guard server vẫn là chốt cuối.
          }
        }
      } catch {
        // Offline hoặc lỗi tạm thời: giữ phiên, thử lại kỳ sau.
      }
    };
    const timer = setInterval(beat, 5 * 60 * 1000);
    void beat(); // Stamp ngay khi vào ca để offline gate có mốc, không chờ 5 phút.

    // S-01/iOS: WebKit và Chrome đóng băng setInterval khi khoá máy / chuyển app.
    // Lắng nghe visibilitychange và focus để gia hạn ngay khi mở lại màn hình —
    // không có nó thì iOS đóng băng timer và thu ngân bị đuổi dù không máy nào
    // tranh chấp (S-01b, xem docs/superpowers/plans/2026-09-24-pos-hardening-abc-master-plan.md §4.2).
    //
    // PHẢI throttle: `focus` bắn liên tục khi người dùng chuyển qua lại giữa các
    // cửa sổ, và `visibilitychange` bắn cả khi quay lại từ app ngân hàng. Bắn
    // request thô tới /api/auth/heartbeat mỗi lần là lãng phí (và Workers free
    // có trần subrequest mỗi request).
    let lastBeatAt = 0;
    const handleWakeup = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastBeatAt < 30_000) return;
      lastBeatAt = now;
      void beat();
    };
    document.addEventListener('visibilitychange', handleWakeup);
    window.addEventListener('focus', handleWakeup);

    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleWakeup);
      window.removeEventListener('focus', handleWakeup);
    };
  }, [session?.role, session?.actorId]);

  // Nguồn thông báo thứ hai (POS) — trước đây là một chuông riêng chỉ mở màn POS,
  // nay gộp vào chuông duy nhất để header không còn hai nút giống nhau.
  const posMountedAt = React.useRef(new Date().toISOString());
  const posNotifyItems = React.useMemo<NotifyItem[]>(() => {
    if (!roleConfig.allowedNavItems.includes('pos')) return [];
    return [{
      id: 'pos-connection',
      kind: 'pos',
      area: 'POS',
      severity: dbStatus && dbStatus !== 'offline' ? 'info' : 'warn',
      title: 'Kết nối hệ thống',
      body: `Kết nối hệ thống: ${dbStatus}. Bấm để mở quầy bán hàng.`,
      at: posMountedAt.current,
      href: 'pos',
    }];
  }, [dbStatus, roleConfig.allowedNavItems]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
      setRole(null);
      setShowLoginModal(true);
      window.location.reload();
    }
  };

  // Phím tắt bàn phím toàn cục:
  // - Windows: Alt + 1..8 (chuyển Tab), Alt + C (Copilot)
  // - macOS: Option + 1..8 (chuyển Tab), Option + C (Copilot)
  React.useEffect(() => {
    const handleGlobalNavShortcuts = (e: KeyboardEvent) => {
      if (isPosCheckoutBusy || isMobileSidebarOpen || copilotView !== 'closed') return;
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
        // Chỉ nuốt phím khi ta thực sự chuyển tab. Phím bị từ chối (chưa đăng
        // nhập, hoặc vai trò không được mở tab đó) phải rơi về mặc định của
        // trình duyệt thay vì bị preventDefault rồi làm không động gì.
        if (targetTab && roleConfig.allowedNavItems.includes(targetTab)) {
          e.preventDefault();
          setCurrentTab(targetTab);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalNavShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalNavShortcuts);
  }, [roleConfig, canUseCopilot, isPosCheckoutBusy, isMobileSidebarOpen, copilotView]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Vertical Sidebar Navigation — chưa có vai trò thì không render: trước
          đây truyền 'ROLE_CASHIER' giả khiến hiện 2 nút bấm được nhưng bấm
          không làm gì (effectiveTab null). Nút chết là dấu hiệu bấm rõ bị sai. */}
      {currentRole && (
        <AppSidebar
          currentTab={effectiveTab ?? ''}
          onSelectTab={setCurrentTab}
          currentRole={currentRole}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isMobileOpen={isMobileSidebarOpen}
          isNavigationDisabled={isPosCheckoutBusy || copilotView !== 'closed'}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          onOpenCopilot={() => setCopilotView('mini')}
          onLogout={session ? handleLogout : undefined}
        />
      )}

      {/* Main Content Area */}
      <div
        id="app-main-content"
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        <header className="sticky top-0 z-30 flex h-[max(3.5rem,calc(2.75rem_+_env(safe-area-inset-top)))] md:h-[max(4rem,calc(2.75rem_+_env(safe-area-inset-top)))] bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-4 md:px-8 pt-[env(safe-area-inset-top)] items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              disabled={isPosCheckoutBusy || copilotView !== 'closed'}
              onClick={() => setIsMobileSidebarOpen(true)}
              className="lg:hidden flex items-center justify-center w-11 h-11 -ml-2 rounded-xl text-slate-600 hover:bg-slate-100"
              aria-label="Mở menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1 md:flex-none">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-sm hidden sm:inline">
                  Khung Vận Hành:
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 flex items-center gap-1.5 truncate">
                  {effectiveTab === 'dashboard' && 'Bảng Quản Trị'}
                  {effectiveTab === 'pos' && 'Quầy Bán Hàng POS'}
                  {effectiveTab === 'inventory' && 'Kho Hàng & Thẻ Kho'}
                  {effectiveTab === 'sales' && 'Doanh Số & Sổ Kép'}
                  {effectiveTab === 'partners' && 'Đối Tác & Đại Lý'}
                  {effectiveTab === 'customers' && 'Độc Giả CRM'}
                  {effectiveTab === 'studio' && 'Phân Tích & Dự Báo'}
                  {effectiveTab === 'settings' && 'Cài Đặt'}
                </span>
              </div>
            </div>
          </div>

          <div className="relative flex items-center gap-2">
            {canUseCopilot && (
              <button
                type="button"
                disabled={isPosCheckoutBusy || isMobileSidebarOpen}
                aria-hidden={isPosCheckoutBusy || isMobileSidebarOpen}
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

            {currentRole && (
              <div
                className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold ${roleConfig.badgeBg} ${roleConfig.badgeColor}`}
                title={roleConfig.label}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{roleConfig.label}</span>
              </div>
            )}

            {/* MỘT chuông duy nhất — gộp nguồn POS + nguồn nghiệp vụ, có nhãn khu vực, xóa được. */}
            {session && (
              <NotificationBell onNavigate={setCurrentTab} extraItems={posNotifyItems} />
            )}

            {/* Connection Status */}
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Edge: {dbStatus}</span>
            </div>
          </div>
        </header>


        {/* Dynamic View Body — currentRole là cổng chặn DUY NHẤT. Không có phiên
            thì không render bất kỳ màn nghiệp vụ nào, kể cả 1 khung hình. */}
        <main className={`p-3 sm:p-4 md:p-8 max-w-7xl w-full mx-auto flex-1 ${mainBottomPadding}`}>
          {currentRole && effectiveTab === 'dashboard' && (
            <ExecutiveDashboard
              currentRole={currentRole}
              onNavigateTab={setCurrentTab}
            />
          )}

          {currentRole && effectiveTab === 'pos' && (
            <PosCheckoutTerminal
               books={matrixBooks}
               currentRole={currentRole}
               actorId={session?.actorId}
               isShellInteractionBlocked={isMobileSidebarOpen}
              onBusyChange={setIsPosCheckoutBusy}
              externalDraft={posDraft}
              onDraftApplied={() => setPosDraft(null)}
              onOrderCompleted={() => {
                // Refresh data if needed
              }}
            />
          )}

          {currentRole && effectiveTab === 'inventory' && (
            <div className="space-y-6">
              {/* Tên kho đã có ở pill top bar — ẩn cả card trên mobile */}
              <div className="hidden md:flex bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex-col md:flex-row items-start md:items-center justify-between gap-4">
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

          {currentRole && effectiveTab === 'sales' && (
            <SalesLedgerView currentRole={currentRole} />
          )}

          {currentRole && effectiveTab === 'sales' && (
            <PendingOrdersView currentRole={currentRole} />
          )}

          {currentRole && effectiveTab === 'partners' && (
            <PartnersListView partners={partnerList} currentRole={currentRole} />
          )}

          {currentRole && effectiveTab === 'customers' && <CustomersListView />}

          {currentRole && effectiveTab === 'settings' && (
            <SettingsRbacView sessionRole={session?.role} />
          )}

          {currentRole && effectiveTab === 'studio' && (
            <AnalyticsStudio currentRole={currentRole} />
          )}
        </main>
      </div>

      {/* Login Modal ca làm việc */}
      {showLoginModal && (
        <LoginModal
          isClosable={!requiresAuth && !!session}
          onLoginSuccess={(newSession) => {
            setSession(newSession);
            setRole(newSession.role);
            setCurrentTab(getDefaultTabForRole(newSession.role));
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
          type="button"
          disabled={isPosCheckoutBusy || isMobileSidebarOpen}
          aria-hidden={isPosCheckoutBusy || isMobileSidebarOpen}
          onClick={() => setCopilotView('mini')}
                title={`Mở Executive AI Copilot (${getShortcutLabel('C', { alt: true })})`}
          className={`fixed ${fabBottom} right-4 lg:bottom-6 lg:right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-xl shadow-indigo-600/30 flex items-center justify-center transition-transform hover:scale-105 active:scale-95 cursor-pointer`}
        >
          <Sparkles className="w-6 h-6 animate-pulse" />
        </button>
      )}

      {/* Executive AI Copilot: mini chat + full drawer */}
      {currentRole && (
        <CopilotDrawer
          currentRole={currentRole}
          isOpen={copilotView !== 'closed'}
          mode={copilotView === 'full' ? 'full' : 'mini'}
          onMinimize={() => setCopilotView('mini')}
          onExpand={() => setCopilotView('full')}
          onClose={() => setCopilotView('closed')}
          onApplyDraft={handleApplyDraft}
        />
      )}
    </div>
  );
}

