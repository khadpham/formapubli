# TÀI LIỆU BÀN GIAO — Cổng 3 Khuyến Mại + Hàng Hóa

**Ngày:** 02/10/2026 · **Trạng thái:** ✅ ĐÃ DEPLOY `bf0def5e` (banner không mạo danh chờ duyệt) · **Độc giả:** agent tiếp nhận, phải làm tiếp được NGAY

| Hạng mục | Giá trị |
|---|---|
| Repo gốc | `D:\Data Project\formapubli` |
| **Worktree đang làm** | `D:\Data Project\formapubli-promo` |
| Branch | `main` (đã merge `feat/khuyen-mai-san-pham` — merge commit `1d95371`, push origin xác nhận) |
| HEAD | `1d95371` + docs sau deploy |
| Production version đang chạy | `bf0def5e-0259-4492-9ba4-ed66ccdc9f9e` (deploy tối 02/10 lần 6: banner chỉ hiện chữ chờ duyệt khi có phê duyệt thật + ma trận/sổ cái hiện SP; site sống) |

> **NGƯỜI ĐỌC PHẢI LÀM ĐƯỢC NGAY, KHÔNG PHẢI SUY LUẬN.** Mọi con số dưới đây là số đo được, không phải ước lượng. Lệnh copy chạy được nguyên văn.

---

## 1. TÓM TẮT 1 TRANG

| Nhóm | Làm được gì | Chưa làm gì | Rủi ro |
|---|---|---|---|
| **Hàng hóa** | ✅ Đầy đủ: bảng `products`, API, UI Cài Đặt → Quản trị → Hàng Hóa, E2E **33/33** | Chưa bán được trên production (code bán chưa deploy) | Migration đã lên production nhưng code bán hàng hóa **chưa deploy** |
| **Cổng 3 — engine** | ✅ Hàm thuần khiết, mô hình bậc thang, `test-promotion-engine` **32/32** | — | Không |
| **Cổng 3 — server** | ✅ 5 lỗi đã sửa, 5 test khoá lại (20/20, 20/20, 21/21, 12/12) + B3 quà hết tồn (7/7) + nối `approvedManual` (8.3) | Nút "Tặng thêm" trong giỏ POS chưa có | Client có thể gửi cờ quà giả — **đã chặn** |
| **Cổng 3 — UI** | ✅ Màn hình cài đặt mốc (Cài Đặt → Khuyến Mãi, chủ đã tự tìm thấy) + mốc 0đ "đơn bất kỳ" (engine 37/37) + giỏ POS badge "Quà"/"Bỏ quà"/"Tặng thêm · chờ duyệt" | Nút "Tặng thêm" nằm nhánh riêng CHƯA deploy | Không — UI chỉ đọc/gợi ý, server tự xác minh lại |
| **Cổng 3 — báo cáo quà** | ✅ `GET /api/reports/gifts` + panel tách còn tồn / hết tồn | — | Không |
| **Cổng 3 — deploy** | ✅ **ĐÃ DEPLOY tối 02/10** (`55a82ca4`, từ merge `1d95371`) | Nghiệm thu quét SP thật chưa làm (cần máy thật) | Rollback sẵn sàng: `npx wrangler rollback <id>` |
| **Test suite** | 124/125 xanh (+ tsc 0 + build sạch trên đúng cây deploy, kèm suite `test-autoclose-shift` của main) | `test-pay2-money-audit.ts` đỏ | Đã chứng minh flaky có sẵn từ trước, không phải hồi quy |
| **Sổ kho** | `stock_balances` ĐÚNG (440 dòng, 0 âm) | 🔴 ledger Hồ Gươm lệch **87 bút toán RECEIPT** (để sau hội chợ) | Hàng vật lý đúng; **thiếu sổ, không thiếu hàng** |
| **Báo cáo chốt ngày** | ✅ Hiện đúng mã/tên/giá hàng hóa (`test-settlement-goods-display` 11/11; nhãn "Giá bán" cho GOODS, key theo product_id) | — | Lỗi thấy trên ảnh chụp: 4 dòng SP hiện `[]` + 0đ vì chỉ đọc `editions` |
| **Hàng hóa mẫu prod** | ✅ SP-001..004 (Bookmark 5k, Móc khoá 15k, Gói quà 50k, Túi Tote 150k), mỗi món 100 cái × 2 kho (Hồ Gươm + ĐH Hà Nội), 8 bút toán OPENING_BALANCE khớp 8 dòng tồn | Chưa bán được (chờ deploy code) | Không — dữ liệu tượng trưng, chủ duyệt |
| **Backup** | ✅ `backup-prod.ts` + `restore-prod.ts`, đã khôi phục thật 6/6 bảng khớp | — | Trước đây KHÔNG có script backup Turso |
| **TypeScript** | `npx tsc --noEmit` **0 lỗi** (sau commit mới nhất `3185edb`) | — | — |

**Việc đã xong sau bàn giao (8 commit):** UI cài đặt mốc `7fc1ab2` → giỏ POS badge Quà `709cad9` → B3 `efa5e0e` → duyệt quà tay `53ecc1e` → báo cáo quà `812745c` + fix gitignore `285e4e4` → fix test regex `e7343d5` → fix kho product_id `3185edb`.

**Việc kế tiếp duy nhất cần chủ quyết:** deploy hay không (xem mục 12).

---

## 2. MÔI TRƯỜNG + QUY TẮC LÀM VIỆC

### 2.1 Quy tắc bắt buộc

| # | Quy tắc | Lệnh kiểm tra |
|---|---|---|
| 1 | ⛔ **KHÔNG BAO GIỜ commit lên `main`.** Quy tắc của chủ doanh nghiệp. Đã vi phạm 1 lần. | `git branch --show-current` → phải trả `feat/khuyen-mai-san-pham` |
| 2 | Mỗi lần commit **phải chạy** `git branch --show-current` trước | như trên |
| 3 | ⛔ **Không đụng** `D:\Data Project\formapubli` — agent khác đang làm SONG SANG ở đó (nhánh `main`) | Kiểm tra `workdir` mọi lệnh |
| 4 | Chỉ sửa file trong `D:\Data Project\formapubli-promo` | `Test-Path 'D:\Data Project\formapubli-promo'` = True |
| 5 | Deploy chỉ khi: **đã đọc kết quả test** + `tsc` sạch + build sạch | xem bài học 1 |

### 2.2 Lệnh chạy được nguyên văn

| Việc | Lệnh |
|---|---|
| Chạy TOÀN BỘ test suite | `npx tsx scripts/run-isolated.ts` — **~13 phút**, **125 suite**, cách ly bằng `formapubli_test.db` |
| Chạy 1 suite | `DATABASE_URL=file:formapubli_test.db npx tsx scripts/<file>.ts` |
| Type check | `npx tsc --noEmit` |
| Deploy | `npm run deploy` |
| Liệt kê version để rollback | `npx wrangler versions list` |
| Rollback | `npx wrangler rollback <id>` |
| Backup production | `npx tsx scripts/backup-prod.ts` |
| Áp migration production | `scripts/apply-00XX-prod.ts` với `ALLOW_PROD_WRITE=true` + `ALLOW_REMOTE_TARGET=<host>` |

⚠️ **Không bao giờ** dry-run script bằng cách đặt `DATABASE_URL=file:...` — chúng đọc thẳng `TURSO_DATABASE_URL` từ `.env` (libsql:// production thật), không đọc `process.env` của bạn.

---

## 3. ✅ ĐÃ XONG — Production

Version đang chạy: **`b8ad7643-ec6d-44ac-80e3-d66fd6838213`**

| Phép đo | Kết quả |
|---|---|
| `integrity_check` | **ok** |
| `foreign_key_check` | **sạch — 0 vi phạm** |
| Dòng tồn âm | **0** |
| Tổng số bảng | **45** |

### 3.1 Migration đã áp

| Migration | Nội dung |
|---|---|
| `0031` | Tạo bảng `products` / `promotions` / `promotion_gifts` + **7 cột nullable** |
| `0031b` (backfill) | editions **88/88** · order_items **217/217** · inventory_ledger **1657/1657** · stock_balances **440/440** · `product_id IS NULL` = **0** |
| `0032` | Dựng lại `stock_balances` + `order_items` |
| `0033` | Dựng lại `inventory_ledger` |

### 3.2 Nghiệm thu tầng 3 (đơn thật qua HTTP)

| Mục | Kết quả |
|---|---|
| Mã đơn | `ORD2610020001` |
| Kho | ĐH Hà Nội |
| Trạng thái | COMPLETED |
| Tổng tiền | **110.000đ** |
| Tổng dòng khớp `final_amount` | ✅ |
| `product_id` | `ed-h65` |
| `is_gift_line` | 0 |
| Bút toán sổ kho | `DISPATCH_SALE −1` |

> **Sách bán bình thường. Hàng hóa CHƯA bán được.**

---

## 4. ✅ ĐÃ XONG — Backup và khôi phục (đã chứng minh thật)

Trước đây **KHÔNG có script nào cho Turso** (`backup-db.ts` chỉ copy file local).

| Hạng mục | File / lệnh |
|---|---|
| Backup (chỉ đọc) | `npx tsx scripts/backup-prod.ts` |
| Khôi phục — dry-run mặc định | `npx tsx scripts/restore-prod.ts` |
| Khôi phục — thật | `npx tsx scripts/restore-prod.ts --thuc-hien` + `ALLOW_REMOTE_TARGET=<host>` |
| Bảng đã bị DROP thì thêm | `--tao-schema` |

**Kết quả khôi phục thật vào DB rỗng — 6/6 bảng khớp chính xác:**

| Bảng | Số dòng khớp production |
|---|---|
| works | 87 |
| editions | 88 |
| warehouses | 5 |
| orders | 79 |
| order_items | 217 |
| stock_balances | 440 |

Integrity `ok` · FK sạch · đủ **3 trigger**.

**Backup đủ dữ liệu kho Hồ Gươm:** 88 dòng tồn · 331 bút toán · 40 đơn · 73 dòng đơn · 5 ca két.

`backups/` đã loại khỏi git qua `.git/info/exclude` (cục bộ).

---

## 5. ✅ ĐÃ XONG — Tính năng hàng hóa

| Hạng mục | Kết quả / lệnh kiểm chứng |
|---|---|
| `products` là tầng gốc chung sách + hàng hóa | ✅ |
| `products.id` của sách = `editions.id` (vd `ed-hh001`) | ✅ |
| Trigger `editions_sync_products` giữ bất biến | ✅ |
| `POST/PATCH /api/products` chỉ `ROLE_OWNER`/`ROLE_MANAGER` | ✅ |
| Mã hàng hóa BẮT BUỘC tiền tố `SP-` | ✅ kiểm **cả `editions.code`** vì UNIQUE không bắt được mã trùng sách |
| UI | `src/components/products/GoodsCatalogManager.tsx` — Cài Đặt → Quản trị → Hàng Hóa |
| Xoá | Không có nút xoá, chỉ **"Ngưng hoạt động"** |
| `costPrice` | **CỐ Ý KHÔNG lộ ra API** — `PUBLIC_COLUMNS` trong `product.service.ts` không có cột này |
| Giá nhập | `type="text"` + `normalizePrice` — vì `type="number"` locale `en-US` đọc `8.900` thành `8.9` ⇒ lưu 9đ |
| Danh mục POS | `FROM products LEFT JOIN editions LEFT JOIN works` |
| **Test E2E** | `DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-goods-sell-e2e.ts` → **33/33** |

---

## 6. ✅ ĐÃ XONG — Cổng 3 Khuyến Mại (LÕI XONG, 🔴 CHƯA DEPLOY)

Engine: `src/lib/promotion-engine.ts` — hàm **thuần khiết, không query DB**.
Mô hình **BẬC THANG**: chỉ mốc **CAO NHẤT** đạt được được kích hoạt.

### 6.1 Bảng file + test

| File | Việc | Test | Kết quả |
|---|---|---|---|
| `src/lib/promotion-engine.ts` | Hàm thuần khiết, bậc thang, chỉ mốc cao nhất | `scripts/test-promotion-engine.ts` | ✅ **32/32** |
| `src/app/api/orders/route.ts` | Lỗi **403** mọi đơn có quà — loại dòng quà khỏi so trần 20% | `scripts/test-gift-subtotal.ts` | ✅ **20/20** |
| `src/services/order.service.ts` | `subtotal` / `discountAmount` **nhiễm giá quà** | (cùng file test) | ✅ |
| `src/services/discount-approval.service.ts` | Đơn có quà + cần duyệt chiết khấu ⇒ **409** | `scripts/test-gift-approval-hash.ts` | ✅ **20/20** |
| `src/lib/offline-db.ts` | Đơn offline **thu thiếu tiền** | `scripts/test-gift-offline.ts` | ✅ **21/21** |
| `src/services/order.service.ts` | 🔒 **CHỐNG GIẢ MẠO** — không tin `isGiftLine` từ client, tự tra bảng `promotions` | `scripts/test-gift-forgery.ts` | ✅ **12/12** |

**Chi tiết chống giả mạo:** server tự tra bảng `promotions` để xác minh dòng quà. Dòng quà giả bị **hạ thành dòng thường** và khách vẫn bị tính **đủ giá**. Không tin bất kỳ cờ nào từ client.

### 6.2 2 lỗi lịch sử đã bị test khoá trong engine (32/32)

- **Cộng dồn bậc:** 1 triệu ra `2A + 2B + C` thay vì `A + B + C`.
- **Vòng lặp:** quà tự đẩy tổng vượt bậc kế tiếp.

### 6.3 Nguyên tắc nghiệp vụ đã chốt

| Nguyên tắc | Nghĩa |
|---|---|
| Mốc theo **bậc thang** | Chỉ bậc CAO NHẤT đạt được chạy, không cộng dồn |
| `gift_quantity` **CỐ ĐỐI** | Không nhân theo tỉ lệ mức đạt |
| Bất đối xứng bảo mật | Thao tác **TĂNG** lợi ích khách → phải duyệt. Thao tác **GIẢM** → không duyệt |

### 6.4 Trạng thái test tổng

`npx tsc --noEmit` **0 lỗi** · `npm run build` **sạch** · full `run-isolated` **124/125** (chỉ đỏ `test-pay2-money-audit.ts` flaky có sẵn — xem mục 7). Tất cả chạy lại sau commit mới nhất `3185edb` tối 02/10.

Test mới sau bàn giao: `scripts/test-promotions-service.ts` **7/7**, `scripts/test-gift-shortfall.ts` **7/7**.

---

## 7. 🔴 ĐANG ĐỎ — 1 suite (đã giảm từ 2: `test-pos-cash-integrity` đã sửa xong ở `e7343d5`)

| Hạng mục | Giá trị |
|---|---|
| Suite đỏ | `scripts/test-pay2-money-audit.ts` |
| Số suite đỏ | **1 / 125** |
| Lệnh tái hiện | `DATABASE_URL=file:formapubli_test.db npx tsx scripts/test-pay2-money-audit.ts` |

### 7.1 Bằng chứng: flaky CÓ SẴN TỪ TRƯỚC, không phải hồi quy

| Phép thử | Kết quả EXIT |
|---|---|
| Cùng code + cùng DB sạch, chạy 3 lần | **0, 1, 1** |
| Chạy trên code **TRƯỚC** đêm nay (`git stash` rồi chạy lại), cùng DB sạch | **0, 1, 1** ⇒ **không liên quan thay đổi hôm nay** |

### 7.2 Vì sao bỏ qua được

| Bằng chứng production | Số liệu |
|---|---|
| `rights_contracts` | **0 dòng** |
| Audit log royalty | **0 hoạt động** |

⇒ Tính năng **chưa ai dùng**, rủi ro thực tế bằng 0.

### 7.3 Suite liên quan có cùng triệu chứng

`scripts/test-royalties.ts` — đã thêm `ORDER BY id` vào `edOf()` nhưng **chưa hết**, còn nguồn phi tất định khác chưa tìm ra.

### 7.4 Hậu quả bắt buộc phải biết

`test-gift-forgery.ts` nạp tồn phải ghi **CẢ** `inventory_ledger` (không chỉ `UPDATE stock_balances`). Nếu không, `test-master-audit.ts` đỏ **bất biến** ở `Balance == LedgerSum`. Khi viết test mới có nạp tồn, nhớ viết ledger.

---

## 8. ✅ ĐÃ XONG HẾT SAU BÀN GIAO (trừ 2 việc nhỏ ở 8.6)

### 8.1 UI khuyến mại — ✅ XONG (`7fc1ab2` + `709cad9`)

| Hạng mục | Đã làm |
|---|---|
| Màn hình cài đặt mốc | Cài Đặt → Quản trị → **Khuyến Mãi** (`PromotionsManager`): thêm/sửa/ngưng chương trình, bậc quà, cảnh báo `giftValueWarning()` |
| API cấu hình | `GET/POST /api/promotions`, `PATCH /api/promotions/:id` — ghi khóa Quản lý/Chủ; GET mở cho thu ngân đọc để giỏ hiện badge |
| Badge "Quà" trong giỏ | Desktop + mobile, giá 0đ |
| Nút **"Bỏ quà"** | Trong giỏ, engine không tặng lại (đã có test engine 32/32 khoá) |
| Giỏ POS tự tính quà | `computeGifts` cùng hàm với server — client chỉ GỢI Ý, server tự xác minh lại |

Kiểm chứng: `test-promotions-service.ts` **7/7** + hồi quy `test-gift-subtotal` 20/20.

### 8.2 B3 = (b\*) — quà hết tồn — ✅ XONG (`efa5e0e` + test `test-gift-shortfall.ts` 7/7)

Quà hết tồn **vẫn cho thanh toán** nhưng **KHÔNG ghi `stock_balances`**; chỉ ghi `inventory_ledger` + bật cờ `is_gift_shortfall`. Sách thường không đổi.

### 8.3 Luồng duyệt quà tay — ✅ XONG PHẦN SERVER (`53ecc1e`)

`order.service.ts` đọc `cartSnapshot` của `discountApprovalId`, truyền `approvedManual` xuống engine. Quà tay chỉ hợp lệ khi đã duyệt — chưa duyệt ⇒ vẫn bị hạ về dòng thường.

### 8.4 Báo cáo quà tặng — ✅ XONG (`812745c`)

`GET /api/reports/gifts` + panel trong Sổ Doanh Số — tách 2 nhóm theo cờ `is_gift_shortfall`. (Kèm fix `.gitignore`: `reports/` → `/reports/` để không che `src/app/api/reports`, commit `285e4e4`.)

### 8.5 🔴 Sổ kho Hồ Gươm — thiếu 87 bút toán RECEIPT (CHƯA LÀM — để sau hội chợ, khi kho đóng)

| Số liệu | Giá trị |
|---|---|
| Tổng ledger âm tại Hồ Gươm | **−85.494** |
| Trên mỗi mã | **−990 / −1000** |
| `stock_balances` | **ĐÚNG** — 440 dòng, 0 âm, khớp bán thật |
| Số bút toán thiếu | **87** (`RECEIPT`) |
| Ngày 30/09 chuyển ra | **85.260 cuốn** — nhưng chỉ nhận **812** |

**Nguyên nhân đã tìm ra:** kho chưa bao giờ có bút toán nhập.

**Cách sửa:** viết script ghi bù. **Chạy khi kho đóng.**

> **Hàng vật lý ĐÚNG — thiếu sổ, không thiếu hàng.**

### 8.6 Hàng hóa mẫu trên production — ✅ XONG (chủ duyệt, đã nạp 02/10 tối)

| Món | Mã | Giá | Tồn |
|---|---|---|---|
| Bookmark | SP-001 | 5.000đ | 100 Hồ Gươm + 100 ĐH Hà Nội |
| Móc khoá | SP-002 | 15.000đ | 100 + 100 |
| Gói quà Bất ngờ | SP-003 (đánh dấu quà) | 50.000đ | 100 + 100 |
| Túi Tote | SP-004 | 150.000đ | 100 + 100 |

Nạp bằng `scripts/seed-goods-prototype.ts` (idempotent theo `code`, bút toán OPENING_BALANCE — 8 bút toán khớp 8 dòng tồn). Khi nạp phát hiện bug kho (xem bài học 9) và đã sửa trong `3185edb`.

### 8.7 Còn mở (nhỏ, không chặn deploy)

1. Nút **"Tặng thêm"** trong giỏ POS (quà tay tự phục vụ) — engine + server đã sẵn (8.3), chỉ thiếu nút bấm.
2. `scripts/probe-ordercode-length.ts` (untracked, không phải của đợt này — để nguyên, không commit).

---

## 9. LỘ TRÌNH CỬA SỔ

| Điều kiện | Trạng thái hiện tại |
|---|---|
| **Chưa ai được nhập hàng hóa vào kho** cho tới khi có xác nhận "xanh" | ⚠️ ĐÃ NHẬP MẪU theo lệnh chủ (SP-001..004, 100×2 kho) — nhưng **chưa bán được** vì code Cổng 3 chưa deploy |
| Migration `0031`–`0033` đã áp | ✅ Nhưng **chưa deploy code Cổng 3** |

**Sau khi "xanh" bao gồm:** Cổng 3 deploy xong + hàng hóa mẫu bán được trên production (quét SP-001..004 ra đơn thật).

**Lý do:** hàng hóa chưa bán được trên production. Điều kiện này do **agent giám sát** đặt ra và **đã được chủ đồng ý**.

**Sau khi "xanh" bao gồm:** Cổng 3 deploy xong + hàng hóa bán được trên production.

---

## 10. BÀI HỌC ĐÃ MẮC (9 bài — đọc để không lặp lại)

| # | Bài học | Hệ quả đã gặp |
|---|---|---|
| 1 | **Deploy CHỈ sau khi đã đọc kết quả test** | Đã deploy trước khi đọc E2E ⇒ **2 lỗi lên production** |
| 2 | **DDL phải lấy NGUYÊN VĂN từ `sqlite_master` của production** | Tự viết `0033` theo bản `0000` ⇒ thiếu cột `reversal_of` ⇒ `no such column` |
| 3 | **Không suy luận "`products.id === editions.id` nên tương đương"** | Sai; đã làm **lệch số liều royalty 35.466đ** |
| 4 | **Một lần chạy test KHÔNG đủ để kết luận** | Chạy 1 lần thấy xanh → kết luận "sai"; chạy lại thấy đỏ → đổ lỗi cho code khác. Thực ra test **flaky**. **Phải chạy lặp ≥3 lần** |
| 5 | **`verify-pos-live.ts` KHÔNG phải "chỉ đọc"** | Nó **tạo đơn thật** qua `POST /api/orders` (dòng **206**) |
| 6 | **`schema.ts` phải khớp migration** | Khai `promotion_gifts.created_at` nhưng `0031` không tạo cột đó ⇒ **mọi truy vấn bảng đó trả 500** |
| 7 | **Giao sub-agent theo MẪU LỖI, không theo danh sách file** | **4 file** cùng một lỗi bị sót vì tôi liệt kê tên file |
| 8 | **Test phải tự dựng dữ liệu chương trình** | `test-gift-subtotal` / `test-gift-offline` gửi cờ quà nhưng **không tạo `promotions`** ⇒ server hạ dòng quà (đúng hành vi bảo mật) ⇒ test đỏ. Sửa bằng cách **dựng chiến dịch thật**, KHÔNG nới lỏng kiểm tra bảo mật |
| 9 | **`stock_balances` đọc/ghi theo `product_id`, KHÔNG theo `edition_id`** | Hàng hóa có `edition_id = NULL` (FK `editions`) nên nạp tồn crash FK + tra tồn luôn trả 0. Sách có `product_id === edition_id` nên đổi sang `product_id` không đổi hành vi sách. Đã quét hết `inventory.service.ts` (getBalance, getBatchBalance, recordMovement, recordMovementsBatch) |

---

## 11. DANH SÁCH FILE QUAN TRỌNG

### Code Cổng 3 (thêm sau bàn giao)

| File | Vai trò |
|---|---|
| `src/services/promotion.service.ts` | CRUD cấu hình khuyến mại (validate mốc/số lượng/sản phẩm) |
| `src/app/api/promotions/route.ts` + `[id]/route.ts` | GET (thu ngân được đọc) / POST / PATCH (khóa Quản lý/Chủ) |
| `src/components/settings/PromotionsManager.tsx` | Màn hình cài đặt mốc (Cài Đặt → Khuyến Mãi) |
| `src/services/gift-report.service.ts` + `src/app/api/reports/gifts/route.ts` | Báo cáo quà tách còn tồn / hết tồn |
| `src/components/sales/GiftReportPanel.tsx` | Panel báo cáo trong Sổ Doanh Số |
| `src/components/pos/PosCheckoutTerminal.tsx` | Giỏ tự tính quà + badge "Quà" + "Bỏ quà" (desktop + mobile); dòng quà đi vào cả 2 đường online/offline |

### Code Cổng 3 (lúc bàn giao)

| File | Vai trò |
|---|---|
| `src/lib/promotion-engine.ts` | Engine thuần khiết. Có `giftValueWarning()` dùng cho UI 8.1. Có tham số `approvedManual` (chưa nối, mục 8.3) |
| `src/app/api/orders/route.ts` | Sửa lỗi 403 đơn có quà |
| `src/services/order.service.ts` | Chống giả mạo quà; nơi sửa B3 và nối `approvedManual` |
| `src/services/discount-approval.service.ts` | Sửa lỗi 409 |
| `src/lib/offline-db.ts` | Sửa lỗi đơn offline thu thiếu tiền |

### Hàng hóa

| File | Vai trò |
|---|---|
| `src/components/products/GoodsCatalogManager.tsx` | UI Cài Đặt → Quản trị → Hàng Hóa |
| `src/services/product.service.ts` | `PUBLIC_COLUMNS` — cố ý không có `costPrice` |

### Script vận hành

| File | Vai trò |
|---|---|
| `scripts/run-isolated.ts` | Chạy full suite (125 suite, ~13 phút) |
| `scripts/backup-prod.ts` | Backup production (chỉ đọc) |
| `scripts/restore-prod.ts` | Khôi phục (dry-run mặc định) |
| `scripts/apply-00XX-prod.ts` | Áp migration production |
| `scripts/verify-pos-live.ts` | Nghiệm thu tầng 3 — **tạo đơn thật**, không phải chỉ đọc |
| `scripts/seed-goods-prototype.ts` | Nạp SP-001..004 + tồn 100×2 kho (idempotent, bọc prod-write-guard) |
| `scripts/test-goods-sell-e2e.ts` | 33/33 |
| `scripts/test-promotion-engine.ts` | 32/32 |
| `scripts/test-promotions-service.ts` | **7/7 (mới)** |
| `scripts/test-gift-subtotal.ts` | 20/20 |
| `scripts/test-gift-approval-hash.ts` | 20/20 |
| `scripts/test-gift-offline.ts` | 21/21 |
| `scripts/test-gift-forgery.ts` | 12/12 |
| `scripts/test-gift-shortfall.ts` | **7/7 (mới, B3)** |
| `scripts/test-pay2-money-audit.ts` | 🔴 flaky có sẵn (mục 7) |
| `scripts/test-royalties.ts` | Cùng triệu chứng flaky |

### Migration

`src/db/migrations/0031_*.sql` · `0031b` (backfill) · `0032_*.sql` (có cột `is_gift_shortfall`) · `0033_*.sql`

---

## 12. LỘ TRÌNH SAU KHI NHẬN BÀN GIAO (cập nhật sau 8 commit mới)

| Bước | Việc | Trạng thái |
|---|---|---|
| 1 | `git branch --show-current` xác nhận đúng branch | ✅ `feat/khuyen-mai-san-pham`, HEAD `3185edb`, cây sạch (trừ 1 file untracked không phải của đợt này) |
| 2 | UI khuyến mại (8.1) | ✅ XONG |
| 3 | B3 (8.2) → duyệt tay (8.3) → báo cáo (8.4) | ✅ XONG, mỗi mục có test riêng xanh |
| 4 | Nạp hàng mẫu SP-001..004 lên prod (8.6) | ✅ XONG — đọc lại prod khớp 4 SP + 8 dòng tồn 100 + 8 bút toán |
| 5 | Chạy `npm run build` + full `run-isolated` LẠI sau `3185edb` | ✅ XONG tối 02/10 — build sạch, 124/125 (chỉ đỏ flaky royalty) |
| 6 | **Chủ duyệt deploy** | ✅ DUYỆT + DEPLOY tối 02/10 — merge `1d95371`, push origin xác nhận, `npm run deploy` → `55a82ca4`, site sống |
| 7 | Nghiệm thu tầng 3 trên prod: quét SP-001..004 ra đơn thật | ⏳ Sáng mai, máy thật (chưa làm — cố ý không tạo đơn rác tối nay) |
| 8 | Mục 8.5 ghi bù sổ kho Hồ Gươm | **Chạy khi kho đóng (sau hội chợ)** |
| 9 | Báo "xanh" để mở lộ trình cửa sổ | Sau bước 7 |
