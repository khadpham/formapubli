/**
 * SỬA DỮ LIỆU: ISBN sai của ấn bản `ed-h66` — "Tristram Shandy" (mã TP0030).
 *
 * VÌ SAO SỬA:
 *   DB lưu `9786044449689` — SAI SỐ KIỂM (12 số đầu ép số kiểm là `5`, không
 *   phải `9`). Mã vạch in thật trên sách là `9786044449869`: checksum hợp lệ,
 *   tiền tố 978+604 = NXB Hà Nội (khớp dòng TP0027 `9786044449845` và
 *   TP0048 `9786044449852` ngay cùng dải).
 *
 *   Chủ doanh nghiệp đã cầm sách và đọc mã vạch, xác nhận 13 chữ số này.
 *
 *   Lỗi là ĐẢO cặp số ở vị trí 11–12 (`68` ↔ `86`) — đúng dạng lỗi đã gặp ở
 *   `ed-h41` (`9768049679377` → `9786049679377`). Cùng một kiểu nhập tay.
 *
 *   ⚠️ Mã `9786044449685` từng được SUY RA từ checksum 12 số đầu và là HỢP LỆ
 *   về checksum — nhưng SAI thật, vì lỗi nằm ở 12 số đầu chứ không phải ở số
 *   kiểm. Không được dùng lại cách suy đoán này.
 *
 * AN TOÀN:
 *   · Idempotent — chạy lại vẫn OK.
 *   · Chỉ sửa `ed-h66`. KHÔNG đụng `ed-h85` (chủ bảo bỏ qua) và `ed-h41`
 *     (đã đúng sẵn).
 *   · Sửa CẢ `isbn_last4` vì 4 số cuối đổi `9689` → `9869`. Không sửa thì
 *     cột tra cứu nhanh (`idx_editions_isbn_last4`) và nhãn "Đuối:" trong UI
 *     sẽ hiện sai. `seed.ts:180` tự suy `isbn.slice(-4)` nên phải khớp.
 *   · Mặc định DRY-RUN. Muốn ghi thật thì đặt ALLOW_REMOTE_TARGET=1.
 *   · In dòng trước/sau, không in secret.
 *
 * CHẠY:
 *   npx tsx scripts/fix-isbn-ed-h66-prod.ts            (xem, không ghi)
 *   $env:ALLOW_REMOTE_TARGET='1'; npx tsx scripts/fix-isbn-ed-h66-prod.ts
 */
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const EDITION_ID = 'ed-h66';
const WRONG = '9786044449689';
const RIGHT = '9786044449869';
const APPLY = process.env.ALLOW_REMOTE_TARGET === '1';

/** Số kiểm ISBN-13: 12 số đầu, trọng số 1,3 xen kẽ. */
function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

const env = fs.readFileSync('.env', 'utf8');
const url = env.match(/^TURSO_DATABASE_URL=(.+)$/m)?.[1]?.trim();
const token = env.match(/^TURSO_AUTH_TOKEN=(.+)$/m)?.[1]?.trim();
if (!url) throw new Error('không thấy TURSO_DATABASE_URL trong .env');
if (!/libsql:\/\//.test(url) && !/turso/.test(url)) {
  throw new Error(`từ chối chạy: URL không phải Turso production (${url.slice(0, 12)}…)`);
}

const db = createClient({ url, authToken: token });

async function main() {
  // Chặn sai ngay ở đầu: nếu mã đích không hợp lệ checksum thì đừng ghi gì cả.
  if (isbn13CheckDigit(RIGHT.slice(0, 12)) !== Number(RIGHT[12])) {
    throw new Error(`mã đích ${RIGHT} không hợp lệ checksum — từ chối ghi.`);
  }
  console.log(`checksum ${RIGHT}: hợp lệ ✓ (mã cũ ${WRONG} sai, phải là ${WRONG.slice(0, 12)}${isbn13CheckDigit(WRONG.slice(0, 12))})`);

  // Không cho đè lên ấn bản khác.
  const clash = await db.execute({ sql: 'SELECT id, code FROM editions WHERE isbn = ? AND id <> ?', args: [RIGHT, EDITION_ID] });
  if (clash.rows.length) throw new Error(`mã đích đã thuộc ấn bản khác: ${JSON.stringify(clash.rows)} — từ chối ghi.`);

  const before = await db.execute({
    sql: 'SELECT e.id, e.code, e.isbn, e.isbn_last4, w.title FROM editions e LEFT JOIN works w ON w.id = e.work_id WHERE e.id = ?',
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
    console.log(`\n🔎 DRY-RUN: sẽ sửa ${EDITION_ID} isbn "${WRONG}" → "${RIGHT}", isbn_last4 "9689" → "9869".`);
    console.log('   Đặt ALLOW_REMOTE_TARGET=1 để ghi thật.');
    return;
  }

  await db.execute({
    sql: 'UPDATE editions SET isbn = ?, isbn_last4 = ? WHERE id = ? AND isbn = ?',
    args: [RIGHT, RIGHT.slice(-4), EDITION_ID, WRONG],
  });

  const after = await db.execute({
    sql: 'SELECT e.id, e.code, e.isbn, e.isbn_last4 FROM editions e WHERE e.id = ?',
    args: [EDITION_ID],
  });
  console.log('SAU   :', JSON.stringify(after.rows));

  // `products` KHÔNG có cột isbn (POS lấy qua LEFT JOIN editions) nên không
  // cần mirror. Chỉ kiểm tồn không bị đụng.
  const stock = await db.execute({
    sql: 'SELECT COUNT(*) rows_, COALESCE(SUM(physical_quantity),0) tong_ton FROM stock_balances WHERE product_id = ?',
    args: [EDITION_ID],
  });
  console.log('tồn của sách (không bị đụng):', JSON.stringify(stock.rows));
  console.log(`\n✅ Đã sửa ${EDITION_ID}: ${WRONG} → ${RIGHT}`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});