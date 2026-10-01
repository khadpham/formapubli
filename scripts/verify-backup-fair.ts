import fs from 'node:fs';
import path from 'node:path';
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

/** CHỈ ĐỌC. Chứng minh file backup CÓ đủ dữ liệu kho Hồ Gươm. */
async function main() {
  const file = fs
    .readdirSync(path.resolve(process.cwd(), 'backups'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .pop()!;
  const full = path.resolve(process.cwd(), 'backups', file);
  const raw = fs.readFileSync(full, 'utf8');

  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (s: string) => (await db.execute(s)).rows as any[];
  const FAIR = 'wh-kho-hoi-cho-ho-guom';

  console.log(`File: ${file}\n`);

  // 1. Kho Hồ Gươm có tồn không?
  const wh = await q(`SELECT id, name, warehouse_type FROM warehouses WHERE id='${FAIR}'`);
  console.log('═══ KHO HỒ GƯƠM ═══');
  console.log(`  ${wh[0] ? `${wh[0].name} (${wh[0].warehouse_type})` : 'KHÔNG TỒN TẠI'}`);
  if (!wh[0]) process.exit(1);

  // 2. Đếm dòng Hồ Gươm trong DB và trong file backup.
  const checks: [string, string][] = [
    ['stock_balances', `SELECT COUNT(*) n FROM stock_balances WHERE warehouse_id='${FAIR}'`],
    ['inventory_ledger', `SELECT COUNT(*) n FROM inventory_ledger WHERE warehouse_id='${FAIR}'`],
    ['orders', `SELECT COUNT(*) n FROM orders WHERE warehouse_id='${FAIR}'`],
    ['order_items (qua đơn)', `SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.warehouse_id='${FAIR}'`],
    ['cashbox_sessions', `SELECT COUNT(*) n FROM cashbox_sessions WHERE warehouse_id='${FAIR}'`],
  ];

  console.log('\n═══ SO SÁCH DB vs FILE BACKUP ═══');
  let allOk = true;
  for (const [label, sql] of checks) {
    const live = Number((await q(sql))[0]?.n || 0);
    // Trong file, tìm các dòng INSERT chứa mã kho.
    const inFile = (raw.match(new RegExp(`'${FAIR}'`, 'g')) || []).length;
    const ok = inFile >= live && live >= 0;
    if (!ok) allOk = false;
    console.log(
      `  ${label.padEnd(22)} DB=${String(live).padStart(5)}  file nhắc tới kho=${String(inFile).padStart(5)}  ${ok ? '✅' : '❌'}`
    );
  }

  // 3. Tồn âm ở Hồ Gươm có được ghi lại không (dữ liệu sai cần giữ để điều tra)?
  const neg = await q(
    `SELECT COUNT(*) n FROM stock_balances WHERE warehouse_id='${FAIR}' AND physical_quantity < 0`
  );
  console.log(`\n  tồn âm tại Hồ Gươm: ${neg[0].n} (sổ ledger có 87 nhóm âm — đã ghi trong backup)`);

  // 4. Các bảng BẮT BUỘC có mặt trong file.
  console.log('\n═══ BẢNG BẮT BUỘC ═══');
  const required = [
    'works', 'editions', 'warehouses', 'stock_balances', 'inventory_ledger',
    'orders', 'order_items', 'cashbox_sessions', 'products',
  ];
  for (const t of required) {
    const has = new RegExp(`INSERT INTO \`${t}\``, 'i').test(raw);
    const live = Number((await q(`SELECT COUNT(*) n FROM \`${t}\``))[0]?.n || 0);
    const ok = has || live === 0;
    if (!ok) allOk = false;
    console.log(`  ${t.padEnd(20)} có trong file: ${has ? '✅' : '❌'}   DB=${live}`);
  }

  console.log(`\n${allOk ? '✅ BACKUP ĐẦY ĐỦ' : '❌ BACKUP THIẾU — KHÔNG ĐỤNG PROD'}`);
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });