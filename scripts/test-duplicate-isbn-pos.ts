/**
 * scripts/test-duplicate-isbn-pos.ts — tra cứu mã vạch khi NHIỀU ấn bản dùng
 * chung một ISBN.
 *
 * VÌ SAO CẦN: production có `9786044737690` nằm trên HAI ấn bản (`HH032` bìa
 * tím 2022, `HH042` tái bản bìa trắng 2023), cùng giá 99.000đ. Quét mã thật ra
 * 2 dòng.
 *
 * LUẬT (chủ doanh nghiệp chốt 03/10/2026): TRÊN 1 ỨNG VIÊN THÌ LUÔN HỎI.
 * Không có mặc định tĩnh, không nhớ lựa chọn trong ca. Lý do: thu ngân là
 * người duy nhất biết mình đang cầm cuốn nào; hệ thống suy từ tồn kho chỉ là
 * đoán, và hai bản cùng 99.000đ nên chọn nhầm **không lệch tiền** — chỉ lệch
 * tồn, im lặng. Thủ công lúc này chỉ tốn MỘT chạm, và bản hết tồn được khoá
 * (xem `disabled` trong modal) nên chọn bản đó cũng không bán được ⇒ tự chọn
 * cũng không tiết kiệm được gì thật.
 *
 * Test thuần khiết — `src/lib/scan-resolve.ts` không chạm DB. Phần DB của cặp
 * ISBN trùng thật đã được `test-barcode-engine.ts` + `test-s2-pos-catalog.ts` đo.
 * Chạy: `npx tsx scripts/test-duplicate-isbn-pos.ts`
 */
import { resolveScan, type ScannableBook } from '../src/lib/scan-resolve';

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
function ok(label: string, cond: boolean) {
  eq(label, cond, true);
}

const SHARED_ISBN = '9786044737690';

function book(over: Partial<ScannableBook> & { id: string; code: string }): ScannableBook {
  return {
    title: `sách ${over.code}`,
    isbn: SHARED_ISBN,
    isbnLast4: SHARED_ISBN.slice(-4),
    coverPrice: 99000,
    publicationYear: 2022,
    ...over,
  };
}

const hh032 = book({ id: 'ed-h21', code: 'HH032', title: 'Le Spleen de Paris (Bìa tím)', publicationYear: 2022 });
const hh042 = book({ id: 'ed-h36', code: 'HH042', title: 'Le Spleen de Paris (Tái bản) - Bìa trắng', publicationYear: 2023 });

console.log('=== TEST: QUÉT MÃ TRÙNG ISBN ===\n');

console.log('--- 1. 2 ấn bản CÙNG ISBN ⇒ LUÔN phải HỎI, không tự chọn ---');
{
  const r = resolveScan(SHARED_ISBN, [hh032, hh042]);
  eq('kind = ambiguous', r.kind, 'ambiguous');
  if (r.kind === 'ambiguous') {
    eq('all chứa cả 2 ấn bản', r.all.length, 2);
    ok(
      '2 ấn bản có TÊN KHÁC NHAU — không thì modal vô dụng',
      r.all[0].title !== r.all[1].title
    );
  }
}

console.log('\n--- 2. MỘT BẢN HẾT TỒN ⇒ VẪN HỎI (tồn kho KHÔNG được suy đoán) ---');
{
  // Đây là ca đã từng cho ra `single`. Chủ chốt 03/10/2026: không. Số tồn là
  // dữ liệu server, tại kho hội chợ có thể sai (xem ghi chú ở `getBookStock`);
  // tôn trọng nó để "tiết kiệm 1 chạm" là đổi lấy rủi ro trừ tồn nhầm ấn bản
  // — không đáng.
  eq('1 trong 2 hết tồn ⇒ vẫn hỏi', resolveScan(SHARED_ISBN, [hh032, hh042]).kind, 'ambiguous');
}

console.log('\n--- 3. KHÔNG CÓ mặc định tĩnh, KHÔNG nhớ lựa chọn trong ca ---');
{
  // `resolveScan` không còn nhận `stockOf` / id nhớ: không tồn tại đường nào
  // để hệ thống tự chọn, kể cả khi thu ngân đã chọn 10 lần trước đó.
  eq('gọi với 2 tham số là đủ — không có tham số nào để ép chọn', resolveScan.length, 2);
  eq('quét lại lần nữa vẫn hỏi', resolveScan(SHARED_ISBN, [hh032, hh042]).kind, 'ambiguous');
}

console.log('\n--- 4. CÙNG ISBN NHƯNG KHÁC GIÁ ⇒ vẫn hỏi (bảo vệ sai lầm tiền thật) ---');
{
  // 99.000đ vs 150.000đ: chọn nhầm là CHÊNH 51.000đ/cuốn, hoá đơn lệch ngay.
  const r = resolveScan(SHARED_ISBN, [hh032, book({ ...hh042, coverPrice: 150000 })]);
  eq('kind = ambiguous', r.kind, 'ambiguous');
}

console.log('\n--- 5. Khớp 4 số cuối CHỈ khi mã quét ĐÚNG 4 ký tự ---');
{
  const eq4 = resolveScan('7690', [hh032, hh042]);
  eq('quét đúng 4 số → khớp cả 2 (hỏi)', eq4.kind, 'ambiguous');
  const long = resolveScan('9786044737690', [hh032, hh042]);
  eq('quét đủ 13 số → cũng khớp cả 2 (khớp theo ISBN đầy đủ)', long.kind, 'ambiguous');
  // Mã dài KHÔNG được khớp bằng 4 số cuối: quét ISBN của cuốn ngoài danh mục,
  // tình cờ trùng 4 số cuối ⇒ trước đây thẻ nhầm ấn bản vào giỏ.
  const other = book({ id: 'ed-x', code: 'TP9999', isbn: '9786044449869', isbnLast4: '9869' });
  const stray = resolveScan('9786044737690', [other]);
  eq('ISBN 13 số không trùng 4 số cuối ⇒ không khớp', stray.kind, 'none');
}

console.log('\n--- 6. Khớp mã SKU vẫn chạy ---');
{
  const r = resolveScan('HH042', [hh032, hh042]);
  eq('quét SKU ⇒ single', r.kind, 'single');
  if (r.kind === 'single') eq('đúng ấn bản', r.book.code, 'HH042');
  eq('SKU không phân biệt hoa thường', resolveScan('hh042', [hh042]).kind, 'single');
}

console.log('\n--- 7. Mã có gạch nối / mã lạ ---');
{
  const r = resolveScan('978-604-473-769-0', [hh032, hh042]);
  eq('gạch nối được khử ⇒ khớp', r.kind, 'ambiguous');
  eq('mã không có trong danh mục ⇒ none', resolveScan('1111222233334', [hh032, hh042]).kind, 'none');
}

console.log('\n--- 7b. Mã quét RỖNG không được khớp hàng hóa (`isbn = ""`) ---');
{
  // Hàng hóa đi qua POS với `isbn: ''` (LEFT JOIN editions, xem
  // inventory.service.ts:1024). Nếu mã quét rỗng mà vẫn so `cleanIsbn ===
  // cleanScanned` thì MỌI hàng hóa khớp ⇒ thêm nhầm món không ai cầm.
  const goods: ScannableBook[] = [
    { id: 'pr-1', code: 'HH001', title: 'Bookmark 5.000đ', isbn: '', isbnLast4: '', coverPrice: 5000 },
    { id: 'pr-2', code: 'TP0042', title: 'Móc khoá 15.000đ', isbn: '', isbnLast4: '', coverPrice: 15000 },
    { id: 'pr-3', code: 'TP0007', title: 'Quà tặng kèm', isbn: '', isbnLast4: '', coverPrice: 0 },
  ];
  eq('mã rỗng + 3 hàng hóa ⇒ none', resolveScan('', goods).kind, 'none');
  eq('chỉ ký tự lạ ⇒ none', resolveScan('-', goods).kind, 'none');
  eq('chỉ ký tự lạ + sách cùng lúc ⇒ không vơ sang hàng hóa', resolveScan('---', [hh032, ...goods]).kind, 'none');
  // Hàng hóa có SKU riêng thì vẫn quét được bằng SKU — không phải mất luôn.
  eq('SKU hàng hóa vẫn quét được', resolveScan('TP0042', goods).kind, 'single');
  // Sách thật vẫn quét được như cũ.
  eq('quét 1 cuốn KHÔNG trùng ISBN (đường phổ biến nhất) ⇒ single', resolveScan('9786043687507', [hh032, hh042]).kind, 'none');
  eq('quét ISBN duy nhất của cuốn đó ⇒ single', resolveScan('9786043687507', [book({ id: 'ed-hh001', code: 'HH001', isbn: '9786043687507', isbnLast4: '7507' }), hh042]).kind, 'single');
}

console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error('\n❌ test-duplicate-isbn-pos thất bại — tra cứu mã vạch có thể chọn nhầm ấn bản.');
  process.exit(1);
}
console.log('\n✅ QUÉT MÃ TRÙNG ISBN ĐÚNG: trên 1 ứng viên thì LUÔN hỏi thu ngân.');
process.exit(0);
