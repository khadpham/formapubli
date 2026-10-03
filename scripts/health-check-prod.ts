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

/**
 * KHÔNG KIỂM TRA SỨC KHOẺ PRODUCTION. CHỈ ĐỌC.
 * Không DDL, không DML, không tạo đơn. Mọi câu đều SELECT/PRAGMA.
 */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (sql: string) => (await db.execute(sql)).rows as any[];

  console.log('═══ 1. TOÀN VẸN DATABASE ═══');
  const integrity = (await q(`PRAGMA integrity_check`)) as any[];
  console.log('  integrity_check:', integrity.map((r) => Object.values(r)[0]).join(', '));

  const fk = (await q(`PRAGMA foreign_key_check`)) as any[];
  console.log('  foreign_key_check:', fk.length === 0 ? 'SẠCH (0 vi phạm)' : `❌ ${fk.length} vi phạm`);
  if (fk.length) console.log('  ', JSON.stringify(fk.slice(0, 5)));

  console.log('\n═══ 2. SỐ BẢNG ═══');
  const t = await q(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`);
  console.log('  Tổng số bảng:', Number(t[0].n));

  console.log('\n═══ 3. ĐƠN — có tạo được không ═══');
  const st = await q(
    `SELECT status, COUNT(*) n FROM orders GROUP BY status ORDER BY n DESC`
  );
  for (const r of st) console.log(`  ${r.status}: ${r.n}`);

  const recent = await q(
    `SELECT order_code, status, final_amount, created_at FROM orders ORDER BY created_at DESC LIMIT 8`
  );
  console.log('  8 đơn mới nhất:');
  for (const r of recent) console.log(`    ${r.order_code} | ${r.status} | ${r.final_amount}đ | ${r.created_at}`);

  const today = new Date().toISOString().slice(0, 10);
  const td = await q(
    `SELECT COUNT(*) n, SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) ok FROM orders WHERE substr(created_at,1,10)=?`,
    );
  console.log(`  Hôm nay (${today}):`, JSON.stringify(td[0]));

  console.log('\n═══ 4. TỒN KHO — có âm không ═══');
  const neg = await q(`SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`);
  console.log('  Bucket tồn âm:', Number(neg[0].n), Number(neg[0].n) === 0 ? '✅' : '❌ CẢNH BÁO');

  const negLedger = await q(
    `SELECT edition_id, warehouse_id, condition, SUM(quantity_delta) total FROM inventory_ledger GROUP BY edition_id, warehouse_id, condition HAVING total < 0`
  );
  console.log('  Tồn âm theo ledger:', negLedger.length === 0 ? 'SẠCH' : `❌ ${negLedger.length} nhóm âm`);
  for (const r of negLedger.slice(0, 5)) console.log('   ', JSON.stringify(r));

  console.log('\n═══ 5. KHÓA CHÍNH / TRÙNG ═══');
  for (const [label, sql] of [
    ['editions trùng id', `SELECT id, COUNT(*) n FROM editions GROUP BY id HAVING n>1`],
    ['orders trùng order_code', `SELECT order_code, COUNT(*) n FROM orders GROUP BY order_code HAVING n>1`],
    ['products trùng id', `SELECT id, COUNT(*) n FROM products GROUP BY id HAVING n>1`],
  ] as const) {
    const r = await q(sql);
    console.log(`  ${label}: ${r.length === 0 ? 'SẠCH' : `❌ ${r.length}`}`);
  }

  console.log('\n═══ 6. CỘT MỚI — đã làm hỏng gì không ═══');
  for (const tbl of ['editions', 'order_items', 'inventory_ledger', 'stock_balances']) {
    const nn = await q(
      `SELECT COUNT(*) n FROM \`${tbl}\` WHERE product_id IS NOT NULL`
    );
    console.log(`  ${tbl}: ${Number(nn[0].n)} dòng có product_id (backfill chưa chạy ⇒ phải = 0)`);
  }
  const gf = await q(`SELECT COUNT(*) n FROM order_items WHERE is_gift_line=1 OR is_manual=1`);
  console.log(`  order_items có dòng quà: ${Number(gf[0].n)} (chưa có tính năng ⇒ phải = 0)`);
  const gf2 = await q(`SELECT COUNT(*) n FROM order_items WHERE unit_discount_rate=1`);
  console.log(`  order_items chiết khấu 100% (cơ chế cũ): ${Number(gf2[0].n)}`);

  console.log('\n═══ 7. ĐỐI CHIẾU SỔ KHO ═══');
  const mismatch = await q(
    `SELECT COUNT(*) n FROM (
       SELECT sb.id FROM stock_balances sb
       LEFT JOIN (SELECT edition_id, warehouse_id, condition, SUM(quantity_delta) t
                  FROM inventory_ledger GROUP BY edition_id, warehouse_id, condition) il
         ON il.edition_id=sb.edition_id AND il.warehouse_id=sb.warehouse_id AND il.condition=sb.condition
       WHERE ABS(COALESCE(il.t,0) - sb.physical_quantity) > 0
     )`
  );
  console.log('  Bucket lệch với ledger:', Number(mismatch[0].n), Number(mismatch[0].n) === 0 ? '✅ khớp' : '⚠️ lệch (có thể đã có sẵn từ trước)');

  console.log('\n═══ KẾT ═══');
  console.log('Không có bước nào ở trên GHI vào DB.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('❌', e.message);
    process.exit(1);
  });