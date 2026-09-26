import { isPaymentWindowExpired } from './offline-db';

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

// ---------------------------------------------------------------------------
// PHIÊN CHUYỂN KHOẢN SỐNG SÓT QUA REFRESH
//
// `transferSession` của POS nằm trong React state nên refresh trình duyệt làm
// mất nó, trong khi đơn PENDING trên server vẫn giữ ATP 30 phút và đơn offline
// vẫn nằm trong IndexedDB. Cashier quay lại thấy màn hình trống, tưởng đơn
// chưa tạo, và bấm "Tạo đơn & hiện QR" lần nữa → hai đơn PENDING cho cùng một
// giỏ hàng. Cache lại phiên để modal mở lại đúng đơn cũ.
//
// Ảnh xác nhận KHÔNG nằm trong cache: blob không JSON hoá được. Phiên khôi
// phục luôn `paymentProof: null` và POS nạp lại ảnh từ IndexedDB theo
// `paymentProofId` — không bao giờ coi là đã có ảnh khi chưa thấy ảnh thật.
// ---------------------------------------------------------------------------

const SESSION_KEY_PREFIX = 'formapubli.transferSession.';

export interface CachedTransferSession {
  mode: 'ONLINE' | 'OFFLINE';
  orderId?: string;
  orderCode: string;
  idempotencyKey: string;
  warehouseId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  createdAt: string;
  expiresAt?: string;
  qrSnapshot: { dataUrl: string; payload: string; accountNo: string; content: string };
  /** Id ảnh trong IndexedDB (nếu đã chụp). Ảnh luôn phải nạp lại, không tin cache. */
  paymentProofId?: string;
  /**
   * Luôn `null` sau khi đọc lại: cache không chứa blob nên không được phép coi
   * là "đã có ảnh". POS nạp `paymentProofId` từ IndexedDB rồi mới gán vào phiên.
   */
  paymentProof: null;
}

function sessionKey(warehouseId: string): string {
  return `${SESSION_KEY_PREFIX}${warehouseId}`;
}

function isCachedTransferSession(value: unknown, warehouseId: string): value is CachedTransferSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return (
    session.warehouseId === warehouseId &&
    (session.mode === 'ONLINE' || session.mode === 'OFFLINE') &&
    typeof session.orderCode === 'string' &&
    (session.paymentMethod === 'BANK_TRANSFER' || session.paymentMethod === 'QR_CODE') &&
    typeof session.createdAt === 'string' &&
    typeof (session.qrSnapshot as { dataUrl?: unknown } | undefined)?.dataUrl === 'string'
  );
}

/** Đọc phiên chuyển khoản đang dang dở của một kho; hỏng hoặc sai kho thì null. */
export function readTransferSessionCache(warehouseId: string): CachedTransferSession | null {
  if (!warehouseId) return null;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(sessionKey(warehouseId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedTransferSession(parsed, warehouseId)) return null;
    // Đơn offline không có expiresAt: chỉ khoá phiên online đã quá cửa sổ 30 phút.
    if (isPaymentWindowExpired(parsed.expiresAt)) {
      writeTransferSessionCache(null, warehouseId);
      return null;
    }
    return { ...parsed, paymentProof: null };
  } catch {
    return null;
  }
}

/**
 * Ghi (hoặc xoá khi `value` null) phiên chuyển khoản của một kho.
 *
 * Khi xoá, `warehouseId` là BẮT BUỘC: không có `value` để suy ra kho, mà phiên
 * được lưu theo từng kho nên không thể đoán. Thiếu kho → no-op, không ném lỗi.
 */
export function writeTransferSessionCache(
  value: {
    mode: 'ONLINE' | 'OFFLINE';
    orderId?: string;
    orderCode: string;
    idempotencyKey: string;
    warehouseId: string;
    amount: number;
    paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
    createdAt: string;
    expiresAt?: string;
    qrSnapshot: { dataUrl: string; payload: string; accountNo: string; content: string };
    paymentProofId?: string;
  } | null,
  warehouseId = value?.warehouseId
): void {
  if (!warehouseId) return;
  try {
    if (!value) {
      localStorage.removeItem(sessionKey(warehouseId));
      return;
    }
    localStorage.setItem(sessionKey(warehouseId), JSON.stringify({ ...value, paymentProof: null }));
  } catch {
    // localStorage bị chặn → phiên không sống sót refresh, nhưng không được làm hỏng luồng.
  }
}
