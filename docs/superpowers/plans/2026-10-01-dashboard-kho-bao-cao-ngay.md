# Dashboard theo kho + Báo cáo ngày (in A4 gọn) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dropdown kho trên dashboard thành bộ lọc toàn trang (nhớ lựa chọn), sửa lỗi in báo cáo ngày ra trang trắng, và làm giàu báo cáo ngày (đơn lớn nhất + top bán chạy + bản in A4 gọn 1–2 trang).

**Architecture:** Không migration, không đụng `closeDay`/cron. Lọc dashboard bằng `warehouseId` đã có ở `GET /api/orders` + thêm param tùy chọn cho `stockSummary`. Sửa CSS in (độ đặc hiệu). Mở rộng `getDailyFairSettlement` bằng trường cộng thêm `highlight`.

**Tech Stack:** Next 14.2.35, Drizzle + Turso, Tailwind (`print:` variant), `window.print()` + `@media print` A4 portrait, `npx tsx scripts/run-isolated.ts` cho test DB chung.

**Spec:** Yêu cầu gốc của owner (chat 01/10/2026): (1) dropdown kho lọc toàn bộ dashboard — doanh thu thực tế, tồn kho, đơn đã chốt, doanh thu 7 ngày, top 5 đơn, đơn gần đây theo kho đã chọn, mặc định **nhớ kho đã chọn**; (2) kho Hồ Gươm đang bán thật — chỉ đọc, không migration, không đụng chốt ngày; (3) in báo cáo ngày đang trắng — sửa + thêm đơn giá trị cao nhất (hình thức TT, số SP) + top bán chạy kèm số lượng + bảng/biểu đồ trực quan, bản in gọn 1–2 trang A4 portrait.

## Global Constraints

- BẤT BIẾN: giữ `[vars] NEXT_PRIVATE_MINIMAL_MODE="1"` trong `wrangler.toml`.
- BẤT BIẾN: giữ twin backslash `@libsql\\client` trong `next.config.mjs`.
- KHÔNG commit secret/token (kể cả `scripts/deploy-cloudflare.ts`).
- KHÔNG migration mới; KHÔNG sửa `closeDay`, cron auto-close, trigger tồn kho.
- KHÔNG ghi production trong test (không tạo đơn/chốt ngày ở kho Hồ Gươm); script ghi DB mới phải gọi `requireProdWriteConsent()`.
- Tên UI tiếng Việt CÓ DẤU, ngắn gọn (đã chốt chữ hiện tại, không đổi nhãn trừ nhãn scope kho).
- Mỗi nút phải có dấu hiệu bấm rõ (đã có, giữ nguyên).
- Test qua `npx tsx scripts/run-isolated.ts --only=...`; không hạ assertion để xanh.
- `git add` ghi rõ từng file, KHÔNG `-A`; chỉ deploy khi cây sạch + tsc + build + suite liên quan xanh.
- Ngày nghiệp vụ = ngày VN: lọc ngày trong SQL bằng `substr(datetime(col,'+7 hours'),1,10)`, CẤM `substr(col,1,10)` / `LIKE 'YYYY-MM-DD%'`.

## Review Focus

- In trên Chrome thật ra trang trắng dù code đã sửa (CSS print chỉ kiểm được bằng preview thật, không bằng test tĩnh).
- Chọn kho Hồ Gươm nhưng dashboard vẫn hiện số kho khác (lọc sót một nguồn: orders / stock-summary / top-editions).
- Thu ngân bị gán kho thấy được số kho khác qua dashboard (lọc đọc theo `assignedWarehouseId`).
- Đơn lớn nhất sai khi có 2 đơn bằng tiền nhau (lấy 1, phải ổn định theo thời gian tạo).
- Bản in tràn sang trang 3+ khi top bán chạy dài (giới hạn 5 dòng in + `break-inside: avoid`).

---

### Task 1: Sửa lỗi in trắng (CSS `:has` tự nuốt chính nó)

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx` (khối `<style jsx global>` `@media print`, dòng ~201–209)
- Test: `scripts/test-settlement-print-css.ts` (mới, chỉ đọc file kiểm chuỗi, không chạm DB)

**Interfaces:**
- Consumes: không có (sửa CSS thuần).
- Produces: selector in ấn loại trừ `#printable-settlement-report` khỏi quy tắc ẩn, để Task 4 tái dùng.

**Root cause đã xác minh (không đoán):** selector `body > *:not(:has(#printable-settlement-report))` có độ đặc hiệu (1,0,1) — ID nằm trong `:has()` vẫn tính điểm — thắng rule `#printable-settlement-report { display:block !important }` (1,0,0). Cả hai đều `!important` nên bản in luôn `display:none` → trang trắng. Không liên quan dữ liệu.

- [ ] **Step 1: Viết test tĩnh thất bại**

```ts
// scripts/test-settlement-print-css.ts
import fs from 'node:fs';
const src = fs.readFileSync('src/components/pos/DailyFairSettlementModal.tsx', 'utf8');
const m = src.match(/body\s*>\s*\*:not\(:has\(#printable-settlement-report\)\)([^{]*)\{/);
if (!m) throw new Error('Không tìm thấy selector ẩn khi in — cập nhật test theo CSS mới.');
if (!/:not\(#printable-settlement-report\)/.test(m[1])) {
  throw new Error('LỖI: selector ẩn khi in nuốt cả #printable-settlement-report (độ đặc hiệu thắng display:block) → in ra trắng.');
}
console.log('OK: selector in loại trừ đúng bản in.');
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx tsx scripts/test-settlement-print-css.ts`
Expected: FAIL với "nuốt cả #printable-settlement-report".

- [ ] **Step 3: Sửa tối thiểu — thêm `:not(#printable-settlement-report)`**

```tsx
body > *:not(:has(#printable-settlement-report)):not(#printable-settlement-report) {
  display: none !important;
}
```

Chỉ đổi đúng selector này, không đụng các rule còn lại (`#printable... display:block`, `.no-print`, `@page A4 portrait` giữ nguyên).

- [ ] **Step 4: Chạy test, xác nhận XANH**

Run: `npx tsx scripts/test-settlement-print-css.ts`
Expected: PASS "OK: selector in loại trừ đúng bản in."

- [ ] **Step 5: Verify bằng trình duyệt thật (bắt buộc, test tĩnh không đủ)**

Mở dashboard → Báo Cáo Ngày → In Báo Cáo → xem print preview có nội dung (không cần máy in). Ghi nhận pass/fail vào commit message.

- [ ] **Step 6: Commit**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-print-css.ts
git commit -m "fix(report): sua selector print nuot ban in, in bao cao ngay het trang trang"
```

---

### Task 2: `stockSummary(warehouseId?)` — tồn kho theo kho (cộng thêm, không đổi contract cũ)

**Files:**
- Modify: `src/services/analytics.service.ts:66-101` (thêm tham số tùy chọn `warehouseId?: string`)
- Modify: `src/app/api/analytics/route.ts:49-51` (đọc `warehouseId` từ query, truyền xuống)
- Test: `scripts/test-stock-summary-scope.ts` (mới, chạy qua run-isolated)

**Interfaces:**
- Consumes: `stockBalances`, `editions`, `warehouses` (đã import sẵn trong file).
- Produces: `AnalyticsService.stockSummary(warehouseId?: string)` — không tham số trả y hệt cũ (5 kho, `warehouseCount`, `warehouseNames` đầy đủ); có tham số thì chỉ tính kho đó và `warehouseCount=1`, `warehouseNames=[tên kho đó]`.

- [ ] **Step 1: Viết test thất bại (copy khối setup từ `scripts/test-s4-settlement.ts:1-60`)**

```ts
// scripts/test-stock-summary-scope.ts
import { AnalyticsService } from '../src/services/analytics.service';
const all = await AnalyticsService.stockSummary();
const one = await AnalyticsService.stockSummary('wh-au-co');
if (!(one.totalUnits <= all.totalUnits)) throw new Error('Lọc kho sai: tồn kho con lớn hơn tồn toàn hệ thống.');
if (one.warehouseCount !== 1) throw new Error(`warehouseCount phải =1, nhận ${one.warehouseCount}.`);
if (all.warehouseCount < 2) throw new Error('Giả định test sai: cần >=2 kho.');
console.log('OK: stockSummary loc dung theo kho.');
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx tsx scripts/run-isolated.ts --only=test-stock-summary-scope`
Expected: FAIL (hàm chưa nhận tham số — TypeScript báo hoặc `warehouseCount !== 1`).

- [ ] **Step 3: Triển khai tối thiểu**

```ts
static async stockSummary(warehouseId?: string) {
  const conds = [
    sql`${stockBalances.physicalQuantity} > 0`,
    sql`${editions.isActive} = 1`,
    sql`${warehouses.isActive} = 1`,
  ];
  if (warehouseId) conds.push(eq(stockBalances.warehouseId, warehouseId));
  // ... where(and(...conds)) cho query rows; query whs thêm eq(warehouses.id, warehouseId) khi có param
}
```

`eq` đã import trong file. Query `skus` (tổng SKU toàn hệ thống) giữ nguyên không lọc.

- [ ] **Step 4: Route truyền param (2 dòng)**

```ts
if (view === 'stock-summary') {
  const warehouseId = searchParams.get('warehouseId') || undefined;
  return NextResponse.json({ success: true, data: await AnalyticsService.stockSummary(warehouseId) });
}
```

- [ ] **Step 5: Chạy test, xác nhận XANH + hồi quy analytics cũ xanh**

Run: `npx tsx scripts/run-isolated.ts --only=test-stock-summary-scope`
Expected: PASS. Sau đó chạy suite analytics hiện có (tìm tên trong `scripts/run-isolated.ts`) đảm bảo không vỡ.

- [ ] **Step 6: Commit**

```bash
git add src/services/analytics.service.ts src/app/api/analytics/route.ts scripts/test-stock-summary-scope.ts
git commit -m "feat(analytics): stockSummary loc theo warehouseId, giu nguyen contract cu"
```

---

### Task 3: Dashboard lọc toàn trang theo kho + nhớ lựa chọn

**Files:**
- Modify: `src/components/dashboard/ExecutiveDashboard.tsx` (state kho, fetch, nhãn scope, thẻ kho động)
- Test: dùng test Task 2 (backend) + `npx tsc --noEmit` + kiểm tay trình duyệt; không thêm test mới (logic lọc server-side đã có ở `/api/orders?warehouseId=`, xem `src/app/api/orders/route.ts:68`)

**Interfaces:**
- Consumes: `GET /api/orders?fiscalScope=ALL&warehouseId=` (đã hỗ trợ), `GET /api/analytics?view=stock-summary&warehouseId=` (Task 2), `GET /api/warehouses?all=true` (đã dùng).
- Produces: `selectedWarehouseId: 'ALL' | warehouseId` — mọi số trên trang (4 KPI, tách sổ kép, trend 7 ngày, donut, top 5, đơn gần đây, thẻ tồn) phản ánh đúng scope; nút Báo Cáo Ngày mở đúng kho đang chọn.

Chi tiết triển khai (giữ diff ngắn nhất):

```tsx
const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(() =>
  (typeof window !== 'undefined' && localStorage.getItem('dashboard.warehouseId')) || 'ALL'
);
// thay selectedSettlementWarehouseId hiện tại; option đầu dropdown = "Tất cả kho"
const pick = (id: string) => { setSelectedWarehouseId(id); try { localStorage.setItem('dashboard.warehouseId', id); } catch {} };
// fetchDashboardData: url orders += id!=='ALL' ? `&warehouseId=${id}` : ''; stock += tương tự
// modal nhận warehouseId = id==='ALL' ? kho FAIR_EVENT đầu tiên (giữ hành vi cũ) : id
```

- KPI "Tồn Kho Vật Lý (N Kho)" khi lọc 1 kho hiện `(1 Kho)` + tên kho đó (dữ liệu Task 2 đã có `warehouseNames`).
- Cột phải "Kho Vận Vật Lý" đang viết cứng 3 kho (`ExecutiveDashboard.tsx:497-527`): dựng từ `warehouses` API (tên + nhãn loại), không thêm API mới.
- Tiêu đề banner thêm dòng scope: `Phạm vi: Tất cả kho` / `Phạm vi: <tên kho>` (1 dòng, không đổi nhãn khác).
- Phân quyền đọc: thu ngân có `assignedWarehouseId` thì ép `selectedWarehouseId = assignedWarehouseId` và ẩn option kho khác (dùng `/api/auth/me` đã có ở POS; không thêm endpoint). Nếu `currentRole` không phải owner/manager/cashier-gán-kho, giữ 'ALL'.
- Biểu đồ 7 ngày / top 5 / đơn gần đây KHÔNG đổi code (chúng tính từ `orders` đã lọc) — ghi rõ trong commit để reviewer khỏi tìm.

- [ ] **Step 1: Sửa `ExecutiveDashboard.tsx` theo chi tiết trên (1 file)**

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sạch.

- [ ] **Step 3: Kiểm tay 3 scope (bắt buộc)**

'ALL' (số = hiện tại) → 1 kho có đơn → 1 kho trống (hiện "Chưa có đơn", không vỡ layout). Ghi nhận vào commit message.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/ExecutiveDashboard.tsx
git commit -m "feat(dashboard): dropdown kho loc toan trang, nho lua chon, the kho dong"
```

---

### Task 4: Báo cáo ngày giàu hơn + bản in A4 gọn (đơn lớn nhất, top bán chạy trực quan)

**Files:**
- Modify: `src/services/daily-settlement.service.ts` (thêm `highlight` vào object trả về `getDailyFairSettlement`, sau `topSellers`)
- Modify: `src/components/pos/DailyFairSettlementModal.tsx` (thẻ "Đơn Nổi Bật" trong tab Doanh Số + thanh ngang cho Top 10 hiện có + khối in gọn)
- Test: `scripts/test-settlement-highlight.ts` (mới, qua run-isolated: tạo 2 đơn COMPLETED cùng kho/ngày VN khác tiền → highlight = đơn lớn hơn, `itemCount` đúng, `paymentMethod` đúng)

**Interfaces:**
- Consumes: `dayOrders` (đã có trong hàm) + 1 query đếm `orderItems` theo `orderId` (gom 1 lần, không N+1).
- Produces: `highlight: { orderCode, finalAmount, subtotal, discountAmount, paymentMethod, itemCount, createdAt } | null` — `null` khi ngày không có đơn.

Triển khai service (tối thiểu, trong `getDailyFairSettlement` sau khi tính `topSellers`):

```ts
const countByOrder = new Map<string, number>();
if (orderIds.length > 0) {
  const rows = await txOrDb.select({ orderId: orderItems.orderId, qty: sql<number>`COALESCE(SUM(${orderItems.quantity}),0)` })
    .from(orderItems).where(sql`${orderItems.orderId} IN (${sql.join(orderIds.map((id: string) => sql`${id}`), sql`, `)})`)
    .groupBy(orderItems.orderId);
  for (const r of rows) countByOrder.set(r.orderId, Number(r.qty || 0));
}
const top1 = [...dayOrders].sort((a: any, b: any) => (b.finalAmount || 0) - (a.finalAmount || 0))[0];
const highlight = top1 ? { orderCode: top1.orderCode, finalAmount: top1.finalAmount, subtotal: top1.subtotal, discountAmount: top1.discountAmount, paymentMethod: top1.paymentMethod, itemCount: countByOrder.get(top1.id) || 0, createdAt: top1.createdAt } : null;
// return { ..., topSellers, highlight, inventoryReconciliation }
```

UI màn hình (tab Doanh Số, trên cùng): thẻ "Đơn Giá Trị Cao Nhất" — mã đơn (mono) + thực thu + hình thức TT + số SP + giờ VN; thanh ngang tỉ lệ `finalAmount/netSales`. Tab Chiết Khấu: danh sách Top 10 hiện có thêm thanh ngang theo `soldCopies` (CSS thuần, không lib).

Bản in (`#printable-settlement-report`, sau phần I hiện có): thêm mục "I-bis. ĐIỂM NHẤN NGÀY" gọn — thực thu, số đơn, đơn lớn nhất (mã + tiền + HTTT + số SP), top 5 bán chạy (mã + tên + số cuốn, tối đa 5 dòng). Bảng tồn đầy đủ KHÔNG in (mới: bọc bảng tồn trong `<div className="print:hidden">`, giữ tổng tồn lý thuyết 1 dòng). Mỗi khối `break-inside: avoid`.

- [ ] **Step 1: Viết test service thất bại (copy setup từ `scripts/test-s4-settlement.ts`)**

Assert: `highlight.orderCode` = mã đơn lớn hơn; `highlight.itemCount` = tổng quantity đã gieo; `paymentMethod` khớp; ngày không đơn → `highlight === null`.

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

Run: `npx tsx scripts/run-isolated.ts --only=test-settlement-highlight`
Expected: FAIL (`highlight` undefined).

- [ ] **Step 3: Thêm `highlight` vào service (theo code trên)**

- [ ] **Step 4: Chạy test, xác nhận XANH + hồi quy settlement xanh**

Run: `npx tsx scripts/run-isolated.ts --only=test-settlement-highlight` rồi các suite settlement hiện có (`test-s4-settlement`, `test-settlement-*`).

- [ ] **Step 5: Thêm UI màn hình + khối in gọn (cùng file modal)**

- [ ] **Step 6: Verify preview in thật (bắt buộc): gọn ≤ 2 trang A4 portrait**

- [ ] **Step 7: Commit (tách service và UI nếu reviewer yêu cầu, mặc định 1 commit)**

```bash
git add src/services/daily-settlement.service.ts src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-highlight.ts
git commit -m "feat(report): don lon nhat + top ban chay truc quan + ban in A4 gon"
```

---

### Task 5: Review độc lập + verify tầng đúng + deploy

**Files:** không sửa code (chỉ đọc + chạy lệnh), trừ khi reviewer bắt sửa (sửa theo nhận xét rồi lặp lại Task tương ứng).

- [ ] **Step 1: Typecheck + build**

Run: `npx tsc --noEmit` rồi `npm run build` (build khi đã tắt `next dev` — build đè `.next` làm dev 404 CSS).
Expected: cả hai sạch.

- [ ] **Step 2: Chạy toàn bộ suite liên quan**

Run: `npx tsx scripts/run-isolated.ts --only=test-settlement-print-css,test-stock-summary-scope,test-settlement-highlight` + các suite settlement/analytics/orders hiện có.
Expected: xanh hết, không hạ assertion.

- [ ] **Step 3: Review code độc lập (subagent reviewer mới, đọc diff từ main)**

Kiểm: không migration, không đụng closeDay/cron/trigger, không log PIN/secret, nhãn Việt có dấu, nút bấm rõ, `:has` fix đúng, `assignedWarehouseId` được tôn trọng, bản in ≤ 2 trang.

- [ ] **Step 4: Xác nhận cây sạch + đúng branch**

Run: `git status --porcelain` (trống) và đang ở branch tính năng trước khi merge/deploy.

- [ ] **Step 5: Verify live CHỈ ĐỌC (không tạo đơn ở kho Hồ Gươm)**

`GET /api/analytics?view=stock-summary&warehouseId=<kho-ho-guom>` + `GET /api/pos/daily-settlement?warehouseId=<kho-ho-guom>` trên production trả 200 và số khớp dashboard. KHÔNG chạy `verify-pos-live.ts` nguyên bản (nó tạo đơn thật).

- [ ] **Step 6: Merge + deploy + báo version**

Merge vào `main`, `npm run deploy`, `git ls-remote` xác nhận, báo Cloudflare version ID (không phải commit SHA).

## Self-Review

- Spec coverage: ý 1 → Task 2+3; ý 2 (an toàn Hồ Gươm) → Global Constraints + Task 5 Step 5; ý 3a (in trắng) → Task 1; ý 3b (giàu thông tin + biểu đồ + in A4) → Task 4. Đủ.
- Placeholder scan: không TBD/TODO; mọi step có lệnh/code cụ thể.
- Type consistency: `highlight` định nghĩa 1 lần ở Task 4 và UI đọc đúng tên trường; `stockSummary(warehouseId?)` dùng 1 chữ ký ở Task 2+3.
- Review Focus: 5 dòng đã có test/step chủ sở hữu (in thật Task 1 Step 5 + Task 4 Step 6; lọc sót Task 3 Step 3; phân quyền Task 3; hòa tiền Task 4 test; tràn trang Task 4 Step 6).
