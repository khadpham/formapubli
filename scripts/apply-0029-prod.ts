import { requireProdWriteConsent } from './prod-write-guard';

requireProdWriteConsent('thêm trigger chặn tồn kho âm khi CHÈN MỚI (migration 0029)');

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

async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (sql: string) => (await db.execute(sql)).rows;

  const before = await q(
    `SELECT name FROM sqlite_master WHERE type='trigger' AND name='check_stock_non_negative_ins'`
  );
  if (before.length) {
    console.log('Trigger BEFORE INSERT đã tồn tại — không làm gì.');
  } else {
    await db.execute(
      `CREATE TRIGGER IF NOT EXISTS check_stock_non_negative_ins
       BEFORE INSERT ON stock_balances
       FOR EACH ROW WHEN NEW.physical_quantity < 0
       BEGIN
         SELECT RAISE(ABORT, 'check_stock_non_negative: physical_quantity >= 0');
       END`
    );
    console.log('Đã tạo trigger BEFORE INSERT.');
  }

  // Chứng minh trigger chạy đúng trên Turso: thử chèn dòng âm rồi phải bị chặn.
  const ed = await q(`SELECT id FROM editions LIMIT 1`);
  const wh = await q(`SELECT id FROM warehouses LIMIT 1`);
  const id = `sg-test-${Date.now()}`;
  let blocked = false;
  let msg = '';
  try {
    await db.execute({
      sql: `INSERT INTO stock_balances (id, edition_id, warehouse_id, condition, physical_quantity)
            VALUES (?, ?, ?, 'NEW', -1)`,
      args: [id, ed[0].id, wh[0].id],
    });
  } catch (e: any) {
    blocked = true;
    msg = String(e?.message || '');
  }
  // Dọn dù kết quả gì.
  await db.execute({ sql: `DELETE FROM stock_balances WHERE id = ?`, args: [id] });
  console.log(`Chèn số âm bị chặn: ${blocked ? 'CÓ' : 'KHÔNG'}${msg ? ` (${msg.slice(0, 70)})` : ''}`);
  if (!blocked) throw new Error('Trigger BEFORE INSERT KHÔNG chặn được tồn kho âm trên Turso.');

  const all = await q(`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`);
  console.log(`\nTrigger trên production: ${all.map((r: any) => r.name).join(', ')}`);
  const leftovers = await q(
    `SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`
  );
  console.log(`Dòng tồn âm còn lại: ${leftovers[0].n}`);
  console.log('\n✅ Sẵn sàng.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });
