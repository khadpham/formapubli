/**
 * GỠ KẸT + XÁC NHẬN ĐƠN — chống tái phát (30/09).
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-confirm-unblock
 *
 * SỰ CỐ: thu ngân bán 1 đơn chuyển khoản 12 dòng sách ở hội chợ. Bấm "Xác nhận
 * đã nhận tiền" ⇒ "Lỗi hệ thống, vui lòng thử lại." Đơn kẹt PENDING_CONFIRMATION.
 * Chốt ca thì bị chặn vì còn đơn chờ, mà KHÔNG CÓ CHỖ NÀO để xác nhận hay huỷ
 * ⇒ kẹt hoàn toàn, không lối ra.
 *
 * BA NGUYÊN NHÂN GỐC:
 *  G1 `confirmOrder` gọi `getBalance` TỪNG DÒNG + `recordMovement` từng dòng.
 *     Mỗi câu SQL là 1 subrequest từ Cloudflare Worker tới Turso. Đơn 12 dòng
 *     vượt trần 50 subrequest của Workers ⇒ Worker ném lỗi runtime THÔ ⇒
 *     `handleApiError` che thành "Lỗi hệ thống".
 *  G2 Chỗ đó lại `throw new Error('SQLITE_BUSY: ...')` ⇒ `withDbRetry` tưởng là
 *     lỗi tạm thời, xoay 30 lần trong 15 giây vô ích rồi mới ném ra.
 *  G3 `PendingOrdersView` đã viết đầy đủ (xem/xác nhận/huỷ) nhưng KHÔNG được
 *     gắn vào đâu cả ⇒ không có lối ra.
 *
 * HỢP ĐỒNG ĐƯỢC CHỐT:
 *  1. Tra tồn trong `confirmOrder` phải GỘP, không lặp theo dòng.
 *  2. Không còn `throw new Error` chứa chữ SQLITE_BUSY trên đường xác nhận/huỷ
 *     (vừa gây che lỗi, vừa gây treo 15 giây).
 *  3. POS phải có nút + modal mở `PendingOrdersView`.
 *  4. Modal thanh toán: BỎ mã QR, thân modal CUỘN ĐƯỢC.
 *  5. Script gỡ kẹt mặc định CHỈ XEM, không tự ý huỷ đơn.
 */
import { readFileSync, existsSync } from 'node:fs';

const orderSvc = readFileSync('src/services/order.service.ts', 'utf8').replace(/\r\n/g, '\n');
const pos = readFileSync('src/components/pos/PosCheckoutTerminal.tsx', 'utf8').replace(/\r\n/g, '\n');
const modal = readFileSync('src/components/pos/TransferPaymentModal.tsx', 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

function section(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0) return '';
  return src.slice(a, b > 0 ? b : src.length);
}

console.log('\n=== GỠ KẸT: XÁC NHẬN ĐƠN NHIỀU DÒNG + LỐI RA KHI CHỐT CA BỊ CHẶN ===');

const confirmFn = section(orderSvc, 'static async confirmOrder', 'static async cancelOrder');
const cancelFn = section(orderSvc, 'static async cancelOrder', 'cleanupExpiredPending');

ok(confirmFn.length > 500, '1. Tìm thấy hàm confirmOrder để kiểm tra');

// --- G1: không lặp getBalance theo dòng ---
ok(!/for \(const \[editionId, qty\][\s\S]{0,220}getBalance\(/.test(confirmFn),
   '2. confirmOrder KHÔNG gọi getBalance từng dòng (mỗi dòng là 1 subrequest)');
ok(/getBatchBalance\(/.test(confirmFn),
   '3. confirmOrder dùng getBatchBalance — tra tồn cả đơn trong 1 câu');

// --- G2: không còn lỗi thô gây che + treo ---
// Chỉ kiểm phần CODE, không kiểm comment: chính comment giải thích cũng nhắc
// tới "SQLITE_BUSY" nên quét cả file sẽ đỏ oan.
const codeOnly = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/throw new Error\(\s*'SQLITE_BUSY/.test(codeOnly(orderSvc)),
   '4. Không còn throw new Error chứa "SQLITE_BUSY" (gây che lỗi + xoay 15 giây vô ích)');
ok(/rowsAffected !== 1\) \{\s*\n\s*\/\/[\s\S]{0,400}AppError\.conflict/.test(confirmFn)
   || /rowsAffected !== 1\)[\s\S]{0,500}AppError\.conflict/.test(confirmFn),
   '5. Trường hợp trạng thái đổi trong confirmOrder ném AppError.conflict (thu ngân thấy thông báo thật)');
ok(/rowsAffected !== 1\)[\s\S]{0,500}AppError\.conflict/.test(cancelFn),
   '6. Tương tự trong cancelOrder (huỷ đơn cũng không được treo 15 giây)');

// --- G3: có lối ra ---
ok(/btn-open-pending-orders/.test(pos), '7. POS có nút "Đơn Chờ"');
ok(/<PendingOrdersView currentRole=\{currentRole\} \/>/.test(pos),
   '8. POS mở được PendingOrdersView (xem / xác nhận / huỷ đơn treo)');
ok(/pendingOrderCount/.test(pos) && /status=PENDING_CONFIRMATION/.test(pos),
   '9. Nút hiện số đơn đang chờ, thu ngân thấy ngay mà không cần mở màn hình');
ok(/setInterval\(load, 30_000\)/.test(pos), '10. Số đơn chờ được làm mới đều đặn');

// --- G4: modal gọn + kéo được ---
ok(!/qrSnapshot\.dataUrl \? \(/.test(modal) && !/alt="QR chuyển khoản"/.test(modal),
   '11. Modal thanh toán ĐÃ BỎ mã QR (khách đã quét ở bước trước)');
ok(/overflow-y-auto flex-1 min-h-0/.test(modal),
   '12. Thân modal CUỘN ĐƯỢC ⇒ ảnh dài vẫn kéo tới được nút Xác nhận');
ok(/max-h-\[92vh\]/.test(modal) && /flex flex-col/.test(modal),
   '13. Modal giới hạn chiều cao + xếp cột để vùng cuộn hoạt động đúng');
ok(modal.indexOf('Xác nhận đã nhận tiền') > 0, '14. Nút "Xác nhận đã nhận tiền" vẫn còn');
ok(!/qrSnapshot\.dataUrl/.test(modal),
   '15. Modal không còn phụ thuộc ảnh QR ở chỗ nào nữa');

// --- G5: script gỡ kẹt an toàn ---
ok(existsSync('scripts/unblock-stuck-pending-orders.ts'), '16. Có script gỡ kẹt để dùng khi đơn mắc');
const unblock = readFileSync('scripts/unblock-stuck-pending-orders.ts', 'utf8').replace(/\r\n/g, '\n');
ok(/process\.argv\.includes\('--apply'\)/.test(unblock),
   '17. Script mặc định CHỈ XEM, phải có --apply mới thực thi');
ok(/OrderService\.cancelOrder/.test(unblock),
   '18. Script dùng chính cancelOrder của hệ thống (đúng giải phóng ATP + ghi sổ + nhật ký)');
ok(/expired && noLedger/.test(unblock),
   '19. Script chỉ huỷ đơn ĐÃ QUÁ HẠN và CHƯA ghi sổ kho; đơn đã ghi sổ thì để người xử lý tay');

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Xác nhận đơn nhiều dòng không vỡ; luôn có lối ra khi chốt ca bị chặn.');
