/**
 * scripts/test-isbn.ts — khoá luật kiểm tra số kiểm ISBN-13.
 *
 * VÌ SAO CẦN: ngày 03/10/2026 phát hiện 2 cuốn trong danh mục lưu ISBN sai
 * (`ed-h66` = 9786044449689 sai số kiểm, `ed-h41` = 9768049679377 đảo số 3–4).
 * Cả hai lọt lên production vì KHÔNG có gì hỏi "mã này có đúng không" lúc
 * nhập. Suite này bảo vệ hàm mà `scripts/seed.ts` (Task 3) và
 * `scripts/verify-prod-sku.ts` (Task 4) sẽ dùng làm cổng chặn.
 *
 * ⚠ BÀI HỌC ĐÃ MẮC (đừng lạm dụng checksum): `9786044449685` HỢP LỆ checksum
 * nhưng là ISBN của cuốn KHÁC. Lỗi nằm ở 12 số đầu, checksum chỉ bắt được sai
 * ở SỐ CUỐI. Suy checksum rồi ghi ngược là tự bịa dữ liệu — phải tra nguồn thật.
 *
 * Test thuần khiết, không đụng DB. Chạy: `npx tsx scripts/test-isbn.ts`
 */
import { isbn13CheckDigit, isValidIsbn13, normalizeIsbn } from '../src/lib/isbn';

let pass = 0;
let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}

console.log('=== TEST: KIỂM TRA SỐ KIỂM ISBN-13 ===\n');

console.log('--- 1. normalizeIsbn: bỏ ký tự thừa, giữ X ---');
eq('978-604-368-749-1 → 9786043687491', normalizeIsbn('978-604-368-749-1'), '9786043687491');
eq('chữ cái bị bỏ', normalizeIsbn('ISBN 9786043687491'), '9786043687491');
eq('x thường → X hoa', normalizeIsbn('978030640615x'), '978030640615X');
eq('khoảng trắng thừa bị bỏ', normalizeIsbn('  9786043687491 '), '9786043687491');

console.log('\n--- 2. isbn13CheckDigit: ví dụ chuẩn 9780306406157 ---');
eq('số kiểm = 7', isbn13CheckDigit('978030640615'), 7);
eq('ghép lại ra đúng mã chuẩn', '978030640615' + isbn13CheckDigit('978030640615'), '9780306406157');

console.log('\n--- 3. isValidIsbn13: MÃ THẬT TRONG DANH MỤC ---');
eq('9786044449869 (ed-h66 ĐÃ SỬA) hợp lệ', isValidIsbn13('9786044449869'), true);
eq('9786044449689 (ed-h66 BỊ SAI) không hợp lệ', isValidIsbn13('9786044449689'), false);
eq('9768049679377 (ed-h41 đảo số 3–4) không hợp lệ', isValidIsbn13('9768049679377'), false);
eq('9786044737690 (trùng 2 ấn bản) hợp lệ', isValidIsbn13('9786044737690'), true);

console.log('\n--- 4. isValidIsbn13: HÌNH DẠNG SAI ---');
eq('14 số → không hợp lệ', isValidIsbn13('97863203176313'), false);
eq('12 số → không hợp lệ', isValidIsbn13('978604473769'), false);
eq('rỗng → không hợp lệ', isValidIsbn13(''), false);
eq('có gạch nối nhưng đúng mã → hợp lệ', isValidIsbn13('978-604-473-769-0'), true);
eq('chữ cái lẫn số → không hợp lệ', isValidIsbn13('97860447A7690'), false);

console.log('\n--- 5. BẪY: X Ở CUỐI KHÔNG BAO GIỜ HỢP LỆ VỚI ISBN-13 ---');
// ISBN-13 dùng số 0-9 ở mọi vị trí. X chỉ là số kiểm của ISBN-10 và chỉ
// được dùng khi quy đổi. Nếu hàm chấp nhận X cuối thì dữ liệu rác lọt vào.
eq('978030640615X không hợp lệ', isValidIsbn13('978030640615X'), false);
let xAccepted = 0;
for (let d = 0; d < 10; d++) {
  if (isValidIsbn13('97803064061' + d + 'X')) xAccepted++;
}
eq('không mã nào đuôi X được chấp nhận', xAccepted, 0);
eq('isbn13CheckDigit KHÔNG bao giờ trả X', isbn13CheckDigit('978030640615') === 10, false);

console.log('\n--- 6. BẤT BIẾN: mọi tiền tố 12 số hợp lệ đều ra đúng 1 mã 13 số ---');
// Đây là bảo chứng hàm không tự mâu thuẫn: ghép số kiểm vào phải LUÔN hợp lệ.
const prefixes = [
  '978030640615',
  '978604444986',
  '978604444968',
  '976804967937',
  '978604473769',
  '978604368750',
  '978604368749',
  '978632031763',
  '979123456789',
  '978000000001',
  '978999999999',
];
let selfConsistent = 0;
for (const p of prefixes) {
  if (isValidIsbn13(p + isbn13CheckDigit(p))) selfConsistent++;
}
eq(`cả ${prefixes.length} tiền tố tự khớp`, selfConsistent, prefixes.length);

console.log('\n--- 7. BẤT BIẾN: số kiểm là DUY NHẤT, đổi số cuối là hỏng ---');
// Đổi số cuối ⇒ mất 1/10 xác suất hợp lệ. Nếu hàm cho hợp lệ >1 mã trên cùng
// 12 số đầu thì nó đang bỏ qua checksum.
let validCount = 0;
for (let d = 0; d < 10; d++) if (isValidIsbn13('978030640615' + d)) validCount++;
eq('đúng 1 trong 10 số cuối hợp lệ', validCount, 1);

console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error('\n❌ test-isbn thất bại — hàm kiểm tra ISBN có thể bỏ lọt mã hỏng.');
  process.exit(1);
}
console.log('\n✅ KIỂM TRA ISBN-13 ĐÚNG. Số kiểm chỉ bắt lỗi ở số cuối — vẫn phải tra nguồn thật cho 12 số đầu.');
process.exit(0);
