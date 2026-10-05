# Tab Doanh Số: sắp xếp + mở rộng + xuất CSV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi bảng tab Doanh Số sort được, mở fullscreen được, xuất CSV được.

**Architecture:** Hạ tầng dùng chung mới (`table-ux.tsx` + overlay + 1 helper
CSV); 4 panel tự nối vào, không refactor 3 bản xuất cũ đang chạy. Sort
client-side (dữ liệu đã tải hết).

**Tech Stack:** React + Tailwind (repo hiện có), không thêm dep.

**Spec:** `docs/superpowers/specs/2026-10-05-sales-table-ux-design.md`

## Global Constraints

- Tên UI tiếng Việt CÓ DẤU, ngắn (`Mở rộng`, `Xuất Excel/CSV`, `Số đơn`, `Thực thu`).
- Mỗi hành động có dấu hiệu bấm rõ + trạng thái sau bấm (aria-sort, aria-pressed).
- Không hạ assertion để xanh; test hằng/giá trị lấy từ nguồn thật.
- `git add` từng file, không `-A`; commit thẳng `main` (làm một mình).
- CSV nào cũng BOM + watermark actorId thật (mẫu 3 bảng cũ).

## Review Focus

- Bảng nghìn dòng sort client có đơ UI không → sort trên `filteredOrders` đã
  cắt trang, không sort toàn DOM (task 4 test với 5000 dòng giả).
- Overlay mobile có kẹt cuộn nền không → test tay + body overflow hidden (task 3).
- Sort tiền theo số thô hay số hiển thị → số thô `discountAmount` (task 4).
- Top 100 sort "trong N dòng đã tải" có gây hiểu nhầm toàn bộ không → nhãn ghi
  rõ (task 5).
- CSV quà thiếu watermark actor → chặn xuất khi chưa có actorId như 3 bảng kia (task 6).

---

### Task 0: Top 10 đơn giá trị cao (đang treo chưa commit)

**Files:**
- Modify: `src/components/dashboard/TopOrdersCard.tsx` (đã sửa slice+title, kiểm lại)
- Test: chạy suite cũ (không suite mới)

**Interfaces:** không đổi.

- [ ] **Step 1: Kiểm lại diff**

```bash
git diff -- src/components/dashboard/TopOrdersCard.tsx
```

Trông đợi: `slice(0, 10)`, title `Top 10 đơn giá trị cao`, comment `Top 10`.

- [ ] **Step 2: Chạy tsc + suite dashboard**

Run: `npx tsc --noEmit`
Expected: PASS (no output)

Run: `npx tsx scripts/run-isolated.ts --only=test-dashboard-ui-text,test-dashboard-and-stocktake-ui`
Expected: PASS toàn bộ.

- [ ] **Step 3: Commit riêng**

```bash
git add src/components/dashboard/TopOrdersCard.tsx
git commit -m 'ui(dashboard): top don gia tri cao 5 -> 10'
```

### Task 1: `useSortable` + `SortableTh` dùng chung

**Files:**
- Create: `src/lib/table-ux.tsx`
- Test: `scripts/test-sales-table-ux.ts` (bổ sung dần qua các task)

**Interfaces:**
- Consumes: không.
- Produces (cho task 4–7):
  - `sortRows<T>(rows: T[], key: string, dir: 'asc'|'desc', get: (r: T, key: string) => string|number): T[]` — pure, stable, số/ngày/chữ(vi).
  - `useSortable<T>(rows: T[], defKey: string, defDir: 'asc'|'desc', get): { sorted, sortKey, sortDir, toggleSort }`
  - `<SortableTh label="Thực thu" sortKey="finalAmount" align="right" />` — nút trong `th`, hiện ▲▼, `aria-sort`.

- [ ] **Step 1: Viết test runtime cho pure function**

Tạo `scripts/test-sales-table-ux.ts` với đoạn runtime (không chỉ regex):

```ts
import { sortRows } from '../src/lib/table-ux';
const rows = [{ a: 3 }, { a: 1 }, { a: 2 }];
const asc = sortRows(rows, 'a', 'asc', (r) => r.a).map((r) => r.a);
assert.deepEqual(asc, [1, 2, 3]);
```

- [ ] **Step 2: Chạy, xác nhận FAIL (module chưa có)**

Run: `npx tsx scripts/test-sales-table-ux.ts`
Expected: FAIL cannot find module.

- [ ] **Step 3: Viết `src/lib/table-ux.tsx` tối thiểu**

Comparator: số (Number.isFinite → trừ), ngày ISO (Date.parse, NaN về cuối),
còn lại `String(a).localeCompare(String(b), 'vi')`. `null/undefined` về cuối
mọi chiều. Stable: giữ index gốc khi bằng nhau. `SortableTh` render
`<th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>`
chứa `<button>` + `▲/▼` + `sr-only` hướng hiện tại.

- [ ] **Step 4: Chạy lại, xác nhận PASS**

Run: `npx tsx scripts/test-sales-table-ux.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-ux.tsx scripts/test-sales-table-ux.ts
git commit -m 'feat(sales): sort dùng chung useSortable + SortableTh'
```

### Task 2: Helper xuất CSV dùng chung (cho bảng quà)

**Files:**
- Modify: `src/lib/sales-view.ts` (thêm hàm, không sửa hàm cũ)
- Test: bổ sung vào `scripts/test-sales-table-ux.ts`

**Interfaces:**
- Produces (cho task 6): `downloadWatermarkedCsv(opts: { filename, headers: string[], rows: string[][], rawObjects: Record<string,unknown>[], meta: { actorId, actorRole, reportName, fiscalScope } }): boolean` — trả `false` + alert khi thiếu dữ liệu/actor (đúng mẫu 3 bảng cũ); BOM + `appendExportWatermark` + Blob + tên file.

- [ ] **Step 1: Thêm assertion regex vào suite**

```ts
ok(/export function downloadWatermarkedCsv/.test(salesView), 'helper xuất CSV dùng chung');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Viết hàm (copy đúng mẫu TopEditionsPanel: cell escape,
  BOM, watermark, Blob, cleanup URL)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/lib/sales-view.ts scripts/test-sales-table-ux.ts
git commit -m 'feat(sales): helper xuat CSV watermark dùng chung'
```

### Task 3: `TableExpandOverlay`

**Files:**
- Create: `src/components/sales/TableExpandOverlay.tsx`
- Test: bổ sung regex vào `scripts/test-sales-table-ux.ts`

**Interfaces:**
- Produces (cho task 4–7): `<TableExpandOverlay title="Sổ đơn" buttonLabel="Mở rộng">` bọc vùng cuộn bảng. State nội bộ `expanded`; khi mở portal ra body `fixed inset-0 z-[70]`, nền bấm ra thu lại, Esc thu lại (dùng `useModalFocusTrap` + `PortalToBody` như POS), `document.body.style.overflow` hidden/khôi phục.

- [ ] **Step 1: Thêm assertion regex**

```ts
ok(/TableExpandOverlay/.test(overlay), 'overlay tồn tại');
ok(/useModalFocusTrap/.test(overlay), 'overlay bẫy focus + Esc');
ok(/createPortal|PortalToBody/.test(overlay), 'overlay portal ra body');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Viết component (nút Maximize2 + overlay + header có nút Thu lại)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/components/sales/TableExpandOverlay.tsx scripts/test-sales-table-ux.ts
git commit -m 'feat(sales): overlay mo-rong bang fullscreen'
```

### Task 4: Nối sổ đơn (sort + overlay)

**Files:**
- Modify: `src/components/sales/SalesLedgerView.tsx:232-240,618-634,695-711`
- Test: bổ sung regex + runtime 5000 dòng vào `scripts/test-sales-table-ux.ts`

**Interfaces:**
- Consumes: `useSortable`, `SortableTh`, `TableExpandOverlay` (task 1, 3).

- [ ] **Step 1: Thêm test**

```ts
ok(/SortableTh[^>]*sortKey="finalAmount"/.test(ledger), 'cột Thực thu sort được');
ok(/SortableTh[^>]*sortKey="discountAmount"/.test(ledger), 'cột Chiết khấu sort được');
ok(/SortableTh[^>]*sortKey="createdAt"/.test(ledger), 'cột Thời gian sort được');
ok(/<TableExpandOverlay/.test(ledger), 'bảng đơn mở rộng được');
// Runtime: sort 5000 dòng < 1s
const big = Array.from({ length: 5000 }, (_, i) => ({ v: 5000 - i }));
const t0 = Date.now();
sortRows(big, 'v', 'asc', (r) => r.v);
assert.ok(Date.now() - t0 < 1000, 'sort 5000 dòng dưới 1s');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Nối (sort `filteredOrders` trước `slice` pageSize; thead dùng
  `SortableTh` cho 3 cột; bọc `div.overflow-x-auto` bằng overlay)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/components/sales/SalesLedgerView.tsx scripts/test-sales-table-ux.ts
git commit -m 'feat(sales): so-don sort + mo-rong'
```

### Task 5: Nối sách bán chạy (Top 100 + sort + overlay)

**Files:**
- Modify: `src/components/sales/TopEditionsPanel.tsx`
- Test: bổ sung vào `scripts/test-sales-table-ux.ts`

- [ ] **Step 1: Thêm test**

```ts
ok(/value=\{100\}/.test(topEditions), 'có option Top 100 (= trần API)');
ok(/SortableTh[^>]*sortKey="(qty|orders|revenue)"/.test(topEditions), 'sort 3 cột');
ok(/<TableExpandOverlay/.test(topEditions), 'mở rộng được');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Nối (option Top 100 + nhãn "tối đa 100"; sort client trên dòng
  đã tải + nhãn "xếp trong N dòng đã tải"; bọc bảng bằng overlay)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/components/sales/TopEditionsPanel.tsx scripts/test-sales-table-ux.ts
git commit -m 'feat(sales): sach-ban-chay top100 + sort + mo-rong'
```

### Task 6: Nối bảng quà (xuất CSV + sort + overlay)

**Files:**
- Modify: `src/components/sales/GiftReportPanel.tsx`
- Test: bổ sung vào `scripts/test-sales-table-ux.ts`

- [ ] **Step 1: Thêm test**

```ts
ok(/downloadWatermarkedCsv/.test(gift), 'bảng quà xuất CSV watermark');
ok(/Xuất Excel\/CSV/.test(gift), 'nút xuất đúng nhãn');
ok(/<TableExpandOverlay/.test(gift), 'mở rộng được');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Nối (headers: Sản phẩm, Dòng quà, Tổng cuốn; filename
  `Qua_Tang_<from>_<to>.csv`; sort Tổng cuốn; overlay; chặn xuất khi thiếu
  actorId đúng mẫu)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/components/sales/GiftReportPanel.tsx scripts/test-sales-table-ux.ts
git commit -m 'feat(sales): bang-qua xuat CSV + sort + mo-rong'
```

### Task 7: Nối nguồn doanh thu (overlay) + đóng đợt

**Files:**
- Modify: `src/components/sales/RevenueAnalyticsPanel.tsx`
- Test: bổ sung vào `scripts/test-sales-table-ux.ts`

- [ ] **Step 1: Thêm test `ok(/<TableExpandOverlay/.test(revenue), ...)`**
- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Bọc bảng bằng overlay (giữ nguyên thứ tự nhóm + xuất cũ)**
- [ ] **Step 4: Chạy suite mới + toàn bộ suite sales cũ, xác nhận PASS**

Run: `npx tsc --noEmit` (PASS không output)
Run: `npx tsx scripts/run-isolated.ts --only=test-sales-table-ux` (PASS)

- [ ] **Step 5: Đăng ký suite vào `scripts/run-isolated.ts`, commit, push,
  build, deploy a-z**

```bash
git add src/components/sales/RevenueAnalyticsPanel.tsx scripts/test-sales-table-ux.ts scripts/run-isolated.ts
git commit -m 'feat(sales): nguon-doanh-thu mo-rong; dong dot table-ux'
git push origin main
```

(Đăng ký suite vào runner ngay task 1 để `--only` chạy được từ đầu — dời
dòng đăng ký lên task 1 khi thực thi.)
