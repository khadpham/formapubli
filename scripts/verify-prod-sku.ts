import fs from 'node:fs';
import { createClient } from '@libsql/client';

/** XÁC MINH SAU MIGRATION TRÊN PRODUCTION — chỉ đọc. */
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
  const q = async (sql: string, ...args: any[]) => (await db.execute({ sql, args })).rows;
  let bad = 0;
  const check = (cond: boolean, msg: string) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) bad++;
  };

  console.log('=== TOAN VEN ===');
  const n = await q(`SELECT COUNT(*) n FROM editions`);
  check(Number(n[0].n) === 88, `88 ấn bản (thực tế ${n[0].n})`);
  const o = await q(`SELECT COUNT(*) n FROM orders`);
  check(Number(o[0].n) === 22, `22 đơn còn nguyên (thực tế ${o[0].n})`);
  const w = await q(`SELECT COUNT(*) n FROM works`);
  check(Number(w[0].n) === 87, `87 tác phẩm (thực tế ${w[0].n})`);
  const sb = await q(`SELECT COUNT(*) n FROM stock_balances`);
  // 405 bản ghi cũ + 7 sách mới × 5 kho = 35 ⇒ 440. Trước đây tôi assert 405 và
  // báo FAIL dù dữ liệu ĐÚNG — số bản ghi tăng chính là do 7 sách mới.
  check(Number(sb[0].n) === 440, `440 bản ghi tồn kho (405 cũ + 7 sách mới × 5 kho) — thực tế ${sb[0].n}`);
  const neg = await q(`SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`);
  check(Number(neg[0].n) === 0, `0 tồn kho âm (thực tế ${neg[0].n})`);

  console.log('\n=== KHOA NGOAI / THAM CHIEU ===');
  const fk = await q(`PRAGMA foreign_key_check`);
  check(fk.length === 0, `không vi phạm khoá ngoại (${fk.length})`);
  const orphan = await q(
    `SELECT COUNT(*) n FROM order_items i LEFT JOIN editions e ON e.id = i.edition_id WHERE e.id IS NULL`
  );
  check(Number(orphan[0].n) === 0, `order_items không mồ côi (${orphan[0].n})`);
  const dup = await q(`SELECT code, COUNT(*) n FROM editions GROUP BY code HAVING n > 1`);
  check(dup.length === 0, `mã SKU không trùng (${dup.length} nhóm trùng)`);

  console.log('\n=== DU LIEU KHONG BI MAT ===');
  // Sau khi đổi mã, KHÔNG còn mã dạng H01–H81. Mẫu đúng là: không cuốn nào có
  // mã H + 2 chữ số ≤ 81. (Lượt trước tôi viết `LIKE 'H0%' OR 'H1%'` — thiếu mẫu
  // 'H8%', nên báo FAIL nhầm dù 7 sách mới H82–H88 vẫn ở đó đúng như mong muốn.)
  const oldCodes = await q(
    `SELECT COUNT(*) n FROM editions WHERE code GLOB 'H[0-7][0-9]'`
  );
  check(Number(oldCodes[0].n) === 0, `không còn mã cũ H01–H79 (thực tế còn ${oldCodes[0].n})`);
  const newBooks = await q(`SELECT COUNT(*) n FROM editions WHERE code GLOB 'H8[2-8]'`);
  check(Number(newBooks[0].n) === 7, `đủ 7 sách mới H82–H88 (thực tế ${newBooks[0].n})`);
  const t34 = await q(`SELECT code, title FROM editions WHERE code IN ('HH001','TP0006','TP105')`);
  check(t34.length === 3, `mã mới HH001/TP0006/TP105 tồn tại (${t34.length})`);
  const t34b = await q(`SELECT COUNT(*) n FROM editions WHERE id = 'ed-h01'`);
  check(Number(t34b[0].n) === 1, `ed-h01 vẫn giữ nguyên id (đơn cũ không đứt liên kết)`);

  console.log('\n=== ISBN ===');
  // H85 "Đốt kho" TRÙNG tựa với TP104 và có ISBN 14 số. User nói "tạm thời cho
  // phép trùng" nên giữ nguyên, KHÔNG tự bịa số. Ghi rõ để không quên.
  const badIsbn = await q(
    `SELECT code, isbn FROM editions WHERE isbn NOT GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'`
  );
  const expectedLeft = badIsbn.length === 1 && (badIsbn[0] as any).code === 'H85';
  check(
    expectedLeft,
    `chỉ còn đúng 1 ISBN chưa chuẩn (H85, chờ user) — thực tế ${badIsbn.length}`
  );
  badIsbn.slice(0, 5).forEach((r: any) => console.log(`        ${r.code} = '${r.isbn}'`));

  // isbnLast4 phải khớp 4 số cuối — quét mã vạch dựa vào cột này.
  const mismatch = await q(
    `SELECT code FROM editions WHERE isbn_last4 <> substr(isbn, -4)`
  );
  check(mismatch.length === 0, `isbnLast4 khớp 4 số cuối của ISBN (${mismatch.length} lệch)`);

  console.log('\n=== 4 CUON DAC BIET ===');
  for (const t of [
    'Tên mọi trên tàu Narcissus',
    'Job, tiểu thuyết về một người thuần hậu',
    'Lý thuyết tầng lớp nhàn rỗi',
    'Một người tên là Thứ Năm',
  ]) {
    const r = await q(`SELECT code FROM editions WHERE title = ?`, t);
    check(r.length === 1, `${r[0]?.code || 'THIEU'} — ${t}`);
  }

  console.log(`\n${bad === 0 ? '✅ PRODUCTION KHOE' : `❌ ${bad} KIỂM TRA ĐỎ`}`);
}
main()
  .then(() => { process.exit(0); })
  .catch((e) => { console.error('\n❌', e.message); process.exit(1); });
