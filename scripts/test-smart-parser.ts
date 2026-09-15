/**
 * Bước 1 — Unit test FB Smart Parser (thuần function, không cần DB thật
 * nhưng vẫn chạy qua runner cách ly để đồng bộ).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-smart-parser
 */
import { db } from '../src/db';
import { editions } from '../src/db/schema';
import { parseSmartOrder, buildFbNote } from '../src/lib/smart-order-parser';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-smart-parser');

async function run() {
  console.log('📋 KIỂM THỬ FB SMART PARSER (unit)');
  const rows = await db.select({ id: editions.id, code: editions.code, title: editions.title }).from(editions);
  if (rows.length === 0) throw new Error('Test DB chưa seed.');
  const catalog = rows.map((r) => ({ editionId: r.id, code: r.code, title: r.title || '' }));

  let passed = 0;
  const total = 8;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) {
      passed++;
      console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
    } else {
      console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
    }
  };

  // 1. Chat đầy đủ: 2 cuốn + địa chỉ + SĐT
  const r1 = parseSmartOrder(
    'Gửi cho mình 2 cuốn Bệnh tưởng đến 123 Cầu Giấy, HN. SĐT 0912345678, ship COD giờ hành chính nhé',
    catalog
  );
  const h01 = r1.items.find((it) => it.code === 'H01');
  ok('1. Bóc full: SĐT + địa chỉ + 2 cuốn H01', r1.phone === '0912345678' && !!r1.address?.includes('123') && h01?.quantity === 2, JSON.stringify({ phone: r1.phone, qty: h01?.quantity }));

  // 2. Gõ không dấu
  const r2 = parseSmartOrder('lay 1 benh tuong, sdt 0987654321', catalog);
  ok('2. Gõ không dấu vẫn ra H01', r2.items.some((it) => it.code === 'H01' && it.quantity === 1) && r2.phone === '0987654321');

  // 3. Cú pháp xN
  const r3 = parseSmartOrder('Bệnh tưởng x3, 0901112223', catalog);
  ok('3. Dạng "x3" ra số lượng 3', r3.items.find((it) => it.code === 'H01')?.quantity === 3);

  // 4. Thiếu SĐT → warning
  const r4 = parseSmartOrder('Gửi mình 1 cuốn Bệnh tưởng đến 456 Xã Đàn', catalog);
  ok('4. Thiếu SĐT có warning', r4.phone === undefined && r4.warnings.some((w) => /SĐT/.test(w)));

  // 5. Sách không tồn tại → warning, items rỗng
  const r5 = parseSmartOrder('Mua 2 cuốn Harry Potter bản rồng, sdt 0901112223', catalog);
  ok('5. Sách lạ không đoán bừa', r5.items.length === 0 && r5.warnings.some((w) => /tên sách/.test(w)));

  // 6. Tên khách ghi rõ
  const r6 = parseSmartOrder('Tên Lan Anh, lấy 1 Bệnh tưởng, sdt 0901112223', catalog);
  ok('6. Tách tên khách', r6.customerName === 'Lan Anh');

  // 7. SĐT +84 chuẩn hóa về 0
  const r7 = parseSmartOrder('1 Bệnh tưởng, +84912345678', catalog);
  ok('7. +84 → 0', r7.phone === '0912345678');

  // 8. buildFbNote giữ raw chat
  const note = buildFbNote('Giao giờ HC nhé', 'khách VIP');
  ok('8. Note [FB][RAW_CHAT]', note.startsWith('[FB]') && note.includes('[RAW_CHAT:') && note.includes('khách VIP'));

  console.log(`\n${passed === total ? '🎉' : '⚠️'} SMART PARSER: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-smart-parser thất bại:', err);
  process.exit(1);
});
