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

// --- LỀ GIẤY ------------------------------------------------------------------
// Owner đã in ra bản thật: chữ dính sát mép trên, không có lề. Nguyên nhân đã
// xác minh: Chrome BỎ QUA margin đặt trong @page khi hộp thoại In để Margins =
// Default (phần lớn máy in mặc định vậy), cộng thêm `padding: 0` của chúng ta
// nên chữ dính mép. Cách chắc chắn là ĐỂ LỀ THẬT BẰNG PADDING của chính khối
// in — không phụ thuộc trình duyệt/tính năng hộp thoại In.
// Regex bắt buộc có `size:` trong thân rule: nếu không, lần khớp đầu tiên rơi
// vào câu chú thích trong component có chữ "@page { margin }" ⇒ đọc nhầm CSS.
const pageRule = src.match(/@page\s*\{([^}]*\bsize\s*:[^}]*)\}/);
if (!pageRule) throw new Error('Không tìm thấy quy tắc @page — cần giữ khổ A4 portrait.');
if (!/margin:\s*0\s*;/.test(pageRule[1])) {
  throw new Error(
    'LỖI: @page phải đặt `margin: 0` — lề thật do padding của khối in quyết định, ' +
      `đặt margin trong @page là Chrome bỏ qua (Margins=Default) ⇒ chữ dính mép. Nhận: ${pageRule[1].trim()}`
  );
}
if (!/size:\s*A4\s+portrait/.test(pageRule[1])) {
  throw new Error('LỖI: @page phải giữ `size: A4 portrait`.');
}

const printableRule = src.match(/#printable-settlement-report\s*\{([^}]*)\}/);
if (!printableRule) throw new Error('Không tìm thấy rule của #printable-settlement-report.');
if (!/padding:\s*\d+mm\s+\d+mm\s*!important/.test(printableRule[1])) {
  throw new Error(
    'LỖI: khối in phải có `padding: <trên>mm <ngang>mm !important` — đây mới là lề thật ' +
      'in ra được trên Chrome. Nhận: ' + printableRule[1].trim()
  );
}

console.log('OK: selector in loại trừ đúng bản in; lề lấy từ padding của khối in (@page margin 0).');