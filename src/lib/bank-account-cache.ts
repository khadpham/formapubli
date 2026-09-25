/**
 * CACHE TÀI KHOẢN NGÂN HÀNG THEO KHO (offline QR).
 *
 * POS mất mạng vẫn phải sinh được QR: nguồn duy nhất cần mạng là
 * `/api/bank-accounts`. Cache JSON theo kho, tối đa 24 giờ — quá hạn thì
 * chặn QR offline thay vì hiển thị tài khoản có thể đã đổi.
 * Không phụ thuộc thư viện ngoài.
 */

export interface CachedBankAccount {
  id: string;
  label: string;
  bankBin: string;
  accountNo: string;
  accountName?: string | null;
}

export interface CachedBankAccounts {
  warehouseId: string;
  cachedAt: number;
  defaultId: string | null;
  accounts: CachedBankAccount[];
}

export const BANK_ACCOUNT_CACHE_TTL_MS = 24 * 3600_000;

const CACHE_KEY_PREFIX = 'formapubli.bankAccounts.';

function cacheKey(warehouseId: string): string {
  return `${CACHE_KEY_PREFIX}${warehouseId}`;
}

function isCachedBankAccount(value: unknown): value is CachedBankAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return (
    typeof account.id === 'string' &&
    typeof account.label === 'string' &&
    typeof account.bankBin === 'string' &&
    typeof account.accountNo === 'string'
  );
}

/**
 * Đọc cache tài khoản của một kho.
 * Từ chối: cache thiếu, JSON hỏng, warehouseId khác, cachedAt không hợp lệ,
 * danh sách tài khoản hỏng, và cache đã quá 24 giờ.
 */
export function readBankAccountsCache(warehouseId: string, now = Date.now()): CachedBankAccounts | null {
  if (!warehouseId) return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(cacheKey(warehouseId));
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const value = parsed as Record<string, unknown>;
  if (value.warehouseId !== warehouseId) return null;
  if (typeof value.cachedAt !== 'number' || !Number.isFinite(value.cachedAt)) return null;
  if (!Array.isArray(value.accounts) || !value.accounts.every(isCachedBankAccount)) return null;
  if (value.defaultId !== null && typeof value.defaultId !== 'string') return null;
  if (now - value.cachedAt >= BANK_ACCOUNT_CACHE_TTL_MS) return null;

  return {
    warehouseId,
    cachedAt: value.cachedAt,
    defaultId: (value.defaultId as string | null) ?? null,
    accounts: value.accounts as CachedBankAccount[],
  };
}

export function writeBankAccountsCache(value: CachedBankAccounts): void {
  if (!value?.warehouseId) return;
  try {
    localStorage.setItem(cacheKey(value.warehouseId), JSON.stringify(value));
  } catch {
    // localStorage bị chặn (private mode, hết quota) → offline QR chỉ dùng được khi còn mạng.
  }
}
