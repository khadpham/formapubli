import fs from 'node:fs';
import { createClient } from '@libsql/client';
import {
  isbnBlockReason,
  isbnDuplicateReason,
  ISBN_EXEMPTIONS,
  ISBN_DUPLICATE_EXEMPTIONS,
} from '../src/lib/isbn';

/**
 * HEALTH CHECK PRODUCTION — chỉ đọc, không ghi gì.
 *
 * Chạy TRƯỚC mỗi hội chợ. Đây là cổng hỏi "dữ liệu còn đúng không", KHÔNG phải
 * kiểm tra "sau migration một lần" — nên ở đây KHÔNG có con số gắn cứng nào.
 * Trước đây gắn `88 ấn bản / 22 đơn / 440 dòng tồn` và báo đỏ chỉ vì đơn đã
 * >100: script báo hỏng chứ không phát hiện hỏng. Mọi khẳng định ở đây phải đúng
 * mãi mãi khi nghiệp vụ lớn lên.
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
  const q = async (sql: string, ...args: any[]) => (await db.execute({ sql, args })).rows;
  let bad = 0;
  const check = (cond: boolean, msg: string) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!cond) bad++;
  };

  console.log('=== TOAN VEN ===');
  // KHÔNG gắn con số: danh mục/đơn/tồn lớn dần theo thời gian, gắn số ⇒ báo đỏ
  // giả. Chỉ kiểm tra thứ KHÔNG được xảy ra.
  const n = await q(`SELECT COUNT(*) n FROM editions`);
  check(Number(n[0].n) > 0, `danh mục ấn bản không rỗng (thực tế ${n[0].n})`);
  const w = await q(`SELECT COUNT(*) n FROM works`);
  check(Number(w[0].n) > 0, `danh mục tác phẩm không rỗng (thực tế ${w[0].n})`);
  const neg = await q(`SELECT COUNT(*) n FROM stock_balances WHERE physical_quantity < 0`);
  check(Number(neg[0].n) === 0, `0 tồn kho âm (thực tế ${neg[0].n})`);

  console.log('\n=== KHOA NGOAI / THAM CHIEU ===');
  const fk = await q(`PRAGMA foreign_key_check`);
  check(fk.length === 0, `không vi phạm khoá ngoại (${fk.length})`);
  // Dòng quà hàng hóa có `edition_id = NULL` CỐ Ý (quà áp sẵn theo chương
  // trình, không phải ấn bản sách) — 95 dòng trên production. Check cũ quên
  // điều này nên báo ĐỎ GIẢ ("95 mồ côi") trên chính dữ liệu đúng. Chỉ dòng
  // CÓ `edition_id` mà trỏ vào ấn bản không tồn tại mới là mồ côi thật.
  const orphan = await q(
    `SELECT COUNT(*) n FROM order_items i
       LEFT JOIN editions e ON e.id = i.edition_id
      WHERE i.edition_id IS NOT NULL AND e.id IS NULL`
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
  const t34b = await q(`SELECT COUNT(*) n FROM editions WHERE id = 'ed-h01'`);
  check(Number(t34b[0].n) === 1, `ed-h01 vẫn giữ nguyên id (đơn cũ không đứt liên kết)`);

  console.log('\n=== ISBN ===');
  // 1. SAI CHỈNH SỐ KIỂM / sai độ dài ⇒ ĐỎ, trừ mã trong `ISBN_EXEMPTIONS`
  // (mỗi mục ghi rõ lý do). H85 "Đốt kho" là mã 14 số, chủ bảo bỏ qua 03/10/2026
  // — KHÔNG tự bịa số thay cho NXB.
  const allIsbn = await q(`SELECT code, isbn FROM editions WHERE isbn IS NOT NULL`);
  const badIsbn = (allIsbn as any[]).filter((r) => isbnBlockReason(r.isbn));
  check(
    badIsbn.length === 0,
    `mọi ISBN đều 13 số + số kiểm khớp (trừ danh sách miễn) — thực tế ${badIsbn.length} lỗi`
  );
  for (const r of badIsbn.slice(0, 10)) {
    console.log(`        ${r.code} = '${r.isbn}' — ${isbnBlockReason(r.isbn)}`);
  }
  // Danh sách miễn phải "còn sống": mỗi mã miễn phải thật sự tồn tại trong DB,
  // nếu không thì miễn đó chỉ là dòng chết che mất một lỗi sắp xảy ra.
  for (const isbn of Object.keys(ISBN_EXEMPTIONS)) {
    const hit = (allIsbn as any[]).filter((r) => r.isbn === isbn);
    check(hit.length > 0, `mã miễn ${isbn} còn tồn tại trong danh mục (${hit.map((h) => h.code).join('/') || 'KHÔNG — miễn đã chết'})`);
  }

  // 2. TRÙNG ISBN — hợp lệ (NXB tái bản chung mã) nên KHÔNG chặn, nhưng cặp mới
  //    xuất hiện thì ĐỎ: có nghĩa là ai đó vừa nhập trùng mà không biết.
  const dupIsbn = await q(
    `SELECT isbn, COUNT(*) n FROM editions WHERE isbn IS NOT NULL GROUP BY isbn HAVING n > 1`
  );
  for (const row of dupIsbn as any[]) {
    const reason = isbnDuplicateReason(row.isbn);
    check(
      Boolean(reason),
      reason
        ? `ISBN trùng đã xác minh: ${row.isbn} x${row.n}`
        : `ISBN trùng CHƯA TỪNG BIẾT ${row.isbn} x${row.n} — cần xác minh rồi ghi lý do vào ISBN_DUPLICATE_EXEMPTIONS`
    );
  }
  for (const isbn of Object.keys(ISBN_DUPLICATE_EXEMPTIONS)) {
    const hit = dupIsbn.find((d: any) => d.isbn === isbn);
    if (!hit) {
      console.log(`        ℹ️  ${isbn} đã nằm trong danh sách miễn nhưng DB không còn cặp trùng nào — xoá khỏi ISBN_DUPLICATE_EXEMPTIONS`);
    }
  }

  // Tiền đề của mọi thứ liên quan tới quét trùng ISBN: các bản trùng phải KHÁC
  // NHAU Ở TÊN. `HH032` = "(Bìa tím)" và `HH042` = "(Tái bản) - Bìa trắng" là
  // tiêu chí duy nhất để thu ngân chọn đúng (works.title thì cả hai đều là
  // "Le Spleen de Paris"). Ai đó sửa `editions.title` cho giống nhau là modal
  // thành vô dụng, mà không có gì đỏ.
  for (const row of dupIsbn as any[]) {
    const names = (await q(`SELECT code, title FROM editions WHERE isbn = ? ORDER BY code`, row.isbn)) as any[];
    const titles = new Set(names.map((n) => (n.title || '').trim()));
    check(
      titles.size === names.length,
      `các ấn bản trùng ISBN ${row.isbn} có TÊN KHÁC NHAU (${names.length} bản, ${titles.size} tên) — giống nhau là modal mù`
    );
    names.forEach((n) => console.log(`        ${n.code}: "${n.title}"`));
  }

  // 3. DOANH SỐ TÁCH THEO ẤN BẢN (90 ngày). Đây là câu trả lời cho câu hỏi
  //    "có nên tạo mặc định tĩnh cho ISBN trùng không?" — quyết bằng số liệu bán
  //    hàng thật, không đoán. Ghi ra file để so sánh qua các kỳ hội chợ.
  if (dupIsbn.length > 0) {
    console.log('\n--- Doanh số 90 ngày, tách theo ấn bản (quyết định mặc định tĩnh) ---');
    for (const row of dupIsbn as any[]) {
      const reason = isbnDuplicateReason(row.isbn);
      if (reason) console.log(`        miễn: ${reason}`);
      const s = await q(
        `SELECT e.code, e.publication_year, e.cover_price,
                COALESCE(SUM(CASE WHEN o.status = 'COMPLETED'
                                   AND o.created_at >= datetime('now','-90 days')
                                  THEN i.quantity ELSE 0 END),0) qty,
                COUNT(DISTINCT CASE WHEN o.status = 'COMPLETED'
                                     AND o.created_at >= datetime('now','-90 days')
                                    THEN o.id END) don
           FROM editions e
           LEFT JOIN order_items i ON i.edition_id = e.id
           LEFT JOIN orders o ON o.id = i.order_id
          WHERE e.isbn = ?
          GROUP BY e.id
          ORDER BY qty DESC`,
        row.isbn
      );
      for (const r of s as any[]) {
        console.log(`        ${row.isbn} · ${r.code} · ${r.publication_year} · ${r.cover_price}đ → ${r.qty} cuốn / ${r.don} đơn`);
      }
    }
  }

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
