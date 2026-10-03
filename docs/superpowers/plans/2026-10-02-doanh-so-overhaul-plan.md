# Overhaul Doanh Số & Sổ Kép Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mọi con số trên tab Doanh Số (+ ExecutiveDashboard) cộng lại được từ một nguồn duy nhất, CSV khớp màn hình, kho/kênh/giờ đúng, quyền đúng vai.

**Architecture:** Gom tầng dữ liệu chung trước (một filter cấp tab, summary từ server, luật loại trừ một chỗ), rồi sửa UI từng panel. Server sửa tối thiểu; 2 chỗ đã đúng (topEditions mặc định loại quà, gift-report đã nhận from/to) chỉ khóa bằng test.

**Tech Stack:** Next 14.2 + @opennextjs/cloudflare 1.15.1 + Turso/libsql + drizzle-orm. Test qua `npx tsx scripts/run-isolated.ts --only=<suite>` (DB cách ly `formapubli_test.db`), helper thuần qua `npx tsx` trực tiếp.

**Spec:** `docs/superpowers/specs/2026-10-02-doanh-so-overhaul-design.md`

## Global Constraints

- Mọi suite DB chung chạy qua `npx tsx scripts/run-isolated.ts --only=<tên>` — không chạy suite thẳng vào `formapubli.db`.
- `npx tsc --noEmit` 0 lỗi + `npm run build` sạch trước khi coi là xong (không chỉ tsc).
- Không hạ assertion để xanh; không log PIN/secret; không commit secret/token.
- `git add` ghi rõ từng file, không `-A`; commit trên nhánh `agent/b-doanh-so-overhaul`, KHÔNG commit lên `main`.
- Không deploy trong plan này — deploy là việc của coordinator sau review.
- Đơn W (`ORD261002000W`) giữ PENDING, không đụng trong mọi test (lọc theo `note NOT LIKE '%test%'` khi cần hoặc chỉ dùng DB cách ly).

## Review Focus

1. Dòng SPONSORSHIP `revenue = 0` nhưng `subtotal > 0` — share % và CK bình quân phải loại cả hai, không chỉ loại revenue.
2. Đơn quà 100% (`finalAmount = 0`, `discountRate = 1`) vẫn đếm vào `totalOrders` — UI phải ghi chú "gồm N đơn quà 0đ" nếu giữ.
3. Rìa ngày 00:00–07:00 VN — đơn 01:30 VN phải thuộc "hôm nay" ở mọi panel và CSV.
4. Thu ngân xem sổ nội bộ thấy đơn quà/tặng của người khác — đúng luật hiện tại (server cho), UI không được hứa "Sổ Thuế" rồi trả sổ nội bộ.
5. `customerName` chứa dấu phẩy/xuống dòng trong CSV — phải quote, không vỡ cột.

---

### Task 0: Worktree + nhánh cách ly

**Files:** (không sửa code)

- [ ] **Step 1: Tạo worktree + nhánh**
```powershell
git worktree add "D:\Data Project\formapubli-sales" main
cd "D:\Data Project\formapubli-sales"
git checkout -b agent/b-doanh-so-overhaul
```
- [ ] **Step 2: Cài node_modules riêng (KHÔNG junction — junction đã từng làm mất cả thư mục gốc)**
```powershell
npm install --include=dev
Test-Path node_modules\typescript\package.json  # phải True
```
- [ ] **Step 3: Xác nhận sạch**
```powershell
git branch --show-current  # phải ra agent/b-doanh-so-overhaul
git status --porcelain     # phải trống
```

---

### Task 1: Server — `/api/analytics` lọc theo kho + sổ

**Files:**
- Modify: `src/services/analytics.service.ts` (hàm `byChannel`, `cashflow`)
- Modify: `src/app/api/analytics/route.ts` (đọc thêm `warehouseId`, `fiscalScope`, truyền xuống)
- Test: `scripts/test-sales-scope-filter.ts` (mới)

**Interfaces:**
- Consumes: `DateRange` (`analytics.service.ts:8-11`), `rangeConds`, `createdAtBetween`.
- Produces: `byChannel(range, opts?: { warehouseId?: string; fiscalScope?: 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT' })`, `cashflow(range, opts?)` (opts truyền tiếp vào `byChannel` + conds COD). Chữ ký này Task 5/7 dùng lại.

- [ ] **Step 1: Viết test khóa (service-level, DB cách ly)**
```ts
// scripts/test-sales-scope-filter.ts
import { db } from '../src/db';
import { editions } from '../src/db/schema';
import { OrderService } from '../src/services/order.service';
import { AnalyticsService } from '../src/services/analytics.service';
import { InventoryService } from '../src/services/inventory.service';
import { assertIsolatedTestDb } from './test-guard';
assertIsolatedTestDb('test-sales-scope-filter');
let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
async function run() {
  let passed = 0; const total = 4;
  const ok = (n: string, c: boolean) => { if (c) passed++; console.log(`${c ? '✅' : '❌'} ${n}`); };
  const seeded = await db.select({ id: editions.id }).from(editions).limit(30);
  const roomy: string[] = [];
  for (const s of seeded) { if (roomy.length >= 2) break; if (await InventoryService.getBalance(s.id, 'wh-au-co', 'NEW') >= 10) roomy.push(s.id); }
  const [edA, edB] = roomy;
  await OrderService.createOrder({ warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: 'Scope A', paymentMethod: 'CASH', fiscalScope: 'INTERNAL_MANAGEMENT', cashierId: 'scope-tester', idempotencyKey: uniq('a'), items: [{ editionId: edA, quantity: 1 }] });
  await OrderService.createOrder({ warehouseId: 'wh-au-co', channel: 'RETAIL_OFFICE', customerName: 'Scope B', paymentMethod: 'CASH', fiscalScope: 'OFFICIAL_TAX', cashierId: 'scope-tester', idempotencyKey: uniq('b'), items: [{ editionId: edB, quantity: 1 }] });
  const all = await AnalyticsService.byChannel({});
  const tax = await AnalyticsService.byChannel({}, { fiscalScope: 'OFFICIAL_TAX' });
  ok('1. không filter thấy cả 2 đơn', all.reduce((s, r) => s + r.orders, 0) >= 2);
  ok('2. fiscalScope=OFFICIAL_TAX chỉ thấy đơn thuế', tax.every((r) => r.orders >= 0) && tax.reduce((s, r) => s + r.orders, 0) < all.reduce((s, r) => s + r.orders, 0));
  const cf = await AnalyticsService.cashflow({}, { fiscalScope: 'OFFICIAL_TAX' });
  ok('3. cashflow theo sổ (salesRevenue thuế < tổng)', cf.salesRevenue <= all.reduce((s, r) => s + r.revenue, 0));
  ok('4. cashflow vẫn trả netRevenue/cod/sponsor shape', typeof cf.netRevenue === 'number' && typeof cf.codPending === 'number');
  console.log(`SCOPE-FILTER: ${passed}/${total}`); process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
```
- [ ] **Step 2: Chạy, xác nhận ĐỎ (hàm chưa nhận opts)**
Run: `npx tsx scripts/run-isolated.ts --only=test-sales-scope-filter`
Expected: FAIL (TypeScript: `byChannel` không nhận tham số 2).
- [ ] **Step 3: Implement tối thiểu** — `byChannel(range, opts?)`: thêm `eq(orders.warehouseId, opts.warehouseId)` và `eq(orders.fiscalScope, opts.fiscalScope)` khi có; `cashflow(range, opts?)` truyền opts vào `byChannel` + thêm cùng 2 cond vào `codConds`; route đọc `warehouseId`/`fiscalScope` (validate scope lạ → 400, không default-allow) và truyền xuống 3 view `channels|cashflow|consignment`(consignment giữ nguyên, chỉ nhận range).
- [ ] **Step 4: Chạy lại**
Run: `npx tsx scripts/run-isolated.ts --only=test-sales-scope-filter`
Expected: PASS 4/4.
- [ ] **Step 5: Commit**
```powershell
git add src/services/analytics.service.ts src/app/api/analytics/route.ts scripts/test-sales-scope-filter.ts
git commit -m "feat(sales): analytics loc theo kho va so kep"
```

---

### Task 2: Server — báo cáo quà chỉ đơn COMPLETED + tổng đã phát

**Files:**
- Modify: `src/services/gift-report.service.ts` (thêm `AND o.status = 'COMPLETED'`, trả `totalDelivered` + `totalShortfall`)
- Test: `scripts/test-gift-completed-only.ts` (mới)

**Interfaces:**
- Consumes: không (SQL trực tiếp, đã có `from/to`).
- Produces: `GiftReportService.summary(from?, to?) → { inStock, shortfall, totalQty, totalDelivered, totalShortfall }`. Task 6 dùng `totalDelivered` cho tiêu đề.

- [ ] **Step 1: Viết test (insert trực tiếp, không phụ thuộc promotion seed)**
```ts
// scripts/test-gift-completed-only.ts
import { db, orders, orderItems, products } from '../src/db';
import { GiftReportService } from '../src/services/gift-report.service';
import { assertIsolatedTestDb } from './test-guard';
assertIsolatedTestDb('test-gift-completed-only');
const uid = () => `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
async function run() {
  let passed = 0; const total = 3;
  const ok = (n: string, c: boolean) => { if (c) passed++; console.log(`${c ? '✅' : '❌'} ${n}`); };
  const [p] = await db.select({ id: products.id }).from(products).limit(1);
  const mkOrder = async (status: string) => {
    const id = `ord-gc-${uid()}`;
    await db.insert(orders).values({ id, orderCode: `GC${uid()}`, warehouseId: 'wh-au-co', subtotal: 100000, finalAmount: 100000, idempotencyKey: `gc-${uid()}`, status } as any);
    await db.insert(orderItems).values({ id: `oi-gc-${uid()}`, orderId: id, productId: p.id, quantity: 2, unitCoverPrice: 50000, unitSellingPrice: 50000, totalAmount: 100000, isGiftLine: true } as any);
  };
  await mkOrder('COMPLETED'); await mkOrder('CANCELLED');
  const s = await GiftReportService.summary();
  ok('1. chỉ đếm quà đơn COMPLETED', s.totalQty === 2);
  ok('2. totalDelivered = quà đã phát', (s as any).totalDelivered === 2);
  ok('3. shortfall tách riêng', Array.isArray(s.shortfall));
  console.log(`GIFT-COMPLETED: ${passed}/${total}`); process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
```
- [ ] **Step 2: Chạy, xác nhận ĐỎ** (`totalQty` hiện = 4, thiếu `totalDelivered`).
- [ ] **Step 3: Implement** — thêm `AND o.status = 'COMPLETED'` vào SQL; `totalDelivered` = tổng `inStock.totalQty`, `totalShortfall` = tổng `shortfall.totalQty` (giữ `totalQty` cũ cho tương thích).
- [ ] **Step 4: Chạy lại** — PASS 3/3. Chạy hồi quy: `npx tsx scripts/run-isolated.ts --only=test-gift-shortfall`.
- [ ] **Step 5: Commit**
```powershell
git add src/services/gift-report.service.ts scripts/test-gift-completed-only.ts
git commit -m "fix(sales): bao cao qua chi don COMPLETED, tach da phat"
```

---

### Task 3: Khóa hành vi top bán chạy (không đổi code nếu xanh)

**Files:**
- Test: `scripts/test-top-gifts-locked.ts` (mới)
- Modify: `src/services/analytics.service.ts` — CHỈ nếu test đỏ.

**Interfaces:** dùng `AnalyticsService.topEditions(range, top, warehouseId?, excludeGifts?)` (đã có, mặc định loại quà).

- [ ] **Step 1: Viết test khóa mặc định** — insert 1 đơn COMPLETED có 1 dòng thường (qty 1) + 1 dòng quà cùng sản phẩm khác (qty 9, `isGiftLine: true`, `totalAmount: 0`) theo mẫu insert trực tiếp Task 2; gọi `topEditions({})` (không truyền excludeGifts) assert món quà vắng mặt + `totalGiftQty >= 9`; gọi `topEditions({}, 20, undefined, false)` assert món quà có mặt (chứng minh cờ vẫn hoạt động).
- [ ] **Step 2: Chạy** — `npx tsx scripts/run-isolated.ts --only=test-top-gifts-locked`. Nếu PASS thì KHÔNG sửa production, chỉ commit test. Nếu FAIL thì sửa service cho mặc định loại quà rồi chạy lại.
- [ ] **Step 3: Commit**
```powershell
git add scripts/test-top-gifts-locked.ts
git commit -m "test(sales): khoa top ban chay loai qua mac dinh"
```

---

### Task 4: Helper thuần dùng chung + Sổ Kép dùng summary server

**Files:**
- Create: `src/lib/sales-view.ts` (`monthPreset()`, `lastNDays()`, `channelLabel()`, `buildSalesCsv()`, `vnHour()`)
- Test: `scripts/test-sales-view-helpers.ts` (thuần, chạy thẳng `npx tsx`, không cần DB)
- Modify: `src/components/sales/SalesLedgerView.tsx` (dùng summary server + helper)

**Interfaces:**
- Produces: `monthPreset(now: Date): { startDate: string; endDate: string }` (tháng lịch VN);
  `channelLabel(c: string | null): string` (FAIR_EVENT→'Tại quầy hội chợ', RETAIL_OFFICE→'Tại quầy', SOCIAL→'Facebook Chat', WEB→'Website', fallback tiếng Việt không lộ enum);
  `buildSalesCsv(rows: Array<Record<string, unknown>>, actorId: string): string` (cột: Mã đơn, Kho, Kênh, Thanh toán, Tiền hàng, Thực thu, Sổ, Giờ VN; quote field chứa phẩy/xuống dòng);
  `vnHour(iso: string | null): string` ('HH:mm DD/MM' giờ VN, '—' khi null).
  Task 5/6 dùng lại cả 4 hàm — không tự viết label/CSV riêng.

- [ ] **Step 1: Viết test helper (đỏ trước)** — assert `monthPreset(new Date('2026-10-02T10:00:00+07:00'))` = `{ startDate: '2026-10-01', endDate: '2026-10-02' }`; `channelLabel('FAIR_EVENT')` = 'Tại quầy hội chợ'; `buildSalesCsv` chứa header `Kênh` có dấu + actorId truyền vào + quote tên khách có dấu phẩy; `vnHour('2026-10-01T18:30:00.000Z')` chứa '01:30'.
- [ ] **Step 2: Chạy** `npx tsx scripts/test-sales-view-helpers.ts` → FAIL (file chưa có).
- [ ] **Step 3: Implement** `src/lib/sales-view.ts` (dùng `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })` như `businessDateOf`, không tự tính offset).
- [ ] **Step 4: Chạy lại** → PASS. Ráp vào `SalesLedgerView`: thẻ tổng đọc `data.summary` (xóa cộng client), preset dùng helper, giờ/kho/kênh dùng helper + tên kho từ API, fetch có AbortController, skeleton khi loading.
- [ ] **Step 5: Kiểm trình duyệt thật** — `npm run dev:lan`, mở tab Doanh Số, chụp màn hình: preset "Tháng này" đúng tháng lịch, giờ VN, kho hội chợ tên đúng. (Theo luật repo: chưa đo trình duyệt thì chưa xong.)
- [ ] **Step 6: Commit**
```powershell
git add src/lib/sales-view.ts scripts/test-sales-view-helpers.ts src/components/sales/SalesLedgerView.tsx
git commit -m "feat(sales): helper dung chung, so kep dung summary server"
```

---

### Task 5: RevenueAnalyticsPanel theo filter tab + dòng tổng + CSV đúng

**Files:**
- Modify: `src/components/sales/RevenueAnalyticsPanel.tsx` (nhận `filter` props từ tab, không tự fetch toàn lịch sử)
- Modify: caller cấp tab (truyền filter xuống; không đụng `MasterAppShell` ngoài thêm props)

**Interfaces:** Consumes `channelLabel`, `buildSalesCsv` (Task 4), API Task 1 (`view=channels|cashflow` kèm ngày/kho/sổ).

- [ ] **Step 1: Test helper/router** — mở rộng `test-sales-view-helpers.ts`: assert `buildSalesCsv` với dòng SPONSORSHIP giữ nguyên dòng riêng (không gộp). Chạy đỏ trước nếu thiếu case.
- [ ] **Step 2: Implement** — panel nhận `{ startDate, endDate, warehouseId, fiscalScope }` qua props; gọi analytics kèm filter; thẻ KPI dùng `cashflow.salesRevenue/netRevenue` (không tự cộng `byChannel`); bảng thêm dòng TỔNG; dòng SPONSORSHIP giữ riêng, không gộp vào tổng doanh thu (Review Focus #1); trạng thái loading/empty riêng (không hiện 0 giả); CSV có dấu + actor thật; bỏ map kênh cứng.
- [ ] **Step 3: Kiểm trình duyệt thật** — đổi filter kho/ngày trên tab, panel đổi theo; chụp màn hình.
- [ ] **Step 4: Commit**
```powershell
git add src/components/sales/RevenueAnalyticsPanel.tsx scripts/test-sales-view-helpers.ts
git commit -m "fix(sales): revenue theo filter tab, them dong tong"
```

---

### Task 6: Top bán chạy + Báo cáo quà

**Files:**
- Modify: `src/components/sales/TopEditionsPanel.tsx` (ngày VN, nhãn, CSV)
- Modify: `src/components/sales/GiftReportPanel.tsx` (nhận `from/to` + `currentRole`, ẩn với thu ngân, nút Thử lại, hiện `lineCount` + `totalDelivered`)

**Interfaces:** Consumes helper Task 4 + API Task 1 (`top-editions` đã đúng) + Task 2 (`totalDelivered`).

- [ ] **Step 1: Implement Top** — preset ngày VN (không `setHours` giờ máy); gửi `warehouseId` + range đã có; hiện "đã tặng N cuốn" từ `totalGiftQty`; select TopN + nút refresh có nhãn nhìn thấy; CSV có dấu + cột kỳ lọc.
- [ ] **Step 2: Implement Gift** — nhận `from/to/currentRole` props; `if (!canView) return null` (OWNER/MANAGER, khớp route); gọi API kèm from/to; tiêu đề dùng `totalDelivered` ("đã phát N phần") + dòng riêng "hết tồn chưa phát"; nút Thử lại; fallback tên '—' khi null.
- [ ] **Step 3: Kiểm trình duyệt thật** — thu ngân đăng nhập không thấy panel Quà, không hộp đỏ; chụp màn hình.
- [ ] **Step 4: Commit**
```powershell
git add src/components/sales/TopEditionsPanel.tsx src/components/sales/GiftReportPanel.tsx
git commit -m "fix(sales): top ngay VN, qua theo ngay va phan quyen"
```

---

### Task 7 (phạm vi B): ExecutiveDashboard dùng chung đường ống

**Files:**
- Modify: `src/components/dashboard/ExecutiveDashboard.tsx` (fetch `/api/orders` kèm khoảng ngày + dùng summary; bỏ nạp toàn lịch sử)

**Interfaces:** Consumes `data.summary` route `/api/orders` (đã có `itemQty/itemLines/giftQty`).

- [ ] **Step 1: Đọc code thật** — mở `ExecutiveDashboard.tsx:190-200` và `:570-580`, ghi lại param hiện tại trước khi sửa (không đoán).
- [ ] **Step 2: Implement** — thêm khoảng ngày (mặc định tháng hiện tại VN) vào mọi lời gọi số liệu; số "Tổng tiền/đơn" đọc từ cùng `summary` đã lọc ⇒ bằng số tab Doanh Số cùng filter; giới hạn số dòng nạp (không ôm toàn bộ lịch sử vào RAM).
- [ ] **Step 3: Kiểm trình duyệt thật** — so dashboard vs tab Doanh Số cùng kỳ, hai số bằng nhau; chụp màn hình.
- [ ] **Step 4: Commit**
```powershell
git add src/components/dashboard/ExecutiveDashboard.tsx
git commit -m "fix(sales): dashboard dung chung duong ong so lieu"
```

---

### Task 8: Nghiệm thu toàn bộ

- [ ] **Step 1: Type + build**
```powershell
npx tsc --noEmit
npm run build
```
- [ ] **Step 2: Suite liên quan (mỗi suite qua run-isolated, không hạ assertion)**
```powershell
npx tsx scripts/run-isolated.ts --only=test-online-orders
npx tsx scripts/run-isolated.ts --only=test-order-sales
npx tsx scripts/run-isolated.ts --only=test-analytics-doanhso
npx tsx scripts/run-isolated.ts --only=test-gift-shortfall
npx tsx scripts/run-isolated.ts --only=test-gift-forgery
npx tsx scripts/run-isolated.ts --only=test-settlement
npx tsx scripts/run-isolated.ts --only=test-sales-scope-filter
npx tsx scripts/run-isolated.ts --only=test-gift-completed-only
npx tsx scripts/run-isolated.ts --only=test-top-gifts-locked
npx tsx scripts/test-sales-view-helpers.ts
```
- [ ] **Step 3: Kiểm production chỉ đọc** — đếm đơn + so tổng `COMPLETED` ngày hiện tại với số tab hiển thị (không tạo/sửa đơn nào).
- [ ] **Step 4: Báo cáo** — liệt kê suite xanh/đỏ + ảnh chụp trình duyệt, giao coordinator review + deploy. Plan này KHÔNG bao gồm deploy.
