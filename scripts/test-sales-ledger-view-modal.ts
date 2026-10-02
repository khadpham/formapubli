/**
 * Test kiểm chứng giao diện: Nút "Xem" chi tiết đơn hàng và Modal Hủy đơn trong SalesLedgerView.tsx.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function runTests() {
  console.log('--- Kiểm tra SalesLedgerView.tsx ---');
  const filePath = path.join(__dirname, '..', 'src', 'components', 'sales', 'SalesLedgerView.tsx');
  const content = fs.readFileSync(filePath, 'utf8');

  // 1. Kiểm tra có cột Thao tác và Nút Xem
  assert.ok(
    content.includes('Thao tác') || content.includes('Thao Tác'),
    'Lỗi: Thiếu tiêu đề cột Thao tác trong bảng đơn hàng'
  );
  assert.ok(
    content.includes('Xem') && (content.includes('Eye') || content.includes('selectedOrderId') || content.includes('viewingOrder')),
    'Lỗi: Thiếu nút hoặc chức năng Xem chi tiết đơn hàng'
  );

  // 2. Kiểm tra có Modal xem chi tiết đơn hàng
  assert.ok(
    content.includes('/api/orders/') || content.includes('fetchOrderDetail'),
    'Lỗi: Thiếu logic tải chi tiết đơn hàng từ API /api/orders/[id]'
  );

  // 3. Kiểm tra tính năng Hủy đơn cho Quản lý / Chủ
  assert.ok(
    content.includes('/void') || content.includes('voidCompletedOrder'),
    'Lỗi: Thiếu chức năng gọi API hủy đơn /void'
  );
  assert.ok(
    content.includes('Hủy đơn') || content.includes('Huỷ đơn'),
    'Lỗi: Thiếu nút Hủy đơn trong giao diện chi tiết'
  );

  // 4. Kiểm tra phân quyền: Quản lý hoặc Chủ mới thấy nút Hủy
  assert.ok(
    content.includes('ROLE_OWNER') && content.includes('ROLE_MANAGER'),
    'Lỗi: Phải kiểm tra quyền ROLE_OWNER hoặc ROLE_MANAGER trước khi hiển thị nút Hủy đơn'
  );

  // 5. Kiểm tra Tiếng Việt CÓ DẤU
  assert.ok(!content.includes('Huy don'), 'Lỗi: Không được dùng tiếng Việt không dấu "Huy don"');
  assert.ok(!content.includes('Chi tiet don hang'), 'Lỗi: Không được dùng tiếng Việt không dấu "Chi tiet don hang"');

  console.log('✅ UI Nút Xem và Modal Hủy đơn đạt chuẩn 100%');
}

runTests();
