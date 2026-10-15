/**
 * Seed combo_components cho 9 combo COMBO01-09.
 * - Tim combo theo products.code, tim thanh phan theo products.name CHINH XAC.
 * - INSERT OR IGNORE: chay lai an toan, thieu du lieu thi bao warn + bo qua (khong fail).
 * - DB mac dinh: file:formapubli.db (chay tren server voi dev.db that).
 *   Test: DATABASE_URL=file:<scratch> (xem scripts/test-combo-seed.ts).
 */
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';

export const COMBO_DEFS: Array<{ code: string; components: string[] }> = [
  { code: 'COMBO01', components: ['Jakob von Gunten', 'Törleß', 'Ferdydurke'] },
  { code: 'COMBO02', components: ['May', 'Người lính tốt'] },
  { code: 'COMBO03', components: ['Tristram Shandy', 'Ông cha đạo ở Wakefield'] },
  { code: 'COMBO04', components: ['Nhà xứ cũ', 'Chuyện các bà vợ già'] },
  { code: 'COMBO05', components: ['Tay điệp viên', 'Một người tên là Thứ Năm'] },
  { code: 'COMBO06', components: ['Anh em Tanner', 'Hotel Savoy'] },
  { code: 'COMBO07', components: ['Hành khúc Radetzky', 'Một vụ việc ám muội'] },
  { code: 'COMBO08', components: ['Jakob von Gunten', 'Anh em Tanner', 'Người phụ tá'] },
  { code: 'COMBO09', components: ['Hành khúc Radetzky', 'Hotel Savoy', 'Job'] },
];

export async function seedCombos(dbUrl: string): Promise<{ inserted: number; skipped: string[] }> {
  const db = createClient({ url: dbUrl });
  let inserted = 0;
  const skipped: string[] = [];
  for (const def of COMBO_DEFS) {
    const comboRows = await db.execute({
      sql: "SELECT id FROM products WHERE code = ? LIMIT 1",
      args: [def.code],
    });
    if (comboRows.rows.length === 0) {
      skipped.push(`${def.code}: khong tim thay combo`);
      continue;
    }
    const comboId = comboRows.rows[0].id as string;
    for (const name of def.components) {
      const compRows = await db.execute({
        sql: 'SELECT id FROM products WHERE name = ? LIMIT 1',
        args: [name],
      });
      if (compRows.rows.length === 0) {
        skipped.push(`${def.code}: khong tim thay sach "${name}"`);
        continue;
      }
      const res = await db.execute({
        sql: `INSERT OR IGNORE INTO combo_components (id, combo_product_id, component_product_id, quantity)
              VALUES (?, ?, ?, 1)`,
        args: [randomUUID(), comboId, compRows.rows[0].id as string],
      });
      inserted += Number(res.rowsAffected || 0);
    }
  }
  db.close();
  return { inserted, skipped };
}

async function main() {
  const url = process.env.DATABASE_URL || 'file:formapubli.db';
  const { inserted, skipped } = await seedCombos(url);
  console.log(`Seed combo: inserted=${inserted}`);
  for (const s of skipped) console.log(`  WARN: ${s}`);
}

if (process.argv[1]?.endsWith('seed-combo-components.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
