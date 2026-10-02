/**
 * TEST: helper sắp xếp/lọc tồn dùng chung cho màn hình và bản in.
 *
 * Vì sao cần: nếu màn hình và bản in tự sắp riêng, chúng sẽ lệch nhau vào
 * lúc nhân viên đang đối chiếu. Hai bên PHẢI gọi cùng một hàm.
 *
 * CHẠY: npx tsx scripts/test-stocktake-order.ts
 */
import assert from 'node:assert/strict';
import { sortByStock, filterLowStock, sortLabel } from '../src/lib/stocktake-order';
import { STOCK_THRESHOLD_WARNING } from '../src/lib/stock-highlight';

const rows = [
  { code: 'C', theoreticalStock: 12 },
  { code: 'A', theoreticalStock: 0 },
  { code: 'B', theoreticalStock: 3 },
  { code: 'D', theoreticalStock: null },
  { code: 'E', theoreticalStock: 5 },
];

// 1. Bé → lớn. null = tồn 0 ⇒ nằm chung nhóm 0, trong nhóm xếp theo mã
// nên 'A' (tồn 0) đứng trước 'D' (null → cũng 0).
assert.deepEqual(sortByStock(rows, 'ASC').map((r) => r.code), ['A', 'D', 'B', 'E', 'C']);

// 2. Lớn → bé.
assert.deepEqual(sortByStock(rows, 'DESC').map((r) => r.code), ['C', 'E', 'B', 'A', 'D']);

// 3. Trùng tồn phải ổn định theo mã, KHÔNG theo thứ tự đầu vào.
assert.deepEqual(
  sortByStock(rows, 'ASC').map((r) => r.code),
  sortByStock(rows, 'ASC').map((r) => r.code),
  'gọi 2 lần cho cùng kết quả'
);

// 4. Không mutate mảng gốc — nếu mutate, bản in sau sẽ bị màn hình sắp hết.
assert.equal(rows[0].code, 'C', 'mảng gốc không bị đổi');
assert.equal(rows[2].theoreticalStock, 3, 'mảng gốc không bị đổi');

// 5. Lọc sắp hết dùng chung hằng số 5 của `stock-highlight`. Lọc GIỮ thứ tự
// vào, việc xếp là việc của sortByStock.
assert.deepEqual(filterLowStock(rows).map((r) => r.code), ['A', 'B', 'D', 'E']);
assert.equal(STOCK_THRESHOLD_WARNING, 5, 'ngưỡng sắp hết là 5');
assert.deepEqual(filterLowStock([]), [], 'mảng rỗng thì trả rỗng');

// 6. Ngưỡng biên: đúng 5 thì VẪN sắp hết (≤ 5), 6 thì không.
assert.deepEqual(filterLowStock([{ code: 'X', theoreticalStock: 6 }]), [], '6 cuốn không sắp hết');
assert.equal(filterLowStock([{ code: 'X', theoreticalStock: 5 }]).length, 1, '5 cuốn là sắp hết');

// 7. Nhãn có dấu mũi tên.
assert.equal(sortLabel('ASC'), 'Bé → Lớn');
assert.equal(sortLabel('DESC'), 'Lớn → Bé');

console.log('✓ test-stocktake-order PASS');