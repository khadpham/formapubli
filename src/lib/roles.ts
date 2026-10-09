export type UserRole = 
  | 'ROLE_OWNER' 
  | 'ROLE_MANAGER' 
  | 'ROLE_CASHIER' 
  | 'ROLE_WAREHOUSE' 
  | 'ROLE_TAX'
  | 'ROLE_SHOPEE_OPS';

export interface RoleConfig {
  id: UserRole;
  label: string;
  badgeColor: string;
  badgeBg: string;
  description: string;
  allowedNavItems: string[];
  hidden?: boolean; // Ẩn khỏi UI chọn role (vẫn giữ để tương thích dữ liệu cũ)
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
    allowedNavItems: ['chu', 'dashboard', 'pos', 'inventory', 'sales', 'shopee', 'partners', 'customers', 'contracts', 'settings', 'studio'],
  },
  ROLE_MANAGER: {
    id: 'ROLE_MANAGER',
    label: 'Quản Lý Vận Hành (Manager)',
    badgeColor: 'text-blue-700 border-blue-300',
    badgeBg: 'bg-blue-50',
    description: 'Điều phối bán hàng, duyệt chuyển kho, áp chiết khấu cho phép',
    allowedNavItems: ['dashboard', 'pos', 'inventory', 'sales', 'shopee', 'partners', 'customers', 'contracts', 'settings', 'studio'],
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
    label: 'Thủ Kho / Shopee',
    badgeColor: 'text-amber-700 border-amber-300',
    badgeBg: 'bg-amber-50',
    description: 'Quản lý kho, đơn online (portal) và đơn Shopee: nhận đơn, đóng gói, gửi hàng. Thấy tổng tiền đơn, không thấy doanh thu/lợi nhuận.',
    allowedNavItems: ['inventory', 'shopee', 'settings'],
  },
  ROLE_TAX: {
    id: 'ROLE_TAX',
    label: 'Kế Toán Thuế (Tax Accountant)',
    badgeColor: 'text-rose-700 border-rose-300',
    badgeBg: 'bg-rose-50',
    description: 'Chỉ xem số liệu Hóa đơn điện tử VAT chính thức (OFFICIAL_TAX), cách ly dữ liệu nội bộ',
    allowedNavItems: ['sales', 'inventory', 'settings'],
    hidden: true, // Ẩn khỏi UI đăng nhập chạm-chọn (kế toán thuế không dùng ở quầy)
  },
  ROLE_SHOPEE_OPS: {
    id: 'ROLE_SHOPEE_OPS',
    label: 'Nhân viên Shopee',
    badgeColor: 'text-orange-700 border-orange-300',
    badgeBg: 'bg-orange-50',
    description: 'Vận hành đơn Shopee trong kho được cấp, không thấy doanh thu tổng',
    allowedNavItems: ['shopee', 'settings'],
    hidden: true, // 2026-10-09: ẩn khỏi UI đăng nhập (gộp vào Thủ Kho / Shopee)
  },
};

// Vai trò lạ (cookie cũ, session tự chế, tên vai trò đã đổi) không có trong
// registry thì KHÔNG được mở tab nào. Trả '' (không phải 'dashboard') vì ''
// không nằm trong allowedNavItems của bất kỳ vai trò nào: mọi kiểm tra
// includes('') đều false, nên caller buộc phải rơi về nhánh "không có quyền".
//
// `?.` KHÔNG đủ: nó chỉ chặn key thiếu, không chặn key KẾ THỪA từ prototype.
// `role='toString'` hay `'constructor'` (chuỗi tấn công từ cookie/session) là
// key có thật trên Object.prototype nên `USER_ROLES[role]` trả về một hàm/ký
// hiệu ứng thay vì undefined → `.allowedNavItems[0]` ném TypeError. Đây chính
// là lớp crash mà P4 định vá. hasOwnProperty mới là kiểm tra đúng: chỉ key do
// chính registry khai báo mới được tin.
export function getDefaultTabForRole(role: UserRole): string {
  if (!Object.prototype.hasOwnProperty.call(USER_ROLES, role)) return '';
  return USER_ROLES[role].allowedNavItems[0] || '';
}

export function getSettingsAccess(role?: UserRole): SettingsAccess {
  const canManage = role === 'ROLE_OWNER' || role === 'ROLE_MANAGER';

  return {
    canManageAccounts: canManage,
    canManageBanks: canManage,
    canManagePrinter: canManage || role === 'ROLE_CASHIER',
  };
}
