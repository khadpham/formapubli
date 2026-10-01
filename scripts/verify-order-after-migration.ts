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

/** CHỈ ĐỌC. Xác minh đơn SAU MIGRATION có tạo đúng không. */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (s: string, p?: any[]) =>
    (await db.execute({ sql: s, args: p || [] })).rows as any[];

  const MIGRATION_UTC = '2026-10-01T10:50:00.000Z'; // migration chạy ~10:40-10:50 UTC

console.log('═══ ĐƠN SAU MIGRATION ═══');
  // KHÔNG lọc bằng so sánh chuỗi `created_at`: cột này trộn SQLite
  // 'YYYY-MM-DD HH:MM:SS' (dấu cách = 0x20) và ISO '...T...Z' (0x54). 0x20 < 0x54
  // nên đơn SQLite bị loại khỏi mọi phép so >= '...T...'. Đây chính là bẫy đã
  // ghi ở order.service.ts:152-154. Lấy đơn mới nhất rồi so ở tầng JS.
  const after = await q(
    `SELECT id, order_code, status, subtotal, discount_amount, final_amount, channel, cashier_id, created_at
     FROM orders ORDER BY created_at DESC LIMIT 3`
  );
  after.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const afterMigration = after.filter(
    (o) => new Date(o.created_at).getTime() >= new Date(MIGRATION_UTC).getTime()
  );
  console.log(`  Migration lúc: ${MIGRATION_UTC}`);
  console.log(`  Đơn mới nhất trong DB: ${after[0]?.created_at} (${after[0]?.order_code})`);
  console.log(`  Trong 3 đơn mới nhất, số đơn SAU migration: ${afterMigration.length}`);
  for (const o of after) {
    const mark = new Date(o.created_at).getTime() >= new Date(MIGRATION_UTC).getTime()
      ? 'SAU MIGRATION ✅'
      : 'trước migration';
    console.log(`  - ${o.created_at} | ${o.order_code} | ${o.status} | ${mark}`);
  }
  for (const o of after) {
    console.log(`\n  ${o.order_code} | ${o.status}`);
    console.log(`    tạo lúc : ${o.created_at}`);
    console.log(`    kho     : ${o.warehouseId ?? ''}${o.channel} | thu ngân ${o.cashier_id}`);
    console.log(`    tiền    : subtotal ${o.subtotal} - CK ${o.discount_amount} = thu ${o.final_amount}`);
    const items = await q(
      `SELECT edition_id, quantity, unit_cover_price, unit_discount_rate, unit_selling_price, total_amount,
              product_id, promotion_id, is_gift_line, is_manual
       FROM order_items WHERE order_id = ?`,
      [o.id]
    );
    console.log('    dòng hàng:');
    for (const it of items) {
      const math = it.quantity * it.unit_selling_price;
      const ok = Math.abs(math - it.total_amount) < 0.01 ? '✅' : '❌ LỆCH';
      console.log(`      ${it.edition_id} x${it.quantity} | bìa ${it.unit_cover_price} | CK ${it.unit_discount_rate} | bán ${it.unit_selling_price} | = ${it.total_amount} ${ok}`);
      console.log(`         product_id=${it.product_id} promotion_id=${it.promotion_id} is_gift_line=${it.is_gift_line} is_manual=${it.is_manual}`);
    }
    const sum = items.reduce((s, i) => s + Number(i.total_amount), 0);
    console.log(`    TỔNG dòng ${sum} vs final_amount ${o.final_amount}: ${Math.abs(sum - o.final_amount) < 0.01 ? '✅ KHỚP' : '❌ LỆCH'}`);

    const led = await q(
      `SELECT event_type, quantity_delta, note FROM inventory_ledger WHERE document_ref = ?`,
      [o.order_code]
    );
    console.log('    sổ kho:', led.length ? led.map((l) => `${l.event_type} ${l.quantity_delta}`).join(', ') : '(không có bút toán)');
  }

  console.log('\n═══ TOÀN DB SAU MIGRATION ═══');
  const fk = await q(`PRAGMA foreign_key_check`);
  console.log('  foreign_key_check:', fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length} vi phạm`);
  const ig = await q(`PRAGMA integrity_check`);
  console.log('  integrity_check:', Object.values(ig[0])[0]);
  const neg = await q(`SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`);
  console.log('  tồn âm:', Number(neg[0].n), Number(neg[0].n) === 0 ? '✅' : '❌');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('❌', e.message); process.exit(1); });
