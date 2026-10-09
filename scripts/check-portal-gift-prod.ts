/**
 * Đọc nhanh dòng quà của đơn portal trên PRODUCTION (CHỈ ĐỘC).
 * Trả lời: SP-004 có tới DB không, order_items ghi edition_id gì, products có
 * tên "Túi Tote" không — vì panel hiện tên sản phẩm mà dòng quà đang hiện id thô.
 *
 *   $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/check-portal-gift-prod.ts
 *
 * KHÔNG log PIN/secret. Chỉ in mã đơn + id dòng + tên sản phẩm.
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
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const ords = (
      await db.execute(
        "SELECT id, order_code FROM orders WHERE channel='ONLINE' AND status='PENDING_CONFIRMATION' ORDER BY created_at DESC LIMIT 5"
      )
    ).rows as any[];
    console.log(`Đơn chờ soạn: ${ords.length}`);
    for (const o of ords) {
      const items = (
        await db.execute({
          sql: 'SELECT edition_id, quantity, is_gift_line FROM order_items WHERE order_id = ?',
          args: [o.id],
        })
      ).rows as any[];
      console.log(`\n${o.order_code}:`);
      for (const it of items) {
        let label = `${it.edition_id} (gift=${it.is_gift_line})`;
        if (it.edition_id) {
          const ed = (
            await db.execute({
              sql: 'SELECT e.code, e.title, w.title AS wt FROM editions e LEFT JOIN works w ON e.work_id = w.id WHERE e.id = ?',
              args: [it.edition_id],
            })
          ).rows[0] as any;
          if (ed) label = `${ed.code} — ${ed.title || ed.wt} (gift=${it.is_gift_line})`;
          else {
            const p = (
              await db.execute({ sql: 'SELECT code, name FROM products WHERE id = ?', args: [it.edition_id] })
            ).rows[0] as any;
            if (p) label = `${p.code} — ${p.name} (gift=${it.is_gift_line})`;
          }
        }
        console.log(`  - ${label} × ${it.quantity}`);
      }
    }
    const sp = (
      await db.execute("SELECT id, code, name FROM products WHERE code LIKE 'SP-%' ORDER BY code")
    ).rows as any[];
    console.log(`\nHàng hóa SP-*: ${sp.map((x) => `${x.code}=${x.name}`).join(', ') || '(không có)'}`);
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
