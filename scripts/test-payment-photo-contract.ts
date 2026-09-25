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
import { isPhotoInScope, normalizeOfflinePaymentState, prunePaymentProofPhotos, type PaymentProofPhoto } from '../src/lib/offline-db';

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
console.log('PASS: transfer payment photo contract.');
