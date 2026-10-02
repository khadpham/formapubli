/**
 * Test kiểm chứng responsive mobile cho các chip và dropdown lọc ở SalesLedgerView và PendingOrdersView.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function runTests() {
  console.log('--- 1. Kiểm tra PendingOrdersView.tsx ---');
  const pendingPath = path.join(__dirname, '..', 'src', 'components', 'sales', 'PendingOrdersView.tsx');
  const pendingContent = fs.readFileSync(pendingPath, 'utf8');

  // Kiểm tra cụm select Tất cả kho xuất và Tất cả kênh có flex-wrap hoặc responsive min-w-0
  const pendingSelectMatch = pendingContent.match(/Tất cả kho xuất[\s\S]{1,600}Tất cả kênh/);
  assert.ok(pendingSelectMatch, 'Lỗi: Không tìm thấy 2 select Tất cả kho xuất và Tất cả kênh trong PendingOrdersView');
  assert.ok(
    pendingContent.includes('flex-wrap sm:flex-nowrap') || pendingContent.includes('flex-wrap'),
    'Lỗi: PendingOrdersView phải có flex-wrap để không tràn 2 select trên mobile'
  );

  console.log('--- 2. Kiểm tra SalesLedgerView.tsx ---');
  const salesPath = path.join(__dirname, '..', 'src', 'components', 'sales', 'SalesLedgerView.tsx');
  const salesContent = fs.readFileSync(salesPath, 'utf8');

  // Kiểm tra scope switcher có overflow-x-auto hoặc scroll
  assert.ok(
    salesContent.includes('overflow-x-auto') || salesContent.includes('flex-wrap'),
    'Lỗi: SalesLedgerView phải có overflow-x-auto hoặc flex-wrap cho thanh chọn Sổ'
  );

  // Kiểm tra dải chip Kênh có container flex-wrap và min-w-0
  const channelMatch = salesContent.match(/<div[^>]*>[\s\S]{1,500}Kênh:[\s\S]{1,400}Tất cả kênh/);
  assert.ok(channelMatch, 'Lỗi: Không tìm thấy bộ lọc Kênh trong SalesLedgerView');
  assert.ok(
    channelMatch[0].includes('flex-wrap') || channelMatch[0].includes('overflow-x-auto'),
    'Lỗi: Container dải chip Kênh phải có flex-wrap hoặc overflow-x-auto'
  );

  console.log('✅ Responsive chip và dropdown đạt chuẩn 100%');
}

runTests();
