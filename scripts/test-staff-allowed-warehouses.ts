import { createClient } from '@libsql/client';
async function main() {
  const db = createClient({ url: 'file:formapubli.db' });
  const cols: any = await db.execute(`PRAGMA table_info(staff_accounts)`);
  const names = (cols.rows as any[]).map((r) => r.name);
  if (!names.includes('allowed_warehouse_ids')) {
    console.error('FAIL thieu cot allowed_warehouse_ids');
    process.exit(1);
  }
  const staff: any = await db.execute(`SELECT staff_id, allowed_warehouse_ids FROM staff_accounts`);
  for (const r of staff.rows as any[]) {
    const v = JSON.parse((r.allowed_warehouse_ids ?? '[]') as string);
    if (!Array.isArray(v)) { console.error(`FAIL ${r.staff_id} khong phai mang`); process.exit(1); }
  }
  console.log(`PASS cot ton tai, ${staff.rows.length} tai khoan parse duoc`);
}
main();
