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
import {
  resolveTransferContent,
  hasTransferTemplate,
  compactOrderCode,
  DEFAULT_TRANSFER_TEMPLATE,
  VIETQR_CONTENT_MAX,
} from '../src/lib/transfer-content';
import { normalizeVietqrContent } from '../src/lib/vietqr';

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

console.log('\n[#1] {MA} và {SL} sống sót — tên kho là phần được bóp');
const MA = compactOrderCode(LONG_CODE);
const btKho = resolveTransferContent(base);
ok(
  btKho.startsWith(`HT ${MA}`) && btKho.includes('12 cu'),
  'mẫu dài: {MA} rút gọn và {SL} vẫn còn, tên kho nhường chỗ',
  `nhận: ${btKho}`
);
ok(
  !btKho.includes(LONG_CODE),
  '{MA} trong QR LUÔN là mã rút gọn, không bao giờ là mã đơn đầy đủ 29 ký tự',
  `nhận: ${btKho}`
);

console.log('\n[#2] Chưa cấu hình mẫu thì dùng MẪU MẶC ĐỊNH (có số lượng + mã đơn rút gọn)');
const macDinh = (itemCount: number) =>
  normalizeVietqrContent(resolveTransferContent({ ...base, template: null, itemCount }));
ok(
  resolveTransferContent({ ...base, template: null }).includes(String(base.itemCount)),
  'template null → mẫu mặc định, CÓ số lượng',
  `nhận: ${resolveTransferContent({ ...base, template: null })}`
);
ok(
  resolveTransferContent({ ...base, template: '' }) === resolveTransferContent({ ...base, template: null }),
  'template rỗng → y hệt template null'
);
ok(macDinh(12).length <= 23 && macDinh(12).includes('12'),
  'mặc định sau normalize ≤ 23 ký tự VÀ còn số lượng', `gửi bank: ${macDinh(12)} (${macDinh(12).length})`);

console.log('\n[#3] Đổi mã đơn KHÔNG được làm mất mẫu');
const doiMaDon = resolveTransferContent({ ...base, orderCode: 'ORD-20260928-ZZZ' });
ok(
  doiMaDon.includes(compactOrderCode('ORD-20260928-ZZZ')) && !doiMaDon.includes('ORD-20260928-ZZZ'),
  'đổi mã đơn thì {MA} đổi theo, và không rò mã đơn dài lên QR',
  doiMaDon
);
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
// Bảo đảm còn giữ từ assertion cũ: biến RỖNG không được sinh ra rác, và số 0
// (giỏ rỗng / chưa chốt) vẫn phải hiện. Ký tự phân cách bị normalize bỏ hết,
// nên "0" dính liền mã rút gọn — đó là hình dạng ĐÚNG, không phải rác.
ok(
  thieu === `0${compactOrderCode('')}`,
  'biến rỗng → không sinh rác, số 0 vẫn hiện, {MA} rỗng ra mã rút gọn ổn định',
  `nhận: ${thieu}`
);
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

console.log('\n[#8] Chốt hành vi "chưa có mẫu" + ngưỡng 23 ký tự của VietQR');
// QUYẾT ĐỊNH MỚI: kho trắng mẫu KHÔNG còn là "QR chỉ mang mã đơn" — dùng mẫu
// mặc định có số lượng, mã đơn rút gọn. Assertion cũ từng chốt `=== LONG_CODE`
// bị thay bằng hợp đồng mới ngay dưới đây.
ok(
  normalizeVietqrContent(resolveTransferContent({ ...base, template: '   ' })) === macDinh(base.itemCount),
  'mẫu chỉ gồm khoảng trắng cũng rơi về mẫu mặc định (không lọt mã đơn trần)'
);
ok(!hasTransferTemplate(null) && !hasTransferTemplate('') && !hasTransferTemplate('  '),
  'hasTransferTemplate: null/rỗng/toàn khoảng trắng đều là chưa cấu hình');
ok(hasTransferTemplate('DH {MA}') && hasTransferTemplate(' DH {MA} '),
  'hasTransferTemplate: có nội dung là đã cấu hình (kể cả có khoảng trắng quanh)');

// (a) mẫu tường minh vẫn nội sup đúng số lượng, với {MA} ĐÃ RÚT GỌN
ok(
  resolveTransferContent({ ...base, template: 'DH {MA} - {SL} cuon', itemCount: 3 }) === `DH ${MA}  3 cuon`,
  'mẫu tường minh: {SL} = số lượng thật, {MA} = mã rút gọn (mã đơn dài lên QR là lỗi)',
  `nhận: ${resolveTransferContent({ ...base, template: 'DH {MA} - {SL} cuon', itemCount: 3 })}`
);
// (b) mẫu tường minh LUÔN thắng, kể cả khi có "mẫu mặc định" tương lai
ok(
  resolveTransferContent({ ...base, template: 'ONLY {MA}' }) === `ONLY ${MA}`,
  'mẫu tường minh luôn thắng — không đường nào ghi đè mẫu của kho',
  `nhận: ${resolveTransferContent({ ...base, template: 'ONLY {MA}' })}`
);
// (c) SỐ LƯỢNG KHÔNG BAO GIỜ BỊ CẮT khỏi QR. Trước đây assertion ở đây chốt
// NGƯỢC LẠI ("số lượng bị cắt là bình thường") — đó chính là hợp đồng đã gây ra
// lỗi người dùng báo. Nay: tên kho dài là phần phải nhường, {SL} thì không.
const SL_SURVIVE = [
  {
    label: 'mẫu kho "{KHO} {SL}" + tên kho 26 ký tự',
    input: { template: '{KHO} {SL}', warehouseName: 'Kho Dai Nam Thang 10 2026' },
    expected: 'Kho Dai Nam Thang 10 12',
  },
  {
    label: 'mẫu "DH {MA} - {SL} cuốn"',
    input: { template: 'DH {MA} - {SL} cuốn' },
    expected: `DH ${MA}  12 cuon`,
  },
];
for (const c of SL_SURVIVE) {
  const nd = normalizeVietqrContent(resolveTransferContent({ ...base, ...c.input, itemCount: 12 }));
  ok(
    nd === c.expected && nd.length <= VIETQR_CONTENT_MAX,
    `${c.label}: số lượng 12 KHÔNG BAO GIỜ bị cắt khỏi QR (23 ký tự ngân hàng nhận)`,
    `gửi bank: ${nd} (${nd.length})`
  );
}
ok(
  !normalizeVietqrContent(
    resolveTransferContent({ ...base, template: '{KHO} {SL}', warehouseName: 'Kho Dai Nam Thang 10 2026' })
  ).includes('Thang 10 2026'),
  'tên kho dài là phần phải nhường chỗ — không được nuốt mất số lượng'
);
const qtyFirst = normalizeVietqrContent(
  resolveTransferContent({ ...base, template: '{SL}cuon {MA}', itemCount: 12 })
);
ok(qtyFirst.startsWith('12cuon'), 'đặt {SL} trước thì số lượng lên được QR', `gửi bank: ${qtyFirst}`);

// Hồi quy: cả hai màn hình phải hỏi cùng một nguồn sự thật
const mgr = readFileSync(join(ROOT, 'src', 'components', 'inventory', 'WarehouseBankManager.tsx'), 'utf8');
ok(vietCode.includes('hasTransferTemplate'), 'POS dùng hasTransferTemplate để bật/tắt nhắc');
ok(mgr.includes('hasTransferTemplate'), 'Quản Lý Kho dùng cùng hàm — không lệch logic');
ok(mgr.includes('Mặc định QR'), 'danh sách kho hiện nhãn "Mặc định QR" khi chưa có mẫu');
ok(/Đang trống nên dùng mẫu mặc định/.test(mgr), 'ô mẫu rỗng nói rõ đang dùng mẫu mặc định (vẫn có số lượng)');
ok(mgr.includes('normalizeVietqrContent'), 'preview hiện đúng 23 ký tự ngân hàng nhận');
ok(/Đã lưu mẫu: /.test(mgr), 'sau khi bấm Lưu phải báo đã lưu MẪU GÌ');
// Nhắc POS không được chặn bán và không được gọi là lỗi
const hint = viet.split('Kho chưa có mẫu riêng')[1] || '';
// className nằm TRƯỚC chữ trong JSX → lấy cửa sổ 400 ký tự đằng trước mốc.
const at = viet.indexOf('Kho chưa có mẫu riêng');
const hintHead = viet.slice(Math.max(0, at - 400), at);
ok(/đang dùng mẫu mặc định/.test(viet), 'POS nhắc đúng: kho đang dùng mẫu mặc định, có thể tuỳ biến');
ok(!/QR chỉ mang mã đơn/.test(viet), 'POS KHÔNG còn nói sai "QR chỉ mang mã đơn, không có số lượng"');
ok(!/QR chỉ mang mã đơn/.test(mgr), 'Quản Lý Kho cũng không nói sai điều đó');
ok(/text-amber-600/.test(hintHead) && !/text-rose/.test(hintHead), 'nhắc dùng màu cảnh báo nhẹ, không phải lỗi đỏ');
ok(!/return null|disabled/.test(hint.split('\n').slice(0, 3).join('\n')),
  'nhắc không chặn bán (không return null / không disable)');

console.log('\n[#9] Mã đơn rút gọn cho QR: ổn định, đủ ngắn, KHÔNG phải mã đơn đầy đủ');
ok(VIETQR_CONTENT_MAX === 23, 'ngưỡng VietQR = 23 ký tự (normalizeVietqrContent)');
ok(DEFAULT_TRANSFER_TEMPLATE.replace('{SL}', '9').replace('{MA}', 'ORD12345678') === '9cuon ORD12345678',
  'mẫu mặc định chỉ dùng biến + ký tự QR giữ nguyên', DEFAULT_TRANSFER_TEMPLATE);
const moc = 'ORD-20260928-91D9A82AF0543D86';
const short = compactOrderCode(moc);

ok(compactOrderCode(moc) === short && short.length > 0,
  'cùng mã đơn ⇒ luôn ra cùng mã rút gọn (không Math.random)', `nhận: ${short}`);
ok(short !== moc && !normalizeVietqrContent(moc).startsWith(short),
  'mã rút gọn KHÁC mã đơn đầy đủ (không phải bản rút gọn của chính nó)', short);
ok(/^ORD[0-9A-F]{8}$/.test(short), 'shape: ORD + 8 hex, chỉ ký tự QR an toàn', short);
ok(compactOrderCode('ORD-20260101-FFFFFFFFFFFFFFFF') !== compactOrderCode('ORD-20260101-0000000000000000'),
  'hai mã đơn khác phần ngẫu nhiên ⇒ hai mã rút gọn khác nhau');
ok(compactOrderCode('ORD-20260928-91D9A82AF0543D86') === compactOrderCode('ord2026092891d9a82af0543d86'),
  'bỏ dấu gạch / đổi hoa thường cho ra CÙNG mã rút gọn');

// Không đúng shape ⇒ vẫn phải ra mã ổn định, KHÔNG ném lỗi.
for (const rác of ['', '   ', 'abc', 'ORD-', '!!!@@@###', 'x'.repeat(300)]) {
  let kq = '';
  let lỗi = '';
  try { kq = compactOrderCode(rác); } catch (e: any) { lỗi = e.message; }
  ok(!lỗi && /^ORD[0-9A-F]{8}$/.test(kq), `rác (${JSON.stringify(rác.slice(0, 12))}) → mã rút gọn hợp lệ`, lỗi || kq);
}
ok(compactOrderCode('abc') === compactOrderCode('abc'), 'mã rút gọn từ rác vẫn tất định (hash FNV-1a)');

// Số lượng + mã rút gọn phải VỪA 23 ký tự sau normalize, với mã đơn thật dài nhất.
const adversarial = [
  { sl: 1, code: 'ORD-20260928-91D9A82AF0543D86' },
  { sl: 12, code: 'ORD-20261231-FFFFFFFFFFFFFFFF' },
  { sl: 99, code: 'ORD-20260101-0000000000000000' },
  { sl: 999, code: 'ORD-20260928-91D9A82AF0543D86' },
];
for (const a of adversarial) {
  const nd = normalizeVietqrContent(resolveTransferContent({ ...base, template: null, itemCount: a.sl, orderCode: a.code }));
  ok(nd.length <= 23 && nd.includes(String(a.sl)) && nd.includes(compactOrderCode(a.code)),
    `mặc định (${a.sl} sp, ${compactOrderCode(a.code)}) vừa 23 ký tự, còn số lượng + mã rút gọn`,
    `gửi bank: ${nd} (${nd.length})`);
}
ok(!normalizeVietqrContent(resolveTransferContent({ ...base, template: null })).includes('91D9A82AF0543D86'),
  'QR KHÔNG chứa mã đơn đầy đủ — nếu ai đó "đơn giản hoá" ngược lại thì test này đỏ');

// Mẫu đã cấu hình LUÔN thắng mẫu mặc định — và {MA} trong đó vẫn là mã rút gọn.
ok(
  resolveTransferContent({ ...base, template: 'DH {SL} {MA}', itemCount: 7 })
    === `DH 7 ${MA}`,
  'mẫu của kho thắng mẫu mặc định, {MA} vẫn là mã rút gọn',
  `nhận: ${resolveTransferContent({ ...base, template: 'DH {SL} {MA}', itemCount: 7 })}`
);
ok(resolveTransferContent({ ...base, template: 'DH {SL} {MA}' }) !== resolveTransferContent({ ...base, template: null }),
  'có mẫu ≠ không mẫu: không có đường nào bị mẫu mặc định ghi đè');

console.log('\n[#10] VietQrPay ẩn dãy payload EMV thô, vẫn hiện dòng số tiền');
ok(!/break-all/.test(viet), 'KHÔNG render dãy payload thô (break-all) dưới mã QR');
ok(!/\{payload\}/.test(viet), 'không còn chỗ in biến payload ra màn hình');
ok(/toLocaleString\('vi-VN'\)\} đ/.test(viet), 'VẪN giữ dòng số tiền dưới mã QR (không xoá nhầm)');

console.log(`\n${fail === 0 ? '🎉' : '💥'} Nội dung QR POS: ${pass}/${pass + fail} PASS`);
assert.equal(fail, 0, `${fail} case FAIL`);
