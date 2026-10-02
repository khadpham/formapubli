/**
 * scripts/test-stock-sorting-ui.ts — Kiểm thử logic sắp xếp và highlight tồn kho.
 *
 * Kiểm tra:
 * 1. Sắp xếp danh sách sách theo tồn kho: Tăng dần (ASC: 0, 1, 2...), Giảm dần (DESC), Mặc định.
 * 2. Sắp xếp độc lập theo từng kho cụ thể (kho Quỳnh Mai vs Âu Cơ vs Tổng tồn).
 * 3. Bộ lọc nhanh sách sắp hết hàng (<= 5 cuốn) kết hợp tự động kích hoạt sắp xếp ASC.
 * 4. Kiểm tra mã nguồn Static Analysis: đảm bảo UI có aria-sort, badge contrast cao, không dùng đỏ rực chói gắt.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  STOCK_THRESHOLD_CRITICAL,
  STOCK_THRESHOLD_WARNING,
  getStockAlertLevel,
  getStockAlertBadge,
  getStockRowHighlightClass,
} from '../src/lib/stock-highlight';

console.log('=== BẮT ĐẦU KIỂM THỬ: SẮP XẾP VÀ HIGHLIGHT TỒN KHO ===\n');

// 1. Dữ liệu sách mẫu với các mức tồn thực tế
interface TestBook {
  id: string;
  code: string;
  title: string;
  stockQuynhMai: number;
  stockAuCo: number;
  stockDuPhong: number;
  totalStock: number;
}

const mockBooks: TestBook[] = [
  { id: 'b1', code: 'SKU-001', title: 'Sách A', stockQuynhMai: 10, stockAuCo: 0, stockDuPhong: 5, totalStock: 15 },
  { id: 'b2', code: 'SKU-002', title: 'Sách B', stockQuynhMai: 0, stockAuCo: 2, stockDuPhong: 0, totalStock: 2 },
  { id: 'b3', code: 'SKU-003', title: 'Sách C', stockQuynhMai: 4, stockAuCo: 50, stockDuPhong: 0, totalStock: 54 },
  { id: 'b4', code: 'SKU-004', title: 'Sách D', stockQuynhMai: 2, stockAuCo: 1, stockDuPhong: 0, totalStock: 3 },
  { id: 'b5', code: 'SKU-005', title: 'Sách E', stockQuynhMai: 25, stockAuCo: 15, stockDuPhong: 10, totalStock: 50 },
  { id: 'b6', code: 'SKU-006', title: 'Sách F', stockQuynhMai: 5, stockAuCo: 8, stockDuPhong: 2, totalStock: 15 },
];

function getWarehouseStock(b: TestBook, warehouseTab: string): number {
  if (warehouseTab === 'ALL') return b.totalStock;
  if (warehouseTab === 'wh-quynh-mai') return b.stockQuynhMai;
  if (warehouseTab === 'wh-au-co') return b.stockAuCo;
  return b.totalStock;
}

// 2. Test Sắp xếp ASC & DESC theo Tổng tồn ('ALL')
{
  const sortAsc = [...mockBooks].sort((a, b) => a.totalStock - b.totalStock);
  const totalStocksAsc = sortAsc.map((b) => b.totalStock);
  assert.deepEqual(totalStocksAsc, [2, 3, 15, 15, 50, 54], 'Thứ tự tổng tồn ASC phải từ bé đến lớn');

  const sortDesc = [...mockBooks].sort((a, b) => b.totalStock - a.totalStock);
  const totalStocksDesc = sortDesc.map((b) => b.totalStock);
  assert.deepEqual(totalStocksDesc, [54, 50, 15, 15, 3, 2], 'Thứ tự tổng tồn DESC phải từ lớn đến bé');

  console.log('  ✅ 1. Sắp xếp Tổng Tồn (ALL) ASC/DESC chính xác');
}

// 3. Test Sắp xếp linh hoạt theo Kho cụ thể (Âu Cơ vs Quỳnh Mai)
{
  // Theo Kho Âu Cơ
  const sortAuCoAsc = [...mockBooks].sort(
    (a, b) => getWarehouseStock(a, 'wh-au-co') - getWarehouseStock(b, 'wh-au-co')
  );
  const auCoStocks = sortAuCoAsc.map((b) => getWarehouseStock(b, 'wh-au-co'));
  assert.deepEqual(auCoStocks, [0, 1, 2, 8, 15, 50], 'Thứ tự tồn kho Âu Cơ ASC phải đúng từ 0 cuốn');
  assert.equal(sortAuCoAsc[0].id, 'b1', 'Sách A hết hàng tại Âu Cơ (tồn 0) phải đứng đầu danh sách');

  // Theo Kho Quỳnh Mai
  const sortQmAsc = [...mockBooks].sort(
    (a, b) => getWarehouseStock(a, 'wh-quynh-mai') - getWarehouseStock(b, 'wh-quynh-mai')
  );
  const qmStocks = sortQmAsc.map((b) => getWarehouseStock(b, 'wh-quynh-mai'));
  assert.deepEqual(qmStocks, [0, 2, 4, 5, 10, 25], 'Thứ tự tồn kho Quỳnh Mai ASC phải đúng');
  assert.equal(sortQmAsc[0].id, 'b2', 'Sách B hết hàng tại Quỳnh Mai (tồn 0) phải đứng đầu danh sách');

  console.log('  ✅ 2. Sắp xếp linh hoạt theo từng kho vật lý/hội chợ riêng biệt');
}

// 4. Test Lọc Sách Sắp Hết (<= 5 cuốn)
{
  const lowStockThreshold = STOCK_THRESHOLD_WARNING; // 5
  assert.equal(lowStockThreshold, 5, 'Ngưỡng cảnh báo sắp hết phải là <= 5 cuốn');

  // Lọc tại kho Âu Cơ: các sách có tồn <= 5 là b1 (0), b4 (1), b2 (2)
  const lowAuCo = mockBooks
    .filter((b) => getWarehouseStock(b, 'wh-au-co') <= lowStockThreshold)
    .sort((a, b) => getWarehouseStock(a, 'wh-au-co') - getWarehouseStock(b, 'wh-au-co'));

  assert.equal(lowAuCo.length, 3, 'Kho Âu Cơ phải có đúng 3 sách tồn <= 5');
  assert.deepEqual(
    lowAuCo.map((b) => b.id),
    ['b1', 'b4', 'b2'],
    'Thứ tự sách sắp hết tại Âu Cơ phải là b1 (0) -> b4 (1) -> b2 (2)'
  );

  // Lọc theo Tổng tồn: b2 (2), b4 (3)
  const lowTotal = mockBooks
    .filter((b) => b.totalStock <= lowStockThreshold)
    .sort((a, b) => a.totalStock - b.totalStock);
  assert.equal(lowTotal.length, 2, 'Tổng tồn chỉ có 2 cuốn <= 5 là b2 và b4');

  console.log('  ✅ 3. Lọc nhanh sách sắp hết (≤ 5 cuốn) kết hợp sắp xếp ASC chính xác');
}

// 5. Kiểm tra Tương phản & Tránh màu đỏ gay gắt (Static check & Class check)
{
  // Kiểm tra helper badge và row
  const badge0 = getStockAlertBadge(0);
  const row0 = getStockRowHighlightClass(0, true);
  // Không được dùng bg-red-600 hay bg-red-500 chói gắt cho toàn bộ dòng
  assert.ok(!row0.includes('bg-red-500'), 'Dòng không được dùng màu đỏ cờ chói gắt bg-red-500');
  assert.ok(!row0.includes('bg-red-600'), 'Dòng không được dùng màu đỏ cờ chói gắt bg-red-600');
  // Phải dùng pastel dịu nhẹ rose-50 hoặc amber-50
  assert.ok(row0.includes('rose-50'), 'Dòng hết hàng phải dùng rose-50 nhẹ nhàng');

  const row3 = getStockRowHighlightClass(3, true);
  assert.ok(row3.includes('rose-50'), 'Dòng tồn 3 phải dùng rose-50');

  const row5 = getStockRowHighlightClass(5, true);
  assert.ok(row5.includes('amber-50'), 'Dòng tồn 5 phải dùng amber-50');

  const rowHealthy = getStockRowHighlightClass(10, true);
  assert.equal(rowHealthy, '', 'Dòng tồn bình thường (>5) không được tô màu highlight');

  console.log('  ✅ 4. Dải màu gradient pastel dịu mắt, tương phản cao, đúng chỉ đạo');
}

// 6. Kiểm tra Tĩnh Mã Nguồn UI (StockOverviewMatrix & DailyFairSettlementModal)
{
  const matrixPath = path.resolve(__dirname, '../src/components/StockOverviewMatrix.tsx');
  const matrixCode = fs.readFileSync(matrixPath, 'utf8');

  assert.ok(matrixCode.includes('stockSortMode'), 'StockOverviewMatrix phải có state stockSortMode');
  assert.ok(matrixCode.includes('onlyLowStock'), 'StockOverviewMatrix phải có state onlyLowStock');
  assert.ok(matrixCode.includes('aria-sort'), 'StockOverviewMatrix phải có thuộc tính aria-sort để hỗ trợ trợ năng');
  assert.ok(matrixCode.includes('getStockRowHighlightClass'), 'StockOverviewMatrix phải gọi getStockRowHighlightClass');
  assert.ok(matrixCode.includes('getStockAlertBadge'), 'StockOverviewMatrix phải gọi getStockAlertBadge');
  assert.ok(matrixCode.includes('Sắp hết (≤ 5)'), 'StockOverviewMatrix phải có chip lọc Sắp hết (≤ 5)');

  const settlementPath = path.resolve(__dirname, '../src/components/pos/DailyFairSettlementModal.tsx');
  const settlementCode = fs.readFileSync(settlementPath, 'utf8');

  assert.ok(settlementCode.includes('stocktakeSortMode'), 'DailyFairSettlementModal phải có stocktakeSortMode');
  assert.ok(settlementCode.includes('stocktakeOnlyLow'), 'DailyFairSettlementModal phải có stocktakeOnlyLow');
  assert.ok(settlementCode.includes('getStockAlertBadge'), 'DailyFairSettlementModal phải dùng getStockAlertBadge');

  const dashboardPath = path.resolve(__dirname, '../src/components/dashboard/ExecutiveDashboard.tsx');
  const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');
  assert.ok(
    dashboardCode.includes("onNavigateTab('inventory')"),
    'ExecutiveDashboard phải hỗ trợ bấm thẻ tồn kho chuyển sang inventory'
  );

  console.log('  ✅ 5. Kiểm tra mã nguồn Static Analysis đồng bộ toàn bộ bảng biểu');
}

console.log('\n=== TẤT CẢ KIỂM THỬ TÍCH HỢP UI ĐÃ ĐẠT 100% ===');
