/**
 * Modal "Mở Phiên Két Tiền Ca Mới" phải hiện TÊN THẬT của thu ngân.
 *
 * Trước đây dòng này in:
 *   `User-{currentRole} - {selectedWarehouseId === 'wh-du-phong' ? 'Kho Hội chợ' : 'Kho Âu Cơ'}`
 * Nghĩa là thu ngân thấy MỘT CHUỖI VAI TRÒ GIẢ ("User-ROLE_CASHIER") cộng thêm
 * TÊN KHO — trong khi nhãn trên là "Thu ngân nhận ca:". Người dùng không xác định
 * được ca đang mở là của ai. Yêu cầu: chỉ tên người, gọn và đúng.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raw = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/pos/PosCheckoutTerminal.tsx'),
  'utf8'
);
// Bỏ comment JSX `{/* ... */}` và comment `//` trước khi kiểm. Không bỏ thì chính
// chú thích giải thích lỗi cũ sẽ khớp regex và test báo FAIL giả — đã dính lần này.
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

// Cắt riêng khối modal mở ca để test không bị nhiễu bởi chỗ khác trong file.
const m = src.match(/Thu ngân nhận ca[\s\S]{0,900}?<\/div>\s*<\/div>/);
ok(!!m, 'phải tìm thấy khối "Thu ngân nhận ca" trong modal mở ca');
const block = m ? m[0] : '';

ok(
  !/User-/.test(block),
  'KHÔNG được dựng chuỗi vai trò giá dạng "User-<role>" cho tên thu ngân'
);
ok(
  !/Kho Âu Cơ|Kho Hội chợ/.test(block),
  'KHÔNG được lẫn tên kho vào dòng tên thu ngân'
);
ok(
  !/selectedWarehouseId/.test(block),
  'dòng tên thu ngân không được phụ thuộc kho đang chọn'
);
ok(
  /cashierFullName/.test(block),
  'phải hiện tên thật lấy từ session'
);
ok(
  !/font-mono/.test(block),
  'bỏ font-mono: đây là tên người, không phải mã'
);

// Nguồn tên phải là /api/auth/me (đã có sẵn), không tạo endpoint mới.
ok(
  /fetch\('\/api\/auth\/me'/.test(src),
  'POS phải gọi /api/auth/me để lấy tên thật'
);
ok(
  /setCashierFullName\(j\?\.data\?\.fullName/.test(src),
  'phải lấy fullName từ response /api/auth/me'
);

// BẪY ĐÃ SỬA: phải lấy TÊN TRƯỚC khi rẽ nhánh kho. Rẽ sớm thì thu ngân chưa
// được gán kho sẽ không bao giờ thấy tên mình — đúng ca cần nhận nhất.
const meBlock = src.match(/fetch\('\/api\/auth\/me'[\s\S]{0,700}?assignedWarehouseId/);
ok(!!meBlock, 'phải tìm thấy khối xử lý /api/auth/me');
if (meBlock) {
  const nameAt = meBlock[0].indexOf('setCashierFullName');
  const earlyReturn = meBlock[0].indexOf('if (!wid) return;');
  ok(
    nameAt !== -1 && (earlyReturn === -1 || nameAt < earlyReturn),
    'phải set tên TRƯỚC khi rẽ nhánh "không có kho được gán"'
  );
}

console.log(`\n=== TÊN THU NGÂN MỞ KÉT: ${checks} assertions PASS ===`);
