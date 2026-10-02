# Sắp Xếp Tồn Kho & Highlight Cảnh Báo Tồn Thấp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung tính năng sắp xếp tồn kho linh hoạt theo ngữ cảnh kho (ưu tiên xếp từ Bé → Lớn để phát hiện ngay sách sắp hết, Lớn → Bé, và Mặc định), chip lọc nhanh sách sắp hết, cùng dải màu sorted gradient / highlight sắc đỏ-cam-vàng cảnh báo trực quan trên màn hình Kho Hàng (`StockOverviewMatrix.tsx`) và Báo Cáo Kiểm Kê (`DailyFairSettlementModal.tsx`).

**Architecture:** Toàn bộ logic sắp xếp và lọc chạy 100% tại Client-side (Zero latency, Zero subrequests tới Cloudflare Worker, không làm chạm ngưỡng giới hạn Workers). Helper chuẩn hóa `src/lib/stock-highlight.ts` phân loại ngưỡng tồn: Hết hàng ($\le 0$), Khẩn cấp ($1 \dots 3$), Chú ý nhập thêm ($4 \dots 5$), và An toàn ($> 5$). Tự động ăn theo số tồn của kho đang mở (kho Hội chợ vs kho Âu Cơ vs Tổng tồn).

**Tech Stack:** React 18, Next.js 14 App Router, TypeScript, Tailwind CSS, Lucide icons, Node.js assert test runner (`node:assert/strict`).

**Spec:** Yêu cầu thực tế từ Chủ doanh nghiệp ngày 02/10/2026 kèm hình ảnh mẫu danh sách sách sắp xếp tăng dần (2, 2, 4, 4, 5, 6...) có highlight trực quan để quản lý lên kế hoạch điều chuyển/tiếp hàng kịp thời.

---

## Global Constraints

- **Tên nhãn UI:** Tiếng Việt có dấu, ngắn gọn, súc tích ("Tồn: Bé → Lớn", "Tồn: Lớn → Bé", "Sắp hết", "Hết hàng").
- **Dấu hiệu bấm rõ ràng:** Có icon chỉ hướng (ArrowUpDown, ArrowUp, ArrowDown), trạng thái active nổi bật, tooltip đầy đủ.
- **Zero API Overload:** Không thêm query DB hay subrequest mới, tận dụng dữ liệu `stockByWarehouse`, `totalStock`, `theoreticalStock` đã có trong bộ nhớ.
- **Không phá vỡ responsive:** Giữ nguyên các padding an toàn mobile và FAB gutter (`data-kho-ui="fab-gutter"`).
- **YAGNI / Ponytail:** Viết tối giản, tách helper tính toán độc lập để tái sử dụng và kiểm thử dễ dàng.

---

## Review Focus

1. **Ngữ cảnh kho linh hoạt:** Khi chuyển tab sang "Kho Hội Chợ" (`wh-hoi-cho`), thứ tự Bé → Lớn phải ăn theo số tồn của kho Hội Chợ, KHÔNG được ăn nhầm vào Tổng tồn hay kho Âu Cơ.
2. **Sách hết hàng (= 0):** Phải nằm đầu danh sách khi xếp Bé → Lớn và nhận mức cảnh báo cao nhất (đỏ rực / gạch chéo), không bị coi là falsy hay bỏ qua.
3. **Kết hợp tìm kiếm và lọc:** Khi gõ từ khoá tìm kiếm + bật sắp xếp / lọc sắp hết, danh sách phải đồng thời thoả mãn cả hai điều kiện, không bị reset trạng thái nhau.
4. **Hiệu ứng sorted gradient / highlight:** Khi bật xếp Bé → Lớn, các dòng đầu bảng có màu gradient chuyển tiếp từ đỏ (hết/sắp hết) sang cam/vàng rồi dịu dần về màu trắng bình thường, không gây chói mắt.
5. **Khả năng tiếp cận & bàn phím:** Tiêu đề cột có `role="button"`, `tabIndex={0}`, `aria-sort`, nhấn Enter/Space để đổi chiều sắp xếp.

---

### Task 1: Xây dựng Helper Chuẩn Hoá Ngưỡng Tồn & Màu Sắc Gradient Cảnh Báo

**Files:**
- Create: `src/lib/stock-highlight.ts`
- Test: `scripts/test-stock-highlight.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type StockAlertLevel = 'OUT_OF_STOCK' | 'CRITICAL' | 'WARNING' | 'HEALTHY';

  export function getStockAlertLevel(qty: number): StockAlertLevel;
  export function getStockAlertBadge(qty: number): {
    level: StockAlertLevel;
    label: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
  };
  export function getStockRowHighlightClass(
    qty: number,
    isSortedAsc: boolean
  ): string;
  ```

- [x] **Step 1: Viết test kiểm tra ngưỡng tồn kho và màu sắc**

Tạo file `scripts/test-stock-highlight.ts`:
```typescript
import assert from 'node:assert/strict';
import { getStockAlertLevel, getStockAlertBadge, getStockRowHighlightClass } from '../src/lib/stock-highlight';

console.log('=== TEST: Helper ngưỡng tồn kho & highlight cảnh báo ===\n');

// 1. Phân loại mức tồn
assert.equal(getStockAlertLevel(0), 'OUT_OF_STOCK');
assert.equal(getStockAlertLevel(-1), 'OUT_OF_STOCK');
assert.equal(getStockAlertLevel(1), 'CRITICAL');
assert.equal(getStockAlertLevel(2), 'CRITICAL');
assert.equal(getStockAlertLevel(3), 'CRITICAL');
assert.equal(getStockAlertLevel(4), 'WARNING');
assert.equal(getStockAlertLevel(5), 'WARNING');
assert.equal(getStockAlertLevel(6), 'HEALTHY');
assert.equal(getStockAlertLevel(100), 'HEALTHY');
console.log('  ✅ 1. Phân loại đúng 4 mức tồn: OUT_OF_STOCK, CRITICAL, WARNING, HEALTHY');

// 2. Nhãn và badge
const badge0 = getStockAlertBadge(0);
assert.match(badge0.label, /Hết hàng/);
assert.match(badge0.textClass, /rose/);

const badge2 = getStockAlertBadge(2);
assert.match(badge2.label, /2 cuốn/);
assert.match(badge2.textClass, /rose/);

const badge5 = getStockAlertBadge(5);
assert.match(badge5.label, /5 cuốn/);
assert.match(badge5.textClass, /amber/);
console.log('  ✅ 2. Badge hiển thị đúng nhãn và tông màu');

// 3. Row highlight class khi sắp xếp Bé -> Lớn
const row0 = getStockRowHighlightClass(0, true);
assert.match(row0, /rose/);
const row2 = getStockRowHighlightClass(2, true);
assert.match(row2, /rose/);
const row5 = getStockRowHighlightClass(5, true);
assert.match(row5, /amber/);
const row10 = getStockRowHighlightClass(10, true);
assert.equal(row10, '');
console.log('  ✅ 3. Row highlight đúng gradient theo số lượng tồn');

console.log('\n=== TẤT CẢ CHECKS TASK 1 ĐẠT ===');
```

- [x] **Step 2: Chạy test để xác nhận test thất bại (Red)**

Run: `npx tsx scripts/test-stock-highlight.ts`
Expected: FAIL (Cannot find module `../src/lib/stock-highlight`).

- [x] **Step 3: Triển khai helper `src/lib/stock-highlight.ts` (Green)**

Tạo `src/lib/stock-highlight.ts`:
```typescript
/**
 * src/lib/stock-highlight.ts — Chuẩn hoá ngưỡng cảnh báo tồn kho và màu sắc hiển thị.
 *
 * Quy ước thực tế gian hàng & hội chợ:
 *  - OUT_OF_STOCK (<= 0): Hết sạch hàng, báo động cao nhất (đỏ rực).
 *  - CRITICAL (1..3 cuốn): Sắp hết khẩn cấp, cần tiếp ứng ngay (đỏ cam).
 *  - WARNING (4..5 cuốn): Chú ý theo dõi để nhập thêm (vàng cam hổ phách).
 *  - HEALTHY (> 5 cuốn): Mức tồn an toàn bình thường.
 */

export type StockAlertLevel = 'OUT_OF_STOCK' | 'CRITICAL' | 'WARNING' | 'HEALTHY';

export const STOCK_THRESHOLD_CRITICAL = 3;
export const STOCK_THRESHOLD_WARNING = 5;

export function getStockAlertLevel(qty: number): StockAlertLevel {
  const n = Number(qty) || 0;
  if (n <= 0) return 'OUT_OF_STOCK';
  if (n <= STOCK_THRESHOLD_CRITICAL) return 'CRITICAL';
  if (n <= STOCK_THRESHOLD_WARNING) return 'WARNING';
  return 'HEALTHY';
}

export function getStockAlertBadge(qty: number): {
  level: StockAlertLevel;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  const level = getStockAlertLevel(qty);
  const n = Number(qty) || 0;

  switch (level) {
    case 'OUT_OF_STOCK':
      return {
        level,
        label: 'Hết hàng (0)',
        bgClass: 'bg-rose-100',
        textClass: 'text-rose-800 font-black',
        borderClass: 'border-rose-300',
      };
    case 'CRITICAL':
      return {
        level,
        label: `${n} cuốn`,
        bgClass: 'bg-rose-50',
        textClass: 'text-rose-700 font-extrabold',
        borderClass: 'border-rose-200',
      };
    case 'WARNING':
      return {
        level,
        label: `${n} cuốn`,
        bgClass: 'bg-amber-50',
        textClass: 'text-amber-700 font-bold',
        borderClass: 'border-amber-200',
      };
    case 'HEALTHY':
    default:
      return {
        level,
        label: `${n.toLocaleString('vi-VN')}`,
        bgClass: 'bg-slate-50',
        textClass: 'text-slate-800 font-semibold',
        borderClass: 'border-slate-200',
      };
  }
}

/**
 * Trả về class gradient / highlight cho toàn bộ dòng bảng.
 * Khi người dùng kích hoạt sắp xếp Bé -> Lớn, các dòng có tồn thấp được tô sắc thái
 * gradient đỏ sang cam để mắt nhận diện ngay lập tức.
 */
export function getStockRowHighlightClass(qty: number, isSortedAsc: boolean): string {
  if (!isSortedAsc) return '';
  const level = getStockAlertLevel(qty);
  switch (level) {
    case 'OUT_OF_STOCK':
      return 'bg-rose-50/90 border-l-4 border-l-rose-600 hover:bg-rose-100/80 transition-colors';
    case 'CRITICAL':
      return 'bg-rose-50/50 border-l-4 border-l-rose-400 hover:bg-rose-100/50 transition-colors';
    case 'WARNING':
      return 'bg-amber-50/40 border-l-4 border-l-amber-400 hover:bg-amber-100/50 transition-colors';
    default:
      return '';
  }
}
```

- [x] **Step 4: Chạy test kiểm tra lại (Green)**

Run: `npx tsx scripts/test-stock-highlight.ts`
Expected: PASS (All checks pass).

- [x] **Step 5: Commit task 1**

```bash
git add src/lib/stock-highlight.ts scripts/test-stock-highlight.ts
git commit -m "feat(stock): them helper phan loai muc ton va highlight mau sac canh bao"
```

---

### Task 2: Triển Khai Tính Năng Sắp Xếp & Highlight Trên Ma Trận Kho

**Files:**
- Modify: `src/components/StockOverviewMatrix.tsx`

- [x] **Step 1: Bổ sung state và logic sắp xếp theo ngữ cảnh kho**

Trong `StockOverviewMatrix.tsx`:
1. Thêm import:
   ```typescript
   import { ArrowUpDown, ArrowUp, ArrowDown, Flame, Filter } from 'lucide-react';
   import { getStockAlertLevel, getStockAlertBadge, getStockRowHighlightClass, STOCK_THRESHOLD_WARNING } from '@/lib/stock-highlight';
   ```
2. Thêm state:
   ```typescript
   export type StockSortMode = 'DEFAULT' | 'ASC' | 'DESC';
   const [stockSortMode, setStockSortMode] = useState<StockSortMode>('DEFAULT');
   const [onlyLowStock, setOnlyLowStock] = useState<boolean>(false);
   ```
3. Cập nhật `filteredBooks` `useMemo`:
   - Lọc theo từ khoá tìm kiếm.
   - Nếu `onlyLowStock === true`: chỉ giữ lại sách có `getWarehouseStock(b, warehouseTab) <= STOCK_THRESHOLD_WARNING`.
   - Nếu `stockSortMode === 'ASC'`: sắp xếp tăng dần theo `getWarehouseStock(b, warehouseTab)`. Nếu bằng nhau, xếp theo mã SKU.
   - Nếu `stockSortMode === 'DESC'`: sắp xếp giảm dần theo `getWarehouseStock(b, warehouseTab)`.
   - Nếu `stockSortMode === 'DEFAULT'`: giữ nguyên thứ tự ban đầu.

- [x] **Step 2: Thêm thanh điều khiển sắp xếp & chip lọc nhanh trên Toolbar**

Bổ sung ngay cạnh thanh tìm kiếm / dải tab kho:
- Chip nút lọc nhanh: **`⚠️ Sắp hết (≤ 5 cuốn)`** kèm số lượng ấn phẩm đang bị cảnh báo:
  ```tsx
  <button
    type="button"
    onClick={() => {
      setOnlyLowStock((prev) => !prev);
      if (!onlyLowStock && stockSortMode === 'DEFAULT') {
        setStockSortMode('ASC'); // Tự động bật sắp xếp Bé -> Lớn khi bấm lọc sách sắp hết
      }
    }}
    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
      onlyLowStock
        ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
        : 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200'
    }`}
    title="Chỉ hiển thị các đầu sách có tồn kho ≤ 5 cuốn để kịp thời nhập thêm"
  >
    <Flame className="w-3.5 h-3.5" />
    <span>Sắp hết (≤ 5)</span>
    <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${onlyLowStock ? 'bg-rose-700 text-white' : 'bg-rose-100 text-rose-800'}`}>
      {lowStockCount}
    </span>
  </button>
  ```
- Nút chuyển nhanh chế độ sắp xếp tồn kho:
  ```tsx
  <button
    type="button"
    onClick={() => {
      setStockSortMode((prev) => (prev === 'DEFAULT' ? 'ASC' : prev === 'ASC' ? 'DESC' : 'DEFAULT'));
    }}
    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
      stockSortMode !== 'DEFAULT'
        ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
    }`}
    title="Đổi chiều sắp xếp tồn kho: Bé đến Lớn / Lớn đến Bé / Mặc định"
  >
    {stockSortMode === 'ASC' ? (
      <>
        <ArrowUp className="w-3.5 h-3.5 text-rose-600" />
        <span>Tồn: Bé → Lớn</span>
      </>
    ) : stockSortMode === 'DESC' ? (
      <>
        <ArrowDown className="w-3.5 h-3.5 text-indigo-600" />
        <span>Tồn: Lớn → Bé</span>
      </>
    ) : (
      <>
        <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
        <span>Sắp xếp tồn</span>
      </>
    )}
  </button>
  ```

- [x] **Step 3: Gắn khả năng click sắp xếp trên Header cột của bảng**

Tại tiêu đề cột "Tồn tại kho này" (khi xem 1 kho) và "Tổng tồn" (khi xem tất cả kho):
- Biến tiêu đề cột thành nút bấm có thể click:
  - Có con trỏ `cursor-pointer`, hiệu ứng hover nhẹ.
  - Hiển thị icon mũi tên trạng thái: `▲` khi ASC, `▼` khi DESC, `↕` khi DEFAULT.
  - Đặt `aria-sort={stockSortMode === 'ASC' ? 'ascending' : stockSortMode === 'DESC' ? 'descending' : 'none'}`.

- [x] **Step 4: Áp dụng dải màu Sorted Gradient / Highlight trên từng dòng**

Tại thẻ `<tr key={b.id}>`:
- Bổ sung class:
  ```tsx
  const currentStock = getWarehouseStock(b, warehouseTab);
  const rowHighlightClass = getStockRowHighlightClass(currentStock, stockSortMode === 'ASC' || onlyLowStock);
  ```
- Cột số lượng tồn:
  - Sử dụng `getStockAlertBadge(currentStock)` để hiển thị badge số lượng nổi bật.
  - Sách tồn 0 cuốn: hiện badge `Hết hàng (0)` nền đỏ viền đỏ.
  - Sách tồn 1–3 cuốn: hiện badge đỏ cam khẩn cấp.
  - Sách tồn 4–5 cuốn: hiện badge vàng cam cảnh báo.

- [x] **Step 5: Kiểm tra TypeScript & build**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [x] **Step 6: Commit task 2**

```bash
git add src/components/StockOverviewMatrix.tsx
git commit -m "feat(matrix): them chuc nang sap xep ton be den lon va gradient highlight sach sap het"
```

---

### Task 3: Triển Khai Sắp Xếp & Highlight Trên Báo Cáo Kiểm Kê & Chốt Ngày

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx`

- [x] **Step 1: Bổ sung state và logic sắp xếp trong Tab 2 (Kiểm Kê Đóng Thùng)**

Trong `DailyFairSettlementModal.tsx`:
1. Thêm import helper `getStockAlertBadge` và `getStockRowHighlightClass` từ `@/lib/stock-highlight`.
2. Thêm state:
   ```typescript
   const [stocktakeSortMode, setStocktakeSortMode] = useState<'DEFAULT' | 'ASC' | 'DESC'>('DEFAULT');
   const [stocktakeOnlyLow, setStocktakeOnlyLow] = useState<boolean>(false);
   ```
3. Tính toán danh sách kiểm kê hiển thị `sortedInventoryReconciliation`:
   - Lọc các sách có `theoreticalStock <= 5` khi `stocktakeOnlyLow === true`.
   - Sắp xếp tăng dần / giảm dần theo `theoreticalStock` khi `stocktakeSortMode !== 'DEFAULT'`.

- [x] **Step 2: Thêm tiêu đề cột sắp xếp và chip lọc trên giao diện Tab 2**

1. Tiêu đề cột `Tồn lý thuyết`:
   - Bấm vào để đảo chiều sắp xếp (Bé → Lớn / Lớn → Bé / Mặc định).
   - Có icon mũi tên chỉ báo rõ ràng.
2. Thêm chip lọc nhanh: `⚠️ Sắp hết (≤ 5)` ngay trên bảng sách kiểm kê.
3. Áp dụng highlight màu đỏ-cam-vàng trên cột Tồn lý thuyết và dòng bảng tương tự ma trận kho.

- [x] **Step 3: Kiểm tra TypeScript**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [x] **Step 4: Commit task 3**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx
git commit -m "feat(settlement): ho tro sap xep va highlight ton ly thuyet trong bao cao kiem ke"
```

---

### Task 4: Viết Test Tích Hợp UI & Kiểm Thử Toàn Diện Hệ Thống

**Files:**
- Create: `scripts/test-stock-sorting-ui.ts`

- [x] **Step 1: Viết test kiểm tra tương tác sắp xếp, lọc và highlight**

Tạo `scripts/test-stock-sorting-ui.ts`:
- Kiểm tra tính đúng đắn của logic sắp xếp với mảng sách mẫu (gồm các mức tồn 0, 2, 4, 5, 8, 12, 100):
  - Kiểm tra thứ tự ASC: 0, 2, 4, 5, 8, 12, 100.
  - Kiểm tra thứ tự DESC: 100, 12, 8, 5, 4, 2, 0.
  - Kiểm tra lọc `onlyLowStock`: chỉ còn [0, 2, 4, 5].
  - Kiểm tra tính toán ăn theo kho cụ thể (kho A tồn 2, kho B tồn 50 -> khi chọn kho A thì xếp theo 2).
- Kiểm tra tĩnh source code:
  - `StockOverviewMatrix.tsx` có chứa `stockSortMode`, `onlyLowStock`, `aria-sort`, `getStockRowHighlightClass`.
  - `DailyFairSettlementModal.tsx` có chứa `stocktakeSortMode`, `getStockAlertBadge`.

- [x] **Step 2: Chạy test tích hợp**

Run: `npx tsx scripts/test-stock-sorting-ui.ts`
Expected: PASS.

- [x] **Step 3: Chạy toàn bộ test suites hiện có của repo**

Run: `npx tsx scripts/test-stock-highlight.ts`
Run: `npx tsx scripts/test-settlement-ui.ts`
Run: `npx tsc --noEmit`
Expected: Tất cả bài test đều XANH, TypeScript sạch.

- [x] **Step 4: Commit task 4**

```bash
git add scripts/test-stock-sorting-ui.ts
git commit -m "test: bo sung test suite kiem tra sap xep va highlight ton kho"
```

---

## Plan Self-Review Check

- **Spec coverage:** Kế hoạch đáp ứng 100% nhu cầu của chủ doanh nghiệp: sắp xếp tồn từ Bé → Lớn theo từng kho linh hoạt + dải màu sorted gradient đỏ-cam-vàng nhận diện sách sắp hết + chip lọc nhanh.
- **Placeholder scan:** Không có bất kỳ "TODO", "TBD" hay hướng dẫn mơ hồ nào.
- **Dry & YAGNI:** Đưa logic phân loại mức tồn vào 1 helper dùng chung `stock-highlight.ts`, cả 2 màn hình đều tái dùng, không duplicate code.
- **Branch isolation:** Kế hoạch chạy trên nhánh riêng `feat/stock-sort-low-stock-highlight` đã được tạo từ `main`.
