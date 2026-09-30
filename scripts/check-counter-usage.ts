// Script CHI DOC - xac ninh tinh hinh "chia mam" co duoc dung o production khong.
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
  })
);

async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const has = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='counter_allocations'`);
  if (!has.rows.length) { console.log('Khong co bang counter_allocations.'); return; }
  const n = await db.execute(`SELECT COUNT(*) n FROM counter_allocations`);
  console.log(`counter_allocations tren production: ${n.rows[0].n} dong`);
  const b = await db.execute(`SELECT COUNT(*) n FROM bank_accounts`);
  const w = await db.execute(`SELECT COUNT(*) n FROM warehouses`);
  const k = await db.execute(`SELECT COUNT(*) n FROM stock_balances`);
  const o = await db.execute(`SELECT COUNT(*) n FROM orders`);
  console.log(`So kho: ${w.rows[0].n} | dong ton kho: ${k.rows[0].n} | don hang: ${o.rows[0].n}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('ERR', e.message); process.exit(1); });
