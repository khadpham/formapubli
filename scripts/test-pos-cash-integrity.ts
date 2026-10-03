/**
 * Ba lỗi POS do người dùng thấy hằng ngày, đã tự xác minh bằng đọc code trước
 * khi sửa.
 *
 * 1. Ô "Tiền mặt thực tế đếm được trong két" bị ĐIỀN SẴN bằng `expectedCash`.
 *    Thu ngân bấm thẳng "Khóa Két & Kết Ca" là `closingCashActual ===
 *    expectedCash` ⇒ CHÊNH LỆCH LUÔN 0 đ. Đó là vô hiệu hoá tầng kiểm soát tiền
 *    mặt: ca nào cũng "khớp", kể cả ca thiếu tiền thật. Server nhận nguyên giá
 *    trị này và không có lớp nào phát hiện nếu ta tự điền hộ.
 *
 * 2. Quét ISBN-13 của một cuốn KHÔNG có trong danh mục, tình cờ trùng 4 số cuối
 *    với đúng một cuốn trong danh mục ⇒ thẻ ấn bản SAI vào giỏ, trừ sai tồn
 *    kho và tính tiền theo giá của cuốn khác. Điều kiện `endsWith(isbnLast4)`
 *    nằm trong `||` vô điều kiện.
 *
 * 3. Phiếu thu in `items`/`subtotal`/`discountAmount` từ GIỎ ĐANG SỐNG nhưng
 *    `finalAmount` từ PHIÊN ĐÃ ĐÓNG BĂNG. Sau khi F5 giữa chừng lúc chờ chuyển
 *    khoản, giỏ rỗng còn phiên còn ⇒ phiếu có tổng tiền đúng nhưng bảng dòng
 *    sách rỗng và mất dòng "Tạm tính".
 *
 * 4. Banner "Giỏ hàng đang tạm khóa" hiện chữ "chờ Quản lý duyệt" NGAY CẢ khi
 *    chỉ đang chốt đơn (checkoutLock, không có phê duyệt nào) ⇒ thu ngân tưởng
 *    đơn nào cũng phải xin duyệt; bấm "Mở lại mã" (không có yêu cầu nào) ⇒
 *    modal duyệt mở ra rồi lỗi/tắt. Chữ duyệt chỉ được hiện khi có phê duyệt
 *    thật; nút "Mở lại mã" chỉ khi có yêu cầu đang chờ.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const strip = (p: string) =>
  fs.readFileSync(path.resolve(process.cwd(), p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');

const pos = strip('src/components/pos/PosCheckoutTerminal.tsx');
const modal = strip('src/components/pos/TransferPaymentModal.tsx');
const cache = strip('src/lib/bank-account-cache.ts');
// Matcher quét mã đã tách ra module dùng chung (03/10/2026) — trước đây nó nằm
// trong `pos`, và bản chép thứ hai trong `test-barcode-engine.ts` đã lệch logic
// (dùng `endsWith` vô điều kiện). Kiểm phải trỏ đúng nơi luật còn nằm.
const scan = strip('src/lib/scan-resolve.ts');

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

// --- 1. Ô tiền thực đếm phải để TRỐNG ---
ok(
  !/setClosingCashActualInput\(String\(activeSession\.expectedCash/.test(pos),
  'KHÔNG được điền sẵn expectedCash vào ô tiền thực đếm — chênh lệch sẽ luôn 0đ'
);
ok(
  /setClosingCashActualInput\(''\)/.test(pos),
  'mở modal chốt ca phải để ô tiền thực đếm TRỐNG để thu ngân tự đếm'
);
// Handler phải vẫn chặn ô rỗng (không được nới lỏng để "cho qua").
ok(
  /isNaN\(closingVal\)/.test(pos),
  'vẫn phải chặn khi ô tiền thực đếm rỗng hoặc không phải số'
);
// Cảnh báo cho thu ngân phải còn.
ok(
  /Đếm tiền trong két rồi tự nhập/.test(pos),
  'phải nhắc thu ngân tự đếm, không dùng số của hệ thống'
);

// --- 2. Khớp 4 số cuối chỉ hợp lệ khi mã quét ĐÚNG 4 ký tự ---
ok(
  !/cleanScanned\.endsWith\(b\.isbnLast4\)/.test(pos) &&
    !/cleanScanned\.endsWith\(b\.isbnLast4\)/.test(scan),
  'không được khớp 4 số cuối bằng endsWith trên mã dài — sẽ thêm nhầm ấn bản'
);
ok(
  /cleanScanned\.length === 4/.test(scan),
  'khớp 4 số cuối chỉ được phép khi mã quét đúng 4 ký tự'
);
// Mã đầy đủ vẫn phải khớp được bằng ISBN đầy đủ.
ok(/cleanIsbn === cleanScanned/.test(scan), 'vẫn phải khớp được ISBN đầy đủ');
// POS phải GỌI hàm dùng chung, không tự chép lại matcher (nguồn của bug này).
ok(/resolveScan\(scannedCode, books, getBookStock/.test(pos),
  'POS phải gọi resolveScan() dùng chung — chép lại matcher là bản chép lệch logic');
ok(!/cleanIsbn === cleanScanned/.test(pos),
  'POS không được tự chứa biểu thức so khớp ISBN nữa — luật chỉ nằm ở scan-resolve.ts');
ok(/resolveScan\(scannedCode, books, getBookStock, readScanPick\(cleanScanned\)\)/.test(pos),
  'POS phải truyền lựa chọn nhớ trong ca (sessionStorage) vào resolveScan — bỏ thì D3 chết âm thầm');
ok(/writeScanPick\(ambiguousPickKey, book\.id\)/.test(pos),
  'bấm chọn trong modal phải ghi nhớ ấn bản theo mã đã quét — không gì đỏ nếu thiếu');
ok(/sessionStorage\.getItem\(scanPickKey\(cleanScanned\)\)/.test(pos) &&
    /sessionStorage\.setItem\(scanPickKey\(cleanScanned\), editionId\)/.test(pos),
  'lựa chọn ấn bản phải lưu trong sessionStorage (đóng tab là quên), không phải biến module');
// Tồn quyết định cả việc tự chọn ấn bản ⇒ ATP của KHO KHÁC không được dùng.
ok(/catalogAtpWarehouse === selectedWarehouseId \? catalogAtp\[book\.id\] : undefined/.test(pos),
  'getBookStock phải bỏ qua ATP của kho khác — đổi kho xong mà chưa nạp xong thì tồn kho cũ quyết sai ấn bản');
// Dòng 0 tồn trong modal trùng mã: bấm là mất modal + ghi nhớ nhầm.
ok(/disabled=\{stock <= 0\}/.test(pos),
  'ấn bản 0 tồn trong modal phải bị khoá — bấm sẽ đóng modal và ghi nhớ 1 cuốn không bán được');

// --- 3. Phiếu thu phải lấy danh sách sách từ phiên đã đóng băng ---
ok(/items\?: Array<\{ editionId/.test(modal), 'phiên chuyển khoản phải lưu danh sách mặc hàng');
ok(/items\?: Array<\{ editionId/.test(cache), 'cache phiên cũng phải giữ danh sách mặc hàng');
ok(
  /session\.items && session\.items\.length > 0 \? \[\.\.\.session\.items\] : \[\.\.\.cart\]/.test(pos),
  'phiếu thu phải ưu tiên danh sách đã đóng băng trong phiên, rơi về giỏ khi phiên cũ không có'
);
ok(
  /items: \[\.\.\.cart, \.\.\.giftItems\]\.map\(/.test(pos),
  'phải đóng băng danh sách mặc hàng (cả dòng thường lẫn dòng quà) vào phiên lúc tạo đơn'
);

// --- 4. Banner đóng băng không được mạo danh "chờ duyệt" khi chỉ đang chốt đơn ---
ok(
  /hasRealApprovalState = isApprovalPending \|\| approvedDiscountRequestId !== null/.test(pos),
  'banner phân biệt phê duyệt thật với khóa chốt đơn'
);
ok(
  /hasRealApprovalState \? \(/.test(pos),
  'chữ "chờ duyệt" chỉ hiện khi có phê duyệt thật, còn lại là "đang xử lý thanh toán"'
);
ok(
  /pendingApprovalRequestId && \(/.test(pos),
  'nút "Mở lại mã" chỉ hiện khi có yêu cầu đang chờ (không mở modal rỗng)'
);

console.log(`\n=== BA LỖI POS ĐÃ XÁC MINH: ${checks} assertions PASS ===`);
