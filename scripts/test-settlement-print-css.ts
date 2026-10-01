// Test tĩnh cho CSS in của Báo Cáo Ngày (không đụng DB).
// Selector ẩn mọi thứ khi in là `body > *:not(:has(#printable-settlement-report))`.
// Nếu thiếu `:not(#printable-settlement-report)` thì chính biên bản cũng bị ẩn
// (độ đặc hiệu :has() thắng display:block !important) ⇒ bản in ra trang trắng.
import fs from 'node:fs';
const src = fs.readFileSync('src/components/pos/DailyFairSettlementModal.tsx', 'utf8');
const m = src.match(/body\s*>\s*\*:not\(:has\(#printable-settlement-report\)\)([^{]*)\{/);
if (!m) throw new Error('Không tìm thấy selector ẩn khi in — cập nhật test theo CSS mới.');
if (!/:not\(#printable-settlement-report\)/.test(m[1])) {
  throw new Error('LỖI: selector ẩn khi in nuốt cả #printable-settlement-report (độ đặc hiệu thắng display:block) → in ra trắng.');
}

// --- LỀ GIẤY PHẢI LÀ @page MARGIN, KHÔNG ĐƯỢC LÀ PADDING CỦA PHẦN TỬ ---------
// Bằng chứng từ ảnh in thật của owner: trang 1 có lề trên, TỪ TRANG 2 nội dung
// dính sát đỉnh giấy. Khớp 100% với chuẩn CSS fragmentation: padding-top của một
// phần tử CHỈ hiện ở TRANG ĐẦU, padding-bottom chỉ ở trang cuối, chỉ padding
// trái/phải mới lặp ở mọi trang. Nên lề trang KHÔNG THỂ đặt bằng padding của
// #printable. Lề trang phải đặt bằng `@page margin` — theo chuẩn lặp mọi trang.
// Bằng chứng ngược: bản cũ `@page margin: 10mm` cho trang 1 lề đẹp ⇒ Chrome
// TÔN TRỌNG @page margin. Giả định trước đó (@page margin bị bỏ qua) SAI.
// Regex bắt buộc có `size:` trong thân rule: nếu không, lần khớp đầu tiên rơi
// vào câu chú thích trong component có chữ "@page { margin }" ⇒ đọc nhầm CSS.
const pageRule = src.match(/@page\s*\{([^}]*\bsize\s*:[^}]*)\}/);
if (!pageRule) throw new Error('Không tìm thấy quy tắc @page — cần giữ khổ A4 portrait.');
if (!/margin:\s*12mm\s+10mm\s*;/.test(pageRule[1])) {
  throw new Error(
    'LỖI: @page phải đặt `margin: 12mm 10mm` — đây là lề thật của MỌI trang. ' +
      'padding của #printable chỉ hiện ở trang đầu (theo chuẩn fragmentation) nên ' +
      'đặt lề ở đó làm trang 2+ dính sát mép trên. Nhận: ' + pageRule[1].trim()
  );
}
if (!/size:\s*A4\s+portrait/.test(pageRule[1])) {
  throw new Error('LỖI: @page phải giữ `size: A4 portrait`.');
}

const printableRule = src.match(/#printable-settlement-report\s*\{([^}]*)\}/);
if (!printableRule) throw new Error('Không tìm thấy rule của #printable-settlement-report.');
if (/padding:\s*[\d.]+mm/.test(printableRule[1])) {
  throw new Error(
    'LỖI: khối in KHÔNG được đặt lề bằng padding mm — padding-top chỉ hiện ở trang ' +
      'đầu nên từ trang 2 chữ dính sát mép trên. Lề do @page margin quyết định. ' +
      'Nhận: ' + printableRule[1].trim()
  );
}
if (!/padding:\s*0\s*!important/.test(printableRule[1])) {
  throw new Error(
    'LỖI: khối in phải đặt `padding: 0 !important` — cộng dồn padding mm với @page ' +
      'margin sẽ nhân đôi lề. Nhận: ' + printableRule[1].trim()
  );
}

// --- KHỐI IN KHÔNG ĐƯỢC `position: absolute` ------------------------------------
// Owner đã in thật và báo: TRANG 2 dính sát mép trái, chỉ trang 1 có lề. Nguyên
// nhân đã xác minh: khối in là khối ABSOLUTE nên Chrome ngắt trang nó kiểu khác
// hẳn khối in-flow — padding của các trang sau rơi mất, chỉ trang đầu giữ lề.
// Portal của khối in vốn đã nằm thẳng dưới `document.body` (anh em của backdrop,
// ngoài khung modal cắt tràn) nên KHÔNG cần absolute để thoát khung cắt.
// Bỏ comment `/* … */` trước khi kiểm: chú thích giải thích lý do bỏ absolute
// buộc phải nhắc lại chữ "position: absolute" — mà comment KHÔNG phải khai báo,
// đọc nó thành lỗi thì test sai.
const printableDecls = printableRule[1].replace(/\/\*[\s\S]*?\*\//g, '');
if (/position\s*:\s*absolute/.test(printableDecls)) {
  throw new Error(
    'LỖI: khối in không được để `position: absolute` — Chrome ngắt trang khối absolute ' +
      'sai, padding mất từ trang 2 ⇒ lề trang 2 dính mép. Nhận: ' + printableDecls.trim()
  );
}

// --- DẢI GIỜ TRÊN BẢN IN PHẢI VẼ BẰNG SVG, KHÔNG BẰNG MÀU NỀN CSS -------------
// Owner in ra một dải 24 cột TRỐNG: Chrome lược màu nền khi hộp thoại In để
// "Background graphics" tắt (đang tắt), chỉ chữ và nhãn còn in. Cách chắc chắn
// là vẽ bằng SVG inline (nét SVG là nội dung, in mặc định), không phụ thuộc tuỳ
// chọn trong hộp thoại. Màn hình vẫn giữ div CSS — chỉ bản IN đổi sang SVG.
const printStart = src.indexOf('id="printable-settlement-report"');
if (printStart < 0) throw new Error('Không tìm thấy khối biên bản in #printable-settlement-report.');
// Cắt ĐÚNG đến hết khối in: khối in là phần tử JSX đầu tiên của portal riêng, nên
// nó kết thúc ngay trước `</div>, document.body` (mount point của portal đó).
// Quét tới CUỐI FILE thì assert vô tình đọc cả giao diện màn hình đặt sau — hôm
// nay chưa có gì sai, nhưng thêm bất kỳ khối nào cuối file là assert im lặng bỏ
// qua khối in mà vẫn xanh.
const printEnd = /\n\s*<\/div>,\s*\n\s*document\.body/.exec(src.slice(printStart));
if (!printEnd) throw new Error('Không tìm thấy điểm kết thúc khối in (</div>, document.body) — cập nhật test theo JSX mới.');
const printBody = src.slice(printStart, printStart + printEnd.index);
if (!/<svg\b/.test(printBody)) {
  throw new Error('LỖI: dải giờ trên bản in phải là <svg> — màu nền CSS bị Chrome lược khi tắt "Background graphics".');
}
if (!/<rect\b/.test(printBody) || !/fill=["']#4f46e5["']/.test(printBody)) {
  throw new Error('LỖI: dải giờ SVG phải có <rect> màu indigo #4f46e5 cho giờ có đơn.');
}
if (!/<rect\b[^>]*fill=["']#cbd5e1["']/.test(printBody)) {
  throw new Error('LỖI: giờ 0 đơn vẫn phải thấy trên bản in ⇒ <rect> màu xám #cbd5e1.');
}
// `hourWin.end` (không phải `hourWin.end` thô) mới được in ra: end=24 là mốc giờ
// không tồn tại, caption phải kẹp ở 23h cho khớp nhãn cuối của dải SVG.
if (!/hourlyInWindow/.test(printBody) || !/hourWin\.start/.test(printBody) || !/hourEndShown/.test(printBody)) {
  throw new Error(
    'LỖI: dải giờ phải cắt theo khung giờ động (hourWindow → hourlyInWindow) và ghi rõ ' +
      'khoảng giờ đã kẹp (hourEndShown) trên biên bản, không in cứng 24 cột.'
  );
}
if (/hourWin\.end\b/.test(printBody)) {
  throw new Error('LỖI: caption dải giờ in thẳng `hourWin.end` — end=24 in ra mốc giờ 24h không có thật, phải dùng hourEndShown.');
}
if (/bg-indigo-600/.test(printBody)) {
  throw new Error('LỖI: còn dải giờ vẽ bằng màu nền CSS (bg-indigo-600) trong khối in ⇒ in ra trống.');
}

console.log('OK: selector in loại trừ đúng bản in; lề lấy từ @page margin 12mm 10mm (mọi trang), padding khối in = 0, không position absolute; dải giờ vẽ bằng SVG.');
