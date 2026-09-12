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
  return { hashes: LEGACY_DEFAULT_PINS.map((p) => hashPin(p)), usingFallback: true };
}

export function isValidManagerPin(pin: string | null | undefined): boolean {
  if (pin === null || pin === undefined) return false;
  const clean = `${pin}`.trim();
  if (!clean) return false;
  const { hashes, usingFallback } = getWhitelistHashes();
  if (usingFallback) {
    console.warn(
      '[manager-pin] MANAGER_PIN_HASHES chưa set — dùng PIN mặc định dev. Production bắt buộc set env!'
    );
  }
  return hashes.includes(hashPin(clean));
}

/** Sinh hash để bỏ vào env (chạy 1 lần khi cấp PIN mới, không commit PIN). */
export function hashPinForEnv(pin: string, salt?: string): string {
  return hashString(`${pin}${salt || getPinSalt()}`);
}
