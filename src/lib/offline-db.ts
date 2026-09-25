/**
 * OFFLINE-FIRST INDEXEDDB ENGINE FOR FORMAPUBLI OS
 * Quản lý lưu trữ đơn hàng ngoại tuyến an toàn trên trình duyệt nhân viên.
 * Không phụ thuộc thư viện ngoài, zero-cost, tương thích 100% mọi trình duyệt.
 */

export interface OfflineOrderItem {
  editionId: string;
  code: string;
  title: string;
  quantity: number;
  unitCoverPrice: number;
}

export interface OfflineOrder {
  id: string; // UUID v7
  orderCode: string;
  idempotencyKey: string;
  warehouseId: string;
  customerName: string;
  channel: string;
  discountRate: number;
  paymentMethod: string;
  moneyReceived?: boolean;
  fiscalScope: 'INTERNAL_MANAGEMENT' | 'OFFICIAL_TAX';
  vatRate?: number;
  vatInvoiceRequired?: boolean;
  vatInvoiceCode?: string;
  cashierId: string;
  cashboxSessionId?: string;
  discountApprovalId?: string;
  note?: string;
  isGift?: boolean; // BV-03: đơn tặng offline (sync lên server với discount 1.0)
  giftReason?: string;
  items: OfflineOrderItem[];
  subtotal: number;
  discountAmount: number;
  finalAmount: number;
  totalQuantity: number;
  createdAt: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';
  lastError?: string;
  /** Trạng thái thanh toán cục bộ (chỉ có trên record tạo từ luồng chuyển khoản/QR). */
  paymentState?: OfflinePaymentState;
}

/**
 * Trạng thái thanh toán của đơn ngoại tuyến:
 * - READY_TO_SYNC: tiền mặt, không cần ảnh.
 * - AWAITING_PAYMENT: đã tạo QR, chờ khách chuyển (chưa có ảnh).
 * - PAID_PENDING_SYNC: đã lưu ảnh, chờ sync lên server.
 * - NEEDS_RECONCILIATION: xung đột ATP/idempotency/két, phải đối soát tay.
 * - CANCELLED_LOCAL: thu ngân hủy trước khi chụp ảnh.
 */
export type OfflinePaymentState =
  | 'READY_TO_SYNC'
  | 'AWAITING_PAYMENT'
  | 'PAID_PENDING_SYNC'
  | 'NEEDS_RECONCILIATION'
  | 'CANCELLED_LOCAL';

export type PaymentProofSyncState = 'LOCAL_ONLY' | 'ORDER_SYNCED' | 'NEEDS_RECONCILIATION';

export interface PaymentProofPhoto {
  id: string;
  orderId?: string;
  orderCode: string;
  warehouseId: string;
  cashierId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  capturedAt: string;
  blob: Blob;
  syncState: PaymentProofSyncState;
}

/** Retention: ảnh thường tối đa 30 ngày và 100 ảnh; ảnh đối soát được miễn prune. */
export const PAYMENT_PHOTO_MAX_AGE_MS = 30 * 86_400_000;
export const PAYMENT_PHOTO_MAX_COUNT = 100;

/** Mã lỗi server buộc đơn chuyển khoản/QR vào đối soát thay vì retry mãi. */
const RECONCILIATION_ERROR_CODES = new Set([
  'INSUFFICIENT_ATP',
  'IDEMPOTENCY_CONFLICT',
  'CASHBOX_SESSION_NOT_FOUND',
]);

const OFFLINE_PAYMENT_STATES: readonly OfflinePaymentState[] = [
  'READY_TO_SYNC',
  'AWAITING_PAYMENT',
  'PAID_PENDING_SYNC',
  'NEEDS_RECONCILIATION',
  'CANCELLED_LOCAL',
];

/** Chỉ hai trạng thái này được phép tự động sync; còn lại phải xem thủ công. */
const AUTO_SYNCABLE_PAYMENT_STATES: readonly OfflinePaymentState[] = ['READY_TO_SYNC', 'PAID_PENDING_SYNC'];

function isDigitalPaymentMethod(paymentMethod: string | undefined): boolean {
  return paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'QR_CODE';
}

/**
 * Trạng thái thanh toán chuẩn hoá của một đơn offline.
 * Ưu tiên `order.paymentState` nếu đã có (record cũ hoặc luồng QR đã đặt tường minh),
 * chỉ suy ra từ `moneyReceived` khi trường đó vắng mặt — nếu không một
 * AWAITING_PAYMENT sẽ bị nâng nhầm lên PAID_PENDING_SYNC bởi moneyReceived=false.
 */
export function normalizeOfflinePaymentState(order: OfflineOrder): OfflinePaymentState {
  const existing = order.paymentState;
  if (existing && OFFLINE_PAYMENT_STATES.includes(existing)) return existing;
  if (!isDigitalPaymentMethod(order.paymentMethod)) return 'READY_TO_SYNC';
  if (order.paymentMethod === 'QR_CODE' && order.moneyReceived !== true) return 'NEEDS_RECONCILIATION';
  return order.moneyReceived === true ? 'PAID_PENDING_SYNC' : 'AWAITING_PAYMENT';
}

/**
 * Trạng thái sau khi sync gặp lỗi. Xung đột dữ liệu (ATP, idempotency, két đã đóng)
 * vào đối soát và giữ ảnh; lỗi mạng giữ nguyên trạng thái để thử lại được.
 * Đơn tiền mặt không bị ảnh hưởng bởi các mã lỗi của luồng chuyển khoản.
 */
export function applySyncErrorToOfflineOrder(order: OfflineOrder, errorCode: string): OfflinePaymentState {
  const current = normalizeOfflinePaymentState(order);
  if (!isDigitalPaymentMethod(order.paymentMethod)) return current;
  if (RECONCILIATION_ERROR_CODES.has(errorCode)) return 'NEEDS_RECONCILIATION';
  return current;
}

/**
 * Áp dụng retention: giữ mọi ảnh NEEDS_RECONCILIATION bất kể tuổi, xóa ảnh
 * thường quá 30 ngày, rồi cắt ảnh thường cũ nhất cho tới khi còn tối đa 100.
 */
export function prunePaymentProofPhotos<T extends PaymentProofPhoto>(photos: T[], now = Date.now()): T[] {
  const reconciliation = photos.filter((photo) => photo.syncState === 'NEEDS_RECONCILIATION');
  const normal = photos
    .filter((photo) => photo.syncState !== 'NEEDS_RECONCILIATION')
    .filter((photo) => now - new Date(photo.capturedAt).getTime() < PAYMENT_PHOTO_MAX_AGE_MS)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, PAYMENT_PHOTO_MAX_COUNT);
  return [...reconciliation, ...normal];
}

export type OfflineOrderRepairAction = 'REASSIGN_CASHBOX' | 'CONFIRM_MONEY_RECEIVED';

export function getOfflineOrderRepairAction(order: OfflineOrder): OfflineOrderRepairAction | null {
  if (/Phiên két ca/i.test(order.lastError || '')) return 'REASSIGN_CASHBOX';
  const isDigitalPayment = order.paymentMethod === 'BANK_TRANSFER' || order.paymentMethod === 'QR_CODE';
  const isGift = Boolean(order.isGift) || order.discountRate === 1;
  if (!isGift && isDigitalPayment && order.moneyReceived !== true && /Phải xác nhận đã nhận tiền/i.test(order.lastError || '')) {
    return 'CONFIRM_MONEY_RECEIVED';
  }
  return null;
}

const DB_NAME = 'formapubli_offline_db';
const DB_VERSION = 2;
const STORE_NAME = 'offline_orders';
const PHOTO_STORE = 'payment_proof_photos';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('syncStatus', 'syncStatus', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
      }
      // Ảnh chứng minh thanh toán nằm chung version với đơn offline: không module DB nào khác được mở DB này.
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const photos = db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        photos.createIndex('orderCode', 'orderCode', { unique: false });
        photos.createIndex('capturedAt', 'capturedAt', { unique: false });
      }
    };
  });
}

/**
 * Lưu một đơn hàng bán ngoại tuyến vào IndexedDB
 */
export async function saveOfflineOrder(order: OfflineOrder): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(order);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lấy danh sách đơn hàng đủ điều kiện TỰ ĐỘNG đồng bộ (PENDING/FAILED và chỉ ở
 * READY_TO_SYNC / PAID_PENDING_SYNC). Được sắp xếp tự nhiên theo thời gian
 * nhờ khóa UUID v7.
 *
 * AWAITING_PAYMENT (chờ khách chuyển) và NEEDS_RECONCILIATION (xung đột) bị
 * loại khỏi đường tự động; xem chúng qua `getOfflineOrdersForReview`.
 */
export async function getPendingOfflineOrders(cashierId?: string): Promise<OfflineOrder[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const allOrders: OfflineOrder[] = req.result || [];
       const pending = allOrders.filter(
        (o) => o.syncStatus === 'PENDING' || o.syncStatus === 'FAILED'
      );
       const autoSyncable = pending.filter(
        (o) => AUTO_SYNCABLE_PAYMENT_STATES.includes(normalizeOfflinePaymentState(o))
      );
       const scoped = cashierId
        ? autoSyncable.filter((order) => order.cashierId === cashierId)
        : autoSyncable;
       // Sắp xếp tự nhiên theo thời gian phát sinh
       scoped.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
       resolve(scoped);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Mọi đơn đang chờ xử lý, kể cả đơn cần đối soát — chỉ dùng cho bề mặt rà soát
 * thủ công, không dùng để tự động sync.
 */
export async function getOfflineOrdersForReview(cashierId?: string): Promise<OfflineOrder[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const pending = ((req.result || []) as OfflineOrder[]).filter(
        (o) => o.syncStatus === 'PENDING' || o.syncStatus === 'FAILED'
      );
      const scoped = cashierId ? pending.filter((o) => o.cashierId === cashierId) : pending;
      scoped.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      resolve(scoped);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Đếm số lượng đơn hàng ngoại tuyến đang chờ đồng bộ
 */
export async function getPendingOrdersCount(cashierId?: string): Promise<number> {
  try {
    const pending = await getPendingOfflineOrders(cashierId);
    return pending.length;
  } catch {
    return 0;
  }
}

export async function getLegacyPendingOrdersCount(): Promise<number> {
  try {
    const pending = await getPendingOfflineOrders();
    return pending.filter((order) => /^User-ROLE_/i.test(order.cashierId)).length;
  } catch {
    return 0;
  }
}

export async function claimLegacyOfflineOrders(actorId: string): Promise<number> {
  if (!actorId.trim() || /^UNSCOPED-/i.test(actorId)) throw new Error('Actor ID không hợp lệ');
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.getAll();
    let claimed = 0;
    getReq.onsuccess = () => {
      for (const order of (getReq.result || []) as OfflineOrder[]) {
        if (
          (order.syncStatus === 'PENDING' || order.syncStatus === 'FAILED') &&
          /^User-ROLE_/i.test(order.cashierId)
        ) {
          order.cashierId = actorId;
          claimed++;
          store.put(order);
        }
      }
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Xóa một đơn hàng ngoại tuyến sau khi đã đồng bộ thành công lên máy chủ
 */
export async function removeOfflineOrder(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Cập nhật trạng thái đồng bộ cho đơn hàng
 */
export async function updateOfflineOrderStatus(
  id: string,
  status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED',
  errorMsg?: string
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const order = getReq.result;
      if (!order) {
        resolve();
        return;
      }
      order.syncStatus = status;
      if (errorMsg) order.lastError = errorMsg;
      const putReq = store.put(order);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function updateOfflineOrderForRetry(
  id: string,
  patch: { cashboxSessionId?: string; moneyReceived?: true }
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const order = getReq.result as OfflineOrder | undefined;
      if (!order) {
        resolve();
        return;
      }
      if (patch.cashboxSessionId !== undefined) order.cashboxSessionId = patch.cashboxSessionId;
      if (patch.moneyReceived === true) order.moneyReceived = true;
      order.syncStatus = 'PENDING';
      delete order.lastError;
      const putReq = store.put(order);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Lưu ảnh chứng minh thanh toán vào IndexedDB, sau đó áp retention.
 * Lỗi ghi phải ném ra: người gọi tuyệt đối không được gọi API xác nhận đơn.
 */
export async function savePaymentProofPhoto(photo: PaymentProofPhoto): Promise<void> {
  const db = await getDB();
  const photos = await listPaymentProofPhotos();
  const kept = prunePaymentProofPhotos([...photos.filter((item) => item.id !== photo.id), photo]);
  for (const stale of photos) {
    if (!kept.some((item) => item.id === stale.id)) await deletePaymentProofPhoto(stale.id);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const req = tx.objectStore(PHOTO_STORE).put(photo);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function listPaymentProofPhotos(): Promise<PaymentProofPhoto[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const req = tx.objectStore(PHOTO_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as PaymentProofPhoto[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePaymentProofPhoto(id: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const req = tx.objectStore(PHOTO_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Chuyển đơn offline sang trạng thái thanh toán kế tiếp (đã chụp ảnh, cần đối soát, hủy cục bộ). */
export async function updateOfflineOrderPaymentState(id: string, state: OfflinePaymentState): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const order = getReq.result as OfflineOrder | undefined;
      if (!order) {
        resolve();
        return;
      }
      order.paymentState = state;
      const putReq = store.put(order);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

