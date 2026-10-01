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

/** CHỈ ĐỌC. Truy nguyên các bất thường ở kho hội chợ. */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (s: string) => (await db.execute(s)).rows as any[];

  console.log('═══ A. ĐƠN SAU THỜI ĐIỂM MIGRATION (10:20 UTC) ═══');
  const after = await q(
    `SELECT order_code, status, final_amount, created_at FROM orders WHERE created_at >= '2026-10-01T10:20:00.000Z' ORDER BY created_at`
  );
  console.log(`  Số đơn từ 10:20 UTC trở đi: ${after.length}`);
  for (const r of after) console.log(`    ${r.created_at} | ${r.order_code} | ${r.status} | ${r.final_amount}đ`);
  if (!after.length) console.log('  ⚠️ KHÔNG có đơn nào — có thể hết ca hoặc hệ thống ngừng nhận.');

  console.log('\n═══ B. TỒN ÂM Ở KHO HỒ GƯƠM — do loại bút toán nào ═══');
  const wh = await q(`SELECT id, name FROM warehouses WHERE id='wh-kho-hoi-cho-ho-guom'`);
  console.log('  Kho:', JSON.stringify(wh));

  const byType = await q(
    `SELECT event_type, COUNT(*) n, SUM(quantity_delta) total, MIN(recorded_at) dau, MAX(recorded_at) cuoi
     FROM inventory_ledger WHERE warehouse_id='wh-kho-hoi-cho-ho-guom' GROUP BY event_type ORDER BY n DESC`
  );
  console.log('  Bút toán theo loại:');
  for (const r of byType) {
    console.log(`    ${r.event_type}: ${r.n} dòng, tổng delta ${r.total}, ${r.dau} → ${r.cuoi}`);
  }

  const sample = await q(
    `SELECT event_type, quantity_delta, document_ref, note, recorded_at, actor_id
     FROM inventory_ledger WHERE warehouse_id='wh-kho-hoi-cho-ho-guom' AND edition_id='ed-h01'
     ORDER BY recorded_at LIMIT 12`
  );
  console.log('\n  12 bút toán đầu của ed-h01 ở kho hội chợ:');
  for (const r of sample) {
    console.log(`    ${r.recorded_at} | ${r.event_type} | ${r.quantity_delta > 0 ? '+' : ''}${r.quantity_delta} | ${r.document_ref} | ${r.actor_id}`);
  }

  console.log('\n═══ C. SO SÁNH stock_balances Ở KHO HỒ GƯƠM ═══');
  const sb = await q(
    `SELECT COUNT(*) n, SUM(physical_quantity) q FROM stock_balances WHERE warehouse_id='wh-kho-hoi-cho-ho-guom'`
  );
  console.log('  stock_balances:', JSON.stringify(sb[0]));
  const led = await q(
    `SELECT SUM(quantity_delta) t FROM inventory_ledger WHERE warehouse_id='wh-kho-hoi-cho-ho-guom'`
  );
  console.log('  Tổng ledger:', JSON.stringify(led[0]));

  console.log('\n═══ D. THỜI ĐIỂM CÁC BÚT TOÁN ÂM — trước hay sau migration ═══');
  const when = await q(
    `SELECT substr(recorded_at,1,13) gio, COUNT(*) n, SUM(quantity_delta) total
     FROM inventory_ledger WHERE warehouse_id='wh-kho-hoi-cho-ho-guom'
     GROUP BY substr(recorded_at,1,13) ORDER BY gio`
  );
  console.log('  Theo giờ (recorded_at):');
  for (const r of when) console.log(`    ${r.gio}h | ${r.n} dòng | tổng ${r.total}`);

  console.log('\n═══ E. KHO NÀO ĐANG CÓ BIẾN ĐỘNG ═══');
  const active = await q(
    `SELECT warehouse_id, COUNT(*) n, MAX(recorded_at) moi FROM inventory_ledger
     GROUP BY warehouse_id ORDER BY moi DESC`
  );
  for (const r of active) console.log(`    ${r.warehouse_id}: ${r.n} dòng, mới nhất ${r.moi}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('❌', e.message); process.exit(1); });