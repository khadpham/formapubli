# Báo cáo kỳ (preset + cả chiến dịch, gom ở server) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Báo cáo theo kỳ tùy chọn (preset tới 3 tháng, cả chiến dịch), màn hình
và in cùng số, 1 request.

**Architecture:** Gom ở server trong `daily-settlement.service.ts` (báo cáo ngày
= kỳ 1 ngày qua cùng lõi); API thêm chế độ kỳ; modal thêm toggle Ngày/Kỳ +
preset; bản in trục X theo ngày.

**Tech Stack:** TypeScript + Drizzle/SQLite (repo hiện có), không migration.

**Spec:** `docs/superpowers/specs/2026-10-05-settlement-range-design.md`

## Global Constraints

- Tên UI tiếng Việt CÓ DẤU (`Cả chiến dịch`, `1 tuần`, `Tồn hiện tại`).
- Kỳ tối đa 3 tháng — hơn thì 400 lịch sự, không 500.
- Ngày nghiệp vụ VN (giờ UTC+7), hai họ timestamp cũ/mới xử lý như báo cáo
  ngày (`parseDbTimestamp`, không cắt chuỗi).
- `git add` từng file; commit thẳng `main`.
- Không hạ assertion; hằng lấy từ schema/migration.

## Review Focus

- Kỳ 1 ngày có == báo cáo ngày hiện tại từng con số không (task 2 pin).
- Tồn kỳ quá khứ có bị đọc nhầm là tồn cuối kỳ không → nhãn bắt buộc (task 4).
- Két kỳ không còn ca mở hiện gì → tiền bàn giao cuối kỳ + nhãn (task 1).
- Đơn PENDING chốt sau có bị đếm 2 kỳ không → chỉ kỳ chứa ngày chốt (task 1).
- Kỳ 3 tháng kho lớn có timeout Worker không → 1 query gom GROUP BY, đo
  thời gian trong test (task 1).

---

### Task 1: Lõi gom kỳ ở server

**Files:**
- Modify: `src/services/daily-settlement.service.ts` (thêm hàm, refactor nội
  bộ dùng chung helper, GIỮ nguyên hàm báo cáo ngày)
- Test: `scripts/test-settlement-range.ts` (mới, runtime pure +WH registry)

**Interfaces:**
- Produces (cho task 2):
  - `getSettlementRange(txOrDb, { warehouseId, startDate, endDate }): RangeReport`
    với `RangeReport = { warehouseId, startDate, endDate, dayCount, days: DaySlice[], totals: { netSales, discount, orders, qty }, paymentBreakdown, topSellers, pendingSnapshot, cashbox: { openedFirst, closedLast }, stockNote: 'Tồn hiện tại' }`.
    `DaySlice` tái dùng đúng shape ngày hiện tại (để modal/in không viết lại).
  - `inferCampaignRange(txOrDb, warehouseId): { startDate, endDate } | null`
    (min/max ngày có đơn COMPLETED; null khi kho chưa có đơn).
  - Quy tắc: start > end → INVALID; kỳ > 3 tháng → INVALID; warehouse lạ/
    ngưng → INVALID; họ ảo → FORBIDDEN (dùng `isForbiddenWarehouseFamily`).

- [ ] **Step 1: Viết test pure cho hàm gom**

```ts
// aggregate 3 DaySlice giả → totals bằng tổng tay, top gộp đúng
import { aggregateDaySlices } from '../src/services/daily-settlement.service';
const days = [
  { netSales: 100, orders: 2, top: [{ code: 'A', qty: 2 }] },
  { netSales: 200, orders: 3, top: [{ code: 'A', qty: 1 }, { code: 'B', qty: 5 }] },
];
const r = aggregateDaySlices(days);
assert.equal(r.totals.netSales, 300);
assert.equal(r.topSellers[0].code, 'B');
```

(Expose `aggregateDaySlices(days: DaySlice[]): Totals` pure để test không cần DB.)

- [ ] **Step 2: Chạy, xác nhận FAIL (chưa có hàm)**
- [ ] **Step 3: Tách helper gom ngày hiện tại thành hàm dùng chung
  (`buildDaySlice`), viết `aggregateDaySlices` + `getSettlementRange` +
  `inferCampaignRange`. Báo cáo ngày cũ gọi `buildDaySlice` — output
  byte-identical (khóa bằng suite settlement cũ ở task 5).**
- [ ] **Step 4: Chạy test mới, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/services/daily-settlement.service.ts scripts/test-settlement-range.ts
git commit -m 'feat(baocao): loi gom ky server + aggregateDaySlices'
```

### Task 2: API chế độ kỳ

**Files:**
- Modify: `src/app/api/pos/daily-settlement/route.ts`
- Test: bổ sung vào `scripts/test-settlement-range.ts` (regex)

**Interfaces:**
- Consumes: `getSettlementRange`, `inferCampaignRange` (task 1).
- Produces (cho task 3): `GET ?warehouseId=&start=&end=` → `{ success, mode: 'range', ...RangeReport }`; `GET ?warehouseId=&campaign=1` → `{ success, startDate, endDate } | { success, empty: true }`. `?date=` cũ giữ nguyên shape.

- [ ] **Step 1: Thêm test**

```ts
ok(/mode: 'range'/.test(route), 'API trả mode range');
ok(/inferCampaignRange/.test(route), 'API suy kỳ chiến dịch');
ok(/3 tháng|90/.test(route), 'API chặn kỳ quá dài');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Nối (validate warehouse/date ở biên; role như báo cáo ngày;
  lỗi trả 400/403 JSON đúng mẫu `handleApiError`)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/app/api/pos/daily-settlement/route.ts scripts/test-settlement-range.ts
git commit -m 'feat(baocao): API che-do-ky + campaign'
```

### Task 3: Modal Ngày/Kỳ + preset

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx`
- Test: bổ sung regex vào `scripts/test-settlement-range.ts`

**Interfaces:**
- Consumes: API task 2.

- [ ] **Step 1: Thêm test**

```ts
ok(/Cả chiến dịch/.test(modal), 'có nút Cả chiến dịch');
ok(/1 tuần/.test(modal) && /3 tháng/.test(modal), 'đủ preset tới 3 tháng');
ok(/Ngày\/Kỳ|mode === 'range'/.test(modal), 'toggle Ngày/Kỳ');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Nối (toggle + 2 ô date + preset 1/2 tuần, 1/3 tháng + nút Cả
  chiến dịch chỉ kho FAIR_EVENT; fetch theo mode; state kỳ hiển thị ở tiêu
  đề + giữ tab FINANCIALS hiện tại cho cả 2 mode)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-range.ts
git commit -m 'feat(baocao): modal che-do-ky + preset + ca-chien-dich'
```

### Task 4: Bản in kỳ

**Files:**
- Modify: `src/components/pos/DailyFairSettlementModal.tsx` (phần in)
- Test: bổ sung regex vào `scripts/test-settlement-range.ts`

- [ ] **Step 1: Thêm test**

```ts
ok(/Tồn hiện tại/.test(modal), 'in kỳ ghi rõ tồn hiện tại, không bịa tồn cuối kỳ');
ok(/Doanh thu theo ngày/.test(modal), 'in kỳ có dải theo ngày');
```

- [ ] **Step 2: Chạy, xác nhận FAIL**
- [ ] **Step 3: Nối (trục X theo ngày; top cả kỳ; két mở đầu→đóng cuối; tiêu đề
  + số biên bản ghi rõ kỳ; SVG thuần rect/text như dải giờ)**
- [ ] **Step 4: Chạy, xác nhận PASS**
- [ ] **Step 5: Commit**

```bash
git add src/components/pos/DailyFairSettlementModal.tsx scripts/test-settlement-range.ts
git commit -m 'feat(baocao): ban-in-ky'
```

### Task 5: Khóa hồi quy + đóng đợt a-z

**Files:**
- Modify: `scripts/run-isolated.ts` (đăng ký suite; đăng ký sớm từ task 1 khi
  thực thi để `--only` chạy được)

- [ ] **Step 1: Chạy tsc + suite mới + TOÀN BỘ suite settlement/print cũ**

Run: `npx tsc --noEmit` (PASS không output)
Run: `npx tsx scripts/run-isolated.ts --only=test-settlement-range,test-settlement-hourly-chart,test-settlement-money-header,test-settlement-print,test-settlement-print-css,test-s4-settlement`
Expected: PASS toàn bộ (báo cáo ngày cũ byte-identical).

- [ ] **Step 2: Commit đăng ký suite, push, build, deploy**

```bash
git add scripts/run-isolated.ts
git commit -m 'chore: dang-ky suite settlement-range; dong dot bao-cao-ky'
git push origin main
npm run build
npm run deploy
```

Báo version ID cuối cùng.
