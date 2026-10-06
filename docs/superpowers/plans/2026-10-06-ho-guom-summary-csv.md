# Bảng Tổng Hợp Hồ Gươm + Mở Kỳ Cho Quản Lý + Xuất CSV — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox syntax.

**Goal:** Quản lý xem được báo cáo kỳ/cả chiến dịch và xuất 3 file CSV tổng hợp Hồ Gươm đúng phạm vi kho + kỳ đang xem.

**Architecture:** Nới `canViewRange` server+client từ OWNER lên OWNER+MANAGER; thêm `GET /api/reports/ho-guom-summary` gom full đầu sách tái dùng `getSettlementRange`; nút Xuất CSV client-side serialize đúng payload, BOM UTF-8, chỉ Quản lý trở lên.

**Tech Stack:** TypeScript + Next 14 + Drizzle/SQLite hiện có, CSV thuần (không dep), test `run-isolated.ts`.

**Spec:** Yêu cầu chủ 06/10/2026 (chat): cột 3 file CSV đã duyệt; mở kỳ/campaign cho Quản lý; nút Xuất CSV cả kỳ chỉ Quản lý trở lên, chọn kho + mốc thời gian + Cả chiến dịch; branch `feat/ho-guom-summary-csv`.

## Global Constraints

- UI tiếng Việt CÓ DẤU (`Cả chiến dịch`, `Xuất CSV`, `Tồn hiện tại`).
- Kỳ tối đa 92 ngày — hơn thì 400 lịch sự, không 500.
- Ngày VN (+7h SQL), hai họ timestamp qua `parseDbTimestamp`, không cắt chuỗi.
- Chỉ đơn `COMPLETED` (+ `shopeeDeliveredOnly()`); PENDING chốt sau vào kỳ chứa ngày chốt.
- Hằng từ nguồn thật: `CASH | BANK_TRANSFER | QR_CODE (+TRANSFER cũ)`; ledger `RECEIPT | DISPATCH_SALE | DISPATCH_GIFT | ADJUSTMENT | RETURN_INBOUND`. CẤM `QR_TRANSFER`.
- Quà (`is_gift_line=1`) chỉ vào `giftSummary`, KHÔNG vào doanh thu/top.
- Tồn chỉ **tồn hiện tại + nhãn rõ**.
- Header file: `FORMApubli`.
- `git add` từng file, KHÔNG `-A`; không commit hộ PNG bẩn + thư mục lạ; không hạ assertion.
- Sửa `.css` thì phải `npm run build`.

## Review Focus

- Manager gọi kỳ hết 403 chưa; Cashier/Kho/Thuế gọi kỳ vẫn 403.
- Kỳ 1 ngày cho Manager == báo cáo ngày cũ từng số.
- CSV đủ full đầu sách ngoài top 10; quà không lọt doanh thu (cắt code phải đỏ).
- Tồn CSV nhãn hiện tại; kỳ quá khứ không bị đọc nhầm tồn cuối kỳ.
- Kỳ > 92 ngày / đảo ngày / kho lạ / 30/2 → 400 lịch sự.

---

### Task 0: Nới quyền xem Kỳ cho Quản lý (server + modal + suite cũ)

**Files:** Modify `src/app/api/pos/daily-settlement/route.ts` (dòng 78), `src/components/pos/DailyFairSettlementModal.tsx` (dòng 387 + comment), `scripts/test-settlement-range.ts`.

**Ra cho task sau:** Manager fetch `?start=&end=` / `?campaign=1` trả 200 thay vì 403.

- [ ] **Step 1: Test đỏ quyền mới** — bổ sung vào `test-settlement-range.ts`: `ok(/ROLE_MANAGER/.test(settleRoute), 'Ky mo cho Quan ly');` + `ok(/ROLE_MANAGER/.test(settleModal), 'modal hien Ky cho Quan ly');`
- [ ] **Step 2: Chạy, xác nhận FAIL** — Run `npx tsx scripts/test-settlement-range.ts`, Expected FAIL ở 2 assertion mới.
- [ ] **Step 3: Nới tối thiểu** — route.ts:78 `['ROLE_OWNER']` → `['ROLE_OWNER', 'ROLE_MANAGER']`; modal:387 `=== 'ROLE_OWNER'` → `=== 'ROLE_OWNER' || currentRole === 'ROLE_MANAGER'`; sửa comment chốt 05/10 (route 71-73, modal 385-386/900-901/505) thành `Kỳ: Chủ + Quản lý`.
- [ ] **Step 4: PASS** — Run lại suite, Expected PASS toàn bộ.
- [ ] **Step 5: Commit** — `git add` 3 file trên, `git commit -m "feat(baocao): mo-bao-cao-ky-cho-quan-ly"`.

---

### Task 1: API full đầu sách Hồ Gươm (không dừng top 10)

**Files:** Create `src/services/ho-guom-summary.service.ts`, `src/app/api/reports/ho-guom-summary/route.ts`; Test `scripts/test-ho-guom-summary.ts` (mới).

**Ăn:** `getSettlementRange`, `inferCampaignRange`, `aggregateSellerLines`, `GiftReportService.summary`. **Ra:** `GET .../ho-guom-summary?warehouseId=&start=&end=` hoặc `?campaign=1` → `{ success, mode:'ho-guom-summary', warehouse, range, totals, days[], lines[] FULL, gifts, stockNote }`. Mỗi line: `{ code,title,coverPrice,soldQty,soldRevenue,giftQty,totalOut,stockNow,rankQty,rankRevenue,group }`.

- [ ] **Step 1: Test đỏ shape API** — file test mới assert route có `ROLE_OWNER` + `ROLE_MANAGER`, mode `ho-guom-summary`, chặn ngày xấu (`assertVnDay|BAD_RANGE`).
- [ ] **Step 2: FAIL** — Run `npx tsx scripts/test-ho-guom-summary.ts`, Expected FAIL (ENOENT chưa có route).
---

### Task 2: Nút Xuất CSV cả kỳ trong modal (chỉ Quản lý trở lên)

**Files:** Create `src/lib/csv-export.ts` (helper BOM + escape, pure); Modify `src/components/pos/DailyFairSettlementModal.tsx` (nút + tải 3 file); Test bổ sung vào `scripts/test-ho-guom-summary.ts`.

**Ăn:** API task 1 + state kỳ đang xem (`currentWarehouseId`, `rangeStart/End`). **Ra:** 3 file `ho-guom-<kho>-<start>_<end>-{dau-sach,ngay,qua}.csv`, header `FORMApubli | Kho ... | Kỳ ... | Xuất lúc ... (giờ VN)`.

- [ ] **Step 1: Thêm test** — `ok(/Xuất CSV/.test(settleModal), 'modal Ky co nut Xuat CSV');` + `ok(/canExportCsv|ROLE_MANAGER/.test(settleModal), 'nut CSV chi Quan ly tro len');` + `ok(/ho-guom-summary/.test(settleModal), 'CSV doc tu API tong hop');` + `ok(/FEFF|BOM/.test(csvLib), 'CSV co BOM mo bang Excel');`
- [ ] **Step 2: FAIL** — Run test, Expected FAIL (`Xuất CSV` chưa có).
- [ ] **Step 3: Nối tối thiểu** — `toCsv(rows)` escape `"`,`,`,newline + prefix `\uFEFF`, join `\r\n`; `downloadCsv(filename, csv)` via Blob+anchor. Modal: `const canExportCsv = canViewRange;` nút cạnh nút In, chỉ hiện khi `isRangeData && canExportCsv`; bấm → fetch summary đúng phạm vi → dựng 3 CSV theo cột đã duyệt → tải từng file → hiện `Đã xuất 3 file CSV (<n> đầu sách, kỳ <start>→<end>)`.
- [ ] **Step 4: PASS** — Run test + `npx tsc --noEmit`, Expected PASS + sạch.
- [ ] **Step 5: Commit** — `git add` 3 file task này, `git commit -m "feat(baocao): nut-xuat-csv-ky-ho-guom"`.

---

### Task 3: Đăng ký suite + khóa hồi quy + đóng đợt

**Files:** Modify `scripts/run-isolated.ts` (thêm `scripts/test-ho-guom-summary.ts`).

- [ ] **Step 1: Verify** — Run `npx tsc --noEmit` (sạch) + `npx tsx scripts/run-isolated.ts --only=test-ho-guom-summary,test-settlement-range,test-settlement,test-s4-settlement,test-settlement-print,test-settlement-print-css,test-exclude-gifts-from-top` (PASS toàn bộ, báo cáo ngày byte-identical).
- [ ] **Step 2: Commit + push branch, mở PR (KHÔNG deploy vội)** — `git add scripts/run-isolated.ts`, `git commit -m "chore: dang-ky-suite-ho-guom-summary"`, `git push -u origin feat/ho-guom-summary-csv`. Deploy chỉ khi chủ gật (cây còn PNG bẩn + thư mục lạ).

- [ ] **Step 3: Implement** — service: gọi `getSettlementRange` (kế thừa validate 92 ngày/kho lạ/30-2 + COMPLETED/VN/SHOPEE/quà/tồn), query `order_items` của kỳ rồi gom FULL sellerAgg (không slice 10), sort `soldCopies DESC, soldRevenue DESC`, gán hạng + nhóm (top 20% Bán chạy / bottom 20% Bán chậm / 0 Không bán / còn lại Bình thường); route: `requireSessionRole(['ROLE_OWNER','ROLE_MANAGER'])`, validate warehouseId + start/end hoặc campaign (copy mẫu daily-settlement 86-127).
- [ ] **Step 4: PASS + cắt đỏ** — Run test → PASS; `npx tsc --noEmit` sạch; đổi `BANK_TRANSFER` thành `QR_TRANSFER` trong service → test DB kỳ-1-ngày-==-ngày phải ĐỎ; hoàn lại.
- [ ] **Step 5: Commit** — `git add` 3 file task này, `git commit -m "feat(baocao): api-tong-hop-ho-guom-full-dau-sach"`.
