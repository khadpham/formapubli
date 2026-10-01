/**
 * scripts/test-no-order-notifications.ts — ĐƠN CHỜ KHÔNG BÁO CHUÔNG.
 *
 * Quyết định chủ 02/10: đơn chờ xác nhận (PENDING_CONFIRMATION) không xin phê
 * duyệt của ai nên không có gì để báo — thu ngân tự thấy trong "Đơn Chờ" của
 * POS mình. Báo cho quản lý/thủ kho chỉ gây ồn, sai kho, sai chữ.
 *
 * Khoá bằng đọc code route (repo đã dùng mẫu này ở test-pos-cash-integrity):
 * route /api/notifications không được sinh mục kind 'order' nào, không được
 * query đơn PENDING_CONFIRMATION để báo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8'
);

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

ok(
  'route không sinh mục thông báo đơn hàng nào',
  !/kind:\s*['"]order['"]/.test(src),
  'còn dòng kind order'
);
ok(
  'route không query đơn chờ xác nhận để báo',
  !/PENDING_CONFIRMATION/.test(src),
  'còn truy vấn PENDING_CONFIRMATION'
);
ok(
  'giữ PendingOrdersView (danh sách việc của thu ngân, không phải noti)',
  fs.existsSync(path.resolve(process.cwd(), 'src/components/sales/PendingOrdersView.tsx')),
  'mất file PendingOrdersView'
);

console.log(`\nKết quả: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
console.log('✅ ĐƠN CHỜ KHÔNG BÁO CHUÔNG.');
