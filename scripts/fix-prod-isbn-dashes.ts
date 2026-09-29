import fs from 'node:fs';
import { createClient } from '@libsql/client';

/**
 * Sửa ISBN có DẤU GẠCH trên production.
 *
 * `978-632-03-1841-4` là ISBN-13 hợp lệ khi bỏ dấu, nhưng đang lưu kèm dấu nên
 * quét mã vạch KHÔNG khớp (POS so `isbnLast4` và so chuỗi). Cùng loại lỗi với
 * trường hợp "xoá khoảng trắng" mà user đã yêu cầu.
 *
 * Chỉ sửa cuốn bỏ dấu ra ĐÚNG 13 chữ số. Cuốn 14 số sẽ bị BỎ QUA và báo lại để
 * user cung cấp ISBN thật — không tự bịa.
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

async function main() {
  const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
  const q = async (sql: string, ...a: any[]) => (await db.execute({ sql, args: a })).rows;

  const bad = (await q(
    `SELECT code, title, isbn, isbn_last4 FROM editions
     WHERE isbn NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
     ORDER BY code`
  )) as any[];

  let fixed = 0;
  const skipped: string[] = [];
  for (const r of bad) {
    const cleaned = String(r.isbn).replace(/[^0-9]/g, '');
    if (cleaned.length !== 13) {
      skipped.push(`${r.code} = '${r.isbn}' -> '${cleaned}' (${cleaned.length} số, CẦN ISBN THẬT)`);
      continue;
    }
    const last4 = cleaned.slice(-4);
    await db.execute({
      sql: `UPDATE editions SET isbn = ?, isbn_last4 = ? WHERE code = ?`,
      args: [cleaned, last4, r.code],
    });
    console.log(`  ✅ ${r.code.padEnd(9)} '${r.isbn}' -> '${cleaned}' (last4: ${r.last4} -> ${last4})`);
    fixed++;
  }

  console.log(`\nĐã sửa ${fixed}/${bad.length}.`);
  if (skipped.length) {
    console.log('BỎ QUA (cần user cung cấp):');
    skipped.forEach((s) => console.log('  ⚠️ ' + s));
  }

  const left = await q(
    `SELECT code, isbn FROM editions
     WHERE isbn NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`
  );
  console.log(`\nCòn lại ISBN chưa đúng 13 số: ${left.length}`);
  left.forEach((r: any) => console.log(`   ${r.code} = '${r.isbn}'`));

  // isbnLast4 phải khớp 4 số cuối của isbn
  const mismatch = await q(
    `SELECT code, isbn, isbn_last4 FROM editions WHERE isbn_last4 <> substr(isbn, -4)`
  );
  console.log(`isbnLast4 lệch với ISBN: ${mismatch.length}`);
  mismatch.slice(0, 5).forEach((r: any) => console.log(`   ${r.code}: isbn='${r.isbn}' last4='${r.isbn_last4}'`));
}
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });
