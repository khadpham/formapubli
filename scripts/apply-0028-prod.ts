import fs from 'node:fs';
import { createClient } from '@libsql/client';

/**
 * Áp riêng migration `0028_daily_order_counters` lên production.
 *
 * PHẢI ÁP TRƯỚC KHI DEPLOY: code mới cấp số đơn trong bảng này. Deploy không kèm
 * migration (`npm run deploy` chỉ build + đẩy code, không chạy migrate), nên nếu
 * thiếu bảng thì POS không tạo được đơn — lỗi ngay giữa hội chợ.
 *
 * CHỈ tạo một bảng rỗng 2 cột, không đụng dữ liệu hiện có.
 */
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

import { requireProdWriteConsent } from './prod-write-guard';

  // Ghi production: phải bật cờ tường minh, xem scripts/prod-write-guard.ts.
  requireProdWriteConsent('apply-0028-prod.ts');
async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (sql: string) => (await db.execute(sql)).rows;

  const before = await q(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='daily_order_counters'`
  );
  if (before.length) {
    console.log('Bảng daily_order_counters đã tồn tại — không làm gì.');
  } else {
    await db.execute(
      `CREATE TABLE IF NOT EXISTS daily_order_counters (
         day TEXT PRIMARY KEY,
         last_seq INTEGER NOT NULL DEFAULT 0
       )`
    );
    console.log('Đã tạo bảng daily_order_counters.');
  }

  // Cấp thử một số rồi xoá: chứng minh cơ chế ON CONFLICT + RETURNING chạy được
  // trên Turso, không chỉ trên SQLite file. Dùng ngày 1970 để không đụng dữ liệu thật.
  const test = await db.execute({
    sql: `INSERT INTO daily_order_counters (day, last_seq) VALUES (?, 1)
          ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1
          RETURNING last_seq`,
    args: ['1970-01-01'],
  });
  const first = Number(test.rows[0].last_seq);
  const test2 = await db.execute({
    sql: `INSERT INTO daily_order_counters (day, last_seq) VALUES (?, 1)
          ON CONFLICT(day) DO UPDATE SET last_seq = last_seq + 1
          RETURNING last_seq`,
    args: ['1970-01-01'],
  });
  const second = Number(test2.rows[0].last_seq);
  // libsql client nhận `{ sql, args }`, không nhận 2 đối số riêng như `execute(sql, args)`.
  await db.execute({ sql: `DELETE FROM daily_order_counters WHERE day = ?`, args: ['1970-01-01'] });
  console.log(`Cơ chế cấp số trên Turso: lần 1 -> ${first}, lần 2 -> ${second}`);
  if (first !== 1 || second !== 2) throw new Error('Cơ chế cấp số KHÔNG đúng trên Turso.');

  const left = await q(`SELECT COUNT(*) n FROM daily_order_counters`);
  console.log(`Bảng còn ${left[0].n} dòng (0 = sạch sau khi thử).`);
  console.log('\n✅ SẴN SÀNG cho code mã đơn 13 ký tự.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });

