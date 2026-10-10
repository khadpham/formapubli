// Kiem chung numberToVietnameseWords (phieu xuat kho) — import ham THAT tu component.
// Gia tri ky vong: tu hieu biet tieng Viet doc lap, KHONG copy tu code.
// Chay: npx tsx scripts/test-slip-words-check.ts
import { numberToVietnameseWords } from '../src/components/inventory/DeliveryReceiptPrint';

const cases: Array<[number, string]> = [
  [1297100, 'Một triệu hai trăm chín mươi bảy nghìn một trăm đồng chẵn.'],
  [50400, 'Năm mươi nghìn bốn trăm đồng chẵn.'],
  [1000000, 'Một triệu đồng chẵn.'],
  [105, 'Một trăm lẻ năm đồng chẵn.'],
  [115, 'Một trăm mười lăm đồng chẵn.'],
  [121, 'Một trăm hai mươi mốt đồng chẵn.'],
  [1000005, 'Một triệu năm đồng chẵn.'],
  [0, 'Không đồng.'],
];

let fail = 0;
for (const [input, expected] of cases) {
  // Component render "{numberToVietnameseWords(x)}." — dau cham nam ngoai ham.
  const got = numberToVietnameseWords(input) + '.';
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${input} → ${got}${ok ? '' : ` (muốn: ${expected})`}`);
}
if (fail > 0) {
  console.error(`THAT BAI: ${fail} case`);
  process.exit(1);
}
console.log('TAT CA DAT');
