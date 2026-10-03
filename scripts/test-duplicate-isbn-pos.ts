/**
 * scripts/test-duplicate-isbn-pos.ts — tra cứu mã vạch khi NHIỀU ấn bản dùng
 * chung một ISBN.
 *
 * VÌ SAO CẦN: production có `9786044737690` nằm trên HAI ấn bản (`HH032` bìa
 * tím 2022, `HH042` tái bản bìa trắng 2023), cùng giá 99.000đ. Quét mã thật ra
 * 2 dòng. Thu ngân cầm cuốn nào thì HỆ THỐNG KHÔNG THỂ BIẾT — mặc định tĩnh là
 * đoán, đoán sai ⇒ trừ tồn nhầm ấn bản, hóa đơn không lệch tiền (cùng giá!) nên
 * càng khó phát hiện. Vì vậy: chỉ tự chọn khi KHÔNG CÒN NGHI NGỜ (đúng 1 ứng
 * viên còn tồn), còn lại thì hỏi.
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
const allStock = () => 50;

console.log('=== TEST: QUÉT MÃ TRÙNG ISBN ===\n');

console.log('--- 1. 2 ấn bản CÙNG ISBN, CÙNG còn tồn ⇒ phải HỎI, không tự chọn ---');
{
  const r = resolveScan(SHARED_ISBN, [hh032, hh042], allStock);
  eq('kind = ambiguous', r.kind, 'ambiguous');
  if (r.kind === 'ambiguous') {
    eq('all chứa cả 2 ấn bản', r.all.length, 2);
    eq('buyable chứa cả 2 (không ai bị loại oan)', r.buyable.length, 2);
    ok(
      '2 ấn bản có TÊN KHÁC NHAU — không thì modal vô dụng',
      r.all[0].title !== r.all[1].title
    );
  }
}

console.log('\n--- 2. 1 ấn bản HẾT TỒN ⇒ tự chọn bản còn tồn (rủi ro = 0) ---');
{
  const stock: Record<string, number> = { 'ed-h21': 0, 'ed-h36': 12 };
  const r = resolveScan(SHARED_ISBN, [hh032, hh042], (b) => stock[b.id]);
  eq('kind = single', r.kind, 'single');
  if (r.kind === 'single') eq('chọn đúng bản còn tồn', r.book.id, 'ed-h36');
}
{
  const stock: Record<string, number> = { 'ed-h21': 7, 'ed-h36': 0 };
  const r = resolveScan(SHARED_ISBN, [hh032, hh042], (b) => stock[b.id]);
  eq('chiều ngược lại cũng vậy (bản còn tồn là HH032)', r.kind === 'single' ? r.book.id : '?', 'ed-h21');
}

console.log('\n--- 3. CẢ HAI HẾT TỒN ⇒ vẫn phải hỏi, tuyệt đối không đoán ---');
{
  const r = resolveScan(SHARED_ISBN, [hh032, hh042], () => 0);
  eq('kind = ambiguous', r.kind, 'ambiguous');
  if (r.kind === 'ambiguous') eq('buyable rỗng', r.buyable.length, 0);
}

console.log('\n--- 4. CÙNG ISBN NHƯNG KHÁC GIÁ ⇒ vẫn phải hỏi (bảo vệ sai lầm tiền thật) ---');
{
  // 99.000đ vs 150.000đ: chọn nhầm là CHÊNH 51.000đ/cuốn, hoá đơn lệch ngay.
  const r = resolveScan(SHARED_ISBN, [hh032, book({ ...hh042, coverPrice: 150000 })], allStock);
  eq('kind = ambiguous', r.kind, 'ambiguous');
}

console.log('\n--- 5. Khớp 4 số cuối CHỈ khi mã quét ĐÚNG 4 ký tự ---');
{
  const eq4 = resolveScan('7690', [hh032, hh042], allStock);
  eq('quét đúng 4 số → khớp cả 2 (hỏi)', eq4.kind, 'ambiguous');
  const long = resolveScan('9786044737690', [hh032, hh042], allStock);
  eq('quét đủ 13 số → cũng khớp cả 2 (khớp theo ISBN đầy đủ)', long.kind, 'ambiguous');
  // Mã dài KHÔNG được khớp bằng 4 số cuối: quét ISBN của cuốn ngoài danh mục,
  // tình cờ trùng 4 số cuối ⇒ trước đây thẻ nhầm ấn bản vào giỏ.
  const other = book({ id: 'ed-x', code: 'TP9999', isbn: '9786044449869', isbnLast4: '9869' });
  const stray = resolveScan('9786044737690', [other], allStock);
  eq('ISBN 13 số không trùng 4 số cuối ⇒ không khớp', stray.kind, 'none');
}

console.log('\n--- 6. Khớp mã SKU vẫn chạy ---');
{
  const r = resolveScan('HH042', [hh032, hh042], allStock);
  eq('quét SKU ⇒ single', r.kind, 'single');
  if (r.kind === 'single') eq('đúng ấn bản', r.book.code, 'HH042');
  eq('SKU không phân biệt hoa thường', resolveScan('hh042', [hh042], allStock).kind, 'single');
}

console.log('\n--- 7. Mã có gạch nối / mã lạ ---');
{
  const r = resolveScan('978-604-473-769-0', [hh032, hh042], allStock);
  eq('gạch nối được khử ⇒ khớp', r.kind, 'ambiguous');
  eq('mã không có trong danh mục ⇒ none', resolveScan('1111222233334', [hh032, hh042], allStock).kind, 'none');
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
  eq('mã rỗng + 3 hàng hóa ⇒ none', resolveScan('', goods, allStock).kind, 'none');
  eq('chỉ ký tự lạ ⇒ none', resolveScan('-', goods, allStock).kind, 'none');
  eq('chỉ ký tự lạ + sách cùng lúc ⇒ không vơ sang hàng hóa', resolveScan('---', [hh032, ...goods], allStock).kind, 'none');
  // Hàng hóa có SKU riêng thì vẫn quét được bằng SKU — không phải mất luôn.
  eq('SKU hàng hóa vẫn quét được', resolveScan('TP0042', goods, allStock).kind, 'single');
  // Sách thật vẫn quét được như cũ.
  eq('quét 1 cuốn KHÔNG trùng ISBN (đường phổ biến nhất) ⇒ single', resolveScan('9786043687507', [hh032, hh042], allStock).kind, 'none');
  eq('quét ISBN duy nhất của cuốn đó ⇒ single', resolveScan('9786043687507', [book({ id: 'ed-hh001', code: 'HH001', isbn: '9786043687507', isbnLast4: '7507' }), hh042], allStock).kind, 'single');
}

console.log('\n--- 8. D3: nhớ lựa chọn TRONG CA (sessionStorage), không nhớ vĩnh viễn ---');
{
  // Quét lần 1 → modal, bấm chọn HH042 ⇒ lần 2 cùng mã phải tự ra HH042.
  eq('chưa có lựa chọn ⇒ hỏi', resolveScan(SHARED_ISBN, [hh032, hh042], allStock, null).kind, 'ambiguous');
  const after = resolveScan(SHARED_ISBN, [hh032, hh042], allStock, 'ed-h36');
  eq('đã chọn HH042 trong ca ⇒ tự chọn', after.kind, 'single');
  if (after.kind === 'single') eq('đúng bản đã chọn', after.book.id, 'ed-h36');
}
{
  // Đã nhớ HH042 nhưng HH042 VỪA HẾT TỒN ⇒ không còn nghi ngờ nào (chỉ còn
  // HH032 là bán được) ⇒ tự chọn HH032. Không hỏi lại cũng không bán hết hàng.
  const stock: Record<string, number> = { 'ed-h21': 5, 'ed-h36': 0 };
  const r = resolveScan(SHARED_ISBN, [hh032, hh042], (b) => stock[b.id], 'ed-h36');
  eq('nhớ bản đã hết tồn ⇒ tự chọn bản còn tồn', r.kind === 'single' ? r.book.id : '?', 'ed-h21');
}
{
  // Nhớ id không tồn tại / không thuộc nhóm trùng ⇒ hỏi, không đoán.
  eq('id nhớ không có trong nhóm ⇒ hỏi', resolveScan(SHARED_ISBN, [hh032, hh042], allStock, 'ed-khong-co').kind, 'ambiguous');
  eq(
    'mã không khớp ấn bản nào thì không có gì để nhớ',
    resolveScan('9786043687507', [hh032], allStock, 'ed-h36').kind,
    'none'
  );
}
{
  // Tồn kho là sự thật còn mãi còn vĩnh; "đã chọn trong ca" chỉ là phỏng đoán.
  // Nên khi chỉ còn đúng 1 bản, tồn kho phải thắng — kể cả khi nhớ bản kia.
  const stock: Record<string, number> = { 'ed-h21': 0, 'ed-h36': 3 };
  const r = resolveScan(SHARED_ISBN, [hh032, hh042], (b) => stock[b.id], 'ed-h21');
  eq('tồn kho thắng lựa chọn nhớ', r.kind === 'single' ? r.book.id : '?', 'ed-h36');
}
{
  // Quét SKU không trùng gì thì không có gì để nhớ — nhớ phải vô hại.
  eq('SKU không bị lựa chọn nhớ chi phối', resolveScan('HH032', [hh032, hh042], allStock, 'ed-h36').kind, 'single');
}

console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error('\n❌ test-duplicate-isbn-pos thất bại — tra cứu mã vạch có thể chọn nhầm ấn bản.');
  process.exit(1);
}
console.log('\n✅ QUÉT MÃ TRÙNG ISBN ĐÚNG: chỉ tự chọn khi không còn nghi ngờ.');
process.exit(0);
