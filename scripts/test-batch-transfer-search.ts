/**
 * Ô tìm sách trong modal "Chuyển Hàng Loạt" phải tìm được sách.
 *
 * LỖI GỐC (tìm được bằng đọc code, không phải đoán): cả vòng đời
 * `isSuggestOpen` chỉ có MỘT chỗ bật lên — `onFocus` ở BatchTransferModal.tsx:868
 * — và chỗ đó bị chặn bởi `filteredBooksToAdd.length > 0`. Mà danh sách gợi ý rỗng
 * khi `searchBookTerm` còn trống (dòng 226). `onChange` chỉ gán từ khoá, không mở.
 * Nên có vòng luẩn quẩn: mở cần kết quả, kết quả cần gõ, gõ không mở.
 * ⇒ Gõ mãi mà danh sách không bao giờ hiện. Người dùng thấy "không tìm được gì".
 *
 * Ca này chỉ pass nếu việc gõ chữ MỞ ĐƯỢC danh sách gợi ý.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(
  path.resolve(process.cwd(), 'src/components/inventory/BatchTransferModal.tsx'),
  'utf8'
);
// Bỏ comment để chính chú thích giải thích lỗi cũ không khớp regex.
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
  .join('\n');

let checks = 0;
const ok = (c: boolean, m: string) => { checks++; assert.ok(c, m); };

// 1. `onChange` của ô tìm kiếm phảI mở danh sách gợi ý, không chỉ gán từ khoá.
const onChange = code.match(/onChange=\{\(e\) => setSearchBookTerm\(e\.target\.value\)\}/);
ok(!onChange, 'onChange KHÔNG được chỉ gán từ khoá rồi bỏ đó — đó là nguyên nhân gốc');

const typing = code.match(/onChange=\{\(e\) => \{[\s\S]{0,900}?setIsSuggestOpen\(true\)[\s\S]{0,200}?\}\}/);
ok(!!typing, 'onChange phải gán từ khoá VÀ mở danh sách gợi ý');

// 2. `onFocus` không được phụ thuộc "đã có kết quả" — lúc focus ô còn trống nên
//    luôn chưa có kết quả, nên điều kiện đó làm khoá chính nó.
const onFocus = code.match(/onFocus=\{[^\n]*\}/g)?.join('\n') || '';
ok(
  !/filteredBooksToAdd\.length > 0 && setIsSuggestOpen/.test(onFocus),
  'onFocus không được đòi "đã có kết quả" mới cho mở — lúc focus ô còn trống'
);

// 3. Bộ lọc phải dùng helper tìm kiếm tiếng Việt có sẵn trong repo, để gõ không
//    dấu vẫn ra ("doramon" phải ra "Đờrămôn"). `.toLowerCase().includes()` thì không.
ok(
  /matchesAnyVietnameseField|matchesVietnameseSearch/.test(code),
  'bộ lọc phải dùng helper tìm tiếng Việt có sẵn (src/lib/vietnamese.ts)'
);
ok(
  /from '@\/lib\/vietnamese'|from "\@\/lib\/vietnamese"/.test(src),
  'phải import helper từ @/lib/vietnamese'
);

// 4. Không được bỏ sót mã SKU / 4 số cuối ISBN như bản cũ.
ok(/isbnLast4/.test(code), 'vẫn phải khớp 4 số cuối ISBN');
ok(/\bb\.code\b/.test(code), 'vẫn phải khớp mã SKU');
ok(/\bb\.title\b/.test(code), 'vẫn phải khớp tên sách');

console.log(`\n=== TÌM SÁCH CHUYỂN HÀNG LOẠT: ${checks} assertions PASS ===`);
