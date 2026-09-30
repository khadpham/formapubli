import { requireProdWriteConsent } from './prod-write-guard';

requireProdWriteConsent(
  'thêm cột royalty_basis cho hợp đồng bản quyền (migration 0030)'
);

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

  const cols = (await db.execute(`PRAGMA table_info(rights_contracts)`)).rows as any[];
  const names = cols.map((c) => c.name);
  if (names.includes('royalty_basis')) {
    console.log('Cột royalty_basis đã tồn tại — không làm gì.');
  } else {
    // DEFAULT 'NET_SOLD': tính royalty theo TIỀN THỰC THU (đã trừ chiết khấu).
    // Hợp đồng nào ký trả theo GIÁ BÌA thì sửa thủ công thành 'COVER_PRICE'.
    await db.execute(
      `ALTER TABLE rights_contracts ADD COLUMN royalty_basis TEXT NOT NULL DEFAULT 'NET_SOLD'`
    );
    console.log("Đã thêm cột royalty_basis, mặc định 'NET_SOLD'.");
  }

  const after = (await db.execute(`PRAGMA table_info(rights_contracts)`)).rows as any[];
  console.log('Cột hiện tại:', after.map((c) => c.name).join(', '));

  const stats = (await db.execute(
    `SELECT royalty_basis, COUNT(*) n FROM rights_contracts GROUP BY royalty_basis`
  )).rows as any[];
  console.log('\nHợp đồng theo cơ sở tính:');
  if (!stats.length) console.log('  (chưa có hợp đồng nào)');
  for (const s of stats) console.log(`  ${s.royalty_basis}: ${s.n}`);

  console.log('\n✅ Sẵn sàng. Lưu ý: HĐ ký theo GIÁ BÌA cần sửa tay thành COVER_PRICE.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌', e.message);
    process.exit(1);
  });
