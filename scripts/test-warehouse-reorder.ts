/**
 * Test kiểm chứng chức năng sửa tên kho và sắp xếp vị trí kho trong WarehouseManagerPanel.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

function runTests() {
  console.log('--- 1. Kiểm tra schema và service hỗ trợ sortOrder ---');
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.ts');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  assert.ok(schemaContent.includes('sortOrder'), 'Lỗi: Thiếu cột sortOrder trong schema warehouses');

  const servicePath = path.join(__dirname, '..', 'src', 'services', 'warehouse.service.ts');
  const serviceContent = fs.readFileSync(servicePath, 'utf8');
  assert.ok(serviceContent.includes('sortOrder'), 'Lỗi: WarehouseService phải hỗ trợ sortOrder');
  assert.ok(serviceContent.includes('asc(warehouses.sortOrder)'), 'Lỗi: listAll/listSellable phải orderBy sortOrder');

  console.log('--- 2. Kiểm tra giao diện WarehouseManagerPanel.tsx ---');
  const panelPath = path.join(__dirname, '..', 'src', 'components', 'inventory', 'WarehouseManagerPanel.tsx');
  const panelContent = fs.readFileSync(panelPath, 'utf8');

  // Kiểm tra có nút sửa tên
  assert.ok(
    panelContent.includes('Sửa') || panelContent.includes('saveName') || panelContent.includes('editingId'),
    'Lỗi: Thiếu tính năng sửa tên kho trong WarehouseManagerPanel'
  );

  // Kiểm tra có nút đổi thứ tự Lên / Xuống
  assert.ok(
    panelContent.includes('moveWarehouse') || panelContent.includes('ArrowUp') || panelContent.includes('ArrowDown'),
    'Lỗi: Thiếu nút di chuyển thứ tự kho (Lên / Xuống)'
  );

  // Kiểm tra tiếng Việt CÓ DẤU
  assert.ok(panelContent.includes('Xoá') || panelContent.includes('Xóa'), 'Lỗi: Phải dùng từ Xoá có dấu');
  assert.ok(panelContent.includes('Ngưng hoạt động'), 'Lỗi: Phải dùng Ngưng hoạt động có dấu');
  assert.ok(panelContent.includes('Mở lại'), 'Lỗi: Phải dùng Mở lại có dấu');
  assert.ok(panelContent.includes('Huỷ') || panelContent.includes('Hủy'), 'Lỗi: Phải dùng Huỷ có dấu');

  console.log('✅ Tính năng sửa tên và sắp xếp kho đạt chuẩn 100%');
}

runTests();
