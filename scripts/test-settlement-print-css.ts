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
console.log('OK: selector in loại trừ đúng bản in.');