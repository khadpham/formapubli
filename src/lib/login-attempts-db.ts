import { db, loginAttemptBuckets } from '@/db';
import { eq, sql } from 'drizzle-orm';

/**
 * Khóa brute-force bền vững dùng chung DB (sống qua restart isolate và đa
 * instance edge — điều Map process-local không làm được).
 *
 * - Tầng 2 sau limiter in-memory ở auth-session: route login gọi cả hai,
 *   chặn nếu MỘT trong hai từ chối; ghi fail vào cả hai; reset cả hai khi đúng.
 * - Fail-open khi lỗi DB (ghi warn): giữ quầy bán được khi DB trục trặc;
 *   tầng in-memory vẫn chặn trong instance hiện tại.
 */
export const DB_MAX_STAFF_FAILS = 5;
export const DB_MAX_IP_FAILS = 10;
export const DB_LOCK_MS = 15 * 60 * 1000;

function bucketKey(prefix: 'staff' | 'ip', id: string): string {
  return `${prefix}:${id.trim().toLowerCase()}`;
}

async function readBucket(key: string): Promise<{ fails: number; lockedUntil: number } | null> {
  try {
    const rows = await db
      .select()
      .from(loginAttemptBuckets)
      .where(eq(loginAttemptBuckets.key, key))
      .limit(1);
    if (rows.length === 0) return null;
    return { fails: rows[0].fails, lockedUntil: rows[0].lockedUntil };
  } catch (err) {
    console.warn('[login-attempts-db] read fail-open:', (err as Error)?.message);
    return { fails: 0, lockedUntil: 0 };
  }
}

/** true = bị khóa DB. Fail-open (false) khi lỗi DB. */
export async function checkDbLocked(key: string): Promise<boolean> {
  const b = await readBucket(key);
  if (!b) return false;
  if (b.lockedUntil > 0 && b.lockedUntil <= Date.now() && b.fails > 0) {
    await resetDbKey(key);
    return false;
  }
  return b.lockedUntil > Date.now();
}

export async function checkDbDualLimit(
  ip: string,
  staffId: string
): Promise<{ allowed: boolean; reason?: 'STAFF_LOCKED' | 'IP_LOCKED'; waitMinutes?: number }> {
  if (staffId?.trim() && (await checkDbLocked(bucketKey('staff', staffId)))) {
    return { allowed: false, reason: 'STAFF_LOCKED', waitMinutes: 15 };
  }
  if (ip?.trim() && (await checkDbLocked(bucketKey('ip', ip)))) {
    return { allowed: false, reason: 'IP_LOCKED', waitMinutes: 15 };
  }
  return { allowed: true };
}

async function bumpDbKey(key: string, maxFails: number): Promise<{ locked: boolean; remaining: number }> {
  try {
    const now = Date.now();
    const cur = (await readBucket(key)) || { fails: 0, lockedUntil: 0 };
    const fails = cur.fails + 1;
    const locked = fails >= maxFails;
    const lockedUntil = locked ? now + DB_LOCK_MS : cur.lockedUntil;
    await db
      .insert(loginAttemptBuckets)
      .values({ key, fails, lockedUntil })
      .onConflictDoUpdate({
        target: loginAttemptBuckets.key,
        set: { fails, lockedUntil, updatedAt: new Date().toISOString() },
      });
    // Chặn phình bảng khi kẻ tấn công xoay key vô hạn (song song với
    // MAX_TRACKED_KEYS của tầng memory): tỉa key cũ nhất khi vượt trần.
    const total = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(loginAttemptBuckets)
      .then((r) => Number(r[0]?.n || 0))
      .catch(() => 0);
    if (total > 20000) {
      const stale = await db
        .select({ key: loginAttemptBuckets.key })
        .from(loginAttemptBuckets)
        .orderBy(loginAttemptBuckets.updatedAt)
        .limit(1000);
      for (const row of stale) {
        await db.delete(loginAttemptBuckets).where(eq(loginAttemptBuckets.key, row.key));
      }
    }
    return { locked, remaining: Math.max(0, maxFails - fails) };
  } catch (err) {
    console.warn('[login-attempts-db] bump fail-open:', (err as Error)?.message);
    return { locked: false, remaining: maxFails };
  }
}

export async function recordDbDualFail(
  ip: string,
  staffId: string
): Promise<{ staffLocked: boolean; ipLocked: boolean; remainingStaffAttempts: number }> {
  let staffLocked = false;
  let remainingStaffAttempts = DB_MAX_STAFF_FAILS;
  if (staffId?.trim()) {
    const r = await bumpDbKey(bucketKey('staff', staffId), DB_MAX_STAFF_FAILS);
    staffLocked = r.locked;
    remainingStaffAttempts = r.remaining;
  }
  let ipLocked = false;
  if (ip?.trim()) {
    ipLocked = (await bumpDbKey(bucketKey('ip', ip), DB_MAX_IP_FAILS)).locked;
  }
  return { staffLocked, ipLocked, remainingStaffAttempts };
}

export async function resetDbDualLimit(ip: string, staffId: string): Promise<void> {
  try {
    if (staffId?.trim()) await resetDbKey(bucketKey('staff', staffId));
  } catch (err) {
    console.warn('[login-attempts-db] reset fail-open:', (err as Error)?.message);
  }
}

export async function resetDbKey(key: string): Promise<void> {
  await db.delete(loginAttemptBuckets).where(eq(loginAttemptBuckets.key, key));
}
