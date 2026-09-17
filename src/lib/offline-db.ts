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
  fiscalScope: 'INTERNAL_MANAGEMENT' | 'OFFICIAL_TAX';
  vatRate?: number;
  vatInvoiceRequired?: boolean;
  vatInvoiceCode?: string;
  cashierId: string;
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
}

const DB_NAME = 'formapubli_offline_db';
const DB_VERSION = 1;
const STORE_NAME = 'offline_orders';

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
 * Lấy danh sách toàn bộ đơn hàng đang chờ đồng bộ (PENDING hoặc FAILED)
 * Được sắp xếp tự nhiên theo thời gian nhờ khóa UUID v7
 */
export async function getPendingOfflineOrders(): Promise<OfflineOrder[]> {
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
      // Sắp xếp tự nhiên theo thời gian phát sinh
      pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      resolve(pending);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Đếm số lượng đơn hàng ngoại tuyến đang chờ đồng bộ
 */
export async function getPendingOrdersCount(): Promise<number> {
  try {
    const pending = await getPendingOfflineOrders();
    return pending.length;
  } catch {
    return 0;
  }
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
