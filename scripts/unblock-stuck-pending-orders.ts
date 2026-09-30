/**
 * GỠ KẸT — huỷ đơn chuyển khoản bị mắc PENDING_CONFIRMATION chặn chốt ca.
 *
 * CHẠY: npx tsx scripts/unblock-stuck-pending-orders.ts            (xem trước)
 *       npx tsx scripts/unblock-stuck-pending-orders.ts --apply    (thực thi)
 *
 * VÌ SAO CẦN (30/09, người dùng bị chặn giữa chừng hội chợ):
 *   Đơn ORD2610010003 (15 dòng sách) mắc PENDING_CONFIRMATION. Nút "Xác nhận
 *   đã nhận tiền" báo "Lỗi hệ thống" vì `confirmOrder` chạy ~80 câu SQL (mỗi câu
 *   là 1 subrequest từ Cloudflare Worker tới Turso) — vượt trần 50 subrequest.
 *   Lỗi đó bị `handleApiError` che thành thông báo chung. Đơn không xác nhận
 *   được, mà chốt ca lại bị chặn khi còn đơn chờ ⇒ thu ngân bị kẹt, không lối ra.
 *
 *   Script này dùng CHÍNH `OrderService.cancelOrder` của hệ thống (không UPDATE
 *   tay) nên giải phóng ATP, ghi sổ và ghi nhật ký đúng như một lần huỷ bình
 *   thường. `cancelOrder` chỉ chạy 1 UPDATE + 1 audit nên KHÔNG vướng trần
 *   subrequest, an toàn với đơn nhiều dòng.
 *
 * AN TOÀN: mặc định chỉ XEM. Chỉ huỷ đơn đã quá hạn giữ chỗ, và KHÔNG huỷ đơn
 * nào đã ghi sổ kho (ledger > 0) — đơn đó cần người xử lý tay, không tự động.
 */
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const REASON =
  'Hủy tự động: đơn quá hạn giữ chỗ và không xác nhận được (vượt giới hạn xử lý ' +
  'nhiều dòng sách trong một lần gọi). Gỡ nút chặn chốt ca cho thu ngân.';

// Nạp .env vào process.env TRƯỚC khi import db (db đọc env lúc module load).
const envPath = path.resolve(process.cwd(), '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
process.env.DATABASE_URL = process.env.TURSO_DATABASE_URL as string;
process.env.DATABASE_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN as string;

if (!process.env.TURSO_DATABASE_URL) {
  console.error('  THIẾU TURSO_DATABASE_URL trong .env');
  process.exit(1);
}

async function main() {
const { createClient } = await import('@libsql/client');
  const raw = createClient({
  url: process.env.DATABASE_URL as string,
  authToken: process.env.DATABASE_AUTH_TOKEN as string,
});

console.log(`\n=== QUÉT ĐƠN CHỜ (${APPLY ? 'CHẾ ĐỘ THỰC THI' : 'chỉ xem'}) ===`);

const stuck = await raw.execute({
  sql: `SELECT o.id, o.order_code, o.status, o.channel, o.payment_method,
               o.cashbox_session_id, o.created_at, o.payment_expires_at, o.cashier_id,
               (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS lines,
               (SELECT COUNT(*) FROM inventory_ledger
                 WHERE correlation_id = o.id OR document_ref = o.order_code) AS ledger
        FROM orders o
        WHERE o.status = 'PENDING_CONFIRMATION'
        ORDER BY o.created_at ASC`,
  args: [],
});

if (stuck.rows.length === 0) {
  console.log('  Không có đơn nào đang chờ. Chốt ca sẽ không bị chặn.');
  raw.close();
  process.exit(0);
}

const now = Date.now();
const cancellable: string[] = [];
for (const r of stuck.rows) {
  const expires = r.payment_expires_at ? new Date(String(r.payment_expires_at)).getTime() : 0;
  const expired = expires > 0 && expires < now;
  const noLedger = Number(r.ledger) === 0;
  const canCancel = expired && noLedger;
  console.log(
    `  ${r.order_code} | ${r.channel} | ${r.payment_method} | ${r.lines} dòng | ledger=${r.ledger} | ` +
      `hết hạn=${r.payment_expires_at ?? '—'} | ${expired ? 'ĐÃ QUÁ HẠN' : 'còn hạn'} | ` +
      `${canCancel ? 'HUỶ ĐƯỢC' : 'CẦN XỬ LÝ TAY'}`
  );
  if (canCancel) cancellable.push(String(r.id));
}

if (!APPLY) {
  console.log(`\n  Sẽ huỷ ${cancellable.length} đơn. Chạy lại kèm --apply để thực thi.`);
  raw.close();
  process.exit(0);
}

if (cancellable.length === 0) {
  console.log('\n  Không có đơn nào đủ điều kiện huỷ tự động.');
  raw.close();
  process.exit(0);
}

// Dùng service thật để giải phóng ATP + ghi sổ + ghi nhật ký.
const { OrderService } = await import('../src/services/order.service');

for (const orderId of cancellable) {
  try {
    const res = await OrderService.cancelOrder(orderId, 'ROLE_OWNER', REASON, undefined, 'ADMIN-01');
    console.log(`  ✅ Đã huỷ ${orderId} → ${JSON.stringify(res)}`);
  } catch (e: any) {
    console.error(`  ❌ Không huỷ được ${orderId}: ${e?.message || e}`);
  }
}

const after = await raw.execute({
  sql: `SELECT COUNT(*) AS n FROM orders WHERE status='PENDING_CONFIRMATION'`,
  args: [],
});
console.log(`\n  Còn lại đơn chờ: ${after.rows[0].n}`);
console.log('  Thu ngân có thể bấm "Chốt ca" trở lại.');
raw.close();
process.exit(0);

}

main().catch((e) => { console.error('  LOI:', e?.message || e); process.exit(1); });
