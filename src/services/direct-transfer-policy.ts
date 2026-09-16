/**
 * Direct Internal Transfer Policy (/api/inventory/transfer).
 * Single Source of Truth: docs/CP3_EXECUTION_PLAN.md §9.
 *
 * Rules:
 * - Direct transfer is restricted to ROLE_OWNER and ROLE_MANAGER.
 * - Allowed warehouse pairs come from a server-side configuration.
 * - Pair comparison is bidirectional and normalized.
 * - The default allowlist is empty, so the endpoint fails closed until explicitly configured.
 * - Transit, consignment, quarantine, and other virtual warehouse families are always forbidden.
 * - The service enforces the rule; route-only enforcement is insufficient.
 * - UI hides the operation when no valid pair is configured.
 */

import { UserRole } from '@/lib/roles';

export const ALLOWED_DIRECT_TRANSFER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  'ROLE_OWNER',
  'ROLE_MANAGER',
]);

export const FORBIDDEN_DIRECT_TRANSFER_WAREHOUSES: ReadonlySet<string> = new Set([
  'wh-in-transit',
  'wh-consignment',
  'wh-damaged',
  'wh-quarantine',
]);

/**
 * Chuẩn hóa cặp kho để so sánh hai chiều (bidirectional).
 * Ví dụ: 'wh-hn-main', 'wh-hn-display' -> 'wh-hn-display<->wh-hn-main'
 */
export function normalizeWarehousePair(w1: string, w2: string): string {
  const a = (w1 || '').trim();
  const b = (w2 || '').trim();
  return [a, b].sort().join('<->');
}

let runtimeAllowlist: Set<string> | null = null;

/**
 * Lấy allowlist các cặp kho được phép chuyển nội bộ trực tiếp.
 * Mặc định rỗng (Set trống) -> fail-closed tuyệt đối.
 * Có thể nạp từ biến môi trường DIRECT_TRANSFER_ALLOWLIST (vd: "wh-hn-main:wh-hn-display,wh-hcm-main:wh-hcm-display")
 * hoặc qua hàm cấu hình setDirectTransferAllowlist().
 */
export function getDirectTransferAllowlist(): ReadonlySet<string> {
  if (runtimeAllowlist !== null) {
    return runtimeAllowlist;
  }

  const set = new Set<string>();
  const envConfig = process.env.DIRECT_TRANSFER_ALLOWLIST;
  if (envConfig && envConfig.trim()) {
    const pairs = envConfig.split(',');
    for (const p of pairs) {
      const parts = p.split(':');
      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
        set.add(normalizeWarehousePair(parts[0], parts[1]));
      }
    }
  }

  return set;
}

/**
 * Cấu hình allowlist tại runtime (phục vụ test hoặc cấu hình động).
 */
export function setDirectTransferAllowlist(pairs: Array<[string, string]>): void {
  runtimeAllowlist = new Set<string>();
  for (const [w1, w2] of pairs) {
    if (w1 && w2 && w1.trim() !== w2.trim()) {
      runtimeAllowlist.add(normalizeWarehousePair(w1, w2));
    }
  }
}

/**
 * Reset allowlist về trạng thái mặc định (đọc từ env).
 */
export function resetDirectTransferAllowlist(): void {
  runtimeAllowlist = null;
}

/**
 * Helper kiểm tra xem hệ thống hiện có bất kỳ cặp kho nội bộ nào được cấu hình hay không.
 * Dùng cho UI để ẩn nút thao tác chuyển nội bộ trực tiếp khi chưa có cặp kho nào được phép.
 */
export function hasConfiguredDirectTransferPairs(): boolean {
  return getDirectTransferAllowlist().size > 0;
}

/**
 * Kiểm tra xem một cặp kho (from, to) có được phép chuyển nội bộ trực tiếp 1 bước hay không.
 * Áp dụng đầy đủ quy tắc fail-closed (SSOT §9, khôi phục strict CP3-B1.2):
 * 1. Kho nguồn và kho đích phải hợp lệ, khác nhau.
 * 2. Cấm tuyệt đối mọi kho thuộc nhóm ảo: transit, consignment, quarantine, damaged.
 * 3. Cặp kho phải nằm trong allowlist đã cấu hình. Mặc định allowlist rỗng -> trả về false.
 * Không cấu hình không được chuyển trực tiếp giữa bất kỳ cặp kho nào.
 */
export function isDirectTransferAllowed(fromWarehouseId: string, toWarehouseId: string): boolean {
  if (!fromWarehouseId || !toWarehouseId) return false;
  const from = fromWarehouseId.trim();
  const to = toWarehouseId.trim();
  if (from === to) return false;

  // Cấm kho ảo
  if (
    FORBIDDEN_DIRECT_TRANSFER_WAREHOUSES.has(from) ||
    FORBIDDEN_DIRECT_TRANSFER_WAREHOUSES.has(to) ||
    from.includes('transit') ||
    to.includes('transit') ||
    from.includes('consignment') ||
    to.includes('consignment') ||
    from.includes('quarantine') ||
    to.includes('quarantine') ||
    from.includes('damaged') ||
    to.includes('damaged')
  ) {
    return false;
  }

  const allowlist = getDirectTransferAllowlist();
  if (allowlist.size === 0) {
    return false; // Mặc định rỗng -> fail-closed (CP3-B1.2).
  }

  const normalized = normalizeWarehousePair(from, to);
  return allowlist.has(normalized);
  return true;
}

/**
 * Kiểm tra vai trò của actor có quyền thực hiện chuyển nội bộ trực tiếp hay không.
 */
export function isRoleAllowedForDirectTransfer(role: string): boolean {
  return ALLOWED_DIRECT_TRANSFER_ROLES.has(role as UserRole);
}
