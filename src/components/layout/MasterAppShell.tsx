'use client';

import React, { useState } from 'react';
import { AppSidebar } from './AppSidebar';
import { ExecutiveDashboard } from '@/components/dashboard/ExecutiveDashboard';
import { PosCheckoutTerminal } from '@/components/pos/PosCheckoutTerminal';
import { StockOverviewMatrix } from '@/components/StockOverviewMatrix';
import { SalesLedgerView } from '@/components/sales/SalesLedgerView';
import { PartnersListView } from '@/components/partners/PartnersListView';
import { CustomersListView } from '@/components/customers/CustomersListView';
import { SettingsRbacView } from '@/components/settings/SettingsRbacView';
import { UserRole, USER_ROLES } from '@/lib/roles';
import { Menu, Shield } from 'lucide-react';

interface MasterAppShellProps {
  matrixBooks: any[];
  warehouseList: any[];
  partnerList: any[];
  ledgerList: any[];
  dbStatus: string;
}

export function MasterAppShell({
  matrixBooks,
  warehouseList,
  partnerList,
  ledgerList,
  dbStatus,
}: MasterAppShellProps) {
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [currentRole, setCurrentRole] = useState<UserRole>('ROLE_OWNER');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const roleConfig = USER_ROLES[currentRole];

  // Nếu vai trò hiện tại không được phép truy cập tab này, tự chuyển về tab đầu tiên được phép
  React.useEffect(() => {
    if (!roleConfig.allowedNavItems.includes(currentTab)) {
      setCurrentTab(roleConfig.allowedNavItems[0]);
    }
  }, [currentRole, currentTab, roleConfig]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Vertical Sidebar Navigation */}
      <AppSidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        currentRole={currentRole}
        onRoleChange={setCurrentRole}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        {/* Top Bar for Mobile & Quick Status */}
        <header className="sticky top-0 z-30 h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 md:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800 text-sm hidden sm:inline">
                Khung Vận Hành:
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200">
                {currentTab === 'dashboard' && 'Bảng Quản Trị Toàn Cảnh'}
                {currentTab === 'pos' && 'Quầy Bán Hàng POS'}
                {currentTab === 'inventory' && 'Kho Hàng & Thẻ Kho Bất Biến'}
                {currentTab === 'sales' && 'Doanh Số & Sổ Kép'}
                {currentTab === 'partners' && 'Đối Tác & Kênh Sỉ'}
                {currentTab === 'customers' && 'Độc Giả & Gói Mùa'}
                {currentTab === 'settings' && 'Phân Quyền & Cài Đặt'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Active Role Badge */}
            <div
              onClick={() => setCurrentTab('settings')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-bold cursor-pointer transition-transform active:scale-95 ${roleConfig.badgeBg} ${roleConfig.badgeColor}`}
              title="Nhấn để đổi vai trò"
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
        <main className="p-4 md:p-8 max-w-7xl w-full mx-auto flex-1">
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
                    Kho Hàng & Thẻ Kho Bất Biến (3 Địa Điểm)
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
              />
            </div>
          )}

          {currentTab === 'sales' && (
            <SalesLedgerView currentRole={currentRole} />
          )}

          {currentTab === 'partners' && (
            <PartnersListView partners={partnerList} />
          )}

          {currentTab === 'customers' && <CustomersListView />}

          {currentTab === 'settings' && (
            <SettingsRbacView
              currentRole={currentRole}
              onRoleChange={setCurrentRole}
            />
          )}
        </main>
      </div>
    </div>
  );
}
