/**
 * CHỐT TÁI PHÁT — nút "Khóa Két & Kết Ca" bị kẹt "Đang chốt..." mãi (30/09).
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-cashbox-close-shift
 *
 * TRIỆU CHỨNG: thu ngân bấm "Chốt ca" ⇒ bấm không ăn, màn hình đứng im, nút
 * hiện "Đang chốt..." mãi không đổi. Không có dấu hiệu lỗi nào.
 *
 * HAI NGUYÊN NHÂN, CÙNG LỚP LỖI "cờ submitting không bao giờ được tắt":
 *  G1. Lệnh ĐỌC ca (`fetchActiveCashboxSession`) dùng CHUNG token với lệnh GHI
 *      (`cashboxRequestRef`). Một lần tải ca chạy nền ⇒ vượt token lệnh ghi ⇒
 *      lệnh ghi thoát sớm ở nhánh "đã bị vượt", mà `finally` chỉ dọn cờ khi
 *      token vẫn khớp ⇒ cờ mắc vĩnh viễn.
 *  G2. `fetch('/api/cashbox')` không có mốc chờ. Ở hội chợ mạng chập chờn, request
 *      treo ⇒ `await` không bao giờ trả về ⇒ `finally` không chạy ⇒ cờ mắc.
 *  G3. Lỗi được `setErrorMessage` nhưng băng thông báo nằm NGOÀI modal, sau lớp
 *      phủ z-[70] ⇒ thu ngân không thấy lỗi, chỉ thấy màn hình đứng.
 *
 * HỢP ĐỒNG ĐƯỢC CHỐT: cờ `isSubmittingSession` do LỆNH GHI bật lên thì lệnh ghi đó
 * PHẢI tự tắt, bất kể token có còn khớp hay không, và mọi lỗi phải hiện được
 * ngay trong modal đang mở.
 */
import { readFileSync } from 'node:fs';

const POS = 'src/components/pos/PosCheckoutTerminal.tsx';
// Chuẩn hoá CRLF: file này lưu CRLF, mà các mốc tìm kiếm có ký tự xuống dòng.
const pos = readFileSync(POS, 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

// Cắt riêng từng hàm để kiểm đúng chỗ, không kiểm cả file (grep rộng từng bị lọt).
function bodyOf(sig: string, nextSig: string): string {
  const a = pos.indexOf(sig);
  const b = pos.indexOf(nextSig, a + 1);
  assertRange(a, b, sig);
  return pos.slice(a, b);
}
function assertRange(a: number, b: number, sig: string) {
  if (a < 0 || b < 0) {
    console.log(`  ❌ Không tìm thấy ${sig}`);
    failures++;
    checks++;
  }
}

console.log('\n=== KÉT TIỀN: NÚT "KHÓA KÉT & KẾT CA" KHÔNG ĐƯỢC KẸT ===');

const readFn = bodyOf('const fetchActiveCashboxSession = async', 'useEffect(() => {\n    fetchActiveCashboxSession');
const openFn = bodyOf('const handleOpenShift = async', '// Chốt ca và kiểm kê két tiền');
const closeFn = bodyOf('const handleCloseShift = async', '// V4.1 S2.4');

// --- G1: token đọc phải tách khỏi token ghi ---
ok(!/cashboxRequestRef/.test(readFn),
   '1. Lệnh ĐỌC ca không dùng token của lệnh GHI (token chung ⇒ lệnh đọc nền vượt lệnh ghi, làm cờ "đang chốt" mắc)');
ok(/cashboxReadRef/.test(readFn), '2. Lệnh đọc dùng token riêng');
ok(/const cashboxReadRef = useRef\(0\)/.test(pos), '3. Token riêng được khai báo');

// --- G2: mọi lệnh ghi phải có mốc chờ ---
for (const [name, fn] of [['mở ca', openFn], ['chốt ca', closeFn]] as const) {
  ok(/signal: controller\.signal/.test(fn), `4. Lệnh ghi "${name}" truyền signal cho fetch`);
  ok(/new AbortController\(\)/.test(fn), `5. Lệnh ghi "${name}" có AbortController`);
  ok(/setTimeout\(\(\) => controller\.abort\(\), CASHBOX_WRITE_TIMEOUT_MS\)/.test(fn),
     `6. Lệnh ghi "${name}" có mốc chờ để không treo vô hạn`);
  ok(/clearTimeout\(timeoutId\)/.test(fn), `7. Lệnh ghi "${name}" dọn timer`);
}

// --- finally PHẢI luôn tắt cờ (đây là chỗ gốc của triệu chứng) ---
for (const [name, fn] of [['mở ca', openFn], ['chốt ca', closeFn]] as const) {
  const finallyBlock = fn.slice(fn.indexOf('} finally {'));
  ok(finallyBlock.length > 0, `8. Lệnh ghi "${name}" có khối finally`);
  ok(
    /setIsSubmittingSession\(false\)/.test(finallyBlock)
      && !/if\s*\([^)]*RequestId[^)]*\)\s*setIsSubmittingSession/.test(finallyBlock),
    `9. Lệnh ghi "${name}" LUÔN tắt cờ submitting, không điều kiện theo token`,
    'Cờ do lệnh ghi bật thì lệnh ghi phải tự tắt — nếu điều kiện theo token thì lệnh bị vượt sẽ để cờ mắc và nút kẹt "Đang chốt..." vĩnh viễn.'
  );
}
ok(/const CASHBOX_WRITE_TIMEOUT_MS = \d/.test(pos), '10. Có hằng số mốc chờ');

// --- G3: lỗi phải hiện được trong modal ---
const closeModal = pos.slice(pos.indexOf('{isCloseShiftModalOpen && activeSession'));
ok(/errorMessage &&/.test(closeModal),
   '11. Modal chốt ca hiện thông báo lỗi NGAY TRONG modal (băng lỗi ngoài modal bị lớp phủ z-[70] che, thu ngân chỉ thấy màn hình đứng)');
ok(/role="alert"/.test(closeModal), '12. Thông báo lỗi trong modal có role="alert"');
ok(/err\?\.name === 'AbortError'/.test(closeFn),
   '13. Có thông báo riêng khi hết mốc chờ, nói rõ ca vẫn đang mở');

// --- Giữ nguyên phần kiểm soát tiền mặt (KHÔNG được nới lỏng) ---
ok(!/setActiveSession\(null\);\s*\n\s*setErrorMessage/.test(closeFn) || /fetchActiveCashboxSession/.test(closeFn),
   '14. Chốt ca thất bại vẫn hỏi lại server thay vì tự xoá state két');
ok(/closingCashActual: closingVal/.test(closeFn),
   '15. Vẫn gửi đúng số tiền thực đếm (không tự điền sẵn)');
ok(/'Khóa Két & Kết Ca'/.test(pos) && /'Đang chốt\.\.\.'/.test(pos),
   '16. Nhãn nút giữ nguyên');

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Chốt ca: luôn thoát được khỏi trạng thái "Đang chốt...", lỗi hiện ngay trong modal.');
