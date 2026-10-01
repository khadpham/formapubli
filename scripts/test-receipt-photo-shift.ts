/**
 * PHIẾU THÀNH CÔNG + ẢNH THANH TOÁN + KÉT CA TIỀN MẶT (30/09).
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-receipt-photo-shift
 *
 * BA YÊU CẦU CỦA NGƯỜI DÙNG:
 *  1. Modal "Bán hàng thành công": HIỆN ẢNH XÁC NHẬN thay mã QR. Khách đã quét
 *     QR và chuyển xong ở bước trước — QR ở đây vô dụng. Và ảnh ẨN mặc định
 *     giống modal thanh toán, bấm "Xem ảnh" mới hiện cho gọn phiếu.
 *  2. Nút "Ảnh thanh toán" phải ở UI POS CHÍNH. Trước đây nó nằm sâu trong
 *     panel thanh toán — thu ngân muốn xem lại ảnh phải lặn vào giỏ hàng, vô lý.
 *  3. Tiền mặt cũng phải MỞ CA mới cho bán (đúng vai trò "theo dõi thanh toán
 *     tiền mặt"). Chuyển khoản đã bị chặn khi chưa mở ca, tiền mặt thì lọt.
 *     Nhưng siết ở SERVER phá vỡ 21 luồng nội bộ hợp lệ (hoa hồng, dự báo, trả
 *     hàng, offline, bundle, đồng bộ tạo đơn tiền mặt ngoài ca) — nên siết ở
 *     ĐÚNG CHỖ THU NGÂN THAO TÁC: nút thanh toán ở POS. Owner/Manager miễn theo
 *     đúng luật B2a ở server; đơn TẶNG không có dòng tiền nên cho qua.
 */
import { readFileSync } from 'node:fs';

const pos = readFileSync('src/components/pos/PosCheckoutTerminal.tsx', 'utf8').replace(/\r\n/g, '\n');
const svc = readFileSync('src/services/order.service.ts', 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

console.log('\n=== PHIẾU THÀNH CÔNG: ẢNH THAY QR · NÚT ẢNH Ở UI CHÍNH · TIỀN MẶT CẦN MỞ CA ===');

// --- 1. Phiếu thành công hiện ảnh, ẩn mặc định ---
ok(/paymentProofUrl: session\.paymentProof\?\.blob/.test(pos),
   '1. Phiếu thành công nhận URL ảnh từ blob đang có trong bộ nhớ (không đọc lại)');
ok(/URL\.createObjectURL\(session\.paymentProof\.blob\)/.test(pos),
   '2. URL ảnh được tạo đúng lúc xác nhận xong');
ok(!/completedOrder\.qrDataUrl && \(/.test(pos),
   '3. Mã QR KHÔNG còn là nội dung chính của phiếu (khách đã chuyển xong)');
ok(/completedOrder\.paymentProofUrl \? \(/.test(pos),
   '4. Phiếu hiện khối ảnh khi có ảnh xác nhận');
ok(/setIsReceiptProofVisible\(\(v\) => !v\)/.test(pos)
   && /\{isReceiptProofVisible \? 'Ẩn ảnh' : 'Xem ảnh'\}/.test(pos),
   '5. Ảnh ẨN mặc định, bấm "Xem ảnh" mới hiện — cùng kiểu nút modal thanh toán');
ok(/aria-label=\{isReceiptProofVisible \? 'Ẩn ảnh xác nhận' : 'Xem ảnh xác nhận'\}/.test(pos),
   '6. Nút có nhãn đọc màn hình rõ đang xem hay chưa');
ok(/completedOrder\?\.paymentProofUrl/.test(pos) && /URL\.revokeObjectURL\(url\)/.test(pos),
   '7. URL ảnh được thu hồi khỏi RAM khi sang phiếu mới / unmount');
ok(/setIsReceiptProofVisible\(false\)/.test(pos),
   '8. Trạng thái hiện ảnh về ẨN mỗi khi sang đơn mới');

// --- 2. Nút "Ảnh thanh toán" ở UI chính ---
ok(/id="btn-open-photo-gallery"/.test(pos),
   '9. Nút thư viện ảnh có id để kiểm thử và tự động hoá');
ok(/onClick=\{\(\) => setIsPhotoGalleryOpen\(true\)\}/.test(pos),
   '10. Nút mở đúng thư viện ảnh đã có (không viết thư viện mới)');
ok(pos.indexOf('id="btn-open-photo-gallery"') < pos.indexOf('Quản lý Két tiền Ca làm việc'),
   '11. Nút nằm ở thanh header chính, cạnh nút "Đơn Chờ" — không nằm trong giỏ');
ok(/aria-label="Xem thư viện ảnh xác nhận thanh toán"/.test(pos),
   '12. Nút có nhãn rõ cho thu ngân và đọc màn hình');

// --- 3. Tiền mặt cần mở ca (siết ở UI, KHÔNG phá server) ---
ok(/checkoutNeedsOpenShift/.test(pos) && /hasMatchingOpenShift/.test(pos),
   '13. Có chốt chặn mở ca cho nút thanh toán');
ok(/paymentMethod === 'CASH' \|\| isDigitalCheckout/.test(pos),
   '14. Chốt chặn ÁP DỤNG cho cả tiền mặt lẫn chuyển khoản (trước đây tiền mặt lọt)');
ok(/currentRole !== 'ROLE_OWNER'/.test(pos) && /currentRole !== 'ROLE_MANAGER'/.test(pos),
   '15. Owner/Manager miễn — đúng luật B2a ở server, không tự đặt lệ mới');
ok(/isGift/.test(pos.slice(pos.indexOf('checkoutNeedsOpenShift'), pos.indexOf('checkoutNeedsOpenShift') + 400)),
   '16. Đơn TẶNG không dòng tiền vẫn cho qua');
ok(/activeSession\?\.warehouseId === selectedWarehouseId/.test(pos)
   && /activeSession\?\.cashierId === cashierActorId/.test(pos),
   '17. Ca phải ĐÚNG kho và ĐÚNG thu ngân, không phải ca nào cũng được');
// Phải khoanh đúng thuộc tính `disabled`: `title` của nút cũng nhắc tới chốt chặn
// nên dò cả cửa sổ 500 ký tự sẽ xanh dù disabled đã mất chốt chặn (đã dính).
function disabledOf(buttonId: string): string {
  const at = pos.indexOf(`id="${buttonId}"`);
  if (at < 0) return '';
  const win = pos.slice(at, at + 800);
  const m = win.match(/disabled=\{([\s\S]*?)\}(?=\s*\n?\s*(?:title|onClick|className|>))/);
  return m ? m[1] : '';
}
const desktopDisabled = disabledOf('btn-desktop-checkout');
const mobileDisabled = disabledOf('btn-confirm-mobile-checkout');
ok(desktopDisabled.includes('checkoutNeedsOpenShift && !hasMatchingOpenShift'),
   '18. Nút thanh toán desktop khoá khi chưa mở ca',
   `disabled={${desktopDisabled.slice(0, 120)}…}`);
ok(mobileDisabled.includes('checkoutNeedsOpenShift && !hasMatchingOpenShift'),
   '19. Nút thanh toán mobile khoá khi chưa mở ca',
   `disabled={${mobileDisabled.slice(0, 120)}…}`);
ok(/Mở ca két trước khi bán/.test(pos),
   '20. Thông báo nói rõ hành động cần làm (mở ca), không để nút chết im lặng');

// --- Server KHÔNG siết tiền mặt chốt ngay (đã rút B2a-2 vì phá 21 luồng) ---
const b2aZone = svc.slice(svc.indexOf('// B2a. Đơn quầy CHỜ'), svc.indexOf('// B2c.'));
ok(!/isInstantCounterCash/.test(svc),
   '21. Server KHÔNG chặn tiền mặt chốt ngay (siết ở đó phá vỡ hoa hồng/dự báo/trả hàng/offline/bundle)');

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Phiếu gọn (ảnh ẩn mặc định), thư viện ảnh ở UI chính, tiền mặt cần mở ca.');
