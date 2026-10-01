import fs from 'node:fs';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

/** CHỈ ĐỌC. */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (s: string) => (await db.execute(s)).rows as any[];

  console.log('═══ CA KÉT ĐANG MỞ (thu ngân đang làm việc?) ═══');
  const cs = await q(
    `SELECT id, cashier_id, warehouse_id, status, opening_cash, opened_at, closed_at
     FROM cashbox_sessions ORDER BY opened_at DESC LIMIT 8`
  );
  for (const r of cs) {
    console.log(`  ${r.id} | ${r.cashier_id} | ${r.warehouse_id} | ${r.status} | mở ${r.opened_at} | đóng ${r.closed_at || '(đang mở)'}`);
  }
  const open = cs.filter((r) => r.status === 'OPEN');
  console.log(`\n  Số ca đang MỞ: ${open.length}`);

  console.log('\n═══ NHẬT KÝ HOẠT ĐỘNG — có lỗi gì không ═══');
  const au = await q(
    `SELECT action, COUNT(*) n, MAX(created_at) moi FROM audit_logs GROUP BY action ORDER BY moi DESC LIMIT 15`
  );
  for (const r of au) console.log(`    ${r.action}: ${r.n} lần, mới nhất ${r.moi}`);

  console.log('\n═══ ĐƠN PENDING (đơn treo do lỗi) ═══');
  const pend = await q(
    `SELECT status, COUNT(*) n, MAX(created_at) moi FROM orders WHERE status NOT IN ('COMPLETED','CANCELLED') GROUP BY status`
  );
  console.log('  ', pend.length ? JSON.stringify(pend) : 'KHÔNG có đơn treo ✅');

  console.log('\n═══ SO SÁNH: đơn theo giờ UTC hôm nay ═══');
  const byHour = await q(
    `SELECT substr(created_at,1,13) gio, COUNT(*) n, SUM(final_amount) tien
     FROM orders WHERE substr(created_at,1,10)='2026-10-01' GROUP BY gio ORDER BY gio`
  );
  for (const r of byHour) console.log(`    ${r.gio}h | ${r.n} đơn | ${r.tien}đ`);

  console.log('\n═══ THỜI ĐIỂM ÁP MIGRATION (bằng chứng gián tiếp) ═══');
  // products rỗng + khung thời gian đơn cho biết migration lúc nào không thay đổi dữ liệu.
  const lastOrder = await q(`SELECT MAX(created_at) m FROM orders`);
  console.log('  Đơn mới nhất:', lastOrder[0].m);
  console.log('  Giờ UTC hiện tại:', new Date().toISOString());
  const mins = Math.round((Date.now() - new Date(lastOrder[0].m).getTime()) / 60000);
  console.log(`  => ${mins} phút chưa có đơn mới.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('❌', e.message); process.exit(1); });