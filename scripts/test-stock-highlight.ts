import assert from 'node:assert/strict';
import {
  getStockAlertLevel,
  getStockAlertBadge,
  getStockRowHighlightClass,
  STOCK_THRESHOLD_CRITICAL,
  STOCK_THRESHOLD_WARNING,
} from '../src/lib/stock-highlight';

console.log('=== TEST: Helper ngưỡng tồn kho & highlight cảnh báo dịu nhẹ ===\n');

// 1. Kiểm tra hằng số ngưỡng
assert.equal(STOCK_THRESHOLD_CRITICAL, 3);
assert.equal(STOCK_THRESHOLD_WARNING, 5);

// 2. Phân loại 4 mức tồn
assert.equal(getStockAlertLevel(0), 'OUT_OF_STOCK');
assert.equal(getStockAlertLevel(-2), 'OUT_OF_STOCK');
assert.equal(getStockAlertLevel(1), 'CRITICAL');
assert.equal(getStockAlertLevel(2), 'CRITICAL');
assert.equal(getStockAlertLevel(3), 'CRITICAL');
assert.equal(getStockAlertLevel(4), 'WARNING');
assert.equal(getStockAlertLevel(5), 'WARNING');
assert.equal(getStockAlertLevel(6), 'HEALTHY');
assert.equal(getStockAlertLevel(20), 'HEALTHY');
console.log('  ✅ 1. Phân loại đúng 4 mức tồn (OUT_OF_STOCK, CRITICAL, WARNING, HEALTHY)');

// 3. Nhãn và badge (độ tương phản cao, màu pastel dịu nhẹ)
const badge0 = getStockAlertBadge(0);
assert.match(badge0.label, /0|Hết/);
assert.match(badge0.textClass, /rose-900/);
assert.match(badge0.bgClass, /rose-100|rose-50/);

const badge2 = getStockAlertBadge(2);
assert.match(badge2.label, /2/);
assert.match(badge2.textClass, /rose-800/);

const badge5 = getStockAlertBadge(5);
assert.match(badge5.label, /5/);
assert.match(badge5.textClass, /amber-900/);

const badge10 = getStockAlertBadge(10);
assert.match(badge10.label, /10/);
assert.match(badge10.textClass, /slate-900|emerald-700/);
console.log('  ✅ 2. Badge tương phản cao, chữ đậm rõ ràng, màu nền pastel nhẹ nhàng');

// 4. Row highlight class: viền điểm nhấn + nền dịu mắt
const row0 = getStockRowHighlightClass(0, true);
assert.match(row0, /border-l-rose-500/);
assert.match(row0, /bg-rose-50\/70/);

const row3 = getStockRowHighlightClass(3, true);
assert.match(row3, /border-l-rose-300/);
assert.match(row3, /bg-rose-50\/40/);

const row5 = getStockRowHighlightClass(5, true);
assert.match(row5, /border-l-amber-300/);
assert.match(row5, /bg-amber-50\/30/);

const row12 = getStockRowHighlightClass(12, true);
assert.equal(row12, '');

// Khi không bật sort Ascending, không highlight nền toàn dòng để giữ bảng sạch sẽ
assert.equal(getStockRowHighlightClass(2, false), '');
console.log('  ✅ 3. Highlight dòng theo dải gradient dịu nhẹ khi sắp xếp Bé -> Lớn');

console.log('\n=== TẤT CẢ CHECKS TASK 1 ĐẠT ===');
