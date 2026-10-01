# Kế hoạch triển khai: Sản phẩm hàng hóa + Khuyến mại

Ngày: 2026-10-01 · Kèm theo: `specs/2026-10-01-khuyen-mai-va-hang-hoa-design.md`

> ## ⚠️ TRẠNG THÁI THẬT — dòng này thay cho "chờ duyệt, chưa viết dòng code nào"
>
> - `871b1d9` và `6973276` — **đã lên `main`** do agent khác merge nhánh tôi.
>   Đây là vi phạm quy tắc "không bao giờ commit trên main"; đã tách sang
>   worktree `D:\Data Project\formapubli-promo` branch `feat/khuyen-mai-san-pham`.
> - Cổng 2 E2E đạt **33/33 xanh** từng lần. Còn nợ: `0033` trên prod + kiểm lại sau deploy.

## Cập nhật 01/10/2026 — sau ca đêm

> Đọc mục này trước, phần dưới còn mô tả trạng thái **trước ca đêm**.

### A. Đã chạy trên PRODUCTION

| Việc | Trạng thái | Bằng chứng |
|---|---|---|
| Migration `0031` (3 bảng products/promotions/promotion_gifts + 7 cột nullable) | **ĐÃ ÁP** | `PRAGMA table_info` từng bảng |
| Backfill `0031b` | **ĐÃ ÁP** | editions 88/88 · order_items 217/217 · inventory_ledger 1657/1657 · stock_balances 440/440 · `product_id IS NULL = 0` ở cả 4 bảng |
| `integrity_check` | ok | — |
| `foreign_key_check` | sạch | — |
| Migration `0032` (dựng lại `stock_balances` + `order_items`) | **ĐÃ ÁP** | Không mất dòng |
| Migration `0033` (dựng lại `inventory_ledger`) | **ĐÃ VIẾT, CHƯA ÁP** | — |
| Deploy `0e2ed259-ed75-4ca5-be8f-83562ae3ed1c` | site HTTP 200 | — |
| Deploy tiếp (sau 0033) | **ĐANG LÀM** | — |

### B. Backup + khôi phục — ĐÃ CHỨNG MINH

- **Không có script backup nào trong repo làm được.** `backup-db.ts` chỉ copy file local, prod là Turso.
- Đã viết `backup-prod.ts` (chỉ đọc) + `restore-prod.ts` (có `--thuc-hien` + `ALLOW_REMOTE_TARGET`).
- **Đã thử khôi phục THẬT vào DB rỗng** → 6/6 bảng khớp production chính xác:
  works 87 · editions 88 · warehouses 5 · orders 79 · order_items 217 · stock_balances 440.
  `integrity` ok, FK sạch, đủ 3 trigger.
- Backup có đủ dữ liệu kho Hồ Gươm: 88 dòng tồn · 331 bút toán · 40 đơn · 73 dòng đơn · 5 ca két.

⇒ PHẦN 8 mục 1 ("chưa xác minh được đường khôi phục") **đã đóng**.

### C. NỢ KỸ THUẬT CẦN GHI

| # | Nợ | Sự thật đã đo |
|---|---|---|
| C1 | `scripts/test-royalties.ts` **FLAKY, có từ TRƯỚC đêm nay** | Cùng code, cùng DB sạch, 3 lần cho EXIT = `0, 1, 1`. Chạy trên code trước đêm nay cũng `0, 1, 1`. **Không liên quan thay đổi đêm nay** |
| C2 | Biện minh bỏ qua C1 | Production có `rights_contracts` = **0 dòng**, audit log royalty = **0 hoạt động**. Tính năng chưa ai dùng |
| C3 | `inventory_ledger` thiếu **87 bút toán "nhập kho"** tại kho Hồ Gươm | Ledger âm **-85.494** trong khi `stock_balances` **đúng** (440 dòng, không âm). Hàng vật lý đúng; **SỔ thiếu**. Cần ghi bù |

### D. Bài học đã mắc — đừng lặp lại

1. **DDL phải lấy NGUYÊN VĂN từ `sqlite_master` của production.** Lần tự viết `0033` theo bản `0000` → thiếu cột `reversal_of` → `no such column`.
2. **Không suy luận "`products.id === editions.id` cho sách nên thay `edition_id` bằng `product_id` ở mọi nơi là tương đương".** SAI — đã làm lệch số liều.
3. **Một lần chạy test KHÔNG đủ để kết luận.** Đã chạy 1 lần thấy xanh → kết luận "sai", chạy lại thấy đỏ → kết luận "thủ phạm là X". Thực ra test flaky. **Phải chạy lặp ≥3 lần.**
4. **`verify-pos-live.ts` KHÔNG phải "chỉ đọc"** — nó tạo đơn thật qua `POST /api/orders` (dòng 206).

---

## PHẦN 0 — BẢNG TUẦN TỰ (đọc phần này để báo team)

`P` = production. Mỗi bước chỉ làm sau khi bước trước **xanh và đã được duyệt**.

### Giai đoạn 0 — Chuẩn bị (ban ngày)

| # | Bước | Việc | Sub-agent | Đụng P? |
|---|---|---|---|---|
| 0.1 | Chốt B3 | Tồn âm → chọn (b) | — | Không |
| 0.2 | Đọc lại spec + plan | Nắm 24 quyết định, 15 lỗi chặn | — | Không |
| 0.3 | Chờ agent khác xong | `run-isolated.ts` đang bị sửa | — | Không |
| 0.4 | Chạy lại toàn bộ suite | Xanh trước khi bắt đầu | — | Không |
| 0.5 | Tạo nhánh git | `feat/khuyen-mai-san-pham`, **không** commit trên main | — | Không |

### Giai đoạn 1 — Cổng 1: Schema (code ban ngày, áp tối)

| # | Bước | Việc | Sub-agent | Đụng P? |
|---|---|---|---|---|
| 1.1 | Viết DDL | `0031_products_promotions.sql` — 3 bảng + 7 cột | Không (DDL dễ sai) | Không |
| 1.2 | Cập nhật journal | `_journal.json` — `when` tăng nghiêm ngặt | Không | Không |
| 1.3 | Test trên DB sạch | `setup-test-db.ts` + migrate-fresh | Không | Không |
| 1.4 | Test idempotency | Chạy 2 lần không lỗi | Không | Không |
| 1.5 | Viết script prod | `apply-0031-prod.ts` — khuôn `apply-0030-prod.ts` | Không | Không |
| 1.6 | Dry-run trên DB test | `ALLOW_PROD_WRITE` trên DB file | Không | Không |
| 1.7 | **`tsc` + `build`** | Bằng chứng tầng 1 + 2 | Không | Không |
| 1.8 | **ÁP PROD** | `apply-0031-prod.ts` | **Không** | **✅ CÓ** |
| 1.9 | Xác nhận | `PRAGMA table_info` từng bảng | — | Chỉ đọc |
| 🛑 | **MỐC 1** | Dừng, báo bạn | — | — |

### Giai đoạn 2 — Cổng 1b: Backfill (tối, sau backup)

| # | Bước | Việc | Sub-agent | Đụng P? |
|---|---|---|---|---|
| 2.1 | **Backup DB prod** | `backup-prod.ts` — đã viết, đã thử khôi phục thật ✅ | Không | **✅ CÓ** |
| 2.2 | Xác nhận backup | Mở được, đủ số bảng | — | Chỉ đọc |
| 2.3 | `INSERT products` | ~88 dòng — nhanh | Không | **✅ CÓ** |
| 2.4 | `UPDATE editions` | 88 dòng — nhanh | Không | **✅ CÓ** |
| 2.5 | `UPDATE order_items` | **Dòng này lâu nhất** | Không | **✅ CÓ** |
| 2.6 | `UPDATE inventory_ledger` | — | Không | **✅ CÓ** |
| 2.7 | `UPDATE stock_balances` | — | Không | **✅ CÓ** |
| 2.8 | `CREATE UNIQUE INDEX` | **SAU backfill** | Không | **✅ CÓ** |
| 2.9 | Kiểm NULL | `WHERE product_id IS NULL` → phải = 0 | — | Chỉ đọc |
| 2.10 | Đơn thử trên prod | Quét sách, thanh toán 1 đơn nhỏ | — | **✅ CÓ** |
| 🛑 | **MỐC 2** | Dừng, báo bạn | — | — |

### Giai đoạn 3 — Cổng 2: Đọc `products` (code ban ngày, deploy tối)

| # | Bước | Việc | Sub-agent | Đụng P? |
|---|---|---|---|---|
| 3.1 | `pos-catalog.service.ts:71` | **Nguồn thật của lưới POS** — không sửa thì hàng hóa biến mất | Không | Không |
| 3.2 | `api/pos/live-monitor/route.ts:289` | Màn hình giám sát | **Có** | Không |
| 3.3 | `inventory.service.ts:974` | Lịch sử bút toán kho | **Có** | Không |
| 3.4 | `analytics.service.ts:89` | Tổng tồn theo kho | **Có** | Không |
| 3.5 | `rma.service.ts:301` | RMA | **Có** | Không |
| 3.6 | `allocation.service.ts:141` | Phân bổ quầy | **Có** | Không |
| 3.7 | `reader-profile.service.ts:68,140` | Hồ sơ người đọc | **Có** | Không |
| 3.8 | `bundle.service.ts:63` | Combo | **Có** | Không |
| 3.9 | Khớp mã vạch | `PosCheckoutTerminal.tsx:1217-1246` thêm `products.barcode` | Không | Không |
| 3.10 | Test sách không hỏng | Sách cũ ra **y hệt** trước đây | **Có** | Không |
| 3.11 | API tạo/sửa sản phẩm | `POST /api/products`, `PATCH /:id` | Không | Không |
| 3.12 | UI nhập sản phẩm | Danh mục: thêm / sửa / tạm ngưng | **Có** | Không |
| 3.13 | 10 bảng còn lại | Thêm `product_id` — ưu tiên thấp | **Có** | Không |
| 3.14 | **`tsc` + `build` + suite** | Toàn bộ xanh | — | Không |
| 3.15 | **`git status`** | Phải SẠCH — build đọc working tree | — | Không |
| 3.16 | **DEPLOY** | `npm run deploy` | **Không** | **✅ CÓ** |
| 3.17 | Verify tầng 3 | `verify-pos-live.ts` | — | Chỉ đọc |
| 3.18 | Thử thật cùng bạn | Quét sách + quét hàng hóa | — | **✅ CÓ** |
| 3.19 | Nhập hàng hóa thật | Tạo qua UI, nhập tồn `RECEIPT` | **Có** | **✅ CÓ** |
| 🛑 | **MỐC 3** | Dừng, báo bạn | — | — |

### Giai đoạn 4 — ĐÓNG BỨC TƯỜNG (bằng chứng, không phải số ngày)

⚠️ Bản đầu ghi *"chờ ≥ 1 tuần tại hội chợ"* — **con số bịa, không có cơ sở.** Đã kiểm tra: hệ thống không lưu ngày kết thúc hội chợ (`warehouse_type = FAIR_EVENT` không có ngày). Và nếu hội chợ chỉ kéo 4–5 ngày thì con số đó vô nghĩa.

Giai đoạn này thay bằng **điều kiện bằng chứng**, đo được, không đếm ngày:

| # | Điều kiện | Cách kiểm | Đủ chưa? |
|---|---|---|---|
| 4.1 | Sách: ≥ 50 đơn thật trên prod, **không lỗi POS** | Đếm `orders` theo ngày | ☐ |
| 4.2 | Hàng hóa: ≥ 10 đơn có hàng hóa, **tồn kho khớp** | So `order_items` vs `inventory_ledger` | ☐ |
| 4.3 | Báo cáo sách **không đổi** so với trước Cổng 2 | So số liệu tuần trước / tuần này | ☐ |
| 4.4 | Tồn kho sách **không âm** | `SELECT COUNT(*) FROM stock_balances WHERE physical_quantity < 0` → 0 | ☐ |
| 4.5 | Không có đơn nào fail giữa chừng | Log lỗi 500 | ☐ |

**Đủ 5/5 thì sang Cổng 3.** Không đủ thì sửa, không làm tiếp.

#### 4.6 — ⚠️ Cổng 3 làm **SAU HỘI CHỢ** (đã chốt)

Đây là điều tôi chưa nói rõ ở lượt trước, và nó quan trọng hơn con số "1 tuần":

| | Cổng 1–2 | Cổng 3 |
|---|---|---|
| Đụng đường tiền? | Không | **Có** |
| Lỗi xảy ra thì sao | Sách vẫn bán bình thường | **Đơn không chốt được, treo quầy** |
| Khách đang đứng trước quầy | Không sao | **Có** |
| Lỗi B1 (403 mọi đơn có quà) | — | Chặn cả POS |

**Trong hội chợ, lỗi Cổng 3 không phải lỗi kỹ thuật — nó là mất tiền thật giữa lúc đông khách.**

→ ✅ **ĐÃ CHỐT: Cổng 1–2 làm trong hội chợ. Cổng 3 dồn tới sau hội chợ kết thúc.**

**Cổng 1–2 an toàn giữa hội chợ** vì không đụng đường tiền: sách đọc `editions` y như cũ, hàng hóa là thêm vào, lỗi nào chỉ ảnh hưởng sản phẩm mới.

### Giai đoạn 5 — Cổng 3: Logic khuyến mại

| # | Bước | Việc | Sub-agent | Đụng P? |
|---|---|---|---|---|
| 🛑 | **MỐC 4** | Duyệt bắt đầu Cổng 3 | — | Không |
| 5.1 | Fix B15 | Đo query/đơn 5–15 dòng — trần 50 subrequest | **Có** | Không |
| 5.2 | Fix B1 | `route.ts:334-346` — 403 mọi đơn có quà | Không | Không |
| 5.3 | Fix B4 | `order.service.ts:526-572` — `subtotal` nhiễm giá quà | Không | Không |
| 5.4 | Fix B5 + B6 | Approval hash + `originalAmount` | Không | Không |
| 5.5 | Fix B8 | `offline-db.ts` — đơn offline thu thiếu tiền | Không | Không |
| 5.6 | Fix B11 | `forecast.service.ts` — DoI tính quà | **Có** | Không |
| 5.7 | Fix B2 tầng 1–2 | ATP cho quà (theo B3=(b)) | Không | Không |
| 5.8 | Hàm `computeGifts` | **Thuần khiết, không query DB** | **Có** | Không |
| 5.9 | Server engine | Nguồn sự thật, tự tra giá, tự kiểm bậc | Không | Không |
| 5.10 | UI cài đặt quà | Nút **"Khuyến mãi"** trong tab POS | **Có** | Không |
| 5.11 | UI dòng quà | Badge **"Quà"**, nút **"Bỏ quà"** / **"Tặng thêm"** | **Có** | Không |
| 5.12 | Rút gọn nút 🎁 | Thành **"100%"** | **Có** | Không |
| 5.13 | Báo cáo quà | Số lượng quà đã phát | **Có** | Không |
| 5.14 | Test 7 tình huống biên | Xem mục B3.5 | Không | Không |
| 5.15 | **`tsc` + `build` + suite** | Toàn bộ xanh | — | Không |
| 5.16 | **DEPLOY** | `npm run deploy` | **Không** | **✅ CÓ** |
| 5.17 | Verify + thử thật | Test cả 7 tình huống trên prod | — | **✅ CÓ** |
| 🛑 | **MỐC 5** | Dừng, báo bạn | — | — |

### Tổng số lần đụng production

**4 lần** — bước 1.8, 2.1–2.8, 3.16, 5.16. **Đều vào ban đêm sau khi đóng ca.**

### Phân công sub-agent

| Nhóm | Bước | Vì sao giao được |
|---|---|---|
| 8 chỗ join (3.2–3.8) | Độc lập, cùng một kiểu sửa | Không chạm file nhau |
| UI (3.12, 5.10–5.12) | Độc lập | Không chạm file nhau |
| Báo cáo (3.4, 5.6, 5.13) | Độc lập | Không chạm file nhau |
| **DDL + migration (1.1–1.8)** | **KHÔNG giao** | Sai 1 cột = 500 toàn hệ thống |
| **Engine quà (5.8–5.9)** | **KHÔNG giao** | Lệch client/server = mất tiền |
| **Approval/discount (5.2–5.4)** | **KHÔNG giao** | Liên quan bảo mật tiền |

⚠️ Không cho sub-agent chạy `git commit` / `deploy` (`AGENTS.md` mục 3).

---

## PHẦN 1 — TRẢ LỜI CÂU HỎI CỐT LÕI: TỪ BƯỚC NÀO ĐỤNG VÀO PRODUCTION?

### Quy tắc

> **Mọi việc viết code chạy trên máy local, KHÔNG đụng production.**
> **Chỉ 3 hành động duy nhất đụng production.**

| # | Hành động đụng production | Bắt buộc báo trước |
|---|---|---|
| **A** | Chạy `ALLOW_PROD_WRITE=true npx tsx scripts/apply-00XX-prod.ts` | **CÓ** — cần kho đóng |
| **B** | `npm run deploy` | **CÓ** — cần kho đóng |
| **C** | `npx tsx scripts/verify-pos-live.ts` | **CÓ — CẦN KHO ĐÓNG** |
| **D** | Bất kỳ script `trace-*.ts` / `health-check-prod.ts` | **CÓ** — xem ghi chú dưới |

> ### 🔴 SỬA — `verify-pos-live.ts` KHÔNG phải "chỉ đọc"
>
> Bản đầu của plan xếp nó vào nhóm chỉ đọc. **Sai.** Đọc file thật:
> - `:181` — `BƯỚC GHI THẬT — tạo một đơn qua POST /api/orders`
> - `:206` — `method: 'POST'` vào `/api/orders`
> - `:216` — assert *"25. POST /api/orders tạo đơn thật"*
>
> Nó **tạo đơn thật trong kho đang bán**. Chạy lúc đang bán là tự tạo đơn rác
> giữa ca, trừ tồn kho thật. → **Xếp vào nhóm cần kho đóng**, giống deploy.

> ### Ghi chú: script đụng production KHÔNG nằm trong test runner
>
> `run-isolated.ts` có danh sách suite **tường minh**, và ép
> `DATABASE_URL=file:formapubli_test.db`. Đã kiểm: nó **không** chạy
> `apply-0031-prod.ts`, `health-check-prod.ts`, `verify-pos-live.ts` hay bất kỳ
> `trace-*.ts` nào. ⇒ `npm run test:isolated` an toàn.
>
> Nhưng những script đó **cố ý** trỏ production. Người khác chạy tay là chuyện
> khác — chúng đều có `requireExplicitTarget()` in ra host đích và bắt gõ
> `ALLOW_REMOTE_TARGET=<host>`.

### Bản đồ cổng

| Cổng | Nội dung | Đụng production? | Khi nào |
|---|---|---|---|
| **1** | 3 bảng + 9 cột (thêm, không `UPDATE`) | ✅ **A** | Tối, kho đóng |
| **1b** | Backfill 4 bảng + tạo index | ✅ **A** | Tối, kho đóng, **sau khi backup** |
| **2** | 9 chỗ join đọc `products` + API sản phẩm + UI nhập | ✅ **B** | Tối, kho đóng |
| **3** | Engine quà + UI khuyến mại + fix 9 lỗi chặn | ✅ **B** | Tối, kho đóng |

**Điểm quan trọng:** Cổng 1 chỉ tạo bảng/cột **chưa ai đọc**. Sách vẫn đọc `editions` y như cũ. **POS không nhận ra gì thay đổi ngay sau Cổng 1.**

### Nhịp đề xuất

| Ngày | Việc | Đụng prod? |
|---|---|---|
| **Ban ngày** (đang bán) | Viết code, `tsc`, `build`, chạy test suite | **KHÔNG** |
| **Tối, sau khi đóng ca** | Áp migration → deploy → verify | **CÓ** |

⚠️ Bản build phải xong **trước** giờ đóng ca. Nếu tối mới bắt đầu viết code thì không kịp — cần dời sang đêm khác.

### Điều kiện KHÔNG được bỏ qua

| # | Điều kiện | Lý do |
|---|---|---|
| 1 | `git status --porcelain` **SẠCH** trước khi deploy | Build đọc working tree, nuốt code chưa commit của agent khác. Đã xảy ra, commit `dbf1dd94` lên prod (`AGENTS.md` mục 3) |
| 2 | `npx tsc --noEmit` sạch | Bằng chứng tầng 1 |
| 3 | `npm run build` sạch | Bằng chứng tầng 2 |
| 4 | `run-isolated.ts` **toàn bộ** xanh | Không hạ assertion để xanh (`AGENTS.md` mục 0) |
| 5 | `verify-pos-live.ts` xanh sau deploy | Bằng chứng tầng 3 — HTTP thật |
| 6 | **Backup DB prod** trước Cổng 1b | Đêm 01/10 đã có `backup-prod.ts` + `restore-prod.ts`, đã thử khôi phục thật khớp 6/6 bảng |

⚠️ Hiện `scripts/run-isolated.ts` đang bị agent khác sửa. **Chạy lại toàn bộ suite sau khi agent đó xong.**

---

## PHẦN 2 — CỔNG 1: SCHEMA

**Mục tiêu:** DB có chỗ chứa sản phẩm và quà. UI chưa hiện gì.
**Rủi ro:** THẤP · **Rollback:** `DROP` 3 bảng + 9 cột, vô hại.

### B1.1 — Chuẩn bị (không đụng prod)

- [ ] Tạo `src/db/migrations/0031_products_promotions.sql` — lấy DDL **nguyên văn** từ file migration hiện có, không tự viết (sai cột = 500 toàn hệ thống)
- [ ] Cập nhật `src/db/migrations/meta/_journal.json` — `when` phải tăng nghiêm ngặt, nếu không drizzle migrator **bỏ qua im lặng** (`test-cp3-migrations.ts:259-297`)
- [ ] Dung lượng: `products` ~88 dòng (bằng số ấn bản). `promotions` + `promotion_gifts` vài chục dòng

### B1.2 — Script áp production

Khuôn: `scripts/apply-0030-prod.ts` (53 dòng).

- [ ] Tạo `scripts/apply-0031-prod.ts`
- [ ] Dùng `requireProdWriteConsent()` từ `prod-write-guard` — chặn nếu không có `ALLOW_PROD_WRITE=true`
- [ ] Mỗi câu SQL: `PRAGMA table_info` kiểm tra trước → `db.execute()` **một lần** → log kết quả
- [ ] Không dùng `migrate-fresh.ts`: không transaction, không rollback, prod không có `__drizzle_migrations` nên chạy lại **không resume được** (`:77-97`)

**SQL của Cổng 1 — CHỈ THÊM, KHÔNG `UPDATE`:**

```
CREATE TABLE IF NOT EXISTS products (...)
CREATE TABLE IF NOT EXISTS promotions (...)
CREATE TABLE IF NOT EXISTS promotion_gifts (...)

ALTER TABLE editions         ADD COLUMN product_id text
ALTER TABLE order_items      ADD COLUMN product_id text
ALTER TABLE inventory_ledger ADD COLUMN product_id text
ALTER TABLE stock_balances   ADD COLUMN product_id text
ALTER TABLE order_items      ADD COLUMN promotion_id text
ALTER TABLE order_items      ADD COLUMN is_gift_line integer NOT NULL DEFAULT 0
ALTER TABLE order_items      ADD COLUMN is_manual integer NOT NULL DEFAULT 0
```

⚠️ `ALTER TABLE ADD COLUMN` là thao tác tức thời — SQLite không đọc lại bảng, không giữ khoá lâu. Đã chứng minh trên prod (`apply-0030-prod.ts:31`).

### B1.3 — Báo cáo sau khi chạy

- [ ] `PRAGMA table_info` từng bảng — xác nhận cột có thật
- [ ] `SELECT COUNT(*) FROM editions` — bằng số trước khi áp

### 🛑 MỐC 1 — DỪNG, CẦN BẠN CHO PHÉP

```
Báo: "Cổng 1 xong. DB prod đã có bảng products/promotions/promotion_gifts
      + 7 cột. Sách đọc editions y như cũ. POS không đổi gì.
      Xong phần DB. Cho phép tiếp không?"
```

---

## PHẦN 3 — CỔNG 1b: BACKFILL (kho đóng, tối)

⚠️ **Tách riêng khỏi Cổng 1** vì `UPDATE` ghi từng dòng một, giữ khoá ghi DB vài giây → POS treo giữa lúc bán hàng thật.

### B1b.0 — Backup (bắt buộc)

- [x] **Backup DB prod.** Không có script nào trong repo làm được — `backup-db.ts:9-10` chỉ copy file local, còn prod là Turso. → Đêm 01/10 đã viết `backup-prod.ts` + `restore-prod.ts` và **thử khôi phục thật vào DB rỗng, khớp 6/6 bảng**. Xem mục B.
- [x] Xác nhận file backup mở được, số bảng khớp

### B1b.1 — Thứ tự thực hiện

```
1. INSERT products từ editions      (~88 dòng — nhanh)
2. UPDATE editions SET product_id = id
3. UPDATE order_items SET product_id = edition_id      ← dòng này lâu nhất
4. UPDATE inventory_ledger SET product_id = edition_id
5. UPDATE stock_balances SET product_id = edition_id
6. CREATE UNIQUE INDEX products_code_unique
```

⚠️ **Đặt index SAU backfill.** Nếu backfill sinh trùng `code`, câu UNIQUE fail và **mọi câu sau nó không chạy** (không transaction).

⚠️ `products.code` cho sách nên để NULL để tránh 2 nguồn sự thật (xem mục 6 B12). Nếu vẫn muốn copy `code` thì phải chấp nhận rủi ro khi `migrate-book-skus.ts` đổi SKU lần sau.

### B1b.2 — Kiểm tra sau backfill

- [ ] `SELECT COUNT(*) FROM order_items WHERE product_id IS NULL` → **phải = 0**
- [ ] `SELECT COUNT(*) FROM editions WHERE product_id IS NULL` → **phải = 0**
- [ ] Mở POS, quét 1 cuốn sách, thanh toán thử 1 đơn nhỏ

### 🛑 MỐC 2 — DỪNG, CẦN BẠN CHO PHÉP

```
Báo: "Cổng 1b xong. Đã backup. Backfill {N} dòng order_items, 0 dòng NULL.
      Đơn thử trên prod đã chạy. Cho phép tiếp không?"
```

---

## PHẦN 4 — CỔNG 2: ĐỌC `products` + NHẬP SẢN PHẨM

**Mục tiêu:** thêm và bán được sản phẩm hàng hóa, quét mã lên POS.
**Rủi ro:** THẤP–TRUNG BÌNH · **Rollback:** `wrangler rollback` (Cổng 1 chỉ thêm bảng chết)

### B2.1 — Đổi 9 chỗ `innerJoin editions` (bắt buộc, không có thì hàng hóa biến mất)

Lỗi B7 — loại lỗi **không báo lỗi, chỉ thiếu dòng**:

| File | Dòng | Khi thiếu |
|---|---|---|
| `pos-catalog.service.ts` | 71 | **POS không hiện hàng hóa** |
| `api/pos/live-monitor/route.ts` | 289 | Màn hình giám sát trực tiếp |
| `inventory.service.ts` | 974 | Lịch sử bút toán kho — **không thấy quà đã xuất** |
| `analytics.service.ts` | 89 | Tổng tồn theo kho |
| `rma.service.ts` | 301 | RMA |
| `allocation.service.ts` | 141 | Phân bổ quầy |
| `reader-profile.service.ts` | 68, 140 | Hồ sơ người đọc |
| `bundle.service.ts` | 63 | Combo |

- [ ] Đổi sang `innerJoin products` (`products.id = edition_id` cho sách)

⚠️ **Bài học đêm 01/10:** đừng suy luận "`products.id === editions.id` cho sách nên thay `edition_id` bằng `product_id` ở mọi nơi là tương đương". **SAI** — đã làm lệch số liều.
- [ ] `analytics.service.ts` thêm `product_kind` vào kết quả để lọc được "chỉ sách"

### B2.2 — Sửa lỗi B13: mã vạch

- [ ] `PosCheckoutTerminal.tsx:1217-1246` — thêm `products.barcode` vào điều kiện khớp (hiện chỉ khớp `isbn`, `isbnLast4`, `code`)
- [ ] Quy định namespace mã vạch: EAN-13 hàng hóa có thể trùng ISBN-13 sách → phải có quy tắc ưu tiên
- [ ] Test: quét mã hàng hóa lên POS, phải ra đúng 1 kết quả

### B2.3 — API tạo/sửa sản phẩm

- [ ] `POST /api/products` — tạo hàng hóa. Trường: mã (`SP-0001`), tên, giá bán, mã vạch, mô tả
- [ ] `PATCH /api/products/:id` — sửa
- [ ] **Chặn trùng `code`**: `products_code_unique` sẽ bắt, nhưng cần trả lỗi thân thiện
- [ ] Kiểm tra mã hàng hóa có trùng mã sách không → chặn ở tầng ứng dụng
- [ ] Phân quyền: Chủ sở hữu / Quản lý (theo `getSettingsAccess`, `roles.ts:82-90`)
- [ ] **Không** thêm `cost_price` lên UI (chốt #4) — cột có sẵn để sau

### B2.4 — UI nhập sản phẩm

- [ ] Màn hình danh mục: thêm / sửa / tạm ngưng sản phẩm
- [ ] Text ngắn, tiếng Việt có dấu (`AGENTS.md` mục 0)
- [ ] Nút có dấu hiệu bấm rõ: icon, viền, nhãn aria, trạng thái sau khi bấm

### B2.5 — 10 bảng còn lại thêm `product_id`

Tất cả `NOT NULL REFERENCES editions(id)`. Xem mục 2.3 của spec. Ưu tiên thấp — làm sau nếu cần.

### B2.6 — Nhập dữ liệu hàng hóa đầu tiên

- [ ] Danh sách sản phẩm hàng hóa (mã, tên, giá, mã vạch EAN nếu có)
- [ ] Tạo qua UI Cổng 2, **không** sửa script seed
- [ ] Nhập tồn kho đầu tiên qua `/api/inventory/movement` với `event_type = RECEIPT`

### B2.7 — Kiểm chứng bắt buộc

- [ ] Sách cũ: quét 1 cuốn → hiện đúng, giá đúng, tồn đúng
- [ ] Hàng hóa: quét mã → hiện đúng trong POS
- [ ] Tồn kho: nhập 10 cái hàng hóa → `stock_balances` đúng
- [ ] Bán thử 1 đơn có hàng hóa + sách
- [ ] `tsc` + `build` + toàn bộ test suite xanh

### 🛑 MỐC 3 — DỪNG, CẦN BẠN CHO PHÉP TRƯỚC KHI DEPLOY

```
Báo: "Cổng 2 code xong. Test xanh. Cần deploy để bạn thử thật.
      Deploy tối nay được không?"
```

---

## PHẦN 5 — CỔNG 3: LOGIC KHUYẾN MẠI

**Mục tiêu:** khuyến mại hoạt động thật.
**Rủi ro:** CAO — đụng đường thanh toán production.

⚠️ Cổng này **phải làm sau khi Cổng 2 đã chạy ổn định ít nhất 1 tuần tại hội chợ.**

### B3.1 — Fix 9 lỗi chặn TRƯỚC KHI VIẾT LOGIC

| Mã | Lỗi | File cần sửa |
|---|---|---|
| **B1** | Đơn có quà bị 403 | `route.ts:334-346` loại dòng quà khỏi `effectiveItemDiscounts`; `order.service.ts:839-844` miễn dòng quà |
| **B2** | Hết quà bị chặn 3 tầng | `order.service.ts:780-789`, `inventory.service.ts:204-212`, `PosCheckoutTerminal.tsx:1722` |
| **B3** | Trigger chặn tồn âm | Migration mới — **xem mục 6** |
| **B4** | `subtotal` bị nhiễm giá quà | `order.service.ts:526-572` — dòng quà không tính vào `subtotal` |
| **B5** | Đơn có quà + duyệt CK = 409 | `order.service.ts:850-867`, `discount-approval.service.ts:815-833` |
| **B6** | `cartHash` hỏng khi có quà | `discount-approval.service.ts:111-116` — loại dòng quà tự động khỏi hash, **giữ** dòng quà tay |
| **B8** | Offline tính sai tiền | `offline-db.ts:7-13`, `PosCheckoutTerminal.tsx:772-777` |
| **B11** | Forecast tính quà là hàng bán | `forecast.service.ts:86-104`, `executive-query.service.ts:499-516` |
| **B15** | Trần 50 subrequest | Gom mọi logic quà về 1–2 query cho cả đơn |

- [ ] B1, B4, B5, B6, B8, B11 — sửa, **không** đụng tồn kho
- [ ] B15 — đo số query thực tế của đơn 5 / 10 / 15 dòng, ghi vào test
- [ ] B2, B3 — **cần quyết định B3 của bạn** (xem mục 6)

### B3.2 — Engine tính quà

- [ ] `promotions` + `promotion_gifts` (bảng đã tạo ở Cổng 1)
- [ ] Hàm `computeGifts(eligibleBase, dismissed, manual)` — **thuần khiết, không query DB**
- [ ] Client tính để hiển thị tức thì
- [ ] Server tính lại — nguồn sự thật. Client gửi `promotion_id`, server tự tra giá và tự kiểm đủ bậc

### B3.3 — UI

- [ ] Nút **"Khuyến mãi"** trong tab POS — chỉ Quản lý / Chủ sở hữu
- [ ] Màn hình cài đặt: danh sách mốc. Mỗi dòng `Từ 500.000đ` → chọn sản phẩm + số lượng
- [ ] Chữ **"Tính trên giá gốc"** trong cài đặt
- [ ] Dòng quà trong giỏ: badge **"Quà"**, giá **0đ**, nút **"Bỏ quà"** và **"Tặng thêm"**
- [ ] Rút gọn nút 🎁 cũ thành **"100%"**
- [ ] Khi đổi bậc, hiện rõ chênh lệch: *"Đạt mốc 1.000.000 — thêm C"*
- [ ] Cảnh báo khi `giá quà ≥ 50% mốc`

### B3.4 — Báo cáo

- [ ] Số lượng quà đã phát, theo sản phẩm, theo ngày
- [ ] `analytics.service.ts:140 trending` — loại dòng quà khỏi "sách bán chạy"
- [ ] `SalesLedgerView.tsx:515` — nút lọc `id:'GIFT'` chết (không có giá trị này trong `orders.channel`)

### B3.5 — Kiểm chứng

- [ ] Đơn 800k đạt mốc → tự thêm quà A+B+C, giá **0đ**
- [ ] Xoá hàng cho rớt mốc → quà tự gỡ
- [ ] Bấm chiết khấu → **quà không đổi** (mốc tính giá gốc)
- [ ] Bấm "Tặng thêm" → **bị chặn, yêu cầu duyệt**
- [ ] Bấm "Bỏ quà" → không cần duyệt, thanh toán ngay
- [ ] Hết quà → cảnh báo, vẫn cho thanh toán
- [ ] Test đơn offline có quà
- [ ] Test đơn 15 dòng — không vượt trần subrequest

### 🛑 MỐC 0 — B3 = PHƯƠNG ÁN (b\*) — ĐÃ CHỐT

**Quyết định:** dòng quà hết tồn vẫn cho thanh toán, **không ghi `stock_balances`**, chỉ ghi ledger kèm cờ.

Lý do: (c*) chặn đơn = mất tiền thật giữa ca. (b*) chỉ đụng dòng quà, sách vẫn bán bình thường.

#### Bốn điều kiện bắt buộc

| # | Điều kiện | Vì sao | Nơi thực thi |
|---|---|---|---|
| **1** | **Chỉ dòng quà được bypass ATP. Sách vẫn chặn.** | Rủi ro lớn nhất của (b*). Bypass nhầm cả đơn ⇒ POS bán được cả khi hết sách ⇒ tồn âm, mất tiền | `order.service.ts:780-789` — lọc dòng quà ra khỏi `needTotal` **trước** khi gọi `getBatchATP` |
| **2** | **Quà ảo phải được đánh dấu.** Cột `is_gift_shortfall` | Không ghi `stock_balances` ⇒ tồn quà **không giảm** ⇒ hết hàng vẫn tặng được, mà không có dấu vết. Hệ thống sẽ nói dối chính nó | Cột mới trên `order_items` — **đặt trong migration 0032**, vì 0031 đã áp production không thêm được nữa |
| **3** | **POS cảnh báo TRƯỚC khi chốt**, không phải sau | Thu ngân phải biết trước khi thu tiền, không phải sau khi khách đứng đợi | Client: khi dòng quà `is_gift_shortfall` thì badge đỏ + hộp thoại |
| **4** | **Báo cáo tách 2 loại**: quà tặng khi **còn tồn** vs quà tặng khi **hết tồn** | Nếu gộp, ta thấy số liệu đẹp trong khi số quà thật đã cạn. Báo cáo sai ngay sau khi dựng lại là mất uy tín | Báo cáo quà tặng: 2 dòng, tách theo `is_gift_shortfall` |

#### Test biên BẮT BUỘC cho điều kiện 1

> Đơn gồm **1 dòng quà hết tồn + 1 cuốn sách hết tồn** → **phải bị chặn**, không được cho bán.

Nếu test này đỏ ⇒ bypass đang nuốt cả đơn ⇒ **dừng ngay**, không deploy.

Cột `is_gift_shortfall` chưa có trong `schema.ts` và chưa trong `orderItems` — phải thêm cùng lúc với Cổng 3.

#### Trạng thái

**B* đã chốt nhưng CHƯA code.** Nó nằm ở **Cổng 3** (đường tiền), chạy **sau hội chợ**. Cổng 1 và 0032 không phụ thuộc quyết định này.

```
Báo: "Cổng 2 đã chạy ổn định. Bắt đầu Cổng 3 (logic khuyến mại) chứ?"
```

### 🛑 MỐC 5 — CẦN BẠN DUYỆT TRƯỚC KHI DEPLOY

```
Báo: "Cổng 3 code xong. Test xanh. Cần deploy để bạn thử thật."
```

---

## PHẦN 7 — PHẢN HỒI RÀ SOÁT CỦA AGENT KHÁC (đã xử lý)

Agent khác rà soát plan này, chỉ ra 5 điểm. **4 điểm đúng, 1 điểm không đúng.**

| # | Điểm agent nêu | Kết luận | Xử lý |
|---|---|---|---|
| 1 | B3=(b) khiến ATP chặn **CẢ ĐƠN** khi hết quà ⇒ POS treo giữa ca | ✅ **Đúng** | Sửa PHẦN 5 / MỐC 0, thêm 4 bước bắt buộc kèm theo. **Cần bạn xác nhận lại** |
| 2 | Dòng "chưa viết dòng code nào" sai thực tế | ✅ **Đúng** | Thay bằng khối TRẠNG THÁI THẬT ở đầu file |
| 3 | `apply-0031-prod.ts` / `health-check-prod.ts` chưa ai kiểm | ➖ **Không đúng** | Đã kiểm: `run-isolated.ts` có danh sách suite **tường minh**, không chạy 2 script đó. Vẫn ghi rõ để người khác khỏi hiểu nhầm |
| 4 | `verify-pos-live.ts` **KHÔNG chỉ đọc**, tạo đơn thật | ✅ **Đúng — tôi đã nói sai** | Đã sửa. Trước đây tôi báo bạn nó "chỉ đọc" — sai |
| 5 | ~~Backup Turso: cần xác minh đường khôi phục trước Cổng 1b~~ | ✅ **Đã đóng** | Đã có `backup-prod.ts` + `restore-prod.ts`, khôi phục thật khớp 6/6 bảng |

### 6. Việc gấp — dev DB thiếu 3 bảng

Agent khác chạy `check-dev-db-schema.ts`, báo dev DB thiếu `products`, `promotions`, `promotion_gifts`. Ai chạy POS local hoặc test đọc bảng mới ⇒ **500**.

Sửa: `npx tsx scripts/fix-dev-db-schema.ts` (tự sao lưu `.bak`, tự kiểm tra trước khi chạy).

---

## PHẦN 8 — VIỆC CÒN MỞ, chặn Cổng 1b

| # | Việc | Vì sao chặn |
|---|---|---|
| 1 | ⚠️ **Đã đóng** — có `backup-prod.ts` + `restore-prod.ts`, đã khôi phục thật vào DB rỗng khớp 6/6 bảng. Xem mục B |
| 2 | **B3 quyết lại** | Xem PHẦN 5 / MỐC 0 |
| 3 | **Dev DB** | Xem mục 7.6 |

---

## PHẦN 9 — Câu hỏi cho bạn

| Mốc | Tên | Đụng prod? | Khi nào | Cần bạn duyệt? |
|---|---|---|---|---|
| **0** | Quyết định B3 (tồn âm) | Không | Bất kỳ | **✅ ĐÃ CHỐT (b)** |
| **1** | Cổng 1 — tạo bảng + cột | **CÓ** | Tối, kho đóng | **CÓ** |
| **2** | Cổng 1b — backfill | **CÓ** | Tối, kho đóng, sau backup | **CÓ** |
| **3** | Cổng 2 — 0033 trên prod + kiểm lại sau deploy | **CÓ** | Tối, kho đóng | **ĐANG LÀM** |
| **4** | Bắt đầu viết Cổng 3 | Không | Sau 5/5 điều kiện 4.1–4.5 | **CÓ** |
| **5** | Cổng 3 — deploy code khuyến mại | **CÓ** | **Sau hội chợ**, tối | **CÓ** |

**Tóm lại: 4 lần đụng production, đều vào ban đêm sau khi đóng ca. Toàn bộ viết code ban ngày không đụng gì.**

---

## PHẦN 7 — Rủi ro tồn tại, nói thẳng

| Rủi ro | Mức | Giảm bằng |
|---|---|---|
| Logic quà làm vượt trần 50 subrequest → POS sập | Cao | B15 — gom query, test đơn 15 dòng |
| Migration chạy nửa chừng hỏng, không quay lại được | Cao | Mỗi câu 1 lần, kiểm `PRAGMA` trước |
| Deploy nuốt code chưa commit của agent khác | Cao | `git status` sạch trước khi deploy |
| Đơn có quà đơt lập không duyệt | Đã xử lý | B1 |
| Hàng hóa biến mất khỏi báo cáo | Đã xử lý | B7 — 9 chỗ join |
| ~~Không có đường restore DB prod~~ | **Đã đóng** | `backup-prod.ts` + `restore-prod.ts`, đã khôi phục thật khớp 6/6 bảng |
| Test flaky dẫn tới kết luận sai | Cao | Chạy lặp **≥3 lần** trước khi kết luận (mục C1) |
| `inventory_ledger` thiếu 87 bút toán nhập kho, ledger âm -85.494 | Trung bình | `stock_balances` đúng, sổ thiếu — cần ghi bù (mục C3) |
| Bản ghi sách giả lọt vào DoI / top tác giả | Đã xử lý | B10 — tách `products` thật |
| Test local không bắt lỗi subrequest | Cao | Chỉ kiểm được trên prod qua `verify-pos-live.ts` |