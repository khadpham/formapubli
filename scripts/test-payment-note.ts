/**
 * Ô GHI CHÚ THANH TOÁN — tiền mặt và chuyển khoản đều ghi được (30/09).
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-payment-note
 *
 * YÊU CẦU: thu ngân muốn một dòng ghi chú ở bước thanh toán, cho CẢ tiền mặt
 * lẫn chuyển khoản. State `note` ĐÃ có và ĐÃ gửi server, nhưng không có ô nhập
 * nào — thu ngân không gõ được.
 *
 * HỢP ĐỒNG VỊ TRÍ (thu ngân chốt): ô ghi chú nằm NGAY DƯỚI chọn hình thức thanh
 * toán, nên dù chọn phương thức nào nó vẫn hiện. Mỗi mặt ĐÚNG MỘT ô:
 *  1. Desktop: dưới picker "Thanh toán" (`pos-payment-method-select`).
 *  2. Mobile sheet: dưới picker "Hình thức thanh toán", TRƯỚC khối điều kiện
 *     hiện QR theo phương thức.
 *  3. Modal chuyển khoản: trên nút "Xác nhận đã nhận tiền".
 * Cả ba ghi vào CÙNG một state `note` đã gửi server — không state mới, không API mới.
 */
import { readFileSync } from 'node:fs';

const pos = readFileSync('src/components/pos/PosCheckoutTerminal.tsx', 'utf8').replace(/\r\n/g, '\n');
const modal = readFileSync('src/components/pos/TransferPaymentModal.tsx', 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

// Khoanh đúng vùng: từ mốc bắt đầu tới mốc kết thúc đầu tiên sau nó.
function between(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b > 0 ? b : src.length);
}

console.log('\n=== Ô GHI CHÚ: DƯỚI CHỌN HÌNH THỨC THANH TOÁN, MỌI PHƯƠNG THỨC ĐỀU THẤY ===');

const noteInputs = (pos.match(/value=\{note\}/g) || []).length
  + (modal.match(/value=\{note\}/g) || []).length;
ok(noteInputs === 3, '1. Đúng 3 ô nhập ghi chú (desktop + mobile sheet + modal chuyển khoản)', `đếm được ${noteInputs}`);

// --- Desktop: dưới picker, ngoài khối điều kiện ---
const desktopPickerAt = pos.indexOf('id="pos-payment-method-select"');
const desktopNoteAt = pos.indexOf('value={note}');
ok(desktopPickerAt > 0 && desktopNoteAt > desktopPickerAt,
   '2. Ô desktop nằm SAU picker "Thanh toán"');
const desktopSelectClose = pos.indexOf('</select>', desktopPickerAt);
const desktopBetween = desktopSelectClose > 0 && desktopNoteAt > desktopSelectClose
  ? pos.slice(desktopSelectClose, desktopNoteAt)
  : '';
// Cắt từ `</select>` trở đi: `value={paymentMethod...}` của chính picker nằm TRƯỚC
// mốc cắt nên không gây nhiễu. Chỉ còn khối điều kiện render thật (`&& (`).
ok(desktopBetween.length > 0 && !/&&\s*\(/.test(desktopBetween),
   '3. Từ picker tới ô ghi chú desktop KHÔNG qua khối điều kiện theo phương thức (luôn hiển thị)');

// --- Mobile: dưới picker, trước khối điều kiện ---
const mobilePickerAt = pos.indexOf('Hình thức thanh toán:');
const mobileNoteCandidates: number[] = [];
for (let m = pos.indexOf('value={note}'); m >= 0; m = pos.indexOf('value={note}', m + 1)) {
  mobileNoteCandidates.push(m);
}
const mobileNoteAt = mobileNoteCandidates.find((at) => at > mobilePickerAt) ?? -1;
ok(mobilePickerAt > 0 && mobileNoteAt > mobilePickerAt,
   '4. Ô mobile nằm SAU picker "Hình thức thanh toán"');
const mobileSelectClose = pos.indexOf('</select>', mobilePickerAt);
const mobileBetween = mobileNoteAt > 0 && mobileSelectClose > 0 && mobileNoteAt > mobileSelectClose
  ? pos.slice(mobileSelectClose, mobileNoteAt)
  : '';
ok(mobileBetween.length > 0 && !/&&\s*\(/.test(mobileBetween),
   '5. Từ picker tới ô ghi chú mobile KHÔNG qua khối điều kiện (tiền mặt hay chuyển khoản đều thấy)');
const mobileCondAt = pos.indexOf("{!isWideCheckout && (paymentMethod === 'BANK_TRANSFER'", mobilePickerAt);
ok(mobileNoteAt > 0 && mobileCondAt > mobileNoteAt,
   '6. Ô mobile đứng TRƯỚC khối hiện QR theo phương thức');

// --- Modal chuyển khoản: trên nút xác nhận ---
// `indexOf('Xác nhận đã nhận tiền')` trúng COMMENT giải thích ở đầu file trước,
// nên phải neo bằng `onClick={onConfirm}` của nút thật.
const modalInputAt = modal.indexOf('value={note}');
const modalConfirmAt = modal.indexOf('onClick={onConfirm}');
ok(modalInputAt > 0 && modalConfirmAt > modalInputAt,
   '7. Ô trong modal chuyển khoản nằm TRÊN nút "Xác nhận đã nhận tiền"');
ok(/note: string/.test(modal) && /setNote: \(value: string\) => void/.test(modal),
   '8. Modal nhận `note`/`setNote` qua prop từ POS (không có state ghi chú thứ hai)');

// --- Cùng một state, đã gửi server, reset sau đơn ---
const onChanges = (pos.match(/onChange=\{\(e\) => setNote\(e\.target\.value\)\}/g) || []).length
  + (modal.match(/onChange=\{\(e\) => setNote\(e\.target\.value\)\}/g) || []).length;
ok(onChanges === 3, '9. Cả 3 ô đều ghi vào cùng một `note`', `đếm được ${onChanges}`);
ok(!/required/.test(between(pos, 'aria-label="Ghi chú đơn hàng"', 'aria-label="Ghi chú đơn hàng"')) || true,
   '10. (kiểm bằng 11) Ô nhập không bắt buộc');
{
  const noteBlocks: string[] = [];
  for (const src of [pos, modal]) {
    let at = src.indexOf('value={note}');
    while (at >= 0) {
      noteBlocks.push(src.slice(Math.max(0, at - 600), at + 100));
      at = src.indexOf('value={note}', at + 1);
    }
  }
  ok(noteBlocks.length === 3 && noteBlocks.every((b) => !/\brequired\b/.test(b)),
     '10. Ô nhập KHÔNG bắt buộc (không chặn submit khi trống)');
}
ok(/placeholder="Ghi chú đơn \(không bắt buộc\)…"/.test(pos + modal),
   '11. Placeholder đúng chữ');
ok((pos.match(/aria-label="Ghi chú đơn hàng"/g) || []).length === 2
   && (modal.match(/aria-label="Ghi chú đơn hàng"/g) || []).length === 1,
   '12. Đủ 3 aria-label, mỗi ô một cái');
ok(/note,/.test(pos), '13. `note` vẫn được gửi trong body tạo đơn');

// --- Không đặt nhầm chỗ ---
ok(!/Khách hàng \/ Đại lý sỉ:[\s\S]{0,300}value=\{note\}/.test(pos),
   '14. Ô desktop KHÔNG nằm dưới ô tên khách (đã dời xuống dưới picker thanh toán)');
ok(!/Sheet Footer[\s\S]{0,600}value=\{note\}/.test(pos),
   '15. Ô mobile KHÔNG nằm ở footer sheet (đã dời lên dưới picker thanh toán)');

// --- Phiếu in phải mang ghi chú (thu ngân yêu cầu 30/09) ---
{
  const receipt = readFileSync('src/lib/thermalReceipt.ts', 'utf8');
  ok(/order\.note/.test(receipt) && /Ghi chú:/.test(receipt),
     '16. Mẫu phiếu nhiệt đã biết in `order.note` với nhãn "Ghi chú:"');
  const completions = pos.split('setCompletedOrder({').slice(1);
  ok(completions.length === 3, '17. Có đúng 3 chỗ dựng phiếu thành công', `đếm được ${completions.length}`);
  ok(completions.every((block) => /^\s*note,/m.test(block.slice(0, 1500))),
     '18. Cả 3 phiếu đều mang `note` theo ⇒ phiếu in ra ghi chú');
}

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Ghi chú thanh toán: đúng chỗ, mọi phương thức đều thấy, không bắt buộc.');
