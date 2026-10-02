/**
 * SỬA DỮ LIỆU: ISBN sai của ấn bản `ed-h41` — "Cháu trai Wittgenstein" (HH034).
 *
 * VÌ SAO SỬA:
 *   DB lưu `9768049679377` — tiền tố 976 không tồn tại trong ISBN-13 và checksum
 *   sai. Mã vạch in trên sách là `9786049679377` (checksum hợp lệ, tiền tố
 *   978+604 = NXB Hà Nội; dòng HH040 ngay dưới cùng NXB có `9786049679421`
 *   — cùng dải 9786049679). Người dùng quét mã thật trên sách xác nhận.
 *   Sai sót là ĐẢO SỐ thứ 3 và thứ 4 (`68` ↔ `86`) khi nhập tay.
 *
 * AN TOÀN:
 *   · Idempotent — chạy lại vẫn OK, chỉ sửa dòng đang sai.
 *   · Chỉ sửa `ed-h41`. KHÔNG đụng `ed-h66` (chỉ sai số kiểm, cần quét sách
 *     xác nhận) và `ed-h85` (tái bản, chủ sẽ tự cập nhật sau).
 *   · `isbn_last4` giữ nguyên vì 4 số cuối không đổi (9377).
 *   · Mặc định DRY-RUN. Muốn ghi thật thì đặt ALLOW_REMOTE_TARGET=1.
 *   · In ra dòng trước/sau, không in secret.
 *
 * CHẠY:
 *   npx tsx scripts/fix-isbn-ed-h41-prod.ts            (xem, không ghi)
 *   $env:ALLOW_REMOTE_TARGET='1'; npx tsx scripts/fix-isbn-ed-h41-prod.ts
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const EDITION_ID = 'ed-h41';
const WRONG = '9768049679377';
const RIGHT = '9786049679377';
const APPLY = process.env.ALLOW_REMOTE_TARGET === '1';

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^TURSO_DATABASE_URL=(.+)$/m)?.[1]?.trim();
const token = env.match(/^TURSO_AUTH_TOKEN=(.+)$/m)?.[1]?.trim();
if (!url) throw new Error('không thấy TURSO_DATABASE_URL trong .env');
if (!/libsql:\/\//.test(url) && !/turso/.test(url)) {
  throw new Error(`từ chối chạy: URL không phải Turso production (${url.slice(0, 12)}…)`);
}

const db = createClient({ url, authToken: token });

async function main() {
  const before = await db.execute({
    sql: 'SELECT e.id, e.isbn, e.isbn_last4, w.title FROM editions e LEFT JOIN works w ON w.id = e.work_id WHERE e.id = ?',
    args: [EDITION_ID],
  });
  console.log('TRƯỚC:', JSON.stringify(before.rows));
  if (before.rows.length !== 1) throw new Error(`không tìm thấy đúng 1 ấn bản ${EDITION_ID}`);

  const cur = String((before.rows[0] as any).isbn);
  if (cur === RIGHT) {
    console.log(`✅ ${EDITION_ID} đã đúng (${RIGHT}) — không cần sửa.`);
    return;
  }
  if (cur !== WRONG) {
    throw new Error(`từ chối sửa: ${EDITION_ID} đang là "${cur}", không phải "${WRONG}" cần sửa.`);
  }

  if (!APPLY) {
    console.log(`\n🔎 DRY-RUN: sẽ sửa ${EDITION_ID} "${WRONG}" → "${RIGHT}".`);
    console.log('   Đặt ALLOW_REMOTE_TARGET=1 để ghi thật.');
    return;
  }

  await db.execute({ sql: 'UPDATE editions SET isbn = ? WHERE id = ? AND isbn = ?', args: [RIGHT, EDITION_ID, WRONG] });

  const after = await db.execute({
    sql: 'SELECT e.id, e.isbn, e.isbn_last4 FROM editions e WHERE e.id = ?',
    args: [EDITION_ID],
  });
  console.log('SAU   :', JSON.stringify(after.rows));

  // `products` KHÔNG có cột isbn (POS lấy qua LEFT JOIN editions) nên không
  // cần mirror. Chỉ kiểm tồn không bị đụng.
  const stock = await db.execute({ sql: 'SELECT COUNT(*) c FROM stock_balances WHERE product_id = ?', args: [EDITION_ID] });
  console.log('tồn của sách (không bị đụng):', JSON.stringify(stock.rows));
  console.log(`\n✅ Đã sửa ${EDITION_ID}: ${WRONG} → ${RIGHT}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});