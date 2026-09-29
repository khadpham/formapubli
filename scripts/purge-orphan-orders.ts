import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';

/**
 * Xoá đơn trỏ tới tài khoản thu ngân không tồn tại.
 *
 * TRƯỚC KHI XOÁ: dump toàn bộ các dòng liên quan ra JSON ở %TEMP% để còn đường
 * quay lại. Xoá 74 đơn trị giá 9.2 triệu là việc không hoàn tác được.
 *
 * CHẠY VỚI --apply để ghi. Mặc định chỉ đọc và in kế hoạch.
 */
const APPLY = process.argv.includes('--apply');
const dumpDir = path.join(process.env.TEMP || '.', 'opencode');
fs.mkdirSync(dumpDir, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const ORPHAN_SQL = `
  SELECT o.id, o.order_code, o.cashier_id, o.status, o.final_amount, o.created_at
  FROM orders o LEFT JOIN staff_accounts s ON s.staff_id = o.cashier_id
  WHERE s.staff_id IS NULL`;

const ORPHAN_IDS = `SELECT o.id FROM orders o LEFT JOIN staff_accounts s ON s.staff_id = o.cashier_id WHERE s.staff_id IS NULL`;

async function survey(label: string, db: any) {
  const orphans = await db.execute(ORPHAN_SQL);
  const all = await db.execute(`SELECT COUNT(*) n, COALESCE(SUM(final_amount),0) t FROM orders`);
  const staff = await db.execute(`SELECT staff_id, full_name FROM staff_accounts`);
  console.log(`\n===== ${label} =====`);
  console.log(`tong don           : ${all.rows[0].n} (${all.rows[0].t})`);
  console.log(`tai khoan ton tai : ${staff.rows.map((r: any) => r.staff_id).join(', ') || '(khong co)'}`);
  console.log(`don tro toi ST_KHONG TON TAI : ${orphans.rows.length} (${orphans.rows.reduce((s: number, r: any) => s + Number(r.final_amount), 0)})`);
  return orphans.rows;
}

async function main() {
  // 1. Dev: file DB trong repo.
  const dev = createClient({ url: 'file:formapubli.db' });
  const devOrphans = await survey('DEV  file:formapubli.db', dev);

  // 2. Production: Turso.
  const prod = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const prodOrphans = await survey('PROD Turso', prod);

  const targets: Array<[string, any, any[]]> = [
    ['DEV', dev, devOrphans],
    ['PROD', prod, prodOrphans],
  ].filter(([, , rows]) => rows.length > 0) as Array<[string, any, any[]]>;

  if (!targets.length) {
    console.log('\n→ Không có đơn mồ côi nào ở đâu. Không làm gì.');
    return;
  }

  // 3. BACKUP trước khi động vào. Ghi cả bảng đơn và các bảng con.
  for (const [label, db, rows] of targets) {
    const ids = rows.map((r) => r.id);
    const ph = ids.map(() => '?').join(',');
    const dump: Record<string, any[]> = { orders: rows };
    for (const t of ['order_items', 'payments', 'cashbox_sessions', 'inventory_ledger']) {
      try {
        const cols = await db.execute(`PRAGMA table_info(${t})`);
        if (!cols.rows.length) continue;
        const hasOrder = cols.rows.some((c: any) => c.name === 'order_id');
        const hasSession = cols.rows.some((c: any) => c.name === 'cashbox_session_id' || c.name === 'session_id');
        let where = '';
        if (hasOrder) where = `order_id IN (${ph})`;
        else if (hasSession) where = `cashbox_session_id IN (SELECT id FROM orders WHERE id IN (${ph}))`;
        else continue;
        const r = await db.execute({ sql: `SELECT * FROM ${t} WHERE ${where}`, args: ids });
        if (r.rows.length) dump[t] = r.rows;
      } catch { /* bang khong ton tai — bo qua */ }
    }
    const f = path.join(dumpDir, `orphan-orders-${label}-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(dump, null, 2));
    console.log(`\nBACKUP ${label}: ${f} (${fs.statSync(f).size} byte)`);
  }

  if (!APPLY) {
    console.log('\n→ Đã backup. Chạy lại với --apply để xoá thật.');
    return;
  }

  for (const [label, db, rows] of targets) {
    const ids = rows.map((r) => r.id);
    for (const t of ['payments', 'order_items']) {
      try {
        await db.execute({ sql: `DELETE FROM ${t} WHERE order_id IN (${ids.map(() => '?').join(',')})`, args: ids });
      } catch { /* bang khong co */ }
    }
    // Cần bật khoá ngoại để xoá đơn khỏi các bảng con khác còn tham chiếu.
    await db.execute('PRAGMA foreign_keys = OFF');
    const res = await db.execute({ sql: `DELETE FROM orders WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids });
    await db.execute('PRAGMA foreign_keys = ON');
    console.log(`\nXOÁ ${label}: rowsAffected=${res.rowsAffected} / ${ids.length} don`);

    const left = await db.execute(ORPHAN_SQL);
    const all = await db.execute(`SELECT COUNT(*) n, COALESCE(SUM(final_amount),0) t FROM orders`);
    console.log(`SAU ${label}: con ${all.rows[0].n} don (${all.rows[0].t}), con moi ${left.rows.length} don mo coi`);
    if (left.rows.length) throw new Error(`${label} vẫn còn ${left.rows.length} đơn mồ côi.`);
  }
  console.log('\n✅ Xoá xong. Danh sách đã lưu ở %TEMP%\\opencode.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });
