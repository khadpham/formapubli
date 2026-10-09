/**
 * Backfill đơn portal cũ trên PRODUCTION (CHỈ ĐỌC trước, ghi khi --thuc-hien).
 *
 * Sửa 3 thứ cho đơn ONLINE đã tạo trước khi có fix:
 * 1. Dòng quà null → edition_id = SP-004 (Túi Tote), is_gift_line = 1.
 * 2. portal_ref ← mã trong note ("Mã portal: XXX").
 * 3. Không đụng đơn đã COMPLETED/CANCELLED.
 *
 *   $env:ALLOW_REMOTE_TARGET='<host>'
 *   npx tsx scripts/backfill-portal-prod.ts            # chỉ xem
 *   npx tsx scripts/backfill-portal-prod.ts --thuc-hien # ghi thật
 *
 * KHÔNG log PIN/secret. Chỉ in mã đơn + số dòng sửa.
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

async function main() {
  requireExplicitTarget(env.TURSO_DATABASE_URL);
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  try {
    const ords = (
      await db.execute(
        "SELECT id, order_code, note FROM orders WHERE channel='ONLINE' AND status='PENDING_CONFIRMATION' ORDER BY created_at"
      )
    ).rows as any[];
    console.log(`\nĐơn ONLINE chờ soạn: ${ords.length}`);

    const sp = (
      await db.execute("SELECT id FROM products WHERE code='SP-004' LIMIT 1")
    ).rows[0] as any;
    if (!sp) {
      console.error('KHÔNG tìm thấy SP-004 trong products — dừng.');
      process.exit(1);
    }
    console.log(`SP-004 id: ${sp.id}`);

    let giftFixed = 0;
    let refFixed = 0;
    for (const o of ords) {
      const nullLines = (
        await db.execute({
          sql: 'SELECT id FROM order_items WHERE order_id = ? AND edition_id IS NULL',
          args: [o.id],
        })
      ).rows as any[];
      const m = /Mã portal:\s*(\S+)/.exec(`${o.note || ''}`);
      const portalRef = m?.[1] || null;

      console.log(`\n${o.order_code}: dòng null=${nullLines.length}, portal_ref=${portalRef || '(none)'}`);
      if (!DO_IT) continue;

      for (const ln of nullLines) {
        await db.execute({
          sql: 'UPDATE order_items SET edition_id = ?, is_gift_line = 1 WHERE id = ?',
          args: [sp.id, ln.id],
        });
        giftFixed++;
      }
      if (portalRef) {
        await db.execute({
          sql: 'UPDATE orders SET portal_ref = ? WHERE id = ?',
          args: [portalRef, o.id],
        });
        refFixed++;
      }
    }

    if (!DO_IT) {
      console.log('\n🧪 CHỈ XEM — chưa ghi. Thêm --thuc-hien (+ ALLOW_PROD_WRITE) để sửa.');
      return;
    }
    requireProdWriteConsent('backfill đơn portal cũ (quà SP-004 + portal_ref)');
    console.log(`\n✅ Sửa ${giftFixed} dòng quà, ${refFixed} portal_ref`);
    const after = (
      await db.execute(
        "SELECT COUNT(*) n FROM order_items WHERE edition_id IS NULL AND order_id IN (SELECT id FROM orders WHERE channel='ONLINE')"
      )
    ).rows as any[];
    console.log(`  Còn dòng null: ${after[0]?.n ?? '?'} (phải = 0)`);
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
