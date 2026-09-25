/**
 * Transfer/QR payment proof contract.
 * Pure node assertion suite: bank-account cache, photo retention, and the
 * source-level contracts of the camera / modal / gallery / POS wiring.
 * No database, no browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Minimal in-memory localStorage so the cache module works under tsx/node. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }
}
(globalThis as any).localStorage = new MemoryStorage();

// Static import: the cache module only touches localStorage inside its functions.
import {
  BANK_ACCOUNT_CACHE_TTL_MS,
  readBankAccountsCache,
  writeBankAccountsCache,
} from '../src/lib/bank-account-cache';

const account = {
  id: 'ba-1',
  label: 'VietinBank — Âu Cơ',
  bankBin: '970436',
  accountNo: '1234567890',
  accountName: 'Công ty TNHH Sách Tri Thức',
};

assert.equal(BANK_ACCOUNT_CACHE_TTL_MS, 24 * 3600_000, 'TTL cache tài khoản ngân hàng là 24 giờ');

const now = Date.now();
writeBankAccountsCache({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: 'ba-1', accounts: [account] });
assert.equal(
  readBankAccountsCache('wh-au-co', now)?.accounts[0]?.accountNo,
  '1234567890',
  'Đọc cache ngay sau khi ghi'
);
assert.equal(
  readBankAccountsCache('wh-au-co', now)?.accounts[0]?.label,
  'VietinBank — Âu Cơ',
  'Cache giữ nguyên nhãn tài khoản'
);
assert.equal(readBankAccountsCache('wh-au-co', now)?.defaultId, 'ba-1', 'Cache giữ tài khoản mặc định');
assert.equal(
  readBankAccountsCache('wh-au-co', now + BANK_ACCOUNT_CACHE_TTL_MS),
  null,
  'Cache hết hạn sau đúng 24 giờ'
);
assert.equal(
  readBankAccountsCache('wh-au-co', now + BANK_ACCOUNT_CACHE_TTL_MS + 1),
  null,
  'Cache quá 24 giờ bị từ chối'
);
assert.equal(readBankAccountsCache('wh-quynh-mai', now), null, 'Không đọc cache của kho khác');
assert.equal(
  readBankAccountsCache('wh-au-co', now)?.warehouseId,
  'wh-au-co',
  'Cache trả về đúng kho đã ghi'
);

localStorage.setItem('formapubli.bankAccounts.wh-au-co', '{not json');
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Cache JSON hỏng bị từ chối');

localStorage.setItem(
  'formapubli.bankAccounts.wh-au-co',
  JSON.stringify({ warehouseId: 'wh-quynh-mai', cachedAt: now, defaultId: 'ba-1', accounts: [account] })
);
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Cache mang warehouseId khác bị từ chối');

localStorage.setItem(
  'formapubli.bankAccounts.wh-au-co',
  JSON.stringify({ warehouseId: 'wh-au-co', cachedAt: 'x', defaultId: 'ba-1', accounts: [account] })
);
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'cachedAt không phải số bị từ chối');

localStorage.setItem(
  'formapubli.bankAccounts.wh-au-co',
  JSON.stringify({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: 'ba-1', accounts: 'nope' })
);
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Danh sách tài khoản hỏng bị từ chối');

localStorage.setItem('formapubli.bankAccounts.wh-au-co', JSON.stringify({ warehouseId: 'wh-au-co', cachedAt: now, defaultId: null, accounts: [] }));
assert.equal(readBankAccountsCache('wh-au-co', now)?.accounts.length, 0, 'Cache rỗng vẫn đọc được, QR sẽ bị chặn ở tầng UI');
localStorage.clear();
assert.equal(readBankAccountsCache('wh-au-co', now), null, 'Không có cache thì trả null, không ném lỗi');

function readSource(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8');
}

const vietQr = readSource('src/components/pos/VietQrPay.tsx');
assert.match(vietQr, /readBankAccountsCache/, 'VietQrPay phải fallback sang cache tài khoản');
assert.match(vietQr, /writeBankAccountsCache/, 'VietQrPay phải làm mới cache khi có mạng');
assert.match(vietQr, /'NETWORK' \| 'CACHE' \| 'NONE'/, 'VietQrPay phải phân biệt nguồn mạng / cache / không có');
assert.doesNotMatch(vietQr, /3600_000|24 \* 3600/, 'VietQrPay không tự đặt hạn cache: TTL thuộc về bank-account-cache');
assert.match(vietQr, /Dữ liệu cache/, 'VietQrPay hiển thị nhãn dữ liệu cache');
assert.match(vietQr, /onQrRef\.current\?\.\(null\)/, 'VietQrPay gọi onQr(null) khi không có tài khoản để xóa QR cũ');

// --- Task 5: kho ảnh chứng minh + retention ---------------------------------
import { normalizeOfflinePaymentState, prunePaymentProofPhotos, type PaymentProofPhoto } from '../src/lib/offline-db';

const offlineDb = readSource('src/lib/offline-db.ts');
assert.match(offlineDb, /const DB_VERSION = 2;/, 'IndexedDB phải nâng version 2 cho store ảnh');
assert.match(offlineDb, /payment_proof_photos/, 'Store ảnh chứng minh phải nằm trong cùng DB');
assert.match(offlineDb, /keyPath: 'id'/, 'Store ảnh định danh theo id');
assert.match(offlineDb, /createIndex\('orderCode'/, 'Store ảnh có index theo mã đơn');
for (const fn of ['savePaymentProofPhoto', 'listPaymentProofPhotos', 'deletePaymentProofPhoto', 'updateOfflineOrderPaymentState']) {
  assert.match(offlineDb, new RegExp(`export async function ${fn}`), `offline-db phải xuất ${fn}`);
}
assert.match(offlineDb, /READY_TO_SYNC[\s\S]*PAID_PENDING_SYNC/, 'Auto-sync chỉ lấy READY_TO_SYNC và PAID_PENDING_SYNC');

function fakePhoto(index: number, syncState: PaymentProofPhoto['syncState'], daysAgo = 0): PaymentProofPhoto {
  return {
    id: `photo-${index}`,
    orderCode: `ORD-20260925-${String(index).padStart(4, '0')}`,
    warehouseId: 'wh-au-co',
    cashierId: 'cashier-pos-test',
    amount: 100000,
    paymentMethod: 'BANK_TRANSFER',
    capturedAt: new Date(Date.now() - daysAgo * 86_400_000 - index * 1000).toISOString(),
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    syncState,
  };
}

// 105 ảnh thường (chỉ 100 ảnh mới nhất được giữ) + 5 ảnh cần đối soát.
const normalPhotos = Array.from({ length: 105 }, (_, i) => fakePhoto(i, 'LOCAL_ONLY'));
const reconciliationPhotos = Array.from({ length: 5 }, (_, i) => fakePhoto(200 + i, 'NEEDS_RECONCILIATION'));
const kept = prunePaymentProofPhotos([...normalPhotos, ...reconciliationPhotos]);
assert.equal(kept.length, 105, 'Giữ đúng 100 ảnh thường mới nhất + 5 ảnh cần đối soát');
const keptNormal = kept.filter((p) => p.syncState !== 'NEEDS_RECONCILIATION');
assert.equal(keptNormal.length, 100, 'Giữ đúng 100 ảnh thường');
for (const p of reconciliationPhotos) {
  assert(kept.some((k) => k.id === p.id), `Ảnh NEEDS_RECONCILIATION ${p.id} không bị prune tự động`);
}
// fakePhoto giảm capturedAt theo chỉ số: index nhỏ là ảnh mới hơn.
// 105 ảnh thường → giữ index 0..99, cắt 5 ảnh cũ nhất (100..104).
for (const p of normalPhotos.filter((item) => Number(item.id.slice('photo-'.length)) >= 100)) {
  assert(!kept.some((k) => k.id === p.id), `Ảnh thường cũ ${p.id} bị cắt bởi giới hạn 100`);
}
assert(kept.some((k) => k.id === 'photo-99'), 'Ảnh thường thứ 100 mới nhất vẫn được giữ');
assert(kept.some((k) => k.id === 'photo-0'), 'Ảnh thường mới nhất được giữ');

const oldNormal = Array.from({ length: 3 }, (_, i) => fakePhoto(300 + i, 'LOCAL_ONLY', 45));
const oldReconcile = fakePhoto(400, 'NEEDS_RECONCILIATION', 365);
const afterAge = prunePaymentProofPhotos([...oldNormal, oldReconcile]);
assert.equal(afterAge.length, 1, 'Ảnh thường quá 30 ngày bị xóa');
assert.equal(afterAge[0].id, oldReconcile.id, 'Ảnh cần đối soát miễn xóa theo tuổi');

assert.equal(
  normalizeOfflinePaymentState({ paymentMethod: 'BANK_TRANSFER', moneyReceived: true } as any),
  'PAID_PENDING_SYNC',
  'Suy ra trạng thái từ moneyReceived khi record cũ chưa có paymentState'
);
assert.equal(
  normalizeOfflinePaymentState({ paymentMethod: 'BANK_TRANSFER', moneyReceived: false } as any),
  'AWAITING_PAYMENT',
  'Chuyển khoản chưa thu tiền là AWAITING_PAYMENT'
);

// --- Task 6: camera chụp ảnh chứng minh --------------------------------------
const camera = readSource('src/components/pos/PaymentProofCamera.tsx');
assert.match(camera, /getUserMedia/, 'Camera dùng getUserMedia');
assert.match(camera, /facingMode/, 'Camera có chọn trước/sau');
assert.match(camera, /'environment'/, 'Camera sau là mặc định');
assert.match(camera, /playsInline/, 'Video phải playsInline');
assert.match(camera, /muted/, 'Video phải muted');
assert.match(camera, /canvas\.toBlob/, 'Chụp ảnh qua canvas.toBlob');
assert.match(camera, /'image\/jpeg'/, 'Ảnh xuất JPEG');
assert.match(camera, /0\.8/, 'JPEG quality 0.8');
assert.match(camera, /1280/, 'Cạnh dài tối đa 1280px');
assert.match(camera, /track\.stop\(\)/, 'Phải dừng toàn bộ media track');
assert.match(camera, /useModalFocusTrap/, 'Camera dùng focus trap có sẵn');
assert.match(camera, /max-w-lg/, 'Dialog camera giới hạn max-w-lg');
assert.match(camera, /Chụp lại/, 'Có nút Chụp lại');
assert.match(camera, /Dùng ảnh này/, 'Có nút Dùng ảnh này');
assert.match(camera, /role="dialog"/, 'Camera là dialog');
assert.doesNotMatch(camera, /createBarcodeDecoder|OCR|tesseract|bank-?api/i, 'Camera không OCR và không gọi API ngân hàng');

// Review Focus 1: camera bị từ chối / không có thiết bị → đóng, tuyệt đối không gọi onUsePhoto.
// Bỏ comment trước khi kiểm tra: chỉ assert trên mã thực thi, không trên chú thích.
const stripComments = (code: string) => code.replace(/\/\/[^\n\r]*/g, '');
const deniedStart = camera.indexOf("'NotAllowedError'");
const deniedEnd = camera.indexOf('}, [isOpen');
const deniedBranch = stripComments(
  deniedStart >= 0 ? camera.slice(deniedStart, deniedEnd > deniedStart ? deniedEnd : camera.length) : ''
);
assert.ok(deniedBranch.length > 0, 'Camera có nhánh xử lý NotAllowedError');
assert.match(deniedBranch, /NotFoundError/, 'Camera xử lý cả NotFoundError');
assert.match(deniedBranch, /onClose\(\)/, 'Nhánh lỗi quyền/thiết bị gọi onClose');
assert.doesNotMatch(deniedBranch, /onUsePhoto/, 'Nhánh lỗi quyền/thiết bị tuyệt đối không gọi onUsePhoto');
// Camera từ chối không được báo "đã lưu ảnh" — không được setPreview rỗng giả.
assert.doesNotMatch(deniedBranch, /setPreview\(/, 'Nhánh lỗi không tạo preview giả');

// Review Focus 2: lưu ảnh lỗi thì giữ preview, không đóng.
const usePhotoStart = camera.indexOf('const usePhoto = async');
const usePhotoEnd = camera.indexOf('return createPortal', usePhotoStart);
const usePhotoRegion = stripComments(
  camera.slice(usePhotoStart > 0 ? usePhotoStart : 0, usePhotoEnd > usePhotoStart ? usePhotoEnd : camera.length)
);
assert.ok(usePhotoStart > 0, 'Camera có hàm usePhoto');
assert.match(usePhotoRegion, /await onUsePhoto\(/, 'Camera await onUsePhoto trước khi đóng');
const tryIndex = usePhotoRegion.lastIndexOf('try {');
const catchIndex = usePhotoRegion.indexOf('} catch');
const useIndex = usePhotoRegion.indexOf('await onUsePhoto(');
const closeIndex = usePhotoRegion.indexOf('onClose();');
assert.ok(tryIndex >= 0 && catchIndex > tryIndex, 'onUsePhoto phải nằm trong try/catch');
assert.ok(useIndex > tryIndex && useIndex < catchIndex, 'await onUsePhoto nằm trong try');
assert.ok(closeIndex > useIndex && closeIndex < catchIndex, 'onClose chạy sau khi lưu thành công, trong try');
assert.doesNotMatch(usePhotoRegion.slice(catchIndex), /setPreview\(null\)/, 'Lỗi lưu không được xóa preview');
assert.match(usePhotoRegion, /setErrorMessage\('Lưu ảnh thất bại/, 'Lỗi lưu ảnh phải báo rõ cho thu ngân');
assert.match(camera, /setPreview\(\{/, 'Preview được set khi chụp thành công');

console.log('PASS: transfer payment photo contract.');
