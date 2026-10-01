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

/** CHỈ ĐỌC. Kiểm chứng đơn vừa bán ở kho ĐH Hà Nội có đúng không. */
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (s: string, a?: any[]) => (await db.execute({ sql: s, args: a || [] })).rows as any[];

  const orders = await q(
    `SELECT id, order_code, status, warehouse_id, subtotal, discount_amount, final_amount,
            cashier_id, created_at FROM orders ORDER BY created_at DESC LIMIT 3`
  );
  const whs = await q(`SELECT id, name FROM warehouses`);
  const whName = (id: string) => whs.find((w: any) => w.id === id)?.name || id;

  console.log('═══ 3 ĐƠN MỚI NHẤT ═══');
  for (const o of orders) {
    const age = Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000);
    console.log(`\n  ${o.order_code} | ${o.status} | ${whName(o.warehouse_id)} | ${age} phút trước`);
    console.log(`    tiền: ${o.subtotal} - CK ${o.discount_amount} = ${o.final_amount}`);

    const math = Math.abs(o.subtotal - (o.discount_amount + o.final_amount)) < 0.01;
    console.log(`    phép cộng đúng: ${math ? '✅' : '❌'}`);

    const items = await q(`SELECT * FROM order_items WHERE order_id = ?`, [o.id]);
    let sum = 0;
    for (const it of items) {
      sum += Number(it.total_amount);
      const lineOk = Math.abs(it.quantity * it.unit_selling_price - it.total_amount) < 0.01;
      console.log(
        `    ${it.edition_id ?? '(hàng hóa)'} x${it.quantity} | bìa ${it.unit_cover_price} | CK ${it.unit_discount_rate} | bán ${it.unit_selling_price} | = ${it.total_amount} ${lineOk ? '✅' : '❌'}`
      );
      console.log(
        `       product_id=${it.product_id} edition_id=${it.edition_id} is_gift_line=${it.is_gift_line} is_manual=${it.is_manual}`
      );
    }
    console.log(`    tổng dòng ${sum} vs final ${o.final_amount}: ${Math.abs(sum - o.final_amount) < 0.01 ? '✅ KHỚP' : '❌ LỆCH'}`);

    const led = await q(
      `SELECT event_type, quantity_delta, edition_id, product_id, document_ref
       FROM inventory_ledger WHERE document_ref = ?`,
      [o.order_code]
    );
    console.log(`    sổ kho: ${led.length ? led.map((l: any) => `${l.event_type} ${l.quantity_delta}`).join(', ') : '(⚠️ KHÔNG CÓ BÚT TOÁN)'}`);

    const neg = await q(
      `SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`
    );
    console.log(`    tồn âm toàn hệ thống: ${neg[0].n} ${Number(neg[0].n) === 0 ? '✅' : '❌'}`);
  }

  const fk = await q(`PRAGMA foreign_key_check`);
  const ig = await q(`PRAGMA integrity_check`);
  console.log(`\n═══ TOÀN DB ═══`);
  console.log(`  integrity_check    : ${Object.values(ig[0])[0]}`);
  console.log(`  foreign_key_check : ${fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length}`}`);
  process.exit(0);
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });