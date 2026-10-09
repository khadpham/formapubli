/**
 * Kiểm tra đầu vào đơn portal trên PRODUCTION (CHỈ ĐỌC, không ghi).
 *
 * Trả lời: datmua POST có tới được không, đơn ONLINE/PENDING có tồn tại không,
 * và danh sách ID kho để chọn PORTAL_WAREHOUSE_ID.
 *
 *   $env:ALLOW_REMOTE_TARGET='formapubli-prod-phamkha9x.aws-ap-northeast-1.turso.io'
 *   npx tsx scripts/check-portal-orders-prod.ts
 *
 * KHÔNG in secret/PIN. Chỉ in mã kho + số lượng đơn.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { requireExplicitTarget } from './prod-write-guard';

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

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  console.log(`LOCAL .env có PORTAL_API_KEY: ${env.PORTAL_API_KEY ? 'có' : 'KHÔNG'}`);
  console.log(`LOCAL .env có PORTAL_WAREHOUSE_ID: ${env.PORTAL_WAREHOUSE_ID ? 'có' : 'KHÔNG'}`);

  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const online = (
      await db.execute("SELECT status, COUNT(*) AS n FROM orders WHERE channel='ONLINE' GROUP BY status")
    ).rows as any[];
    console.log(`PROD đơn ONLINE theo trạng thái: ${online.length ? JSON.stringify(online.map((r) => `${r.status}:${r.n}`)) : '(không có đơn ONLINE nào)'}`);

    const pending = (
      await db.execute(
        "SELECT order_code, created_at FROM orders WHERE channel='ONLINE' AND status='PENDING_CONFIRMATION' ORDER BY created_at DESC LIMIT 5"
      )
    ).rows as any[];
    console.log(`PROD đơn chờ soạn (PENDING_CONFIRMATION): ${pending.length}`);
    for (const o of pending) console.log(`  - ${o.order_code} (${o.created_at})`);

    const wh = (await db.execute('SELECT id FROM warehouses ORDER BY id')).rows as any[];
    console.log(`PROD kho (${wh.length}): ${wh.map((w) => w.id).join(', ')}`);

    try {
      const ps = (await db.execute('SELECT key, value FROM portal_settings')).rows as any[];
      console.log(
        `PROD portal_settings: ${ps.length ? ps.map((r) => `${r.key}=${r.value}`).join(', ') : '(trống — chưa chọn kho fulfill)'}`
      );
    } catch (err: any) {
      console.log(`PROD portal_settings: THIẾU BẢNG (${err?.message || err}) — cần chạy migration 0053`);
    }

    // Đơn portal rỗng mà cấu hình đã có → xem datmua chết ở bước nào:
    // customer cust-portal-* tồn tại mà không có đơn = createOrder ném lỗi.
    const pc = (
      await db.execute(
        "SELECT id, code, email FROM customers WHERE id LIKE 'cust-portal-%' OR code LIKE 'CUST-P%' ORDER BY rowid DESC LIMIT 5"
      )
    ).rows as any[];
    console.log(`PROD customer do portal tạo: ${pc.length}`);
    for (const c of pc) console.log(`  - ${c.code} ${c.email}`);

    const eds = (
      await db.execute(
        "SELECT code FROM editions WHERE code IN ('H82','H83','H84','H86','H87','H88')"
      )
    ).rows as any[];
    console.log(`PROD ấn bản H82-H88: ${eds.length ? eds.map((e) => e.code).join(', ') : 'KHÔNG có mã nào!'}`);

    const ful = (
      await db.execute(
        "SELECT id, is_active FROM warehouses WHERE id='wh-kho-dh-ha-noi-thang-10-2026'"
      )
    ).rows as any[];
    console.log(`PROD kho fulfill: ${ful.length ? `is_active=${ful[0].is_active}` : 'KHÔNG tồn tại!'}`);
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
