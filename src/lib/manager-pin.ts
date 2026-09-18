import { hashString } from './export-hash';

/**
 * Xác thực mã PIN quản lý bằng hash (không bao giờ so plain-text trong source).
 *
 * - Client POS gửi PIN plain như cũ (managerPin: '9999').
 * - Server băm sha256(PIN + salt) rồi đối chiếu whitelist hash từ env
 *   MANAGER_PIN_HASHES (cách nhau bằng dấu phẩy).
 * - Chưa set env (local dev / test DB): fallback danh sách mặc định
 *   ['9999', '1234', '8888'] băm tại runtime + cảnh báo — production
 *   BẮT BUỘC set env.
 */
const DEFAULT_SALT = 'formapubli-pin-salt-2026';
const LEGACY_DEFAULT_PINS = ['9999', '1234', '8888'];

// KDF V2 cho PIN quản lý (PBKDF2-SHA256 native, Edge-safe):
//   `mpv2$<iterations>$<hex>` — verify chịu cả hash legacy `sha256(pin+salt)`.
const MP_KDF_ITERATIONS = 100000;

function bufferToHexLocal(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function pbkdf2PinHex(pin: string, salt: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`formapubli-mgrpin-v2:${salt}`), iterations },
    baseKey,
    256
  );
  return bufferToHexLocal(bits);
}

export async function hashPinV2(pin: string, salt?: string, iterations: number = MP_KDF_ITERATIONS): Promise<string> {
  const s = salt || getPinSalt();
  return `mpv2$${iterations}$${await pbkdf2PinHex(pin, s, iterations)}`;
}

async function matchesWhitelist(clean: string, hashes: string[]): Promise<boolean> {
  for (const h of hashes) {
    const norm = `${h}`.trim().toLowerCase();
    if (norm.startsWith('mpv2$')) {
      const parts = norm.split('$');
      const iterations = parseInt(parts[1] || '', 10) || MP_KDF_ITERATIONS;
      const expected = parts[2] || '';
      const computed = await pbkdf2PinHex(clean, getPinSalt(), iterations);
      if (computed === expected) return true;
    } else if (hashPin(clean) === norm) {
      return true;
    }
  }
  return false;
}

export function getPinSalt(): string {
  return process.env.MANAGER_PIN_SALT || DEFAULT_SALT;
}

export function hashPin(pin: string): string {
  return hashString(`${pin}${getPinSalt()}`);
}

function getWhitelistHashes(): { hashes: string[]; usingFallback: boolean } {
  const raw = (process.env.MANAGER_PIN_HASHES || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (raw.length > 0) return { hashes: raw, usingFallback: false };
  // 2.4: fail-closed trên production — không bao giờ dùng PIN mặc định ở prod
  if (process.env.NODE_ENV === 'production') {
    throw new Error('MANAGER_PIN_HASHES chưa cấu hình trên production — từ chối xác thực PIN.');
  }
  return { hashes: LEGACY_DEFAULT_PINS.map((p) => hashPin(p)), usingFallback: true };
}

export async function isValidManagerPin(pin: string | null | undefined): Promise<boolean> {
  if (pin === null || pin === undefined) return false;
  const clean = `${pin}`.trim();
  if (!clean) return false;
  const { hashes, usingFallback } = getWhitelistHashes();
  if (usingFallback) {
    console.warn(
      '[manager-pin] MANAGER_PIN_HASHES chưa set — dùng PIN mặc định dev. Production bắt buộc set env!'
    );
  }
  return matchesWhitelist(clean, hashes);
}

/** Sinh hash V2 để bỏ vào env (chạy 1 lần khi cấp PIN mới, không commit PIN). */
export async function hashPinForEnv(pin: string, salt?: string): Promise<string> {
  return hashPinV2(pin, salt);
}
