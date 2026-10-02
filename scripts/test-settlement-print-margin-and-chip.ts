/**
 * TEST: lề in A4 và chip trạng thái ca.
 *
 * Lỗi thật đã gặp (02/10/2026):
 *  1. Lề A4 bị mất sạch. Khối 80mm trong `globals.css` khai
 *     `@page { margin: 0mm !important }`, khối A4 khai `margin: 12mm 10mm`
 *     KHÔNG important ⇒ `!important` thắng bất kể thứ tự ⇒ biên bản in sát mép.
 *     ĐO THẬT bằng Edge headless: trước khi sửa 0.00mm, sau khi sửa 10.05mm.
 *  2. Chip "Đã chốt ca 100%" lệm ra ngoài thẻ, thừa khoảng trắng bên phải.
 *     Vì hàng không xuống dòng và div số tiền không co được (thiếu `min-w-0`).
 *
 * CHẠY: npx tsx scripts/test-settlement-print-margin-and-chip.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/app/globals.css', 'utf8');
const modal = fs.readFileSync('src/components/pos/DailyFairSettlementModal.tsx', 'utf8');

// ---- 0. globals.css phải CÂN BẰNG ngoặc ----
// Lỗi thật đã gặp: sửa khối @page xong thừa một dấu } ở cuối file.
// `tsc` KHÔNG bắt lỗi CSS, và lỗi này làm `next build` fail ⇒ chặn cả repo.
// Đã lên main một lần, mọi người build sau đều fail.
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ''); // bỏ comment trước khi đếm
const open = (stripped.match(/\{/g) || []).length;
const close = (stripped.match(/\}/g) || []).length;
assert.equal(open, close, `globals.css lệch ngoặc: ${open} '{' nhưng ${close} '}' — next build sẽ fail`);

// ---- 1. Lề A4 ----
const pageBlocks: string[] = [];
const re = /@page\s*\{([^}]*)\}/g;
let m: RegExpExecArray | null;
while ((m = re.exec(css)) !== null) pageBlocks.push(m[1]);
assert.ok(pageBlocks.length >= 2, 'phải còn khối 80mm và khối A4');

const a4 = pageBlocks.find((b) => /A4/.test(b));
assert.ok(a4, 'phải có khối @page khổ A4');

// Khối A4 PHẢI có `!important`, không thì khối 80mm (`0mm !important`) thắng.
assert.ok(/margin:[^;]*!important/.test(a4), 'lề A4 phải có !important, nếu không khối 80mm sẽ thắng và mất sạch lề');
assert.ok(/size:\s*A4[^;]*!important/.test(a4), 'khổ A4 phải có !important cho chắc chắn');

// Khối A4 phải nằm SAU khối 80mm (thứ tự quyết định khi cả hai cùng important).
const i80 = pageBlocks.findIndex((b) => /80mm/.test(b));
const iA4 = pageBlocks.indexOf(a4!);
assert.ok(iA4 > i80, 'khối A4 phải đứng sau khối 80mm trong globals.css');

// Không được để component là nguồn duy nhất.
assert.ok(modal.includes('@page'), 'component vẫn giữ dòng @page cùng giá trị (vô hại)');
assert.ok(
  modal.includes('NGUỒN DUY NHẤT của lề A4'),
  'component phải ghi rõ nguồn duy nhất của lề là globals.css'
);

// ---- 2. Chip trạng thái không lệm ra ngoài ----
const iHeader = modal.indexOf('function MoneyHeader');
const iComponent = modal.indexOf('export function DailyFairSettlementModal', iHeader);
const header = modal.slice(iHeader, iComponent > 0 ? iComponent : undefined);

assert.ok(
  /flex flex-wrap items-start justify-between/.test(header),
  'hàng tiền phải flex-wrap: màn hẹp thì chip xuống dòng thay vì tràn ra ngoài'
);
assert.ok(
  /<div className="min-w-0">/.test(header),
  'div số tiền phải có min-w-0, nếu không nó giữ độ rộng tối thiểu và đẩy chip ra'
);
assert.ok(
  /text-2xl sm:text-3xl/.test(header),
  'số tiền phải nhỏ lại ở màn hẹp (sm:) để chừa chỗ cho chip'
);
assert.ok(
  /Đã chốt ca 100%/.test(header) && /whitespace-nowrap max-w-full/.test(header),
  'chip phải không xuống dòng bên trong, nhưng vẫn giới hạn bởi bề rộng thẻ'
);

console.log('✓ test-settlement-print-margin-and-chip PASS');