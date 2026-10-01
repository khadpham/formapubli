/**
 * scripts/test-price-normalize.ts — khoá luật chuyển đổi giá kiểu Việt Nam.
 *
 * VÌ SAO CẦN: ô nhập giá là `type="text"`. Trước đó nó là `type="number"` với
 * locale `en-US`: người Việt gõ `8.900` (nghĩa là 8.900đ) thì bị đọc thành
 * `8.9` ⇒ **lưu 9đ**. Đây là hỏng tiền ÂM THẦM — không báo lỗi, không đỏ, chỉ
 * phát hiện khi đối chiếu cuối ngày. Chỉ test mới bắt được.
 *
 * Test thuần khiết, không đụng DB. Chạy: `npx tsx scripts/test-price-normalize.ts`
 */
import assert from 'node:assert';
import { normalizePrice, formatPriceInput } from '../src/components/products/GoodsCatalogManager';

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

console.log('=== TEST: CHUẨN HOÁ GIÁ KIỂU VIỆT NAM ===\n');

console.log('--- 1. Dấu chấm = phân cách nghìn (cách gõ phím Việt Nam) ---');
eq('8.900 → 8900', normalizePrice('8.900'), 8900);
eq('89.000 → 89000', normalizePrice('89.000'), 89000);
eq('1.500.000 → 1500000', normalizePrice('1.500.000'), 1500000);
eq('450.000 → 450000', normalizePrice('450.000'), 450000);
eq('59.000 → 59000', normalizePrice('59.000'), 59000);

console.log('\n--- 2. Dấu phẩy = phân cách nghìn ---');
eq('89,000 → 89000', normalizePrice('89,000'), 89000);
eq('1,500,000 → 1500000', normalizePrice('1,500,000'), 1500000);

console.log('\n--- 3. Số trần, không dấu phân cách ---');
eq('89000 → 89000', normalizePrice('89000'), 89000);
eq('0 → 0', normalizePrice('0'), 0);
eq('khoảng trắng quanh vẫn được', normalizePrice('  89000  '), 89000);

console.log('\n--- 4. THẬP PHÂN thật (dấu cuối cùng) ---');
eq('89.900,50 → 89900.5', normalizePrice('89.900,50'), 89900.5);
eq('8.900,5 → 8900.5', normalizePrice('8.900,5'), 8900.5);
eq('12.5 → 12.5 (dấu chấm cuối, 1 chữ số)', normalizePrice('12.5'), 12.5);
eq('99.99 → 99.99', normalizePrice('99.99'), 99.99);
eq('0.5 → 0.5', normalizePrice('0.5'), 0.5);

console.log('\n--- 5. GIÁ TRỊ XẤU ---');
eq('chuỗi rỗng → NaN', Number.isNaN(normalizePrice('')), true);
eq('chỉ khoảng trắng → NaN', Number.isNaN(normalizePrice('   ')), true);
eq('chữ cái → NaN', Number.isNaN(normalizePrice('abc')), true);
eq('undefined → NaN', Number.isNaN(normalizePrice(undefined as any)), true);
eq('null → NaN', Number.isNaN(normalizePrice(null as any)), true);

console.log('\n--- 6. Định dạng ngược (ô nhập khi rời chuột) ---');
eq('89000 → "89.000"', formatPriceInput(89000), '89.000');
eq('1500000 → "1.500.000"', formatPriceInput(1500000), '1.500.000');
eq('"89.000" → "89.000" (làm sạch', formatPriceInput('89.000'), '89.000');
eq('8900.6 → "8.901" (làm tròn', formatPriceInput(8900.6), '8.901');
eq('giá rác → ""', formatPriceInput('abc'), '');

console.log('\n--- 7. VÒNG LẶP: định dạng rồi parse lại phải giữ nguyên giá ---');
// Đây là bất biến quan trọng: người dùng mở modal lần 2 (giá đã định dạng
// "89.000"), sửa tên, lưu — giá phải KHÔNG đổi. Nếu vòng này hỏng thì cứ mở
// modal là giá nhảy.
for (const v of [89000, 8900, 1500000, 450000, 100000, 999999]) {
  const roundTrip = normalizePrice(formatPriceInput(v));
  eq(`vòng khép kín ${v} giữ nguyên`, roundTrip, v);
}

console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
if (fail > 0) {
  console.error('\n❌ test-price-normalize thất bại — giá có thể bị bóp méo.');
  process.exit(1);
}
console.log('\n✅ CHUẨN HOÁ GIÁ ĐÚNG. Không còn hỏng tiền âm thầm.');
process.exit(0);