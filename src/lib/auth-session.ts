import { UserRole } from './roles';
import { hashString } from './export-hash';
import { db, staffAccounts } from '@/db';
import { eq } from 'drizzle-orm';

export interface SessionPayload {
  role: UserRole;
  actorId: string;
  fullName?: string;
  sessionId?: string;
  issuedAt: number;
  expiresAt: number;
}


export const SESSION_COOKIE_NAME = 'formapubli_session';
export const SESSION_MAX_AGE_SECONDS = 12 * 3600; // 12 giờ cho một ca làm việc

const DEFAULT_DEV_SECRET = 'formapubli-super-secret-auth-key-at-least-32-chars-2026';

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.AUTH_STRICT === 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('BẮT BUỘC cấu hình AUTH_SECRET (tối thiểu 32 ký tự) khi bật AUTH_STRICT hoặc trên production!');
  }
  return DEFAULT_DEV_SECRET;
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 SIGNING & VERIFICATION (Web Crypto API - 100% Native Edge / Node)
// ---------------------------------------------------------------------------

async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

/**
 * Ký tạo Session Token: base64Payload.hexSignature
 */
export async function signSession(payload: SessionPayload, secret = getAuthSecret()): Promise<string> {
  const jsonStr = JSON.stringify(payload);
  const base64Payload = Buffer.from(jsonStr, 'utf-8').toString('base64url');
  const key = await getCryptoKey(secret);
  const enc = new TextEncoder();
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(base64Payload));
  return `${base64Payload}.${bufferToHex(signature)}`;
}

/**
 * Xác thực Session Token. Trả về payload nếu hợp lệ và chưa hết hạn, null nếu sai chữ ký hoặc quá hạn.
 */
export async function verifySession(token: string, secret = getAuthSecret()): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [base64Payload, hexSignature] = parts;
    if (!base64Payload || !hexSignature) return null;

    const key = await getCryptoKey(secret);
    const enc = new TextEncoder();
    const sigBuffer = hexToBuffer(hexSignature);
    const isValid = await crypto.subtle.verify('HMAC', key, sigBuffer, enc.encode(base64Payload));
    if (!isValid) return null;

    const jsonStr = Buffer.from(base64Payload, 'base64url').toString('utf-8');
    const payload = JSON.parse(jsonStr) as SessionPayload;

    if (!payload.role || !payload.actorId || !payload.expiresAt) return null;
    if (Date.now() > payload.expiresAt) return null; // Quá hạn 12h

    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// RATE LIMITING & CHỐNG BRUTE-FORCE IN-MEMORY
// Giới hạn 5 lần đăng nhập sai -> Khóa 15 phút
// ---------------------------------------------------------------------------

interface AttemptRecord {
  failedCount: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, AttemptRecord>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 phút

export function checkRateLimit(key: string): { allowed: boolean; waitMinutes?: number } {
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };

  const now = Date.now();
  if (record.lockedUntil > now) {
    const remainingMs = record.lockedUntil - now;
    return { allowed: false, waitMinutes: Math.ceil(remainingMs / 60000) };
  }

  // Đã hết thời gian khóa -> reset
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    loginAttempts.delete(key);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordFailedAttempt(key: string): { locked: boolean; remainingAttempts: number } {
  const now = Date.now();
  const record = loginAttempts.get(key) || { failedCount: 0, lockedUntil: 0 };
  record.failedCount += 1;

  if (record.failedCount >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    loginAttempts.set(key, record);
    return { locked: true, remainingAttempts: 0 };
  }

  loginAttempts.set(key, record);
  return { locked: false, remainingAttempts: MAX_FAILED_ATTEMPTS - record.failedCount };
}

export const MAX_FAILED_ATTEMPTS_STAFF = 5;
export const MAX_FAILED_ATTEMPTS_IP = 10;

export function checkDualRateLimit(
  ip: string,
  staffId: string
): { allowed: boolean; reason?: 'STAFF_LOCKED' | 'IP_LOCKED'; waitMinutes?: number } {
  if (staffId && staffId.trim()) {
    const staffCheck = checkRateLimit(`staff:${staffId.trim().toLowerCase()}`);
    if (!staffCheck.allowed) {
      return { allowed: false, reason: 'STAFF_LOCKED', waitMinutes: staffCheck.waitMinutes };
    }
  }
  if (ip && ip.trim()) {
    const ipCheck = checkRateLimit(`ip:${ip.trim()}`);
    if (!ipCheck.allowed) {
      return { allowed: false, reason: 'IP_LOCKED', waitMinutes: ipCheck.waitMinutes };
    }
  }
  return { allowed: true };
}

export function recordDualFailedAttempt(
  ip: string,
  staffId: string
): { staffLocked: boolean; ipLocked: boolean; remainingStaffAttempts: number } {
  let staffLocked = false;
  let remainingStaffAttempts = MAX_FAILED_ATTEMPTS_STAFF;

  if (staffId && staffId.trim()) {
    const staffRes = recordFailedAttempt(`staff:${staffId.trim().toLowerCase()}`);
    staffLocked = staffRes.locked;
    remainingStaffAttempts = staffRes.remainingAttempts;
  }

  let ipLocked = false;
  if (ip && ip.trim()) {
    // Ngưỡng IP: 10 lần
    const key = `ip:${ip.trim()}`;
    const now = Date.now();
    const record = loginAttempts.get(key) || { failedCount: 0, lockedUntil: 0 };
    record.failedCount += 1;
    if (record.failedCount >= MAX_FAILED_ATTEMPTS_IP) {
      record.lockedUntil = now + LOCKOUT_DURATION_MS;
      loginAttempts.set(key, record);
      ipLocked = true;
    } else {
      loginAttempts.set(key, record);
    }
  }

  return { staffLocked, ipLocked, remainingStaffAttempts };
}

export function resetDualRateLimit(ip: string, staffId: string): void {
  if (staffId && staffId.trim()) {
    loginAttempts.delete(`staff:${staffId.trim().toLowerCase()}`);
  }
}

/** Backward-compat alias cho test và route cũ */
export function resetRateLimit(key: string): void {
  loginAttempts.delete(key);
}

// ---------------------------------------------------------------------------
// SLIDING WINDOW RATE LIMITER (In-Memory, Edge-safe)
// Dùng cho Copilot API (15 req/phút/staffId), không đụng checkRateLimit login.
// ---------------------------------------------------------------------------

const slidingWindows = new Map<string, number[]>();

export interface WindowRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAfterMs: number;
}

export function checkWindowRateLimit(
  key: string,
  limit: number = 15,
  windowMs: number = 60 * 1000
): WindowRateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;
  let timestamps = slidingWindows.get(key) || [];

  // Lọc bỏ timestamp cũ ngoài window
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const resetAfterMs = Math.max(0, oldest + windowMs - now);
    slidingWindows.set(key, timestamps);
    return {
      allowed: false,
      remaining: 0,
      resetAfterMs,
    };
  }

  timestamps.push(now);
  slidingWindows.set(key, timestamps);
  return {
    allowed: true,
    remaining: limit - timestamps.length,
    resetAfterMs: windowMs,
  };
}

export function resetWindowRateLimit(key: string): void {
  slidingWindows.delete(key);
}


// ---------------------------------------------------------------------------
// ROLE PASSCODES STORE & VALIDATION
// Hỗ trợ mã PIN/Passcode riêng cho từng Role
// ---------------------------------------------------------------------------

// Salt riêng cho Auth Passcode
const AUTH_PASSCODE_SALT = process.env.AUTH_PASSCODE_SALT || 'formapubli-auth-passcode-salt-2026';

function hashPasscode(passcode: string): string {
  // Pure-TS (Edge-safe: không require('crypto') của Node)
  return hashString(`${passcode}${AUTH_PASSCODE_SALT}`);
}

/** Băm mật khẩu nhân viên với salt riêng của từng tài khoản — Pure-TS, Edge-safe */
export function hashStaffPasscode(passcode: string, salt: string): string {
  return hashString(`${passcode}:${salt}`);
}

/** So sánh hằng thời gian (timing-safe) cho hash passcode — Edge-safe, thuần TS. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StaffSeedData {
  staffId: string;
  fullName: string;
  role: UserRole;
  passcode: string;
  salt: string;
}

export const DEFAULT_STAFF_ACCOUNTS: StaffSeedData[] = [
  {
    staffId: 'ADMIN-01',
    fullName: 'Chủ Quản Lý',
    role: 'ROLE_OWNER',
    passcode: 'owner9999',
    salt: 'salt_admin_01',
  },
  {
    staffId: 'QL-01',
    fullName: 'Quản Lý Vận Hành',
    role: 'ROLE_MANAGER',
    passcode: 'manager8888',
    salt: 'salt_ql_01',
  },
  {
    staffId: 'NV-01',
    fullName: 'Thu Ngân 01',
    role: 'ROLE_CASHIER',
    passcode: '1234',
    salt: 'salt_nv_01',
  },
  {
    staffId: 'NV-02',
    fullName: 'Thu Ngân 02',
    role: 'ROLE_CASHIER',
    passcode: '1234',
    salt: 'salt_nv_02',
  },
  {
    staffId: 'KHO-01',
    fullName: 'Thủ Kho 01',
    role: 'ROLE_WAREHOUSE',
    passcode: '5678',
    salt: 'salt_kho_01',
  },
  {
    staffId: 'THUE-01',
    fullName: 'Kế Toán Thuế',
    role: 'ROLE_TAX',
    passcode: '7890',
    salt: 'salt_thue_01',
  },
];

/**
 * Danh sách Passcode mặc định trên local dev/test.
 * Production: cấu hình AUTH_ROLE_PASSCODES dạng JSON băm hoặc chuỗi env
 */
const DEFAULT_DEV_PASSCODES: Record<UserRole, string> = {
  ROLE_OWNER: 'owner9999',     // Owner cần passcode an toàn dài hơn
  ROLE_MANAGER: 'manager8888', // Manager passcode
  ROLE_CASHIER: '1234',        // Thu ngân quầy
  ROLE_WAREHOUSE: '5678',      // Thủ kho
  ROLE_TAX: '7890',            // Kế toán thuế
};


export function verifyRolePasscode(role: UserRole, passcode: string): boolean {
  if (!role || !passcode) return false;
  const clean = passcode.trim();
  if (!clean) return false;

  const envPasscodesRaw = process.env.AUTH_ROLE_PASSCODES;
  if (envPasscodesRaw) {
    try {
      const parsed = JSON.parse(envPasscodesRaw);
      const expectedHash = parsed[role];
      if (expectedHash) {
        return safeEqual(hashPasscode(clean), `${expectedHash}`.toLowerCase());
      }
    } catch {
      console.error('[auth-session] Lỗi parse AUTH_ROLE_PASSCODES từ env.');
    }
  }

  // Nếu là production hoặc strict mà chưa cấu hình envPasscodes -> FAIL CLOSED
  if (process.env.AUTH_STRICT === 'true' || process.env.NODE_ENV === 'production') {
    throw new Error(`AUTH_ROLE_PASSCODES chưa được thiết lập an toàn cho vai trò ${role} trên production!`);
  }

  // Fallback dev
  return safeEqual(`${DEFAULT_DEV_PASSCODES[role] || ''}`, clean);
}

// ---------------------------------------------------------------------------
// CONTRACT ADAPTERS cho Bước 3 (rbac-guard): tên export khóa cứng theo thỏa thuận
// Zero-Conflict — chỉ thêm mới, không đổi logic Lane 2 ở trên.
// ---------------------------------------------------------------------------

/** Alias tên cookie đúng contract. */
export const SESSION_COOKIE = SESSION_COOKIE_NAME;

/** Chế độ strict: AUTH_STRICT === 'true' (không dựa NODE_ENV). */
export function isAuthStrict(): boolean {
  return process.env.AUTH_STRICT === 'true';
}

/** Verify cookie thô → payload (null = thiếu/hết hạn/sai ký tự). */
export async function verifySessionCookie(raw: string | null | undefined): Promise<SessionPayload | null> {
  if (!raw || !`${raw}`.trim()) return null;
  return verifySession(`${raw}`.trim());
}

/** Alias recordLoginFailure đúng contract (ủy thác sang recordFailedAttempt). */
export function recordLoginFailure(key: string): { locked: boolean; remainingAttempts: number } {
  return recordFailedAttempt(key);
}

// ---------------------------------------------------------------------------
// BƯỚC 3 — ĐỌC SESSION TỪ REQUEST (async, dùng chung mọi route).
// Đọc header Cookie thô nên chạy được cả NextRequest runtime lẫn Request
// thường trong test. Không đụng logic Lane 2 ở trên.
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Trích session từ Cookie header (null = không có/không hợp lệ). */
export async function getSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const cookieHeader = req.headers.get('cookie') || '';
  const m = cookieHeader.match(/(?:^|;\s*)formapubli_session=([^;]+)/);
  if (!m) return null;
  try {
    return await verifySession(decodeURIComponent(m[1].trim()));
  } catch {
    return null;
  }
}

export function extractClientIp(req: Request): string {
  if (process.env.TRUST_PROXY === 'cloudflare') {
    const cf = req.headers.get('cf-connecting-ip');
    if (cf && cf.trim()) return cf.trim();
    return (req as any).ip || '127.0.0.1';
  }
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp && cfIp.trim()) return cfIp.trim();
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();
  return (req as any).ip || '127.0.0.1';
}

/**
 * Kiểm tra trạng thái tài khoản thời gian thực với CSDL.
 * Nếu tài khoản bị khóa/vô hiệu hóa (isActive = false) -> lập tức ném AuthError(401).
 * Nếu vai trò bị thay đổi -> ném AuthError(403).
 */
export async function validateSessionAccount(sess: SessionPayload): Promise<void> {
  if (!sess || !sess.actorId) return;
  try {
    const rows = await db
      .select()
      .from(staffAccounts)
      .where(eq(staffAccounts.staffId, sess.actorId))
      .limit(1);

    if (isAuthStrict()) {
      if (rows.length === 0 || !rows[0].isActive) {
        throw new AuthError(401, 'Tài khoản nhân viên đã bị vô hiệu hóa hoặc không tồn tại.');
      }
      if (rows[0].role !== sess.role) {
        throw new AuthError(403, `Vai trò của tài khoản đã thay đổi thành ${rows[0].role}.`);
      }
    } else {
      if (rows.length > 0) {
        if (!rows[0].isActive) {
          throw new AuthError(401, 'Tài khoản nhân viên đã bị vô hiệu hóa.');
        }
        if (rows[0].role !== sess.role) {
          throw new AuthError(403, `Vai trò của tài khoản đã thay đổi.`);
        }
      }
    }
  } catch (err: any) {
    if (err instanceof AuthError) throw err;
    if (isAuthStrict()) {
      throw new AuthError(401, `Xác thực tài khoản thất bại do lỗi kết nối CSDL: ${err?.message || 'Database unavailable'}`);
    }
    // Môi trường thường: Bỏ qua lỗi kết nối CSDL nếu chạy trong unit test không có bảng staffAccounts
  }
}

/**
 * Bắt buộc session hợp lệ + role trong allowlist. Ném AuthError 401/403.
 * Chỉ dùng khi isAuthStrict(); môi trường thường giữ hành vi header legacy.
 */
export async function requireSessionRole(req: Request, allowed: UserRole[]): Promise<SessionPayload> {
  const sess = await getSessionFromRequest(req);
  if (!sess) throw new AuthError(401, 'Thiếu phiên đăng nhập hợp lệ. Vui lòng đăng nhập ca làm việc.');
  await validateSessionAccount(sess);
  if (!allowed.includes(sess.role)) {
    throw new AuthError(403, `Vai trò ${sess.role} không đủ thẩm quyền cho thao tác này.`);
  }
  return sess;
}

import type { ActorContext } from '@/services/actor-context';

export interface RequestIdentity {
  role: string;
  actorId: string;
  fullName?: string;
  sessionId?: string;
  actorContext: ActorContext;
}

/**
 * Phân giải danh tính thống nhất cho route:
 * - strict → Bắt buộc session cookie hợp lệ (ném AuthError 401/403).
 * - thường → Nếu có cookie thì ưu tiên cookie; nếu không thì dùng legacy header.
 * Luôn cung cấp actorContext chuẩn mực chống mạo danh.
 */
export async function resolveRequestIdentity(
  req: Request,
  allowed: UserRole[],
  legacy: { role: string; actorId: string }
): Promise<RequestIdentity> {
  if (isAuthStrict()) {
    const sess = await requireSessionRole(req, allowed);
    return {
      role: sess.role,
      actorId: sess.actorId,
      fullName: sess.fullName,
      sessionId: sess.sessionId,
      actorContext: {
        staffId: sess.actorId,
        role: sess.role,
        fullName: sess.fullName,
        sessionId: sess.sessionId,
      },
    };
  }

  // Môi trường thường (local dev / backward-compat test):
  const sess = await getSessionFromRequest(req);
  if (sess) {
    await validateSessionAccount(sess);
    if (!allowed.includes(sess.role)) {
      throw new AuthError(403, `Vai trò ${sess.role} không đủ thẩm quyền cho thao tác này.`);
    }
    return {
      role: sess.role,
      actorId: sess.actorId,
      fullName: sess.fullName,
      sessionId: sess.sessionId,
      actorContext: {
        staffId: sess.actorId,
        role: sess.role,
        fullName: sess.fullName,
        sessionId: sess.sessionId,
      },
    };
  }

  return {
    role: legacy.role,
    actorId: legacy.actorId,
    actorContext: {
      staffId: legacy.actorId,
      role: legacy.role as UserRole,
    },
  };
}


