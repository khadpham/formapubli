/**
 * CHỐT TÁI PHÁT cho bảng quản trị tổng quan.
 *
 * CHẠY: npx tsx scripts/run-isolated.ts --only=test-dashboard-ui-text
 *
 * VÌ SAO CÓ FILE NÀY (30/09): người dùng phát hiện thẻ "Tồn Kho Vật Lý" hiện
 * "81 Đầu Sách" + "(3 Kho)" + tên kho — TẤT CẢ GHI CỨNG trong JSX, trong khi
 * production có 5 kho. Thẻ đó chưa từng lấy dữ liệu, nên không bao giờ đúng và
 * không tự cập nhật. Không có test canh thì 3 tháng sau lại có người ghi cứng số
 * và lại phải người dùng phát hiện.
 *
 * Ba bất biến được canh ở đây:
 *   1. Dashboard KHÔNG được có số ghi cứng kiểu `<số> Đầu Sách` trong JSX.
 *   2. Thẻ tồn kho PHẢI lấy từ API (stock-summary), không phải chữ viết thẳng.
 *   3. Text hiển thị cho người dùng KHÔNG còn tiếng Anh trong ngoặc.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DASH = 'src/components/dashboard/ExecutiveDashboard.tsx';
const dash = readFileSync(DASH, 'utf8');

let checks = 0;
let failures = 0;
function ok(cond: boolean, name: string, detail = '') {
  checks++;
  if (cond) console.log(`  ✅ ${name}${detail ? `\n       ↳ ${detail}` : ''}`);
  else { failures++; console.log(`  ❌ ${name}${detail ? `\n       ↳ ${detail}` : ''}`); }
}

/** Bỏ comment và nội dung trong ngoặc của biểu thức để chỉ còn TEXT HIỂN THỊ. */
function userVisibleLines(src: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i];
    // Bỏ comment cuối dòng và comment nguyên dòng.
    l = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    if (/^\s*\*/.test(l)) continue;
    const t = l.trim();
    if (!t) continue;
    // Bỏ dòng thuần biểu thức JS: bắt đầu bằng dấu JSX/JS, hoặc là dòng lệnh.
    if (/^[<>{}\[\]()=;,?.]/.test(t)) continue;
    if (/^(import|export|const|let|var|function|return|if|for|while|switch|case|default|async|await|type|interface|class|break|continue|new|try|catch|throw)\b/.test(t)) continue;
    // Dòng là MÃ nguồn, không phải text: `.filter(Boolean) as X[]`, `x as Y`.
    if (/\bas\s+[A-Z]/.test(t)) continue;
    // Dòng có `{...}` chen giữa chữ (template literal) vẫn là text — giữ lại.
    out.push({ line: i + 1, text: t });
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

console.log('\n=== BẢNG QUẢN TRỊ TỔNG QUAN: SỐ LIỆU THẬT + TEXT THUẦN TIẾNG VIỆT ===');

// 1) Không được ghi cứng số đầu sách trong JSX.
const hardcodedTitles = dash.match(/<p[^>]*>\s*\{?\d+\}?\s*Đầu Sách/g);
ok(
  !hardcodedTitles,
  '1. Không có số đầu sách GHI CỨNG trong JSX (phải lấy từ API)',
  hardcodedTitles ? `phát hiện: ${hardcodedTitles.join(' | ')}` : 'đã dùng {stockSummary?.titlesWithStock}'
);

// 2) Thẻ tồn kho phải nối tới API thật.
ok(/view=stock-summary/.test(dash), '2. Dashboard có gọi API stock-summary');
ok(/setStockSummary\(/.test(dash), '3. Dashboard lưu kết quả tồn kho vào state');
// Quét trên TEXT HIỂN THỊ, không phải cả file — nếu không thì chính comment giải
// thích của ta cũng bị quét và báo đỏ giả.
const dashText = userVisibleLines(dash).map((x) => x.text).join('\n');
ok(
  !/\(3\s*Kho\)/.test(dashText) && !/Kho 1 Âu Cơ\s*\|/.test(dashText),
  '4. Đã gỡ "(3 Kho)" và danh sách tên kho ghi cứng (quét cả comment sẽ báo đỏ giả)'
);

// 3) Text hiển thị không còn tiếng Anh trong ngoặc.
const offenders: string[] = [];
for (const file of walk('src')) {
  const src = readFileSync(file, 'utf8');
  for (const { line, text } of userVisibleLines(src)) {
    // Ngoặc chứa MÃ/MÃ KHO/SỐ là mã kỹ thuật, không phải tiếng Anh.
    const m = text.match(/\(([A-Z][A-Za-z][A-Za-z &/-]{2,})\)/);
    if (!m) continue;
    const inner = m[1];
    const isCode = /^[A-Z0-9_.-]+$/.test(inner) || /\(cron\)/i.test(inner) || /[a-z]{2}-[a-z]/i.test(inner);
    if (isCode) continue;
    offenders.push(`${path.relative('.', file)}:${line}  ${m[0]}`);
  }
}
ok(
  offenders.length === 0,
  '5. Text hiển thị KHÔNG còn tiếng Anh trong ngoặc (toàn bộ src/**/*.tsx)',
  offenders.length ? offenders.join('\n       ') : 'đã dọn sạch'
);

// 4) Số kho trên thẻ phải động, không phải hằng số.
ok(
  /warehouseCount \?\? 0/.test(dash),
  '6. Số kho trên thẻ lấy động từ API (không phải số 3 cứng)'
);

console.log(`\nTổng ${checks} kiểm tra — đạt ${checks - failures}, lỗi ${failures}.`);
if (failures > 0) process.exit(1);
console.log('\n✅ Bảng quản trị tổng quan không còn số ghi cứng, không còn tiếng Anh trong ngoặc.');
