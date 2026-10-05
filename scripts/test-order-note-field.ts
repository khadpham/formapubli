/**
 * Trường Ghi chú đơn hàng — mất chữ ở 2 chỗ (sự cố 05/10/2026, đo trên prod:
 * 299 đơn chỉ 35 đơn có note trong khi ô Ghi chú nằm ngay dưới hình thức
 * thanh toán ở quầy).
 *
 * Khóa lại:
 * 1. Modal chi tiết LUÔN hiện trường Ghi chú (trống thì gạch ngang) — phân
 *    biệt được "đơn không có ghi chú" với "mất trường".
 * 2. Ô Ghi chú trong modal thanh toán mở SAU khi đơn PENDING đã tạo — CONFIRM
 *    phải mang note theo và server ghi vào đơn (chỉ khi non-blank).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

const modal = read('src/components/orders/OrderDetailModal.tsx');
const pos = read('src/components/pos/PosCheckoutTerminal.tsx');
const route = read('src/app/api/orders/route.ts');
const service = read('src/services/order.service.ts');

// --- 1. Modal luôn hiện trường Ghi chú --------------------------------------
ok(
  /\{orderDetail\.order\.note && \(/.test(modal) === false,
  'modal không được ẩn cả khối Ghi chú khi note trống'
);
ok(/Ghi chú:/.test(modal), 'modal phải còn nhãn "Ghi chú:"');

// --- 2. CONFIRM mang note theo ----------------------------------------------
ok(
  /action: 'CONFIRM'[\s\S]{0,400}note:/.test(pos),
  'POS phải gửi note kèm CONFIRM (ô Ghi chú modal mở sau khi đơn đã tạo)'
);
ok(
  /body\.note/.test(route) && /confirmOrder\(/.test(route),
  'route CONFIRM phải đọc body.note'
);
ok(
  /opts\?: \{ note\?: string \}/.test(service),
  'confirmOrder phải nhận opts.note'
);
ok(
  /note = COALESCE\(NULLIF\(TRIM\(/.test(service),
  'server chỉ ghi đè note khi chuỗi chốt non-blank (blank giữ note lúc tạo)'
);

console.log(`\n=== GHI CHÚ ĐƠN HÀNG: ${checks} assertions PASS ===\n`);
