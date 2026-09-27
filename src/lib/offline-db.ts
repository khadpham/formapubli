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
  /** Ảnh xác nhận đã gắn với đơn offline (chỉ dữ liệu vận hành, không upload). */
  paymentProofId?: string;
  paymentProofCapturedAt?: string;
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

/**
 * Mã lỗi của `POST /api/orders` mà đơn chuyển khoản/QR KHÔNG THỂ tự retry.
 *
 * Mỗi mã ở đây đều là mã server thật sự phát ra (xem statusMap trong
 * `handleApiError`) và đều là lỗi VĨNH VIỄN với payload hiện tại: gửi lại y
 * hệt sẽ cho cùng kết quả. Với đơn đã thu tiền + đã có ảnh, điều đó nghĩa là
 * retry mãi chỉ làm đơn biến mất khỏi màn hình — nên phải đưa sang đối soát
 * để người có quyền quyết định, giữ cả bản ghi lẫn ảnh.
 *
 * - `INSUFFICIENT_ATP` (409): tồn đã bị bán/giữ chỗ mất.
 * - `IDEMPOTENCY_CONFLICT` (409): key đã gắn với đơn khác (vd. replay key của
 *   một đơn PENDING bằng payload sync offline).
 * - `STATE_CONFLICT` (409): trạng thái thực tế không cho phép — gồm quy tắc
 *   mới: đơn tại quầy phải có ca két OPEN nên thu ngân chưa mở ca sẽ bị chặn
 *   khi sync lại đơn gom offline.
 * - `INVALID_INPUT` (400): ca két không tồn tại/đã đóng khi tạo đơn, thiếu cặp
 *   proof, chiết khấu sai — sửa payload không giúp, phải có người xử lý.
 * - `FORBIDDEN` (403): cashier không có quyền tạo/xác nhận đơn này.
 *
 * Cố ý KHÔNG có `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `AUTH_REQUIRED`
 * (401) và các mã 409 của miền khác: đó là lỗi tạm thời, thử lại sau là đúng,
 * và đơn vẫn nằm trong `getPendingOfflineOrders` nên cashier vẫn thấy badge
 * đang chờ. `CASHBOX_SESSION_NOT_FOUND` đã bị gỡ: không mã nào trong statusMap
 * mang tên đó, nên nó là mã bịa — ca két hỏng thật sự đến dưới dạng
 * `STATE_CONFLICT` (đơn chờ) hoặc `INVALID_INPUT` (tạo đơn).
 */
export const RECONCILIATION_ERROR_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_ATP',
  'IDEMPOTENCY_CONFLICT',
  'STATE_CONFLICT',
  'INVALID_INPUT',
  'FORBIDDEN',
]);

const OFFLINE_PAYMENT_STATES: readonly OfflinePaymentState[] = [
  'READY_TO_SYNC',
  'AWAITING_PAYMENT',
  'PAID_PENDING_SYNC',
  'NEEDS_RECONCILIATION',
  'CANCELLED_LOCAL',
];

/** Chỉ hai trạng thái này được phép tự động sync; còn lại phải xem thủ công. */
export const AUTO_SYNCABLE_PAYMENT_STATES: readonly OfflinePaymentState[] = ['READY_TO_SYNC', 'PAID_PENDING_SYNC'];

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
  // Đơn quà tặng (discountRate 1) không thu tiền: không khoá vào AWAITING_PAYMENT
  // vì sẽ không bao giờ được auto-sync. POS cũng không gắn paymentState cho quà
  // tặng, nên nếu thiếu nhánh này, một đơn tặng chọn BANK_TRANSFER/QR_CODE sẽ
  // kẹt vĩnh viễn trong máy cashier mà không ai thấy.
  if (order.isGift === true || order.discountRate === 1) return 'READY_TO_SYNC';
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

/**
 * Đơn nào phải hiện ra cho thu ngân xử lý tay.
 *
 * `getPendingOfflineOrders` chỉ trả về READY_TO_SYNC / PAID_PENDING_SYNC, nên
 * đơn đã kẹt ở AWAITING_PAYMENT (khách bỏ đi) hoặc NEEDS_RECONCILIATION (xung
 * đột ATP/idempotency/két) sẽ không bao giờ đi qua đường tự động. Nếu bề mặt
 * rà soát cũng lọc bằng danh sách đó, các đơn này biến mất vĩnh viễn khỏi máy
 * cashier và không ai đối soát được. Hàm này là nguồn sự thật cho cả hai.
 */
export function needsManualReview(order: OfflineOrder): boolean {
  const state = normalizeOfflinePaymentState(order);
  if (state === 'NEEDS_RECONCILIATION' || state === 'AWAITING_PAYMENT') return true;
  return getOfflineOrderRepairAction(order) !== null;
}

/**
 * Cửa sổ 30 phút là quyết định của server (`payment_expires_at`); client chỉ
 * dùng hàm này để hiển thị và chặn sớm. `confirmOrder` vẫn là chủ quyết định.
 */
export function isPaymentWindowExpired(expiresAt: string | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return false;
  return now >= deadline;
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

/**
 * Trạng thái thanh toán sau khi thu ngân xử lý thủ công một đơn bị kẹt.
 *
 * `updateOfflineOrderForRetry` ghi `moneyReceived`/ca két rồi đặt lại
 * `syncStatus: 'PENDING'`, nhưng nếu giữ nguyên `paymentState` là
 * NEEDS_RECONCILIATION thì đơn vẫn bị `getPendingOfflineOrders` loại — POS báo
 * "đã cập nhật, đang đồng bộ lại" rồi không bao giờ đồng bộ được, và mọi lần
 * sync sau lại loại nó một lần nữa. Sửa xong thì phải thực sự sync được.
 *
 * CANCELLED_LOCAL là trạng thái kết, không quay lại.
 */
export function paymentStateAfterManualRepair(order: OfflineOrder): OfflinePaymentState {
  const state = normalizeOfflinePaymentState(order);
  if (state === 'CANCELLED_LOCAL') return 'CANCELLED_LOCAL';
  if (state !== 'NEEDS_RECONCILIATION' && state !== 'AWAITING_PAYMENT') return state;
  // Tiền mặt và quà tặng không thu tiền nên không cần ảnh: luôn READY_TO_SYNC,
  // kể cả khi hình thức ghi là chuyển khoản và cờ moneyReceived bị bẩn.
  const isDigital = order.paymentMethod === 'BANK_TRANSFER' || order.paymentMethod === 'QR_CODE';
  const isGift = order.isGift === true || order.discountRate === 1;
  if (!isDigital || isGift) return 'READY_TO_SYNC';
  return order.moneyReceived === true ? 'PAID_PENDING_SYNC' : 'READY_TO_SYNC';
}

/**
 * Chuẩn bị lại một đơn offline bị kẹt để sync. Trả về `false` nếu record không
 * tồn tại — để bề mặt rà soát không báo "đã cập nhật" cho một đơn không có thật.
 */
export async function updateOfflineOrderForRetry(
  id: string,
  patch: { cashboxSessionId?: string; moneyReceived?: true }
): Promise<boolean> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const order = getReq.result as OfflineOrder | undefined;
      if (!order) {
        resolve(false);
        return;
      }
      if (patch.cashboxSessionId !== undefined) order.cashboxSessionId = patch.cashboxSessionId;
      if (patch.moneyReceived === true) order.moneyReceived = true;
      order.syncStatus = 'PENDING';
      delete order.lastError;
      // Sửa xong thì phải thực sự nằm trong đường tự động sync.
      order.paymentState = paymentStateAfterManualRepair(order);
      const putReq = store.put(order);
      putReq.onsuccess = () => resolve(true);
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
  const photos = await readAllPaymentProofPhotos();
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

/**
 * Phạm vi xem ảnh: ảnh chỉ thuộc kho đang chọn; thu ngân chỉ thấy ảnh của
 * chính mình, Owner/Manager thấy cả kho. Lọc ở nguồn để máy thu ngân dùng
 * chung không lộ ảnh chuyển khoản của kho/thu ngân khác.
 */
export interface PaymentProofScope {
  warehouseId: string;
  cashierId: string;
  includeAllCashiers?: boolean;
}

export function isPhotoInScope(photo: PaymentProofPhoto, scope: PaymentProofScope): boolean {
  if (photo.warehouseId !== scope.warehouseId) return false;
  return Boolean(scope.includeAllCashiers) || photo.cashierId === scope.cashierId;
}

/** Đọc toàn bộ ảnh: dùng cho retention, KHÔNG dùng để hiển thị (xem listPaymentProofPhotos). */
async function readAllPaymentProofPhotos(): Promise<PaymentProofPhoto[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const req = tx.objectStore(PHOTO_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as PaymentProofPhoto[]);
    req.onerror = () => reject(req.error);
  });
}

export async function listPaymentProofPhotos(scope: PaymentProofScope): Promise<PaymentProofPhoto[]> {
  const all = await readAllPaymentProofPhotos();
  return all.filter((photo) => isPhotoInScope(photo, scope));
}

/** Nạp lại một ảnh theo id (dùng khi khôi phục phiên chuyển khoản sau refresh). */
export async function getPaymentProofPhoto(id: string): Promise<PaymentProofPhoto | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const req = tx.objectStore(PHOTO_STORE).get(id);
    req.onsuccess = () => resolve((req.result as PaymentProofPhoto | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Tiến trạng thái đồng bộ của ảnh.
 *
 * Không có hàm này thì ảnh kẹt ở LOCAL_ONLY mãi mãi: retention chỉ miễn xoá
 * ảnh NEEDS_RECONCILIATION và gallery chỉ chặn xoá ảnh đó — cả hai đều là code
 * chết. Ảnh của đơn đã vào đối soát phải được giữ lại cho tới khi người có
 * quyền xử lý xong.
 */
export async function markPaymentProofPhotoSyncState(
  id: string | undefined,
  syncState: PaymentProofSyncState
): Promise<void> {
  if (!id) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const photo = getReq.result as PaymentProofPhoto | undefined;
      // Ảnh đã bị retention xoá giữa lúc: không phải lỗi, chỉ không còn gì để tiến.
      if (!photo) {
        resolve();
        return;
      }
      photo.syncState = syncState;
      const putReq = store.put(photo);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Xoá ảnh. Khi `scope` được truyền (mọi thao tác của người dùng), ảnh nằm ngoài
 * phạm vi kho/thu ngân hiện tại sẽ bị từ chối — không xoá, không ném lỗi.
 * Retention gọi KHÔNG scope: đó là dọn bộ nhớ máy, được phép thấy mọi ảnh.
 */
export async function deletePaymentProofPhoto(id: string, scope?: PaymentProofScope): Promise<void> {
  if (scope) {
    const all = await readAllPaymentProofPhotos();
    const photo = all.find((item) => item.id === id);
    if (!photo || !isPhotoInScope(photo, scope)) return;
  }
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
  return patchOfflineOrder(id, (order) => {
    order.paymentState = state;
  });
}

/**
 * Ghi ảnh xác nhận vào đơn offline và đánh dấu đã thu tiền.
 * Đồng thời bật `moneyReceived` để lần sync kế tiếp gửi đúng trạng thái —
 * server dùng cặp `moneyReceived` + proof fields làm chốt quy trình.
 */
export async function attachOfflineOrderPaymentProof(
  id: string,
  proof: { id: string; capturedAt: string }
): Promise<void> {
  return patchOfflineOrder(id, (order) => {
    order.moneyReceived = true;
    order.paymentState = 'PAID_PENDING_SYNC';
    (order as OfflineOrder & { paymentProofId?: string; paymentProofCapturedAt?: string }).paymentProofId = proof.id;
    (order as OfflineOrder & { paymentProofId?: string; paymentProofCapturedAt?: string }).paymentProofCapturedAt =
      proof.capturedAt;
  });
}

/**
 * Huỷ một đơn offline và TRẢ VỀ kết quả thật.
 *
 * `patchOfflineOrder` và `removeOfflineOrder` đều resolve im lặng khi không thấy
 * record, nên gọi chúng rồi coi là "đã huỷ xong" là sai: POS sẽ báo thành công và
 * xoá giỏ trong khi đơn vẫn còn nguyên trên máy (và nếu là đơn đã thu tiền thì
 * còn giữ ATP ở server). Hàm này chỉ trả `true` khi record thực sự tồn tại và
 * thực sự bị ghi/xoá.
 *
 * @param hasPaymentProof đơn đã có ảnh xác nhận thì KHÔNG xoá: giữ ở
 *   NEEDS_RECONCILIATION cùng ảnh, vì tiền đã thu và cần người có quyền xử lý.
 */
export async function cancelOfflineOrderLocally(id: string, hasPaymentProof: boolean): Promise<boolean> {
  if (!id) return false;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const order = getReq.result as OfflineOrder | undefined;
      // Không có record: không có gì để huỷ, và cũng không được báo thành công.
      if (!order) {
        resolve(false);
        return;
      }
      if (hasPaymentProof) {
        // Đã có bằng chứng khách đã chuyển: giữ đơn + ảnh cho đối soát.
        order.paymentState = 'NEEDS_RECONCILIATION';
        const putReq = store.put(order);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
        return;
      }
      order.paymentState = 'CANCELLED_LOCAL';
      const putReq = store.put(order);
      putReq.onerror = () => reject(putReq.error);
      putReq.onsuccess = () => {
        // Xoá sau khi đã ghi CANCELLED_LOCAL: nếu xoá hỏng, đơn vẫn ở trạng thái
        // huỷ rõ ràng thay vì quay lại AWAITING_PAYMENT và bị bỏ quên.
        const delReq = store.delete(id);
        delReq.onsuccess = () => resolve(true);
        delReq.onerror = () => reject(delReq.error);
      };
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Đơn offline đã sẵn sàng chốt chưa: có ảnh xác nhận, đã thu tiền và đã ở
 * PAID_PENDING_SYNC (nên sẽ thực sự được auto-sync khi có mạng).
 *
 * POS dùng hàm này trước khi báo "đã ghi nhận" cho đường offline. Nếu bỏ qua,
 * một phiên mà `attachOfflineOrderPaymentProof` đã hỏng vẫn bị coi là thành
 * công: cashier thấy toast, giỏ bị xoá, còn đơn thì kẹt AWAITING_PAYMENT —
 * không bao giờ tự sync, dù tiền đã thu.
 */
export async function isOfflineTransferReadyToConfirm(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => {
      const order = req.result as OfflineOrder | undefined;
      if (!order) {
        resolve(false);
        return;
      }
      const hasProof = Boolean(order.paymentProofId && order.paymentProofCapturedAt);
      resolve(hasProof && normalizeOfflinePaymentState(order) === 'PAID_PENDING_SYNC');
    };
    req.onerror = () => reject(req.error);
  });
}

async function patchOfflineOrder(id: string, apply: (order: OfflineOrder) => void): Promise<void> {
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
      apply(order);
      const putReq = store.put(order);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

