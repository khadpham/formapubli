import { eq } from 'drizzle-orm';
import { db, periodLocks } from '@/db';
import { AppError } from './app-error';
import { recordAuditLog } from '../lib/rbac-guard';
import type { UserRole } from '../lib/roles';

const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

function assertOwner(role: UserRole) {
  if (role !== 'ROLE_OWNER') throw AppError.forbidden('Chỉ chủ mới được khóa/mở sổ kỳ.');
}

/**
 * Khóa sổ kỳ đã quyết toán (GĐ3-P4, Q14). Kỳ bị khóa: không ghi/sửa chi phí
 * trong kỳ đó nữa. Chỉ chủ mở khóa được.
 */
export class PeriodLockService {
  static async isLocked(month: string): Promise<boolean> {
    if (!isMonth(month)) return false;
    const [row] = await db.select().from(periodLocks).where(eq(periodLocks.month, month)).limit(1);
    return !!row;
  }

  static async getInfo(month: string) {
    const [row] = await db.select().from(periodLocks).where(eq(periodLocks.month, month)).limit(1);
    return row || null;
  }

  /** Ném lỗi nếu kỳ đã khóa — gọi ở mọi API ghi dữ liệu theo kỳ. */
  static async assertUnlocked(month: string) {
    if (await this.isLocked(month)) {
      throw AppError.forbidden(`Kỳ ${month} đã khóa sổ. Chỉ chủ mở khóa mới được ghi tiếp.`);
    }
  }

  static async lock(month: string, actorRole: UserRole, actorId: string, note?: string) {
    assertOwner(actorRole);
    if (!isMonth(month)) throw AppError.invalid('Kỳ phải dạng YYYY-MM.');
    if (await this.isLocked(month)) throw AppError.conflict(`Kỳ ${month} đã khóa rồi.`);
    await db.insert(periodLocks).values({
      month,
      lockedBy: actorId,
      note: `${note || ''}`.trim() || null,
    });
    await recordAuditLog({
      action: 'PERIOD_LOCK' as any,
      actorRole,
      actorId,
      resource: '/api/owner/period-locks',
      details: `Khóa sổ kỳ ${month}.`,
    });
    return { month, locked: true };
  }

  static async unlock(month: string, actorRole: UserRole, actorId: string) {
    assertOwner(actorRole);
    if (!isMonth(month)) throw AppError.invalid('Kỳ phải dạng YYYY-MM.');
    if (!(await this.isLocked(month))) throw AppError.invalid(`Kỳ ${month} đang không khóa.`);
    await db.delete(periodLocks).where(eq(periodLocks.month, month));
    await recordAuditLog({
      action: 'PERIOD_LOCK' as any,
      actorRole,
      actorId,
      resource: '/api/owner/period-locks',
      details: `Mở khóa sổ kỳ ${month}.`,
    });
    return { month, locked: false };
  }
}
