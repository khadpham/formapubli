/**
 * Nội dung chuyển khoản trên mã QR POS phải là MẪU TUỲ BIẾN của kho, không
 * phải mã đơn dài.
 *
 * LỖI ĐÃ XẢY RA: VietQrPay có hai effect cùng ghi state `content` —
 * một effect dựng từ template, một effect `setContent(initialContent)`.
 * Effect thứ hai khai báo sau nên chạy sau và XOÁ MẤT template mỗi khi mã đơn
 * đổi, khiến QR ra mã đơn dài. Test này chốt hành vi đúng ở hàm thuần
 * `resolveTransferContent` để lỗi không quay lại.
 *
 * Chạy: npx tsx scripts/test-pos-qr-content.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTransferContent } from '../src/lib/transfer-content';

const ROOT = join(__dirname, '..');
let pass = 0;
let fail = 0;
const ok = (cond: unknown, msg: string, why = '') => {
  if (cond) {
    pass++;
    console.log(`  ok  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}${why ? ` — ${why}` : ''}`);
  }
};

const LONG_CODE = 'ORD-20260928-A1B2C3D4E5F60718293A4B5C';
const base = {
  template: 'HT {MA} - {SL} cu - {KHO} ({KH})',
  orderCode: LONG_CODE,
  itemCount: 12,
  warehouseName: 'Kho Hội Chợ ABC',
  warehouseCode: 'KHC-ABC',
  manualContent: null,
};

console.log('\n[#1] Mẫu tuỳ biến là nguồn duy nhất khi có mẫu');
ok(
  resolveTransferContent(base) === `HT ${LONG_CODE} - 12 cu - Kho Hội Chợ ABC (KHC-ABC)`,
  'thay đủ {MA} {SL} {KHO} {KH}',
  `nhận: ${resolveTransferContent(base)}`
);
ok(
  !resolveTransferContent(base).startsWith(LONG_CODE),
  'KHÔNG trả về mã đơn dài nguyên xi',
  `nhận: ${resolveTransferContent(base)}`
);

console.log('\n[#2] Chưa cấu hình mẫu thì mới dùng mã đơn');
ok(
  resolveTransferContent({ ...base, template: null }) === LONG_CODE,
  'template null → mã đơn (hành vi cũ, giữ làm dự phòng)'
);
ok(
  resolveTransferContent({ ...base, template: '' }) === LONG_CODE,
  'template rỗng → mã đơn'
);

console.log('\n[#3] Đổi mã đơn KHÔNG được làm mất mẫu');
const doiMaDon = resolveTransferContent({ ...base, orderCode: 'ORD-20260928-ZZZ' });
ok(doiMaDon.includes('ORD-20260928-ZZZ'), 'mã đơn mới được nội suy vào {MA}', doiMaDon);
ok(!doiMaDon.includes(LONG_CODE), 'không còn sót mã đơn cũ', doiMaDon);
ok(doiMaDon.includes('12 cu'), 'phần còn lại của mẫu giữ nguyên', doiMaDon);

console.log('\n[#4] Biến chưa có giá trị không sinh ra "undefined"');
const thieu = resolveTransferContent({
  template: '{SL}|{KHO}|{KH}|{MA}',
  orderCode: '',
  itemCount: 0,
  warehouseName: '',
  warehouseCode: '',
  manualContent: null,
});
ok(thieu === '0|||', 'biến rỗng → chuỗi rỗng, số 0 vẫn hiện', `nhận: ${thieu}`);
ok(!thieu.includes('undefined') && !thieu.includes('null'), 'không lọt chữ undefined/null', thieu);

console.log('\n[#5] Người dùng gõ tay thì giữ bản của họ');
ok(
  resolveTransferContent({ ...base, manualContent: 'Tui thang 5tr' }) === 'Tui thang 5tr',
  'manualContent thắng template'
);
ok(
  resolveTransferContent({ ...base, manualContent: '' }) === '',
  'xoá sạch ô cũng giữ rỗng, không quay về mẫu'
);

console.log('\n[#6] Chốt hồi quy: VietQrPay không được tự ghi đè nội dung');
const viet = readFileSync(join(ROOT, 'src', 'components', 'pos', 'VietQrPay.tsx'), 'utf8');
// Bỏ comment để regex không tự khớp vào chính dòng giải thích.
const vietCode = viet.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
ok(!/useEffect\(\(\)\s*=>\s*\{\s*setContent\(initialContent\)/.test(vietCode),
  'đã xoá effect setContent(initialContent) gây mất mẫu');
ok(!/setContent\(initialContent\)/.test(vietCode),
  'không còn chỗ nào ghi thẳng mã đơn vào content');
ok((vietCode.match(/setContent\(/g) || []).length <= 2,
  'chỉ còn 2 chỗ ghi content: hàm thuần + sửa tay',
  `thấy ${(vietCode.match(/setContent\(/g) || []).length}`);
ok(viet.includes('setManualContent'), 'ô nhập ghi manualContent để không bị mẫu đè');

console.log('\n[#7] Chốt hồi quy: tồn kho không lộ cho thu ngân qua ?all=true');
const wh = readFileSync(join(ROOT, 'src', 'app', 'api', 'warehouses', 'route.ts'), 'utf8');
const stockRowsLine = wh.split('\n').find((l) => l.includes('const stockRows')) || '';
ok(/getAll\s*&&\s*isPrivileged/.test(stockRowsLine),
  'stockRows chặn theo role, không chỉ theo getAll', stockRowsLine.trim());
ok(/qrTransferTemplate:/.test(wh),
  'vẫn trả qrTransferTemplate cho mọi role (POS cần để dựng nội dung)');

console.log(`\n${fail === 0 ? '🎉' : '💥'} Nội dung QR POS: ${pass}/${pass + fail} PASS`);
assert.equal(fail, 0, `${fail} case FAIL`);
