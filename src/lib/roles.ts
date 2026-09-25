export type UserRole = 
  | 'ROLE_OWNER' 
  | 'ROLE_MANAGER' 
  | 'ROLE_CASHIER' 
  | 'ROLE_WAREHOUSE' 
  | 'ROLE_TAX';

export interface RoleConfig {
  id: UserRole;
  label: string;
  badgeColor: string;
  badgeBg: string;
  description: string;
  allowedNavItems: string[];
}

export interface SettingsAccess {
  canManageAccounts: boolean;
  canManageBanks: boolean;
  canManagePrinter: boolean;
}

export const USER_ROLES: Record<UserRole, RoleConfig> = {
  ROLE_OWNER: {
    id: 'ROLE_OWNER',
    label: 'Chủ Quản Lý (Super Admin)',
    badgeColor: 'text-purple-700 border-purple-300',
    badgeBg: 'bg-purple-50',
    description: 'Toàn quyền điều hành, xem Báo cáo Quản trị Thực tế Toàn cảnh và Sổ Kép',
    allowedNavItems: ['dashboard', 'pos', 'inventory', 'sales', 'partners', 'customers', 'settings', 'studio'],
  },
  ROLE_MANAGER: {
    id: 'ROLE_MANAGER',
    label: 'Quản Lý Vận Hành (Manager)',
    badgeColor: 'text-blue-700 border-blue-300',
    badgeBg: 'bg-blue-50',
    description: 'Điều phối bán hàng, duyệt chuyển kho, áp chiết khấu cho phép',
    allowedNavItems: ['dashboard', 'pos', 'inventory', 'sales', 'partners', 'customers', 'settings', 'studio'],
  },
  ROLE_CASHIER: {
    id: 'ROLE_CASHIER',
    label: 'Thu Ngân Hội Chợ (Cashier)',
    badgeColor: 'text-emerald-700 border-emerald-300',
    badgeBg: 'bg-emerald-50',
    description: 'Bán hàng quầy siêu tốc, không thấy doanh thu tổng',
    allowedNavItems: ['pos', 'settings'],
  },
  ROLE_WAREHOUSE: {
    id: 'ROLE_WAREHOUSE',
    label: 'Thủ Kho Chuyên Trách (Keeper)',
    badgeColor: 'text-amber-700 border-amber-300',
    badgeBg: 'bg-amber-50',
    description: 'Quản lý thẻ kho, nhập/xuất/chuyển kho 3 kho vật lý, không thấy doanh thu',
    allowedNavItems: ['inventory', 'settings'],
  },
  ROLE_TAX: {
    id: 'ROLE_TAX',
    label: 'Kế Toán Thuế (Tax Accountant)',
    badgeColor: 'text-rose-700 border-rose-300',
    badgeBg: 'bg-rose-50',
    description: 'Chỉ xem số liệu Hóa đơn điện tử VAT chính thức (OFFICIAL_TAX), cách ly dữ liệu nội bộ',
    allowedNavItems: ['sales', 'inventory', 'settings'],
  },
};

export function getDefaultTabForRole(role: UserRole): string {
  return USER_ROLES[role].allowedNavItems[0] || 'dashboard';
}

export function getSettingsAccess(role?: UserRole): SettingsAccess {
  const canManage = role === 'ROLE_OWNER' || role === 'ROLE_MANAGER';

  return {
    canManageAccounts: canManage,
    canManageBanks: canManage,
    canManagePrinter: canManage || role === 'ROLE_CASHIER',
  };
}
