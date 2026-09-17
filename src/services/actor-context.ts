import type { UserRole } from '../lib/roles';

/**
 * Lane B — Danh tính nội bộ truyền tách khỏi payload client (theo docs/PHASE0_CONTRACT.md §1).
 * Lane A trích từ session đã xác thực; Lane B chỉ dùng để phân quyền + ghi audit.
 * staffId là khóa ổn định; fullName chỉ hiển thị, KHÔNG dùng phân quyền.
 * (Lane A centralize khi có kiểu dùng chung — hiện đặt tạm ở services để Lane B chạy trước.)
 */
export interface ActorContext {
  staffId: string;
  role: UserRole;
  fullName?: string;
  sessionId?: string;
}

/** Dựng context từ các tham số rời rạc hiện có (tương thích ngược trong lúc migrate). */
export function toActorContext(
  staffId: string | undefined | null,
  role: UserRole,
  fullName?: string
): ActorContext {
  return { staffId: staffId && `${staffId}`.trim() ? `${staffId}`.trim() : 'unknown-actor', role, fullName };
}
