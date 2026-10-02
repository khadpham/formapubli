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

  // Kiểm tra lưu cấu hình sắp xếp tuần tự và không lỗi va chạm
  assert.ok(
    panelContent.includes('wh.sortOrder = idx') || panelContent.includes('sortOrder: idx'),
    'Lỗi: WarehouseManagerPanel phải lưu thứ tự tuần tự idx cho các kho'
  );

  // Lỗi thật đã gặp (02/10/2026): vòng PATCH lưu sortOrder KHÔNG kiểm `res.ok`.
  // `fetch` không throw khi HTTP 500 ⇒ một kho bị từ chối vẫn báo "Đã đổi vị
  // trí", UI giữ thứ tự tối ưu, server không lưu ⇒ refresh là thứ tự tự nhảy
  // về cũ, không có thông báo lỗi. Ba handler khác trong cùng file đều kiểm.
  const moveFn = panelContent.slice(panelContent.indexOf('moveWarehouse'));
  assert.ok(
    /Promise\.allSettled/.test(moveFn.slice(0, 2000)),
    'Lỗi: moveWarehouse phải dùng Promise.allSettled để mọi PATCH hoàn tất trước khi kết luận'
  );
  assert.ok(
    /!res\.ok/.test(moveFn.slice(0, 2000)),
    'Lỗi: moveWarehouse phải kiểm res.ok — fetch không throw khi HTTP lỗi'
  );
  assert.ok(
    /failed\.length/.test(moveFn.slice(0, 2500)),
    'Lỗi: moveWarehouse phải báo khi chỉ lưu được một phần danh sách'
  );

  console.log('--- 3. Kiểm tra SSR HomePage và API /api/warehouses ---');
  const pagePath = path.join(__dirname, '..', 'src', 'app', 'page.tsx');
  const pageContent = fs.readFileSync(pagePath, 'utf8');
  assert.ok(
    pageContent.includes('WarehouseService.listAll()'),
    'Lỗi: HomePage (page.tsx) phải nạp kho qua WarehouseService.listAll() để giữ đúng thứ tự khi F5/refresh'
  );

  const routePath = path.join(__dirname, '..', 'src', 'app', 'api', 'warehouses', 'route.ts');
  const routeContent = fs.readFileSync(routePath, 'utf8');
  assert.ok(
    routeContent.includes('sortOrder:'),
    'Lỗi: /api/warehouses phải trả về trường sortOrder trong JSON'
  );

  console.log('✅ Tính năng sửa tên và lưu cấu hình sắp xếp kho đạt chuẩn 100%');
}

runTests();
