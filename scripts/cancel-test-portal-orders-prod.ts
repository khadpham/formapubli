/**
 * Hủy đơn portal TEST trên PRODUCTION để nhả chỗ giữ ATP (mặc định CHỈ XEM).
 *
 * Bối cảnh: 6 đơn PENDING giữ hết trần 20 cuốn của kho Âu Cơ ⇒ đơn thật mới bị
 * 409. Giữ nguyên đơn KHÁCH THẬT (portal_ref = DH-20261009-NW0Z), chỉ hủy đơn
 * test (TEST-CURL-001, TEST-GIFT-*, DH-...-TEST2, WPLN, 2O06).
 *
 * Chạy (xem trước):
 *   $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/cancel-test-portal-orders-prod.ts
 * Chạy thật (cần cả 3 cờ):
 *   $env:ALLOW_PROD_WRITE='true'; $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/cancel-test-portal-orders-prod.ts --thuc-hien
 *
 * KHÔNG log PIN/secret.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { requireProdWriteConsent, requireExplicitTarget } from './prod-write-guard';

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const DO_IT = process.argv.includes('--thuc-hien');

/** Mã đơn KHÁCH THẬT — tuyệt đối không hủy. */
const KEEP_PORTAL_REF = 'DH-20261009-NW0Z';

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const rows = (
      await db.execute(
        "SELECT id, order_code, portal_ref, note FROM orders WHERE channel='ONLINE' AND status='PENDING_CONFIRMATION' ORDER BY created_at"
      )
    ).rows as any[];

    const keep = rows.filter((r) => `${r.portal_ref || ''}` === KEEP_PORTAL_REF);
    const cancel = rows.filter((r) => `${r.portal_ref || ''}` !== KEEP_PORTAL_REF);

    console.log(`\nĐơn chờ soạn: ${rows.length}`);
    console.log(`  GIỮ (đơn khách thật): ${keep.map((r) => r.order_code).join(', ') || '—'}`);
    console.log(`  HỦY (đơn test): ${cancel.map((r) => r.order_code).join(', ') || '—'}`);

    if (!DO_IT) {
      console.log('\n🧪 CHỈ XEM — chưa hủy gì. Thêm --thuc-hien (+ ALLOW_PROD_WRITE) để thực hiện.');
      return;
    }
    requireProdWriteConsent(`hủy ${cancel.length} đơn test online để nhả ATP`);

    let done = 0;
    for (const r of cancel) {
      try {
        await db.execute({
          sql: "UPDATE orders SET status = 'CANCELLED', note = note || ' | [HỦY: dọn đơn test, nhả ATP]' WHERE id = ? AND status = 'PENDING_CONFIRMATION'",
          args: [r.id],
        });
        console.log(`  ✅ ${r.order_code} → CANCELLED`);
        done++;
      } catch (e: any) {
        console.error(`  ❌ ${r.order_code}: ${e?.message || e}`);
      }
    }

    // Kiểm lại: đơn PENDING còn lại + tổng cuốn đang giữ.
    const after = (
      await db.execute(
        `SELECT o.order_code, COALESCE(SUM(oi.quantity), 0) AS held
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE o.channel='ONLINE' AND o.status='PENDING_CONFIRMATION'
         GROUP BY o.id ORDER BY o.created_at`
      )
    ).rows as any[];
    const totalHeld = after.reduce((s, r) => s + Number(r.held || 0), 0);
    console.log(`\nĐơn PENDING còn lại: ${after.length}, đang giữ ${totalHeld} cuốn (trần 20)`);
    for (const r of after) console.log(`  - ${r.order_code}: ${r.held} cuốn`);
    console.log(`Đã hủy ${done}/${cancel.length}.`);
  } finally {
    try {
      (db as any).close?.();
    } catch {
      /* bỏ qua lỗi đóng client native trên Windows */
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
