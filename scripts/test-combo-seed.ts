/**
 * Test seed combo tren DB scratch (fixture), KHONG dung du lieu that.
 * - Dung COMBO01 + 3 sach that (Jakob von Gunten, TörleB, Ferdydurke).
 * - Chay seed 2 lan: lan 2 phai inserted=0 (idempotent).
 * - COMBO02..09 thieu du lieu -> skipped, khong fail.
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { seedCombos } from './seed-combo-components';

const SCRATCH = 'file:formapubli_test_combo_seed.db';

async function main() {
  try {
    fs.unlinkSync('formapubli_test_combo_seed.db');
  } catch {
    /* chua co */
  }
  const db = createClient({ url: SCRATCH });
  await db.execute(`CREATE TABLE products (
    id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL,
    product_kind TEXT NOT NULL DEFAULT 'BOOK', selling_price REAL NOT NULL DEFAULT 0
  )`);
  await db.execute(`CREATE TABLE combo_components (
    id TEXT PRIMARY KEY, combo_product_id TEXT NOT NULL,
    component_product_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(`CREATE UNIQUE INDEX idx_combo_components_unique
    ON combo_components(combo_product_id, component_product_id)`);
  const comboId = randomUUID();
  await db.execute({
    sql: "INSERT INTO products (id, code, name) VALUES (?, 'COMBO01', 'Combo 01')",
    args: [comboId],
  });
  const bookIds: string[] = [];
  for (const n of ['Jakob von Gunten', 'Törleß', 'Ferdydurke']) {
    const id = randomUUID();
    bookIds.push(id);
    await db.execute({ sql: 'INSERT INTO products (id, name) VALUES (?, ?)', args: [id, n] });
  }

  const r1 = await seedCombos(SCRATCH);
  const r2 = await seedCombos(SCRATCH);
  const rows = await db.execute('SELECT COUNT(*) AS c FROM combo_components');
  const count = Number((rows.rows[0] as any).c);

  let fail = 0;
  const check = (name: string, cond: boolean) => {
    console.log((cond ? 'PASS' : 'FAIL') + ': ' + name);
    if (!cond) fail++;
  };
  check('lan 1 insert du 3 dong COMBO01', r1.inserted === 3);
  check('lan 2 idempotent (inserted=0)', r2.inserted === 0);
  check('tong bang = 3', count === 3);
  check('combo thieu du lieu duoc skipped', r1.skipped.length > 0);
  const compIds = (
    await db.execute({
      sql: 'SELECT component_product_id AS id FROM combo_components',
      args: [],
    })
  ).rows.map((r: any) => r.id);
  check(
    'component dung 3 sach',
    bookIds.every((id) => compIds.includes(id))
  );

  db.close();
  await new Promise((r) => setTimeout(r, 100));
  try {
    fs.unlinkSync('formapubli_test_combo_seed.db');
  } catch {
    /* Windows giu lock: bao de operator xoa tay, khong fail test */
    console.log('NOTE: khong xoa duoc file scratch (lock), bo qua.');
  }
  if (fail > 0) {
    console.error(`${fail} test FAILED`);
    process.exit(1);
  }
  console.log('Seed combo test: tat ca xanh.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
