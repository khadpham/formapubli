import { UserRole } from './roles';
import { db, auditLogs } from '@/db';

export interface AuditLogParams {
  action: 'VIEW_FISCAL_MANAGEMENT' | 'EXPORT_SALES_REPORT' | 'VOID_ORDER' | 'ADJUST_STOCK' | 'MUTATE_ORDER' | 'MANAGER_DISCOUNT_APPROVED' | 'MANAGER_DISCOUNT_DENIED' | 'TRANSFER_DISPATCH' | 'TRANSFER_RECEIVE' | 'TRANSFER_CANCEL' | 'CONSIGNMENT_STATEMENT' | 'CONSIGNMENT_SALE' | 'CONSIGNMENT_RETURN';
  actorRole: UserRole | string;
  actorId: string;
  resource: string;
  details?: string;
  ipAddress?: string;
}

/**
 * Trích xuất vai trò của người dùng từ Request Headers (x-formapubli-role).
 * Mặc định trả về ROLE_OWNER nếu môi trường local/dev chưa có hệ thống Auth bên ngoài.
 */
export function extractUserRole(req: Request): UserRole {
  const headerRole = req.headers.get('x-formapubli-role') as UserRole | null;
  const validRoles: UserRole[] = [
    'ROLE_OWNER',
    'ROLE_MANAGER',
    'ROLE_CASHIER',
    'ROLE_WAREHOUSE',
    'ROLE_TAX',
  ];

  if (headerRole && validRoles.includes(headerRole)) {
    return headerRole;
  }

  return 'ROLE_OWNER';
}

/**
 * LÁ CHẮN BẢO MẬT SỔ KÉP PHÍA SERVER (Server-side Scope Guard):
 * Ngăn chặn tuyệt đối việc kế toán thuế hoặc nhân viên chỉnh sửa param URL
 * để truy cập Sổ Quản trị thực tế nội bộ.
 */
export function enforceFiscalScope(
  userRole: UserRole,
  requestedScope: string = 'ALL'
): 'ALL' | 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT' {
  // 1. Kế toán thuế: BỊ ÉP CHẶT vào OFFICIAL_TAX, không có ngoại lệ
  if (userRole === 'ROLE_TAX') {
    return 'OFFICIAL_TAX';
  }

  // 2. Thu ngân / Thủ kho: Không có thẩm quyền xem báo cáo gộp toàn công ty
  if (userRole === 'ROLE_CASHIER' || userRole === 'ROLE_WAREHOUSE') {
    if (requestedScope === 'ALL' || requestedScope === 'INTERNAL_MANAGEMENT') {
      return 'INTERNAL_MANAGEMENT'; // Giới hạn trong phạm vi nội bộ tác nghiệp tại quầy
    }
  }

  // 3. Chủ quản lý / Giám đốc: Toàn quyền truy cập theo yêu cầu
  if (requestedScope === 'OFFICIAL_TAX') return 'OFFICIAL_TAX';
  if (requestedScope === 'INTERNAL_MANAGEMENT') return 'INTERNAL_MANAGEMENT';
  return 'ALL';
}

/**
 * Ghi vết nhật ký kiểm toán (Audit Trail) cho các thao tác nhạy cảm
 */
export async function recordAuditLog(params: AuditLogParams): Promise<void> {
  try {
    const id = `aud-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    await db.insert(auditLogs).values({
      id,
      action: params.action,
      actorRole: params.actorRole,
      actorId: params.actorId || 'unknown-actor',
      resource: params.resource,
      details: params.details,
      ipAddress: params.ipAddress || 'local',
    });
  } catch (error) {
    // Không làm sập luồng chính nếu lỗi ghi audit
    console.error('Lỗi khi ghi audit log:', error);
  }
}
