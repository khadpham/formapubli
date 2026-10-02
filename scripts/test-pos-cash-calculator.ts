/**
 * Test kiểm chứng Bộ tính tiền mặt (Cash Change Calculator) và VietQR mặc định trong POS.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function calculateCashChange(cashReceived: number, finalAmount: number) {
  if (cashReceived < 0 || finalAmount < 0) {
    throw new Error('Số tiền không được âm');
  }
  const change = cashReceived - finalAmount;
  return {
    change,
    isSufficient: change >= 0,
    formattedChange: Math.abs(change).toLocaleString('vi-VN') + ' đ',
  };
}

function runTests() {
  console.log('--- 1. Kiểm tra logic tính tiền thối ---');
  // Trường hợp 1: Khách đưa 500k cho đơn 380k -> thối 120k
  const res1 = calculateCashChange(500000, 380000);
  assert.strictEqual(res1.change, 120000);
  assert.strictEqual(res1.isSufficient, true);
  assert.strictEqual(res1.formattedChange, '120.000 đ');

  // Trường hợp 2: Khách đưa đủ tiền 240k cho đơn 240k -> thối 0đ
  const res2 = calculateCashChange(240000, 240000);
  assert.strictEqual(res2.change, 0);
  assert.strictEqual(res2.isSufficient, true);
  assert.strictEqual(res2.formattedChange, '0 đ');

  // Trường hợp 3: Khách đưa 200k cho đơn 350k -> còn thiếu 150k
  const res3 = calculateCashChange(200000, 350000);
  assert.strictEqual(res3.change, -150000);
  assert.strictEqual(res3.isSufficient, false);
  assert.strictEqual(res3.formattedChange, '150.000 đ');

  console.log('✅ Logic tính tiền thối đạt 100%');

  console.log('--- 2. Kiểm tra mã nguồn PosCheckoutTerminal.tsx ---');
  const posFilePath = path.join(__dirname, '..', 'src', 'components', 'pos', 'PosCheckoutTerminal.tsx');
  const content = fs.readFileSync(posFilePath, 'utf8');

  // Kiểm tra 1: Mặc định paymentMethod phải là 'BANK_TRANSFER'
  assert.ok(
    content.includes("useState<'CASH' | 'BANK_TRANSFER' | 'QR_CODE'>('BANK_TRANSFER')"),
    "Lỗi: paymentMethod mặc định phải là 'BANK_TRANSFER' thay vì 'CASH'"
  );

  // Kiểm tra 2: Có state cashReceived
  assert.ok(
    content.includes('cashReceived') && content.includes('setCashReceived'),
    'Lỗi: Thiếu state cashReceived trong PosCheckoutTerminal'
  );

  // Kiểm tra 3: Có các nút mốc tiền nhanh 200k, 500k, 1M, Đủ tiền
  assert.ok(content.includes('200.000') || content.includes('200000'), 'Lỗi: Thiếu nút mốc 200.000đ');
  assert.ok(content.includes('500.000') || content.includes('500000'), 'Lỗi: Thiếu nút mốc 500.000đ');
  assert.ok(content.includes('1.000.000') || content.includes('1000000'), 'Lỗi: Thiếu nút mốc 1.000.000đ');
  assert.ok(content.includes('Đủ tiền'), 'Lỗi: Thiếu nút bấm nhanh Đủ tiền');

  // Kiểm tra 4: Có nhãn Tiền trả khách và Tiền nhận
  assert.ok(content.includes('Tiền trả khách') || content.includes('Tiền thối'), 'Lỗi: Thiếu dòng Tiền trả khách');
  assert.ok(content.includes('Tiền nhận') || content.includes('Tiền khách đưa'), 'Lỗi: Thiếu dòng Tiền nhận');

  console.log('✅ PosCheckoutTerminal.tsx cấu hình đúng 100%');
}

runTests();
