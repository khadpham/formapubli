import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { requireExplicitTarget } from './prod-write-guard';

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
 * CỔNG 3b — migration 0033: dựng lại `inventory_ledger`.
 * 0032 BỎ SÓT bảng này ⇒ hàng hóa ghi sổ kho không được ⇒ đơn rollback.
 *
 * ⚠️ Cùng tính chất 0032: COPY sang bảng tạm → DROP → RENAME, KHÔNG transaction.
 * Cần backup đã mở được trước khi chạy trên production.
 */
const SQL_FILE = path.resolve(process.cwd(), 'src/db/migrations/0033_ledger_sellable.sql');

const targetUrl = process.env.DATABASE_URL || env.TURSO_DATABASE_URL;
const isDryRun = Boolean(process.env.DATABASE_URL);

async function main() {
  requireExplicitTarget(targetUrl);
  if (isDryRun) console.log('\n🧪 DRY-RUN: DB LOCAL.');

  const db = createClient({ url: targetUrl, authToken: isDryRun ? undefined : env.TURSO_AUTH_TOKEN });
  const rows = async (s: string) => (await db.execute(s)).rows as any[];
  const count = async (t: string) => {
    try {
      return Number((await rows(`SELECT COUNT(*) n FROM \`${t}\``))[0]?.n || 0);
    } catch {
      return -1;
    }
  };

  console.log('\n════ TRƯỚC ════');
  const before = {
    inventory_ledger: await count('inventory_ledger'),
    editions: await count('editions'),
    orders: await count('orders'),
    stock_balances: await count('stock_balances'),
    order_items: await count('order_items'),
  };
  for (const [k, v] of Object.entries(before)) console.log(`  ${k}: ${v}`);

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((c) =>
      c
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(Boolean);

  console.log(`\n════ CHẠY ${statements.length} CÂU ════`);
  for (let i = 0; i < statements.length; i++) {
    const head = statements[i].replace(/\s+/g, ' ').slice(0, 60);
    try {
      await db.execute(statements[i]);
      console.log(`  ✓ ${i + 1}/${statements.length}  ${head}`);
    } catch (e: any) {
      console.error(`\n❌ DỪNG Ở CÂU ${i + 1}: ${head}`);
      console.error(`   ${e?.message || e}`);
      process.exit(1);
    }
  }

  console.log('\n════ SAU ════');
  const after = {
    inventory_ledger: await count('inventory_ledger'),
    editions: await count('editions'),
    orders: await count('orders'),
    stock_balances: await count('stock_balances'),
    order_items: await count('order_items'),
  };
  for (const [k, v] of Object.entries(after)) {
    const b = (before as any)[k];
    console.log(`  ${k}: ${b} → ${v} ${v === b ? '✅' : '❌ ĐÃ ĐỔI'}`);
  }

  const n = await rows(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE product_id IS NULL) a,
            (SELECT COUNT(*) FROM inventory_ledger WHERE edition_id IS NULL) b,
            (SELECT COUNT(*) FROM inventory_ledger WHERE document_ref IS NULL) c,
            (SELECT COUNT(*) FROM inventory_ledger WHERE actor_id IS NULL) d`
  );
  console.log(`\n  product_id NULL    : ${n[0].a} ${Number(n[0].a) === 0 ? '✅' : '❌'}`);
  console.log(`  edition_id NULL    : ${n[0].b} (hàng hóa — được phép)`);
  console.log(`  document_ref NULL  : ${n[0].c} ${Number(n[0].c) === 0 ? '✅' : '❌ mất dữ liệu'}`);
  console.log(`  actor_id NULL      : ${n[0].d} ${Number(n[0].d) === 0 ? '✅' : '❌ mất dữ liệu'}`);

  const idx = await rows(
    `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='inventory_ledger' AND sql IS NOT NULL`
  );
  console.log(`  index              : ${idx.map((x) => x.name).join(', ')}`);

  // Thử ghi bút toán cho hàng hóa — đây là lý do 0033 tồn tại.
  let err = '';
  try {
    await db.execute({
      sql: `INSERT INTO inventory_ledger (id, edition_id, product_id, warehouse_id, event_type,
              quantity_delta, condition, document_ref, note, actor_id, idempotency_key, effective_at)
            VALUES ('led-probe-0033', NULL, ?, 'wh-au-co', 'DISPATCH_SALE', -1, 'NEW',
                    'PROBE-0033', 'probe', 'setup', 'IDEM-PROBE-0033', '2026-10-01T00:00:00Z')`,
      args: [before.editions > 0 ? 'ed-hh001' : 'x'],
    });
  } catch (e: any) {
    err = String(e?.message || e);
  }
  console.log(`\n  ghi bút toán HÀNG HÓA (edition_id NULL): ${err ? '❌ ' + err.slice(0, 70) : '✅ ĐƯỢC'}`);

  const fk = await rows(`PRAGMA foreign_key_check`);
  const ig = await rows(`PRAGMA integrity_check`);
  console.log(`  foreign_key_check  : ${fk.length === 0 ? 'SẠCH ✅' : `❌ ${fk.length}`}`);
  console.log(`  integrity_check    : ${Object.values(ig[0])[0]}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});