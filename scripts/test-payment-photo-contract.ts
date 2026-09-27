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

const photoOf = (id: string, warehouseId: string, cashierId: string): PaymentProofPhoto => ({
  id,
  orderCode: `ORD-20260925-${id}`,
  warehouseId,
  cashierId,
  amount: 150000,
  paymentMethod: 'BANK_TRANSFER',
  capturedAt: '2026-09-25T10:00:00.000Z',
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  syncState: 'LOCAL_ONLY',
});

const mineAuCo = photoOf('p1', 'wh-au-co', 'cashier-1');
const otherCashierAuCo = photoOf('p2', 'wh-au-co', 'cashier-2');
const otherWarehouse = photoOf('p3', 'wh-quynh-mai', 'cashier-1');

assert.equal(
  isPhotoInScope(mineAuCo, { warehouseId: 'wh-au-co', cashierId: 'cashier-1' }),
  true,
  'Thu ngân thấy ảnh của chính mình'
);
assert.equal(
  isPhotoInScope(otherCashierAuCo, { warehouseId: 'wh-au-co', cashierId: 'cashier-1' }),
  false,
  'Thu ngân KHÔNG thấy ảnh của thu ngân khác'
);
assert.equal(
  isPhotoInScope(otherWarehouse, { warehouseId: 'wh-au-co', cashierId: 'cashier-1' }),
  false,
  'KHÔNG thấy ảnh của kho khác'
);
assert.equal(
  isPhotoInScope(otherCashierAuCo, { warehouseId: 'wh-au-co', cashierId: 'cashier-1', includeAllCashiers: true }),
  true,
  'Owner/Manager thấy ảnh mọi thu ngân trong kho'
);
assert.equal(
  isPhotoInScope(otherWarehouse, { warehouseId: 'wh-au-co', cashierId: 'cashier-1', includeAllCashiers: true }),
  false,
  'Kể cả Owner/Manager cũng KHÔNG thấy ảnh kho khác'
);

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

/** assert.match/catch nhưng báo lỗi gọn (không dump cả file nguồn). */
function expectMatch(source: string, pattern: RegExp, message: string): void {
  try {
    assert.match(source, pattern);
  } catch {
    throw new Error(message);
  }
}

function expectNoMatch(source: string, pattern: RegExp, message: string): void {
  try {
    assert.doesNotMatch(source, pattern);
  } catch {
    throw new Error(message);
  }
}

const vietQr = readSource('src/components/pos/VietQrPay.tsx');
assert.match(vietQr, /readBankAccountsCache/, 'VietQrPay phải fallback sang cache tài khoản');
assert.match(vietQr, /writeBankAccountsCache/, 'VietQrPay phải làm mới cache khi có mạng');
assert.match(vietQr, /'NETWORK' \| 'CACHE' \| 'NONE'/, 'VietQrPay phải phân biệt nguồn mạng / cache / không có');
assert.doesNotMatch(vietQr, /3600_000|24 \* 3600/, 'VietQrPay không tự đặt hạn cache: TTL thuộc về bank-account-cache');
assert.match(vietQr, /Dữ liệu cache/, 'VietQrPay hiển thị nhãn dữ liệu cache');
assert.match(vietQr, /onQrRef\.current\?\.\(null\)/, 'VietQrPay gọi onQr(null) khi không có tài khoản để xóa QR cũ');

// --- Task 5: kho ảnh chứng minh + retention ---------------------------------
import {
  applySyncErrorToOfflineOrder,
  isPaymentWindowExpired,
  isPhotoInScope,
  needsManualReview,
  normalizeOfflinePaymentState,
  prunePaymentProofPhotos,
  type OfflineOrder,
  type PaymentProofPhoto,
} from '../src/lib/offline-db';
import {
  readTransferSessionCache,
  writeTransferSessionCache,
} from '../src/lib/bank-account-cache';

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

// --- Task 7: modal thanh toán chuyển khoản + gallery ảnh ----------------------
const transferModal = readSource('src/components/pos/TransferPaymentModal.tsx');
assert.match(transferModal, /TransferPaymentSession/, 'Modal dùng interface TransferPaymentSession');
assert.match(transferModal, /remainingMs/, 'Modal có đồng hồ đếm ngược');
assert.match(transferModal, /setInterval\(update, 1000\)/, 'Đếm ngược cập nhật mỗi giây');
assert.match(transferModal, /new Date\(session\.expiresAt/, 'Đếm ngược suy ra từ expiresAt');
assert.match(transferModal, /const expired = Boolean\(session(\?)?\.expiresAt\) && remainingMs === 0/, 'expired suy ra từ đếm ngược');
assert.match(transferModal, /Chụp màn hình xác nhận/, 'Modal có nút chụp màn hình xác nhận');
assert.match(transferModal, /Khách chuyển sau/, 'Modal có hành động Khách chuyển sau');
assert.match(transferModal, /onClick=\{onCancel\}/, 'Modal có hành động hủy tường minh');
assert.match(transferModal, /onClick=\{onClose\}/, 'Modal có hành động đóng (khách chuyển sau)');
assert.match(transferModal, /onClick=\{onCapture\}/, 'Modal gọi onCapture');
assert.match(transferModal, /onClick=\{onConfirm\}/, 'Modal gọi onConfirm');
assert.match(transferModal, /qrSnapshot\.dataUrl/, 'Modal hiển thị QR từ snapshot');
assert.match(transferModal, /useModalFocusTrap/, 'Modal dùng focus trap có sẵn');
// Confirm và chụp bị khoá khi hết hạn / đang bận / chưa có ảnh.
assert.match(
  transferModal,
  /disabled=\{expired \|\| busy \|\| !session\?\.paymentProof\}/,
  'Nút xác nhận khoá khi hết hạn, đang bận, hoặc chưa có ảnh'
);
assert.match(
  transferModal,
  /disabled=\{expired \|\| busy\}/,
  'Nút chụp khoá khi hết hạn hoặc đang bận'
);

const gallery = readSource('src/components/pos/PaymentPhotoGallery.tsx');
assert.match(gallery, /listPaymentProofPhotos/, 'Gallery đọc ảnh từ IndexedDB');
assert.match(gallery, /orderCode\.toLowerCase\(\)\.includes/, 'Gallery lọc theo mã đơn');
assert.match(gallery, /b\.capturedAt\.localeCompare\(a\.capturedAt\)/, 'Gallery sắp xếp mới nhất trước');
assert.match(gallery, /navigator\.share/, 'Gallery dùng Web Share API khi có');
assert.match(gallery, /navigator\.canShare/, 'Gallery kiểm tra canShare trước khi share');
assert.match(gallery, /new File\(/, 'Gallery đóng gói ảnh thành File để chia sẻ');
assert.match(gallery, /URL\.createObjectURL/, 'Gallery có fallback tải ảnh xuống');
assert.match(gallery, /anchor\.download/, 'Fallback tải ảnh dùng thuộc tính download');
assert.match(gallery, /deletePaymentProofPhoto/, 'Gallery xóa ảnh thủ công');
assert.match(gallery, /NEEDS_RECONCILIATION/, 'Gallery biết trạng thái cần đối soát');
assert.match(gallery, /useModalFocusTrap/, 'Gallery dùng focus trap có sẵn');
assert.doesNotMatch(gallery, /fetch\(|XMLHttpRequest|FormData/, 'Gallery không upload ảnh lên server');

// --- Task 8: điều phối POS cho luồng chuyển khoản/QR -------------------------
const pos = readSource('src/components/pos/PosCheckoutTerminal.tsx');
const posCode = stripComments(pos);

// Nút thanh toán số đổi nhãn: tạo đơn trước, hiện QR sau.
expectMatch(pos, /Tạo đơn & hiện QR/, 'Nút thanh toán số phải là "Tạo đơn & hiện QR"');
expectNoMatch(
  posCode,
  /if \(!isGift && \(paymentMethod === 'BANK_TRANSFER' \|\| paymentMethod === 'QR_CODE'\) && !isMoneyReceived\)/,
  'Bỏ chốt tiền trước khi tạo đơn số',
);
expectMatch(posCode, /confirmImmediately: false/, 'Đơn số gửi confirmImmediately: false');
expectMatch(posCode, /action: 'CONFIRM'/, 'Xác nhận đơn số qua action CONFIRM');
expectMatch(posCode, /paymentProofId/, 'Gửi paymentProofId khi xác nhận');
expectMatch(posCode, /paymentProofCapturedAt/, 'Gửi paymentProofCapturedAt khi xác nhận');
expectMatch(
  posCode,
  /initialContent=\{transferSession \? transferSession\.orderCode : activeOrderCode\}/,
  'VietQrPay nhận mã đơn thật làm nội dung chuyển khoản',
);
expectMatch(posCode, /onQr=\{handleTransferQrSnapshot\}/, 'Giữ snapshot QR qua callback onQr hiện có');

// MoneyReceivedToggle không được hiện cho thanh toán số.
expectNoMatch(
  posCode,
  /<VietQrPay[\s\S]{0,900}?MoneyReceivedToggle/,
  'Không render MoneyReceivedToggle cạnh VietQrPay',
);
expectNoMatch(posCode, /<MoneyReceivedToggle/, 'MoneyReceivedToggle không còn được render ở POS');

// Trạng thái phiên chuyển khoản + overlay mới.
for (const state of ['transferSession', 'isTransferCameraOpen', 'isPhotoGalleryOpen', 'isTransferSubmitting']) {
  expectMatch(
    pos,
    new RegExp(`const \\[${state}, set${state[0].toUpperCase()}${state.slice(1)}\\] = useState`),
    `POS có state ${state}`,
  );
}
expectMatch(
  posCode,
  /const isPosOverlayOpen[\s\S]*isTransferCameraOpen[\s\S]*isPhotoGalleryOpen/,
  'Overlay camera/gallery phải nằm trong isPosOverlayOpen',
);
expectMatch(
  posCode,
  /const isTransferOverlayOpen = Boolean\(transferSession\) \|\| isTransferCameraOpen \|\| isPhotoGalleryOpen/,
  'POS có cờ overlay phiên chuyển khoản gồm cả 3 lớp',
);
// Chặn checkout và chặn scanner khi phiên chuyển khoản đang mở.
expectMatch(
  posCode,
  /isSettlementModalOpen \|\|\s*\n\s*isTransferOverlayOpen\s*\n\s*\) return;/,
  'handleCheckout bị chặn khi overlay phiên chuyển khoản đang mở',
);
expectMatch(
  posCode,
  /const openScanner = \(\) => \{\s*\n\s*if \(isTransferOverlayOpen\) return;/,
  'openScanner bị chặn khi overlay phiên chuyển khoản đang mở',
);

// Camera mở trước, xác nhận sau, và không xác nhận được khi chưa có ảnh.
expectMatch(pos, /<PaymentProofCamera/, 'POS render PaymentProofCamera');
expectMatch(pos, /<TransferPaymentModal/, 'POS render TransferPaymentModal');
expectMatch(pos, /<PaymentPhotoGallery/, 'POS render PaymentPhotoGallery');
expectMatch(
  posCode,
  /if \(!session\.paymentProof\) \{[\s\S]{0,300}?return;/,
  'Không gọi API xác nhận khi chưa có ảnh',
);
expectMatch(
  posCode,
  /const handleUseTransferPhoto = async \(photo: PaymentProofPhoto\) => \{\s*\n\s*await savePaymentProofPhoto\(photo\);/,
  'Ảnh phải lưu thành công trước khi mở đường xác nhận',
);

// Đường offline: dùng lại phân loại lỗi sẵn có, tài khoản cache, và thông báo chờ đồng bộ.
expectMatch(posCode, /fallbackToOffline/, 'Tái dùng fallbackToOffline cho đường offline');
expectMatch(posCode, /readBankAccountsCache/, 'Đường offline cần tài khoản ngân hàng trong cache');
expectMatch(posCode, /paymentState: !isGift && isDigitalPayment \? 'AWAITING_PAYMENT' : undefined/, 'Đơn offline khởi tạo ở AWAITING_PAYMENT');
expectMatch(posCode, /attachOfflineOrderPaymentProof\(transferOfflineOrderId, \{[\s\S]{0,120}?id: photo\.id,[\s\S]{0,80}?capturedAt: photo\.capturedAt/, 'Sau khi lưu ảnh, đơn offline được gắn proof và sang PAID_PENDING_SYNC');
expectMatch(pos, /đã ghi nhận, chờ đồng bộ/, 'Offline hiện thông báo đã ghi nhận, chờ đồng bộ');
expectMatch(posCode, /applySyncErrorToOfflineOrder/, 'Xung đột sync dùng applySyncErrorToOfflineOrder');
expectMatch(posCode, /updateOfflineOrderPaymentState\(order\.id, 'NEEDS_RECONCILIATION'\)/, 'Xung đột sync chuyển sang NEEDS_RECONCILIATION');
// Sync offline phải gửi moneyReceived + cả hai trường proof.
const syncStart = posCode.indexOf('moneyReceived: order.moneyReceived');
assert.ok(syncStart > 0, 'Sync offline gửi moneyReceived của đơn');
expectMatch(posCode.slice(syncStart, syncStart + 400), /paymentProofId/, 'Sync offline gửi kèm paymentProofId');
expectMatch(posCode.slice(syncStart, syncStart + 400), /paymentProofCapturedAt/, 'Sync offline gửi kèm paymentProofCapturedAt');
// Đơn cần đối soát không bị xóa khi sync lỗi.
const syncErrorStart = posCode.indexOf("updateOfflineOrderStatus(order.id, 'FAILED'");
assert.ok(syncErrorStart > 0, 'Sync lỗi ghi trạng thái FAILED');
expectMatch(
  posCode.slice(syncErrorStart, syncErrorStart + 500),
  /updateOfflineOrderPaymentState|applySyncErrorToOfflineOrder/,
  'Sync lỗi cập nhật trạng thái thanh toán',
);
expectNoMatch(
  posCode.slice(syncErrorStart, syncErrorStart + 500),
  /deletePaymentProofPhoto|removeOfflineOrder/,
  'Xung đột không được xóa ảnh hay xóa đơn offline',
);

// --- Phạm vi ảnh: scope bắt buộc ở MỌI call site, và POS chỉ nới cho Owner/Manager ---
// 1. Gallery bắt buộc nhận scope, không có call site nào gọi listPaymentProofPhotos() rỗng.
expectMatch(
  gallery,
  /warehouseId: string;\s*\n\s*cashierId: string;\s*\n\s*canViewAllCashiers: boolean;/,
  'PaymentPhotoGallery bắt buộc nhận warehouseId + cashierId + canViewAllCashiers',
);
// scope phải mang đủ 3 trường, và mọi đường đọc/xóa/chia sẻ đều đi qua nó.
expectMatch(
  gallery,
  /const scope = useMemo<PaymentProofScope>\(\s*\(\) => \(\{ warehouseId, cashierId, includeAllCashiers: canViewAllCashiers \}\)/,
  'Gallery dựng scope đủ warehouseId + cashierId + includeAllCashiers',
);
expectMatch(
  gallery,
  /await listPaymentProofPhotos\(scope\)/,
  'Gallery đọc ảnh bằng đúng scope hiện tại',
);
for (const guard of ['visible', 'sharePhoto', 'removePhoto']) {
  expectMatch(
    gallery,
    new RegExp(`${guard}[\\s\\S]{0,400}?isPhotoInScope\\(photo, scope\\)`),
    `${guard} phải chặn ảnh ngoài phạm vi bằng isPhotoInScope`
  );
}
// 2. POS chỉ bật canViewAllCashiers cho ROLE_OWNER / ROLE_MANAGER.
expectMatch(
  pos,
  /<PaymentPhotoGallery[\s\S]{0,300}?warehouseId=\{selectedWarehouseId\}[\s\S]{0,200}?cashierId=\{cashierActorId\}[\s\S]{0,200}?canViewAllCashiers=\{currentRole === 'ROLE_OWNER' \|\| currentRole === 'ROLE_MANAGER'\}/,
  'POS truyền selectedWarehouseId + cashierActorId và chỉ nới phạm vi cho Owner/Manager',
);
expectNoMatch(
  pos,
  /canViewAllCashiers=\{true\}|canViewAllCashiers=\{isGift|canViewAllCashiers=\{isManager/i,
  'Không được bật xem mọi thu ngân bằng hằng số hoặc biến không phải vai trò',
);
// 3. Quét toàn bộ src/: không call site nào của listPaymentProofPhotos bỏ trống scope.
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}
for (const file of sourceFiles(path.resolve(process.cwd(), 'src'))) {
  const code = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    code,
    /listPaymentProofPhotos\(\s*\)/,
    `${path.relative(process.cwd(), file)} gọi listPaymentProofPhotos() mà không truyền scope`
  );
}
// 4. Regression đường retention: savePaymentProofPhoto phải đọc TOÀN BỘ ảnh
//    (không dùng hàm đã lọc theo scope) — nếu không, mọi lần lưu ảnh sẽ ném lỗi/thiếu ảnh.
const retentionStart = offlineDb.indexOf('export async function savePaymentProofPhoto');
assert.ok(retentionStart > 0, 'offline-db có savePaymentProofPhoto');
const retentionBody = stripComments(offlineDb.slice(retentionStart, offlineDb.indexOf('export interface PaymentProofScope', retentionStart)));
expectMatch(retentionBody, /await readAllPaymentProofPhotos\(\)/, 'Retention đọc ảnh qua readAllPaymentProofPhotos');
expectNoMatch(retentionBody, /listPaymentProofPhotos/, 'Retention KHÔNG được gọi hàm đã lọc theo scope');
expectNoMatch(
  stripComments(offlineDb),
  /export (async )?function readAllPaymentProofPhotos/,
  'readAllPaymentProofPhotos phải private — không được xuất để lọt ra ngoài phạm vi',
);
// 5. Xóa ảnh: deletePaymentProofPhoto phải nhận scope và tự chặn ở tầng dữ liệu;
//    gallery luôn truyền scope, và retention gọi KHÔNG scope (được phép dọn ảnh cũ).
expectMatch(
  offlineDb,
  /export async function deletePaymentProofPhoto\(id: string, scope\?: PaymentProofScope\)/,
  'deletePaymentProofPhoto nhận scope tuỳ chọn để chặn xoá ảnh ngoài phạm vi',
);
expectMatch(
  offlineDb,
  /const photo = all\.find\(\(item\) => item\.id === id\);\s*\n\s*if \(!photo \|\| !isPhotoInScope\(photo, scope\)\) return;/,
  'deletePaymentProofPhoto từ chối xoá ảnh ngoài phạm vi',
);
expectMatch(
  gallery,
  /await deletePaymentProofPhoto\(photo\.id, scope\)/,
  'Gallery xoá ảnh kèm scope hiện tại',
);
expectMatch(
  stripComments(offlineDb),
  /if \(!kept\.some\(\(item\) => item\.id === stale\.id\)\) await deletePaymentProofPhoto\(stale\.id\);/,
  'Retention vẫn xoá được ảnh cũ ngoài phạm vi (không truyền scope)',
);
// --- 6. Đổi phạm vi (đổi kho / đổi thu ngân / đổi vai trò) phải dọn ảnh cũ TRƯỚC khi
//    tải ảnh mới, để không ai kịp xem / chia sẻ / xóa ảnh ngoài phạm vi hiện tại.
const resetGalleryStart = gallery.indexOf('const resetGallery = ');
assert.ok(resetGalleryStart > 0, 'Gallery có resetGallery() dọn trạng thái theo phạm vi');
const resetGalleryBody = stripComments(gallery.slice(resetGalleryStart, gallery.indexOf('useEffect', resetGalleryStart)));
for (const line of ['revokePreviews(', 'setPhotos([]);', 'setPreviewUrls({});', 'setExpandedId(null);']) {
  expectMatch(resetGalleryBody, new RegExp(line.replace(/[(){}[\]]/g, '\\$&')), `resetGallery() phải gọi ${line}`);
}
expectMatch(
  stripComments(gallery),
  /useEffect\(\(\) => \{[\s\S]{0,200}?if \(!isOpen\) \{[\s\S]{0,120}?resetGallery\(\);[\s\S]{0,200}?return;[\s\S]{0,120}?\}[\s\S]{0,200}?resetGallery\(\);[\s\S]{0,120}?load\(\);/,
  'Gallery resetGallery() trước rồi load() ở mọi lần mở modal / đổi phạm vi',
);
// Object URL phải được thu hồi đúng lúc, không thu hồi ảnh đang hiển thị.
expectNoMatch(
  stripComments(gallery),
  /useEffect\(\(\) => \(\) => \{[\s\S]{0,160}?Object\.values\(previewUrls\)/,
  'Không được thu hồi object URL theo mọi lần render (sẽ xoá luôn ảnh đang xem)',
);

// --- moneyReceived sau khi bỏ state chết -----------------------------------------
expectNoMatch(posCode, /isMoneyReceived/, 'State isMoneyReceived đã bị gỡ phải không còn tham chiếu');
expectMatch(
  posCode,
  /paymentMethod,\s*\n\s*moneyReceived: false,\s*\n\s*fiscalScope: isGift \? 'INTERNAL_MANAGEMENT' : fiscalScope/,
  'Đường online tiền mặt/quà tặng gửi moneyReceived: false (bất biến so với state cũ luôn false)',
);
// ============================================================================
// ADVERSARIAL ROUND 2 — săn lỗi trạng thái, đối soát offline và hỏng camera.
// Mỗi khẳng định dưới đây FAIL trên 9da1d50..HEAD trước khi sửa.
// ============================================================================

// --- A1. Đơn AWAITING_PAYMENT / NEEDS_RECONCILIATION phải nhìn thấy được -----
// getOfflineOrdersForReview tồn tại nhưng không nơi nào gọi: đơn đã đi vào
// NEEDS_RECONCILIATION ở phiên trước bị loại khỏi getPendingOfflineOrders nên
// không bao giờ vào panel rà soát -> vô hình vĩnh viễn, không ai đối soát.
assert.equal(
  typeof needsManualReview,
  'function',
  'offline-db phải xuất needsManualReview() để lọc đơn cần thủ công'
);
const reviewBase = {
  id: 'off-review-1',
  orderCode: 'OFF-REVIEW',
  idempotencyKey: 'idem-off-review',
  warehouseId: 'wh-au-co',
  customerName: 'Khách offline',
  channel: 'RETAIL_OFFICE',
  discountRate: 0,
  paymentMethod: 'BANK_TRANSFER',
  fiscalScope: 'INTERNAL_MANAGEMENT',
  cashierId: 'cashier-pos-test',
  items: [],
  subtotal: 0,
  discountAmount: 0,
  finalAmount: 0,
  totalQuantity: 0,
  createdAt: '2026-09-25T10:00:00.000Z',
  syncStatus: 'FAILED',
} as unknown as OfflineOrder;
assert.equal(
  needsManualReview({ ...reviewBase, paymentState: 'NEEDS_RECONCILIATION' }),
  true,
  'Đơn NEEDS_RECONCILIATION phải hiện ra cho thu ngân đối soát'
);
assert.equal(
  needsManualReview({ ...reviewBase, moneyReceived: false, paymentState: 'AWAITING_PAYMENT' }),
  true,
  'Đơn AWAITING_PAYMENT (khách bỏ đi) phải hiện ra, không bị bỏ quên'
);
assert.equal(
  needsManualReview({ ...reviewBase, paymentState: 'CANCELLED_LOCAL' }),
  false,
  'Đơn đã hủy cục bộ không cần hiện ra rà soát'
);
assert.equal(
  needsManualReview({ ...reviewBase, paymentMethod: 'CASH', lastError: 'Phiên két ca đã đóng' }),
  true,
  'Đơn tiền mặt bị chặn két vẫn phải hiện ra rà soát'
);
expectMatch(
  posCode,
  /getOfflineOrdersForReview\(/,
  'POS phải gọi getOfflineOrdersForReview() để đơn cần đối soát không bị vô hình'
);
expectMatch(posCode, /needsManualReview\(/, 'POS lọc panel rà soát bằng needsManualReview()');
// Panel rà soát không được hiện nút sửa cho đơn không có hành động sửa: bấm vào
// handleRepairOfflineOrder sẽ return ngay, cashier bấm hoài không được gì.
expectMatch(
  pos,
  /\{action \? \([\s\S]{0,700}?handleRepairOfflineOrder\(order\)[\s\S]{0,700}?Cần quản lý đối soát/,
  'Đơn không có hành động sửa được phải hiện hướng dẫn, không phải nút bấm-không-được'
);

// --- A2. Xác nhận 2 lần: chốt bằng ref, không chỉ bằng state ------------------
// setIsTransferSubmitting(true) là state bất đồng bộ: hai cú tap trong cùng
// tick đều đọc transferSession cũ và cùng gửi POST CONFIRM.
expectMatch(posCode, /const transferLockRef = useRef\(false\)/, 'POS phải có transferLockRef chống double-submit');
const confirmStart = posCode.indexOf('const handleConfirmTransfer = async');
const confirmEnd = posCode.indexOf('const handleCancelTransfer', confirmStart);
assert.ok(confirmStart > 0 && confirmEnd > confirmStart, 'POS có handleConfirmTransfer');
const confirmBody = stripComments(posCode.slice(confirmStart, confirmEnd));
expectMatch(
  confirmBody,
  /if \(transferLockRef\.current\) return;[\s\S]{0,900}?transferLockRef\.current = true;/,
  'handleConfirmTransfer phải khoá bằng ref trước khi gọi API'
);
expectMatch(
  confirmBody,
  /finally \{[\s\S]{0,200}?transferLockRef\.current = false;/,
  'handleConfirmTransfer phải mở khoá ref ở finally'
);

// --- A3. Cửa sổ 30 phút: server là chủ, client chỉ để hiển thị -------------
assert.equal(typeof isPaymentWindowExpired, 'function', 'offline-db phải xuất isPaymentWindowExpired()');
const expiryNow = Date.parse('2026-09-25T10:00:00.000Z');
assert.equal(isPaymentWindowExpired('2026-09-25T10:30:00.000Z', expiryNow), false, 'Còn 30 phút thì chưa hết hạn');
assert.equal(isPaymentWindowExpired('2026-09-25T10:00:00.000Z', expiryNow), true, 'Đúng mốc hạn thì đã hết hạn');
assert.equal(isPaymentWindowExpired('2026-09-25T09:59:59.000Z', expiryNow), true, 'Quá mốc hạn thì đã hết hạn');
assert.equal(isPaymentWindowExpired(undefined, expiryNow), false, 'Không có hạn thì không chặn');
// Tab bị throttle khi background: đếm ngược phải tính lại khi quay lại tab,
// nếu không cashier thấy đồng hồ đứng và bấm Xác nhận trên đơn đã hết hạn.
expectMatch(transferModal, /visibilitychange/, 'Modal phải tính lại đồng hồ khi tab quay lại foreground');
expectMatch(confirmBody, /isPaymentWindowExpired\(/, 'handleConfirmTransfer phải tự chặn khi phiên đã hết hạn, không chỉ dựa vào disabled');
expectMatch(
  confirmBody,
  /isPaymentWindowExpired[\s\S]{0,240}?return;/,
  'handleConfirmTransfer chặn sớm khi hết hạn'
);

// --- A4. Refresh giữa phiên: phiên chuyển khoản phải sống sót ---------------
// Browser refresh làm mất transferSession nhưng đơn offline vẫn nằm trong
// IndexedDB và đơn PENDING trên server vẫn giữ ATP 30 phút.
assert.equal(typeof writeTransferSessionCache, 'function', 'Phải có writeTransferSessionCache() để phiên sống sót qua refresh');
writeTransferSessionCache({
  mode: 'ONLINE',
  orderId: 'srv-order-1',
  orderCode: 'ORD-20260925-ABC',
  idempotencyKey: 'idem-ORD-20260925-ABC',
  warehouseId: 'wh-au-co',
  amount: 150000,
  paymentMethod: 'BANK_TRANSFER',
  createdAt: '2026-09-25T10:00:00.000Z',
  expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  qrSnapshot: { dataUrl: 'data:image/png;base64,AAA', payload: 'p', accountNo: '123', content: 'ORD-20260925-ABC' },
});
const restored = readTransferSessionCache('wh-au-co');
assert.ok(restored, 'Phiên chuyển khoản phải đọc lại được sau refresh');
assert.equal(restored?.orderId, 'srv-order-1', 'Khôi phục đúng orderId');
assert.equal(restored?.paymentProof, null, 'Phiên khôi phục KHÔNG được tự coi là đã có ảnh');
assert.match(JSON.stringify(restored), /"paymentProof":null/, 'Ảnh phải được đánh dấu chưa có, không nối bằng object rỗng');
assert.equal(readTransferSessionCache('wh-kho-khac'), null, 'Phiên không lọc sang kho khác');
writeTransferSessionCache(null, 'wh-au-co');
assert.equal(readTransferSessionCache('wh-au-co'), null, 'Xoá cache phiên hoạt động');
// Phiên đã quá cửa sổ 30 phút không được hồi sinh: cashier sẽ thấy modal trên
// một đơn server đã tự huỷ, và nút Xác nhận sẽ bị chặn vĩnh viễn.
writeTransferSessionCache({
  mode: 'ONLINE',
  orderId: 'srv-order-expired',
  orderCode: 'ORD-20260925-OLD',
  idempotencyKey: 'idem-ORD-20260925-OLD',
  warehouseId: 'wh-au-co',
  amount: 150000,
  paymentMethod: 'BANK_TRANSFER',
  createdAt: '2026-09-25T10:00:00.000Z',
  expiresAt: new Date(Date.now() - 60_000).toISOString(),
  qrSnapshot: { dataUrl: 'data:image/png;base64,AAA', payload: 'p', accountNo: '123', content: 'ORD-20260925-OLD' },
});
assert.equal(readTransferSessionCache('wh-au-co'), null, 'Phiên đã hết hạn không được khôi phục');
// Cache hỏng / sai kho không được ném lỗi.
localStorage.setItem('formapubli.transferSession.wh-au-co', '{not json');
assert.equal(readTransferSessionCache('wh-au-co'), null, 'Cache phiên hỏng bị từ chối');
localStorage.removeItem('formapubli.transferSession.wh-au-co');
// Khôi phục phải nạp lại ảnh từ IndexedDB, không nhét blob rỗng.
assert.match(offlineDb, /export async function getPaymentProofPhoto\(/, 'Có đường nạp lại ảnh theo id');
expectMatch(posCode, /readTransferSessionCache\(/, 'POS phải khôi phục phiên chuyển khoản khi mount');
expectMatch(posCode, /getPaymentProofPhoto\(/, 'POS phải nạp lại blob ảnh từ IndexedDB sau khi khôi phục phiên');
// Phiên phải được ghi ngay khi mới tạo (trước khi chụp ảnh), không chỉ sau khi
// chụp: refresh giữa chừng là lúc cashier dễ bấy F5 nhất.
expectMatch(
  posCode,
  /useEffect\(\(\) => \{[\s\S]{0,120}?if \(!transferSession\) return;[\s\S]{0,600}?writeTransferSessionCache\(/,
  'POS ghi cache phiên ngay khi phiên tồn tại, không đợi tới lúc chụp ảnh'
);

// --- A5. syncState của ảnh phải được tiến, không đứng ở LOCAL_ONLY ----------
// retention miễn xoá ảnh NEEDS_RECONCILIATION và gallery chặn xoá ảnh đó —
// nhưng không nơi nào ghi state lên ảnh, nên cả hai đều là code chết.
assert.match(offlineDb, /export async function markPaymentProofPhotoSyncState\(/, 'Phải có markPaymentProofPhotoSyncState() để tiến trạng thái ảnh');
const syncSuccess = posCode.indexOf('if (resData.success) {');
assert.ok(syncSuccess > 0, 'POS có nhánh sync thành công');
const syncSuccessBlock = stripComments(
  posCode.slice(syncSuccess, posCode.indexOf('updateOfflineOrderStatus', syncSuccess))
);
expectMatch(syncSuccessBlock, /markPaymentProofPhotoSyncState\([^)]*'ORDER_SYNCED'/, 'Sync thành công phải đánh dấu ảnh ORDER_SYNCED');
expectMatch(
  posCode,
  /markPaymentProofPhotoSyncState\([^)]*'NEEDS_RECONCILIATION'/,
  'Đơn vào đối soát phải đánh dấu ảnh NEEDS_RECONCILIATION để retention miễn xoá'
);

// --- A6. Camera: lỗi quyền phải còn lại để cashier đọc được -----------------
// setErrorMessage() rồi onClose() ngay -> modal unmount, thông báo biến mất,
// cashier thấy camera tự biến mất mà không biết vì sao.
const advDeniedStart = camera.indexOf("'NotAllowedError'");
assert.ok(advDeniedStart > 0, 'Camera có nhánh NotAllowedError');
const advDeniedBody = stripComments(camera.slice(advDeniedStart, camera.indexOf('}, [isOpen')));
expectNoMatch(
  advDeniedBody,
  /setErrorMessage\([\s\S]{0,400}?onClose\(\);/,
  'Camera không được set lỗi rồi đóng ngay (thông báo bị unmount mất)'
);
expectMatch(pos, /onCameraError=/, 'Lỗi camera phải được nâng lên POS để hiện trong modal chuyển khoản');
// Nút X trên camera không khoá khi đang lưu, còn focus trap thì có.
const cameraHeaderClose = stripComments(camera.slice(0, camera.indexOf('{preview ?')));
expectMatch(
  cameraHeaderClose,
  /onClick=\{onClose\}[\s\S]{0,200}?disabled=\{isSaving\}/,
  'Nút đóng camera phải khoá khi đang lưu ảnh, đồng bộ với focus trap'
);

// --- A7. Object URL của ảnh đã xoá phải được thu hồi -------------------------
expectMatch(
  stripComments(gallery),
  /removePhoto[\s\S]{0,600}?URL\.revokeObjectURL\(/,
  'Xoá ảnh phải thu hồi object URL tương ứng'
);
// Tải xuống: revoke ngay sau click() có thể hủy download ở một số trình duyệt.
const shareStart = gallery.indexOf('const sharePhoto');
const shareBody = stripComments(gallery.slice(shareStart, gallery.indexOf('const removePhoto')));
assert.ok(shareStart > 0, 'Gallery có sharePhoto');
expectNoMatch(
  shareBody,
  /anchor\.click\(\);[\s\S]{0,80}?URL\.revokeObjectURL\(url\);/,
  'Không được revoke object URL ngay sau anchor.click() (huỷ download)'
);

// --- A8. CASH và GIFT: bỏ toggle tay không được đổi hành vi -----------------
// Bằng chứng: toggle cũ chỉ render trong nhánh BANK_TRANSFER/QR_CODE và bị
// force-reset theo cart/paymentMethod, nên với CASH/GIFT nó luôn false.
expectNoMatch(posCode, /isMoneyReceived|MoneyReceivedToggle/, 'Toggle tay phải bị gỡ hoàn toàn');
expectMatch(
  posCode,
  /paymentMethod,\s*\n\s*moneyReceived: false,\s*\n\s*fiscalScope: isGift \? 'INTERNAL_MANAGEMENT' : fiscalScope/,
  'Đường online CASH/GIFT vẫn gửi moneyReceived: false như trước'
);
expectMatch(
  posCode,
  /paymentState: !isGift && isDigitalPayment \? 'AWAITING_PAYMENT' : undefined/,
  'Đơn offline CASH/GIFT không gắn paymentState (vẫn READY_TO_SYNC như cũ)'
);
assert.equal(
  normalizeOfflinePaymentState({ ...reviewBase, paymentMethod: 'CASH' }),
  'READY_TO_SYNC',
  'Đơn offline tiền mặt vẫn tự đồng bộ, không bị kẹt vì paymentState mới'
);
assert.equal(
  normalizeOfflinePaymentState({ ...reviewBase, paymentMethod: 'BANK_TRANSFER', discountRate: 1 } as OfflineOrder),
  'READY_TO_SYNC',
  'Đơn quà tặng (discountRate 1) không bị kẹt ở trạng thái chuyển khoản'
);
assert.equal(
  applySyncErrorToOfflineOrder({ ...reviewBase, paymentMethod: 'CASH' }, 'INSUFFICIENT_ATP'),
  'READY_TO_SYNC',
  'Lỗi ATP của luồng chuyển khoản không được kéo đơn tiền mặt vào đối soát'
);
// Đường offline CASH: vẫn in bill ngay (không mở phiên chuyển khoản).
// Slice TRƯỚC khi strip, và dùng mốc ASCII ổn định (comment tiếng Việt dễ lệch encoding).
const offlineCashBlock = stripComments(
  pos.slice(pos.indexOf('const fallbackToOffline'), pos.indexOf('await fallbackToOffline();'))
);
// Nhánh này (khác nhánh chặn cache ở trên) là điểm rẽ duy nhất giữa "mở phiên
// chuyển khoản" và "in bill": CASH/gift rơi xuống dưới phải tới setCompletedOrder.
expectMatch(
  offlineCashBlock,
  /if \(!isGift && isDigitalPayment\) \{\s*setTransferErrorMessage\(null\);[\s\S]{0,1400}?\n\s*return;/,
  'Đường offline chỉ mở phiên chuyển khoản cho BANK_TRANSFER/QR_CODE, CASH vẫn đi tiếp in bill'
);
expectMatch(
  offlineCashBlock,
  /setCompletedOrder\(\{[\s\S]{0,900}?isOffline: true/,
  'Đơn offline tiền mặt vẫn tạo bill như cũ'
);

// ============================================================================
// ADVERSARIAL ROUND 3 — "reset without checking success".
//
// Lớp lỗi: giỏ hàng bị xoá, phiên bị đóng, bản ghi offline bị xoá hoặc toast
// thành công hiện lên TRƯỚC khi biết thao tác thật sự thành công. Cashier tin
// là xong, dữ liệu thì còn nằm trên server.
// ============================================================================

const cancelStart = posCode.indexOf('const handleCancelTransfer = async');
const cancelEnd = posCode.indexOf('const handleCheckout', cancelStart) > cancelStart
  ? posCode.indexOf('const handleCheckout', cancelStart)
  : posCode.length;
assert.ok(cancelStart > 0, 'POS có handleCancelTransfer');
const cancelBody = stripComments(posCode.slice(cancelStart, cancelEnd));

// --- B1. Huỷ ONLINE: bắt buộc kiểm tra response trước khi dọn state ---------
expectMatch(
  cancelBody,
  /const cancelData = await res\.json\(\)[\s\S]{0,300}?if \(!res\.ok \|\| !cancelData\?\.success\)/,
  'Huỷ online phải kiểm tra res.ok và success, không chỉ await fetch'
);
expectMatch(
  cancelBody,
  /if \(!res\.ok \|\| !cancelData\?\.success\) \{[\s\S]{0,300}?setTransferErrorMessage\([\s\S]{0,300}?return;/,
  'Huỷ thất bại phải báo lỗi server và dừng, không return im lặng'
);
// Giỏ và phiên chỉ được dọn ở đường thành công, sau khi đã kiểm.
const cancelResetIdx = cancelBody.indexOf('closeTransferSession();');
const cancelGuardIdx = cancelBody.indexOf('if (!res.ok || !cancelData?.success)');
assert.ok(
  cancelResetIdx > 0 && cancelGuardIdx > 0 && cancelGuardIdx < cancelResetIdx,
  'closeTransferSession() phải nằm SAU chặn kiểm response, không trước'
);
const cancelResetBlock = stripComments(cancelBody.slice(cancelResetIdx, cancelResetIdx + 260));
expectMatch(
  cancelResetBlock,
  /postCheckoutResetRef\.current\?\.\(\)/,
  'Xác nhận thứ tự: đóng phiên rồi mới xoá giỏ'
);
expectNoMatch(
  cancelBody.slice(0, cancelGuardIdx),
  /closeTransferSession\(\)|postCheckoutResetRef\.current\?\.\(\)/,
  'Trước khi kiểm response không được đóng phiên hay xoá giỏ'
);
// Thông báo lỗi phải lấy từ server trước, rồi mới tới câu dự phòng kèm HTTP status
// (để cashier biết đơn vẫn còn trên máy chủ chứ không mất tiền).
expectMatch(cancelBody, /cancelData\?\.error \|\| /, 'Huỷ thất bại phải hiện lỗi server cho cashier');
expectMatch(cancelBody, /res\.status/, 'Câu dự phòng khi server không trả JSON phải nêu HTTP status');

// --- B2. Huỷ OFFLINE: chỉ đánh CANCELLED_LOCAL sau khi thao tác thật sự xong --
// patchOfflineOrder/removeOfflineOrder đều resolve im lặng khi không thấy
// record, nên "thành công" phải được xác nhận bằng chính record đó.
expectMatch(
  cancelBody,
  /const cancelled = await cancelOfflineOrderLocally\(/,
  'Huỷ offline phải đi qua một hàm trả về kết quả thật, không gọi removeOfflineOrder im lặng'
);
expectMatch(
  cancelBody,
  /if \(!cancelled\) \{[\s\S]{0,300}?setTransferErrorMessage\([\s\S]{0,200}?return;/,
  'Huỷ offline thất bại phải báo lỗi và giữ nguyên giỏ + phiên'
);
expectNoMatch(
  cancelBody,
  /removeOfflineOrder\(/,
  'handleCancelTransfer không tự xoá bản ghi: xoá phải do hàm có xác nhận kết quả'
);
assert.match(
  offlineDb,
  /export async function cancelOfflineOrderLocally\(/,
  'offline-db phải có cancelOfflineOrderLocally() xác nhận việc huỷ thực sự xảy ra'
);

// --- B3. Ảnh lưu xong nhưng gắn vào đơn offline hỏng: KHÔNG mở nút Xác nhận -
// handleUseTransferPhoto set paymentProof vào session TRƯỚC khi
// attachOfflineOrderPaymentProof ném lỗi. Camera báo lỗi nhưng session đã có
// ảnh → cashier bấm Xác nhận, thấy toast thành công, giỏ bị xoá, trong khi đơn
// offline vẫn AWAITING_PAYMENT (không bao giờ tự sync) dù tiền đã thu.
const usePhotoStart2 = posCode.indexOf('const handleUseTransferPhoto = async');
const usePhotoEnd2 = posCode.indexOf('const handleConfirmTransfer', usePhotoStart2);
assert.ok(usePhotoStart2 > 0, 'POS có handleUseTransferPhoto');
const usePhotoBody2 = stripComments(posCode.slice(usePhotoStart2, usePhotoEnd2));
const attachIdx2 = usePhotoBody2.indexOf('await attachOfflineOrderPaymentProof(');
const proofSetIdx2 = usePhotoBody2.indexOf('paymentProof: photo');
assert.ok(attachIdx2 > 0 && proofSetIdx2 > 0, 'handleUseTransferPhoto gọi attach và set paymentProof');
assert.ok(
  proofSetIdx2 > attachIdx2,
  'paymentProof chỉ được set vào session SAU khi attachOfflineOrderPaymentProof thành công'
);

// --- B4. Xác nhận OFFLINE: phải kiểm đơn thật sự PAID_PENDING_SYNC -----------
// Nhánh offline báo "đã ghi nhận" và xoá giỏ mà không hề xác minh đơn local đã
// sang PAID_PENDING_SYNC. Nếu attach lúc trước hỏng, cashier vẫn thấy thành công.
const confirmBodyB = stripComments(
  posCode.slice(posCode.indexOf('const handleConfirmTransfer = async'), cancelStart)
);
expectMatch(
  confirmBodyB,
  /isOfflineTransferReadyToConfirm\(/,
  'Xác nhận offline phải xác minh đơn local thật sự sẵn sàng trước khi báo thành công'
);
expectMatch(
  confirmBodyB,
  /if \(session\.mode === 'OFFLINE'\) \{[\s\S]{0,900}?if \(!ready\) \{[\s\S]{0,300}?setTransferErrorMessage\([\s\S]{0,200}?return;/,
  'Xác nhận offline thất bại phải báo lỗi và giữ giỏ, không toast thành công'
);
const offlineConfirmReset = confirmBodyB.indexOf('postCheckoutResetRef.current?.()');
const offlineReadyIdx = confirmBodyB.indexOf('isOfflineTransferReadyToConfirm(');
assert.ok(
  offlineReadyIdx > 0 && offlineConfirmReset > offlineReadyIdx,
  'Nhánh offline phải xác minh đơn TRƯỚC khi xoá giỏ và báo thành công'
);
assert.match(
  offlineDb,
  /export async function isOfflineTransferReadyToConfirm\(/,
  'offline-db phải có isOfflineTransferReadyToConfirm() đọc trạng thái thật của đơn'
);

// --- B5. Sửa thủ công phải đưa đơn THẬT SỰ trở lại đường tự động sync ------
// updateOfflineOrderForRetry ghi ca két / moneyReceived rồi đặt syncStatus
// PENDING, nhưng nếu giữ nguyên paymentState = NEEDS_RECONCILIATION thì
// getPendingOfflineOrders vẫn loại đơn đó. POS báo "đã cập nhật, đang đồng bộ
// lại" rồi không bao giờ đồng bộ được — thông báo thành công sai.
assert.match(
  offlineDb,
  /export function paymentStateAfterManualRepair\(/,
  'offline-db phải có paymentStateAfterManualRepair() để tính trạng thái sau khi sửa'
);
assert.match(
  offlineDb,
  /order\.paymentState = paymentStateAfterManualRepair\(order\);/,
  'updateOfflineOrderForRetry phải tính lại paymentState, không giữ nguyên NEEDS_RECONCILIATION'
);
// repair phải báo kết quả thật, không "thành công" cho một record không tồn tại
assert.match(
  offlineDb,
  /export async function updateOfflineOrderForRetry\([\s\S]{0,120}?\): Promise<boolean>/,
  'updateOfflineOrderForRetry phải trả về boolean thay vì void im lặng'
);
const repairStart = posCode.indexOf('const handleRepairOfflineOrder');
const repairEnd = posCode.indexOf('const handleClaimLegacyOrders', repairStart);
assert.ok(repairStart > 0 && repairEnd > repairStart, 'POS có handleRepairOfflineOrder');
const repairBody = stripComments(posCode.slice(repairStart, repairEnd));
expectMatch(
  repairBody,
  /repaired = await updateOfflineOrderForRetry\(/,
  'POS phải nhận kết quả thật của updateOfflineOrderForRetry'
);
expectMatch(
  repairBody,
  /if \(!repaired\) \{[\s\S]{0,300}?setErrorMessage\([\s\S]{0,200}?return;/,
  'Sửa thất bại phải báo lỗi, không toast "đã cập nhật" cho đơn không tồn tại'
);
const repairToastIdx = repairBody.indexOf('đang đồng bộ lại');
assert.ok(
  repairToastIdx > 0 && repairToastIdx > repairBody.indexOf('if (!repaired)'),
  'Toast thành công phải nằm SAU chặn !repaired'
);

// --- D1. Mã lỗi server mà client theo dõi phải là mã server THẬT SỰ phát ra --
// Mọi mã trong RECONCILIATION_ERROR_CODES phải nằm trong statusMap của
// handleApiError, nếu không đó là code chết: ca két hỏng thật sự vẫn rơi vào
// nhánh FAILED chung chung và đơn đã thu tiền mất dấu vết.
const statusMapBlock = readSource('src/lib/api-response.ts');
// String.match với /g trả về TOÀN BỆNH khớp chứ không trả nhóm bắt, nên phải exec.
const serverCodes = new Set<string>();
const codeRe = /^\s*([A-Z_]+):\s*\d+,/gm;
let codeMatch: RegExpExecArray | null;
while ((codeMatch = codeRe.exec(statusMapBlock)) !== null) serverCodes.add(codeMatch[1]);
expectMatch(offlineDb, /export const RECONCILIATION_ERROR_CODES/, 'RECONCILIATION_ERROR_CODES phải xuất ra để test kiểm chứng');
for (const code of ['INSUFFICIENT_ATP', 'IDEMPOTENCY_CONFLICT', 'STATE_CONFLICT', 'INVALID_INPUT', 'FORBIDDEN']) {
  assert.ok(
    serverCodes.has(code),
    `handleApiError thực sự phát ra mã ${code} (client theo dõi mã có thật)`
  );
}
expectMatch(
  offlineDb,
  /'STATE_CONFLICT'/,
  'RECONCILIATION_ERROR_CODES phải chứa STATE_CONFLICT (quy tắc ca két của đơn tại quầy)'
);
expectNoMatch(
  offlineDb,
  /'CASHBOX_SESSION_NOT_FOUND'/,
  'Không theo dõi mã CASHBOX_SESSION_NOT_FOUND: server không có mã này trong statusMap'
);
// Mọi mã trong set phải là mã server thật (bắt mã bịa mới trong tương lai).
const reconSetBlock = offlineDb.slice(
  offlineDb.indexOf('RECONCILIATION_ERROR_CODES'),
  offlineDb.indexOf('const OFFLINE_PAYMENT_STATES')
);
for (const m of reconSetBlock.match(/'([A-Z_]+)'/g) || []) {
  assert.ok(
    serverCodes.has(m.replace(/'/g, '')),
    `Mã ${m} trong RECONCILIATION_ERROR_CODES phải là mã server thật sự phát ra`
  );
}
// Sync phải giữ ảnh khi đơn vào đối soát, và bỏ qua đơn tiền mặt.
expectMatch(
  posCode,
  /markPaymentProofPhotoSyncState\(order\.paymentProofId, 'NEEDS_RECONCILIATION'\)/,
  'Đơn vào đối soát phải giữ ảnh (kể cả khi nguyên nhân là STATE_CONFLICT)'
);

console.log('ADVERSARIAL-A: state machine + reconciliation');
console.log('PASS: transfer payment photo contract.');
