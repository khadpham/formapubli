# TÀI LIỆU BÀN GIAO — Cổng 3 Khuyến Mại + Hàng Hóa

> ## ⛔ TÀI LIỆU LỊCH SỬ — KHÔNG LÀM NGUỒN NGỮ CẢNH
>
> Đây là bản ghi trạng thái **ngày 02/10/2026**, giữ lại làm vì chứa phân tích
> gốc rễ và bài học. **Các số liệu trong đây đã cũ.** Trước khi tin bất kỳ dòng nào:
>
> | Loại | Thay bằng |
> |---|---|
> | Số suite (125 / 124/125 / 146) | `scripts/run-isolated.ts` là nguồn sự thật — tự đếm, đừng đọc số trong docs |
> | HEAD (`4aa9203` / `3185edb` / `e2f231d`) | `git log --oneline -1` |
> | Worktree `formapubli-orch` / `-promo` / `-sales` / `-dashboard` | **đã xoá hết.** Chỉ còn `D:\Data Project\formapubli` trên `main` |
> | `scripts/probe-ordercode-length.ts` | không tồn tại |
> | "CHƯA DEPLOY" ở mục 1–9 | đã deploy nhiều lần, xem mục 8–10 và `npx wrangler versions list` |
>
> **Trạng thái hiện tại: đọc `docs/superpowers/plans/2026-10-02-trang-thai-toan-bo.md` mục 10 và `git log`.**

**Ngày:** 02/10/2026 · **Trạng thái:** ✅ ĐÃ DEPLOY `1e05338c` (bật cuộn ngang bảng kiểm kê đóng thùng, giám sát CK, chuyển kho trên mobile + đồng bộ main) · **Độc giả:** agent tiếp nhận, phải làm tiếp được NGAY

| Hạng mục | Giá trị |
|---|---|
| Repo gốc | `D:\Data Project\formapubli` |
| **Worktree đang làm** | `D:\Data Project\formapubli` |
| Branch | `main` |
| HEAD | `4aa9203` |
| Production version đang chạy | `1e05338c-1993-4dbe-9014-49148d7b5d41` (deploy trưa 02/10: cuộn ngang bảng kiểm kê đóng thùng, giám sát chiết khấu, chuyển kho trên điện thoại; site sống 200 OK) |

> **NGƯỜI ĐỌC PHẢI LÀM ĐƯỢC NGAY, KHÔNG PHẢI SUY LUẬN.** Mọi con số dưới đây là số đo được, không phải ước lượng. Lệnh copy chạy được nguyên văn.

---

## 1. TÓM TẮT 1 TRANG

| Nhóm | Làm được gì | Chưa làm gì | Rủi ro |
|---|---|---|---|
| **Hàng hóa** | ✅ Đầy đủ: bảng `products`, API, UI Cài Đặt → Quản trị → Hàng Hóa, E2E **33/33** | ~~Chưa bán được trên production~~ → **đã deploy 02/10 tối** | Không |
| **Cổng 3 — engine** | ✅ Hàm thuần khiết, mô hình bậc thang, `test-promotion-engine` xanh | — | Không |
| **Cổng 3 — server** | ✅ 5 lỗi đã sửa + B3 quà hết tồn + nối `approvedManual` | — | Client có thể gửi cờ quà giả — **đã chặn** |
| **Cổng 3 — UI** | ✅ Màn hình cài đặt mốc + mốc 0đ "đơn bất kỳ" + giỏ POS badge "Quà"/"Bỏ quà"/"Tặng thêm · chờ duyệt" | Nút "Tặng thêm" **đã xong** trên nhánh `feat/tang-them-qua-tay`, chủ không cần merge | Không — UI chỉ đọc/gợi ý, server tự xác minh lại |
| **Cổng 3 — báo cáo quà** | ✅ `GET /api/reports/gifts` + panel tách còn tồn / hết tồn | — | Không |
| **Cổng 3 — deploy** | ✅ **ĐÃ DEPLOY tối 02/10** (`55a82ca4`, từ merge `1d95371`) | Nghiệm thu quét SP thật chưa làm (cần máy thật) | Rollback sẵn sàng: `npx wrangler rollback <id>` |
| **Test suite** | Số suite **không ghi cứng ở docs** — xem `scripts/run-isolated.ts` | Số "124/125" là của 02/10, đã cũ | Đừng tin con số trong docs, hãy chạy |
| **Sổ kho** | `stock_balances` ĐÚNG (440 dòng, 0 âm) | 🔴 ledger Hồ Gươm lệch **87 bút toán RECEIPT** (để sau hội chợ) | Hàng vật lý đúng; **thiếu sổ, không thiếu hàng** |
| **Báo cáo chốt ngày** | ✅ Đã overhaul 02/10 tối (deploy `95eba1d5`) | — | — |
| **Hàng hóa mẫu prod** | ✅ SP-001..004, mỗi món 100 cái × 2 kho, 8 bút toán OPENING_BALANCE khớp 8 dòng tồn | — | Dữ liệu tượng trưng, chủ duyệt |
| **Backup** | ✅ `backup-prod.ts` + `restore-prod.ts`, đã khôi phục thật 6/6 bảng khớp | — | Trước đây KHÔNG có script backup Turso |
| **TypeScript** | `npx tsc --noEmit` phải 0 lỗi | — | — |

**Việc đã xong sau bàn giao (8 commit):** UI cài đặt mốc `7fc1ab2` → giỏ POS badge Quà `709cad9` → B3 `efa5e0e` → duyệt quà tay `53ecc1e` → báo cáo quà `812745c` + fix gitignore `285e4e4` → fix test regex `e7343d5` → fix kho product_id `3185edb`.

**Việc kế tiếp cần chủ:** ~~gửi mã vạch thật cho `ed-h66`~~ → **đã nhận và đã sửa 03/10** (mục 11). Còn `ed-h85` — chủ bảo **bỏ qua**.

---

## 2. MÔI TRƯỜNG + QUY TẮC LÀM VIỆC

### 2.1 Quy tắc bắt buộc

| # | Quy tắc | Lệnh kiểm tra |
|---|---|---|
| 1 | ✅ **`main` LUÔN là code mới nhất.** Chủ đổi quy tắc 02/10/2026: **được commit lên `main`**, push sau khi `tsc` + test + build sạch. Luật cũ "không bao giờ commit lên main" **ĐÃ BỊ BỎ** | `git status --porcelain` phải rỗng ngay trước khi push |
| 2 | Nhánh riêng chỉ dùng khi **đang làm song song với agent khác** (ràng buộc bên dưới). Làm một mình thì commit thẳng `main` | `git branch --show-current` |
| 3 | ⛔ **Không được ăn vào cây nguồn của lệnh deploy khi cây đó bẩn.** `npm run deploy` đọc **working tree**, không đọc git — đã từng nuốt code chưa commit của agent khác lên production | `git status --porcelain` ngay trước `npm run deploy` |
| 4 | Chỉ sửa file trong `D:\Data Project\formapubli` (worktree chính) trừ khi đã tạo worktree riêng có `node_modules` thật | xem mục "Worktree" bên dưới |
| 5 | Deploy chỉ khi: **đã đọc kết quả test** + `tsc` sạch + build sạch | xem bài học 1 |

### 2.2 Lệnh chạy được nguyên văn

| Việc | Lệnh |
|---|---|
| Chạy TOÀN BỘ test suite | `npx tsx scripts/run-isolated.ts` — lâu, cách ly bằng `formapubli_test.db`. **Số suite đọc từ `scripts/run-isolated.ts`**, đừng ghi cứng trong docs |
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

## 6. ✅ Cổng 3 Khuyến Mại (lúc bàn giao: LÕI XONG, 🔴 CHƯA DEPLOY — **đã deploy 02/10 tối, xem mục 8–10**)

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

### 8.7 Còn mở (nhỏ, không chặn deploy) — **cập nhật 03/10**

1. Nút **"Tặng thêm"** trong giỏ POS (quà tay tự phục vụ) — **ĐÃ LÀM XONG** trên nhánh `feat/tang-them-qua-tay` (`90e972a`, test `test-manual-gift-approval` 11/11). Chủ quyết **không cần merge** — giữ nhánh để tham khảo.
2. ~~`scripts/probe-ordercode-length.ts`~~ — **không tồn tại**, xoá khỏi danh sách.
3. **Còn treo:** `ed-h85` (chủ bảo bỏ qua lần này), validate checksum ISBN-13 khi nhập, cột "so với hôm qua" trên khối tiền.

---

## 9. LỘ TRÌNH CỬA SỔ (đã đóng 02/10 tối)

| Điều kiện | Trạng thái |
|---|---|
| Nhập hàng hóa mẫu vào kho | ✅ ĐÃ NẠP theo lệnh chủ (SP-001..004, 100×2 kho) |
| Migration `0031`–`0033` | ✅ đã áp |
| Deploy code Cổng 3 (bán hàng hóa) | ✅ **đã deploy 02/10 tối** (`55a82ca4`) — mục 8, 9, 10 |

> Mục này viết lúc 02/10 buổi chiều, khi code chưa deploy. **Đã đóng xong.** Chi tiết các lần deploy: mục 8, 9, 10.

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
| `scripts/run-isolated.ts` | Chạy full suite (danh sách suite nằm ngay trong file này) |
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

---

# BỔ SUNG 02/10/2026 (chiều) — MÃ ĐƠN DUYỆT CHIẾT KHẤU + BIÊN LAI SAI SỐ

Nhánh `fix/discount-approval-order-code` trong worktree `D:\Data Project\formapubli-dashboard`.
**CHƯA COMMIT, CHƯA DEPLOY.** Production chạy version cũ.

## 1. Đã làm xong

### 1.1 Mã đơn của yêu cầu duyệt chiết khấu (server cấp, không phải máy POS)
Lỗi: `PosCheckoutTerminal` sinh mã 29 ký tự ở máy, `order.service` lại cấp mã
13 ký tự ⇒ **mã trên giấy ≠ mã trong hệ thống**, và `discount_approval_requests`
không nối được với `orders` (báo cáo đối soát ca nối bằng mã nên 0 khớp).

| Việc | File |
|---|---|
| Tách bộ cấp mã ra `src/services/order-code.ts` (tránh vòng import với `discount-approval.service`) | mới |
| `createRequest` cấp mã thật ngay lúc tạo yêu cầu, `cartHash` khoá theo mã đó | `discount-approval.service.ts` |
| Mã phiếu tạm của máy POS tách sang cột mới `discount_approval_requests.client_order_code` | `0035` + schema |
| Đơn có duyệt dùng lại đúng mã của yêu cầu; ghi `orders.discount_approval_id` | `order.service.ts` |
| `assertSameOrderContent` không so mã client với đơn có duyệt (tránh IDEMPOTENCY_CONFLICT giả khi POS bấm lại) | `order.service.ts` |

Migration **`0035_order_discount_approval.sql`**: `orders.discount_approval_id` +
`discount_approval_requests.client_order_code` + 2 index. Chỉ ADD COLUMN NULLABLE
⇒ an toàn, không backfill, không khóa bảng ghi.

**BẮT BUỘC trước khi deploy:** chạy `npx tsx scripts/apply-0035-prod.ts`
(coordinator). Script idempotent, đã dry-run trên bản sao DB: cả nhánh "cột đã có"
lẫn nhánh "chưa có" đều chạy đúng, `foreign_key_check` sạch.

### 1.2 Hai lỗi màn "Bán Hàng Thành Công" + phiếu in (báo cáo của chủ, đã đo trên production)

| Lỗi | Nguyên nhân đã xác minh | Sửa |
|---|---|---|
| **Kho xuất sai** | Màn biên lai map cứng 2 mã kho văn phòng rồi `else 'Kho Quỳnh Mai'`. Kho hội chợ thật là `wh-kho-hoi-cho-ho-guom` / `wh-kho-dh-ha-noi-thang-10-2026` ⇒ **mọi đơn hội chợ in tên kho khác** | Tra tên trong danh sách kho POS; không tra được thì in MÃ kho, không bịa tên. `thermalReceipt.ts` bỏ bảng tra cứng cứng, nhận `warehouseName` từ POS |
| **Tổng số sách = 2 khi chỉ bán 1 cuốn** | `totalQuantity` cộng MỌI dòng, kể cả dòng quà HÀNG HÓA. Đo thật: `ORD261002000V` = 1 sách (135.000đ) + 1 quà bookmark (`order_items.edition_id = NULL`) | Server trả `bookQuantity` (đếm dòng có `edition_id`); màn hình + phiếu in dùng số này |

Quy tắc dùng chung một chỗ: `src/lib/receipt-summary.ts` → `resolveReceiptSummary`.

**Cần biết:** hội chợ Hồ Gươm và ĐH Hà Nội tháng 10/2026 đều đang chạy chương
trình tặng hàng hóa 1 món/đơn. Thông báo "2 cuốn" là do DÒNG QUÀ HÀNG HÓA bị đếm
vào sách, KHÔNG phải hệ thống tự thêm sách. Nếu muốn phiếu ghi rõ, cần tách dòng
"Quà tặng" — hiện chưa làm (chưa có yêu cầu).

## 2. Kiểm chứng đã chạy

- `npx tsc --noEmit` → 0 lỗi.
- `scripts/test-receipt-warehouse-and-book-count.ts` (mới, 20 assertions) PASS.
- Xanh: `test-s3-discount-approval`, `test-s4-settlement`, `test-settlement`,
  `test-discount-checkout-atomic`, `test-discount-guard`, `test-order-code-13`,
  `test-receipt-hotline-cashier`, `test-online-orders`, `test-order-sales`,
  `test-order-guards`, `test-pos-cash-integrity`, `test-pos-money-integrity`,
  `test-cashbox-close-shift`, `test-cashbox-audit-count`, `test-gift-approval-hash`,
  `test-gift-offline`, `test-transfer-payment-flow`,
  `test-transfer-payment-adversarial`, `test-goods-in-pos-catalog`,
  `test-s2-pos-catalog`, `test-offline-engine`, `test-pos-qr-content`,
  `test-pos-cashier-name`, `test-manager-approval-drawer`.
- DB dev trong worktree đã vá 0035 (`fix-dev-db-schema.ts` nay biết 0035).
- **Chưa** chạy `npm run build`, **chưa** nghiệm thu tầng 3
  (`verify-pos-live.ts`), **chưa** kiểm bằng tay trên điện thoại.

## 3. Test đã sửa (không hạ assertion)

`test-s3-discount-approval.ts`:
- `shortCode` nay kiểm theo mã server thay vì literal `'4821'`; thêm assert mã đơn
  13 ký tự + `clientOrderCode` giữ mã phiếu tạm.
- Case 9: assert `discountApprovalId` được ghi vào đơn.
- Case "retry idempotency": đổi MỨC CHIẾT KHẤU thay vì mã đơn để tạo xung đột —
  từ 0035 mã đơn là của server nên đổi mã không còn là xung đột (đúng ý đồ).

## 4. Việc tiếp theo

1. Coordinator: `npx tsx scripts/apply-0035-prod.ts` **trước** khi deploy.
2. `npm run build` trên đúng worktree này (dừng `next dev` trước nếu đang chạy).
3. Nghiệm thu tầng 3 trên production: tạo 1 đơn có duyệt chiết khấu 100% tại
   kho hội chợ, kiểm màn biên lai hiện đúng tên kho + "1 cuốn".
4. Cân nhắc thêm dòng "Quà tặng" riêng trên phiếu (chưa làm, cần chủ quyết).

## 5. Kết quả deploy (chiều 02/10/2026)

| Việc | Kết quả |
|---|---|
| Commit | `85acbb1` trên `fix/discount-approval-order-code` (chưa merge `main`, không đụng commit trên `main`) |
| Migration `0035` lên production | ✅ chạy `npx tsx scripts/apply-0035-prod.ts` — orders 111 → 111, approvals 20 → 20 (không mất dữ liệu), `foreign_key_check` sạch, `integrity_check ok` |
| Build | ✅ `npm run build` sạch |
| Deploy | ✅ worker `formapubli`, Version ID **`1c3b1889-f41b-462c-b645-4db5e66fe6aa`** |
| Smoke HTTP | ✅ `GET /` → 200; `GET /api/auth/me` → `AUTH_REQUIRED` (worker + binding DB đang sống) |
| Chưa làm | Chưa merge vào `main`; chưa nghiệm thu bằng tay trên điện thoại; chưa chạy `verify-pos-live.ts` (sẽ tạo 1 đơn thật — cần chủ quyết) |

### Cách nghiệm thu trên điện thoại (2 phút)
1. Mở POS, chọn kho **Hội chợ Hồ gươm**.
2. Bán 1 cuốn có chiết khấu 100% (duyệt một chạm) → màn "Bán Hàng Thành Công" phải hiện:
   - `Kho xuất: Hội chợ Hồ gươm` (không phải "Kho Quỳnh Mai")
   - `Tổng số sách: 1 cuốn`
   - `MÃ ĐƠN:` dạng `ORD261002xxxx` (13 ký tự)
3. In biên lai → cùng hai số đó.

### Quy tắc mới rút ra (đừng viết lại)
- **Cấm map cứng `warehouseId → tên kho`.** Kho hội chợ được tạo mới theo từng sự kiện
  (`wh-kho-hoi-cho-ho-guom`, `wh-kho-dh-ha-noi-thang-10-2026`) nên mọi map cứng đều
  sẽ in nhầm tên. Lấy tên từ `/api/warehouses`, thiếu thì hiện MÃ kho.
- **"Số sách" ≠ `totalQuantity`.** `totalQuantity` = tổng mọi dòng hàng gồm quà hàng
  hóa. Muốn số cuốn thì dùng `bookQuantity` (server đếm dòng có `edition_id`).

## 6. Deploy lần 2 (sau verify tầng 3) — 15:20 02/10/2026

| Việc | Kết quả |
|---|---|
| Commit | `44f800f` (docs) + `85acbb1` (code) — đã **push** lên `origin/fix/discount-approval-order-code` |
| Deploy | ✅ Version ID **`1c3b1889-f41b-462c-b645-4db5e66fe6aa`**, 100% traffic |
| Smoke | `GET /` → 200 (7.809 bytes) · `GET /api/auth/me` → 401 |

### Kết quả verify tầng 3 (`scripts/verify-pos-live.ts`) trên dev
PASS 22 / FAIL 2 — **cả 2 lỗi đều do dữ liệu DB dev, không phải code**:
- `#9` catalog POS 0 mặt hàng ⇒ bảng `products` của `formapubli.db` **rỗng 0 dòng** (editions 88, stock_balances có). Catalog lấy nguồn từ `products` nên không có gì để bán.
- `#15` mã đơn 13 ký tự = 0 ⇒ 74 đơn dev đều mã cũ 17 ký tự `ORD-20260912-XXXX`.
Vì 2 lỗi đọc, script bỏ qua phần ghi thật ⇒ **không có đơn test nào được tạo**.

### Bằng chứng production (đọc-only, qua HTTP thật)
- Login `ADMIN-01` → 200, có cookie phiên.
- `/api/warehouses?all=true` → **5 kho**.
- `/api/pos/catalog` mỗi kho → **91 mặt hàng** (hội chợ: 81 có ATP; ĐH Hà Nội T10: 91/91).
- DB production: `products` 92, `stock_balances` 448, `orders` 111.
- **5 đơn hôm nay mã 13 ký tự server** `ORD261002000S…W`.
- `orders.discount_approval_id` NULL cả 111 dòng, `client_order_code` NULL cả 20 yêu cầu ⇒ **luồng duyệt chiết khấu chưa có đơn thật nào dùng approval** (chủ quyết: không có dữ liệu kho sách để test, bỏ qua).

### Bẫy mới gặp (rất dễ lẫn)
`background_process start` với tham số `workdir` **bị bỏ qua** — dev server khởi động ở thư mục gốc session (`D:\Data Project\formapubli`) và ghi vào `.next` của worktree chính, tức **phục vụ nhầm code**. Phải `Set-Location -LiteralPath '<worktree>'` trong chính lệnh rồi mới chạy `npm run dev:lan`. Dấu hiệu: so `LastWriteTime` của `.next` ở hai worktree.

## 7. Overhaul Báo Cáo Chốt Ngày + Trạng Thái Hội Chợ (18:00 02/10/2026)

Nhánh `feat/settlement-overhaul`, 6 commit, `tsc` sạch, **7/7 suite cách ly xanh**, build thành công. **CHƯA DEPLOY** — chờ chủ duyệt.

| # | Việc | Kết quả |
|---|---|---|
| 1 | `paymentBreakdown.pendingQr` | ✅ Đơn chuyển khoản đang chờ, **loại đơn quá hạn 48h**, loại tiền mặt, loại ngoài ngày |
| 2 | `src/lib/stocktake-order.ts` | ✅ `sortByStock` / `filterLowStock` / `sortLabel` — màn hình và bản in dùng CHUNG |
| 3 | Khối tiền đầu tab | ✅ Thực thu là số chủ đạo + 4 ô phụ + dòng két + dòng đơn chờ |
| 4 | Bỏ nút "Đơn vị CK" + bản in | ✅ Hiện luôn tiền và %; mặc định xếp tồn bé→lớn; thêm **bảng VI. Sắp hết** |
| 5 | Thanh tab + chân modal | ✅ Segmented pill dính đầu, 3 mục luôn hiện; nút In dính đáy; nhớ tab qua `sessionStorage` |
| 6 | Trạng Thái Hội Chợ | ✅ Chọn kho + ngày, nhớ kho (không nhớ ngày); thêm khối "Đơn lớn nhất" (API có `largestOrder` mới) |

### Sửa cái gì đúng sau khi đọc code (không phải do đoán)
- **Bản in thiếu luôn nhóm cần đếm**: trước đây chỉ in ấn phẩm ĐÃ BÁN trong ngày. Cuốn sắp hết mà hôm nay không bán cuốn nào không có mặt trên giấy — đúng nhóm nhân viên cần đếm nhất.
- **Cả hai màn đã dùng ngày Việt Nam từ trước**: comment trong `live-monitor/route.ts` nói báo cáo ngày dùng ngày UTC là **sai** (`daily-settlement` dùng `vnDayEquals` + `businessDateOf`). Đã sửa comment, không đổi logic.

### Rủi ro đã chặn bằng test
| Rủi ro | Chặn bằng |
|---|---|
| Đơn chờ quá hạn 48h làm thổi phồng tiền chờ | `test-pending-qr-total` — 5 ca: còn hạn / quá hạn / tiền mặt / ngoài ngày / đã chốt |
| Bản in lệch màn hình | `test-settlement-print-stocktake` — cả hai bảng gọi chung `sortByStock` |
| Người dùng đọc nhầm "%" là tổng chiết khấu | Bỏ hẳn nút đổi đơn vị, luôn hiện cả hai số |
| Mở nhầm ngày ở Trạng Thái Hội Chợ | Không nhớ ngày + cảnh báo "Đang xem ngày X, không phải hôm nay" |

### Lỗi phát hiện khi chạy (đã sửa)
- `{ data: any }` trong destructuring TS hiểu là **đổi tên biến thành `any`**, không phải khai báo kiểu → `tsc` báo `Cannot find name 'data'`. Đúng cách: `{ data }: { data: any }`.
- Monitor đã có sẵn khối "Bán chạy nhất" ⇒ chỉ thêm "Đơn lớn nhất", không dán trùng.

### Chưa làm (có chủ ý)
- Cột "So với hôm nay" ▲▼ trên khối tiền (cần truy vấn ngày hôm trước) — để đợt sau để giữ diff nhỏ.
- Sửa mã vạch `ed-h66`, `ed-h85`; validate checksum ISBN-13 (chủ để sau).

### Nghiệm thu tay (2 phút, cần dev server)
1. Mở Báo Cáo Chốt Ngày → Thực thu phải ở NGAY ĐẦU, không cuộn.
2. Tab Kiểm Kê mở ra đã xếp tồn bé→lớn, không cần bấm.
3. Bấm `In Báo Cáo` → giấy có mục IV (đã bán) và VI (sắp hết), cùng xếp tồn bé→lớn.
4. Trạng Thái Hội Chợ → chọn 1 kho, đóng mở lại thì kho còn đúng, ngày về hôm nay.

## 8. Deploy + review (02/10/2026 18:49)

| Việc | Kết quả |
|---|---|
| Version ID | **`3cec35f9-d86d-4bc7-8d06-9a25c9176e61`** (100% traffic) |
| main | `9a90226` — đã rebase lên `99725cf` của agent khác rồi mới push |
| Kiểm chứng HTTP thật | Đăng nhập 200 · `/` 200 · live-monitor lọc kho + chọn ngày OK · `largestOrder` OK · `pendingQr` có mặt |
| Số tiền thật | Hồ Gươm 02/10: thực thu 11.570.400đ = 1.644.900đ tiền mặt + 9.925.500đ chuyển khoản ✓ |

### Đã chạy review độc lập — tìm ra 8 lỗi, đã sửa hết
| # | Lỗi | Hậu quả |
|---|---|---|
| 1 | Chọn "Tất cả kho hội chợ" không có tác dụng (ref fallback về prop) | Quản lý tưởng xem cả hội chợ, thực ra xem 1 gian hàng |
| 2 | Đổi kho/ngày không nạp lại, chờ poll 10–40s | Chọn "hôm qua" thấy số hôm nay |
| 3 | `itemCount` đếm SỐ DÒNG `order_items` | Đơn 3 dòng × 5 cuốn ra "3 SP" thay vì 15 |
| 4 | Đơn lớn nhất không có tie-break | Thẻ nhảy qua lại khi hoà tiền |
| 5 | Bản in ra mục VI trước mục V | Biên bản khách in sai thứ tự |
| 6 | Test pending-qr hỏng 17/24 giờ trong ngày | CI đỏ bất ngờ |
| 7 | Test để default `payment_method` giả | Case sau đỏ với nguyên nhân sai |
| 8 | Dead code 3 biến | Gây nhiễu |

**Nguyên nhân gốc khiến lỗi lọt:** test tự dùng **cùng giá trị sai** với code nên vẫn xanh — `pendingQr` lọc `QR_TRANSFER` trong khi hệ thống thật dùng `BANK_TRANSFER` ⇒ tính năng **luôn = 0**. Đã sửa và bổ sung assert chặn đúng lớp lỗi này.

### Bài học đã lưu
1. **Test dùng chung hằng/giá trị với code = test không bảo chứng được gì.** Giá trị phải lấy từ nguồn thật (schema), và nên có 1 test "phá code có chủ đích" để chứng minh test bắt lỗi.
2. **Mọi thao tác trước khi deploy phải chạy lại sau rebase** — main tiến thêm 3 lần trong lúc làm.

---

## 9. Vòng review + sửa lỗi UI (02/10/2026 19:00–19:36)

| Deploy | Version ID | Nội dung |
|---|---|---|
| 8 | `3cec35f9` | Overhaul báo cáo chốt ngày + trạng thái hội chợ |
| 9 | `62fee3c7` | Sửa lề A4 (0mm → 12/10mm) + chip "Đã chốt ca 100%" lệm ra ngoài |
| 10 | `95eba1d5` | Sửa lỗi review: `moveWarehouse` báo thành công giả + import chết |

### Lỗi A4: đo thật, không đoán
Khối 80mm trong `globals.css` khai `@page { margin: 0mm !important }` **đứng trước**;
khối A4 khai `margin: 12mm 10mm` **không** important. Theo cascade, `!important` thắng
bất kể thứ tự. `size` thì cả hai đều không important nên A4 thắng ⇒ triệu chứng
"đúng khổ A4 nhưng không có lề nào".

Đo bằng Edge headless + đọc trực tiếp content stream trong PDF:

| | Lề trái | Lề trên |
|---|---|---|
| Trước | **0.00 mm** | **0.00 mm** |
| Sau | **10.05 mm** | **11.91 mm** |

Đã xác nhận lại trên CSS production sau deploy:
`@page{size:80mm auto;margin:0!important}` rồi `@page{size:A4 portrait!important;margin:12mm 10mm!important}`.

### Sự cố tôi tự gây ra (đã sửa)
Sửa `globals.css` xong để thừa một dấu `}`. `tsc` **không** bắt lỗi CSS, test vẫn
xanh, tôi **đã push lên main** trước khi build ⇒ `next build` fail ⇒ ai build sau
cũng fail. Đã sửa + push ngay, và thêm test cân bằng ngoặc cho `globals.css`.

**Quy tắc mới: file CSS phải chạy `npm run build` TRƯỚC khi push, không dựa vào `tsc`.**

### Review OCR delegate (19 file, 20 tổng cộng; 1 file `.md` bị loại)
| Mức | Lỗi | Kết quả |
|---|---|---|
| Medium | `WarehouseManagerPanel.moveWarehouse` không kiểm `res.ok` cho các PATCH lưu `sortOrder` ⇒ HTTP 500 vẫn báo "Đã đổi vị trí", refresh là thứ tự tự nhảy về cũ | ✅ Đã sửa: `res.ok` + `Promise.allSettled` + báo "Chỉ lưu được x/y kho" |
| Low | `page.tsx` import chết `warehouses` | ✅ Đã gỡ |
| Nghi vấn | `colSpan={8}` vs "9 `<th>`" | ❌ **Không phải bug** — tôi đếm nhầm `<thead` là `<th>`; thật chỉ có 8 cột |

Một sự cố phạm vi đã bắt được: preview OCR đầu dùng `main` **cục bộ đã cũ** nên bỏ sót
`globals.css` — chính là file chứa bản sửa lề. Phải dùng `origin/main` mới đủ.

## 10. TỔNG KẾT PHIÊN 02/10/2026

### Đang chạy trên production
| Mục | Trạng thái |
|---|---|
| Worker `formapubli` | `95eba1d5` — 100% traffic |
| `main` | `e2f231d` = `origin/main` |
| Migration | `0035` (discount approval) + `0036` (warehouse sort_order) — đều đã áp |

### Test mới thêm hôm nay (7 suite, đều đăng ký trong `run-isolated.ts`)
`test-pending-qr-total` · `test-stocktake-order` · `test-settlement-money-header` ·
`test-settlement-print-stocktake` · `test-settlement-print-margin-and-chip` ·
`test-live-monitor-scope` · (cập nhật) `test-warehouse-reorder`

### 🔶 Việc TREO, cần chủ quyết
| Việc | Nguyên nhân |
|---|---|
| ~~Sửa ISBN `ed-h66` (Tristram Shandy)~~ | ✅ **XONG 03/10** — mục 11 |
| `ed-h85` (Đốt kho tái bản) | ⛔ **Chủ bảo bỏ qua lần này.** Hệ thống vẫn lưu 14 số, vẫn `is_active=0` |
| Validate checksum ISBN-13 khi nhập | Chủ để sau. Đây chính là nguyên nhân gốc làm sách Wittgenstein không quét được |
| Cột "so với hôm qua" ▲▼ trên khối tiền | Để giữ diff nhỏ, làm ở đợt sau |

### 🟡 Việc của AGENT KHÁC, không đụng vào
- `D:\Data Project\formapubli` (worktree chính): đang có 2 file docs `doanh-so-overhaul` sửa dở (đã commit 03/10) + script tạm `scripts/tmp-probe-isbn.ts` (đã xoá 03/10).
- `D:\Data Project\formapubli-promo`: nhánh `fix/remove-order-notifications`, chưa merge, có `scripts/probe-ordercode-length.ts` untracked.
- `D:\Data Project\formapubli-sales`: nhánh `agent/b-doanh-so-overhaul`.

### Bài học lớn nhất hôm nay
1. **Test dùng chung hằng/giá trị với code thì test không bảo chứng được gì.** `pendingQr`
   lọc `QR_TRANSFER` trong khi hệ thống thật dùng `BANK_TRANSFER` ⇒ tính năng luôn = 0
   mà test vẫn xanh. Trước khi tin test, cắt 1 chỗ trong code và xem test có đỏ không.
2. **`tsc` không validate CSS.** Lỗi `}` thừa làm cả repo không build được mà test vẫn xanh.
3. **Deploy phải đo bằng thứ chạy thật**, không tin bằng mắt: lề A4 đo được 0.00mm → 10.05mm.
4. **Review độc lập bắt được 9 lỗi** mà tự test không bắt được.

---

## 11. SỬA MÃ VẠCH ISBN (03/10/2026)

Chủ cầm sách lên, đọc mã vạch in thật. Ghi thẳng production (Turso), tồn kho **không đổi**.

| Mã ấn bản | Sách | Trước | Sau | Kết quả |
|---|---|---|---|---|
| **`TP0030`** (`ed-h66`) | Tristram Shandy | `9786044449689` ❌ | **`9786044449869`** | ✅ đã sửa |
| `HH034` (`ed-h41`) | Cháu trai Wittgenstein | `9786049679377` | (không đổi) | ✅ **đã đúng sẵn** |
| `H85` (`ed-h85`) | Đốt kho tái bản | `9786320317631 3` (14 số) | — | ⛔ **chủ bảo bỏ qua** |

Script: `scripts/fix-isbn-ed-h66-prod.ts` (idempotent, mặc định DRY-RUN, chặn trước khi
ghi nếu mã đích sai checksum hoặc đã thuộc ấn bản khác). Cùng khuôn với
`scripts/fix-isbn-ed-h41-prod.ts`.

### Hai bài học rút ra từ việc này

**1. Suy checksum KHÔNG phải là quét mã.** Mã `9786044449685` hợp lệ checksum và
tôi đã từng ghi vào docs là "mã đúng". Nó **sai thật** — mã thật là `…89869`.
Vì `…89689` sai ở **12 số đầu** chứ không phải ở số kiểm, nên "ép lại số kiểm"
vẫn ra một số hợp lệ — nhưng là số của một cuốn sách khác. Checksum chỉ bắt được
sai ở **1 chữ số cuối**, không bắt được sai ở 12 số đầu.

**2. Cùng một dạng lỗi, hai cuốn khác nhau.** Cả `ed-h41` và `ed-h66` đều là
**đảo cặp số ở vị trí 11–12** (`68` ↔ `86`) khi nhập tay:
`9768049679377` → `9786049679377`, và `9786044449689` → `9786044449869`.
⇒ Mã nguồn có lỗi nhập tay có hệ thống, **nên kiểm tra cả danh mục**, không chỉ
cuốn người dùng vấp.

**3. Sửa DB mà quên CSV thì sẽ bị ghi đè.** `scripts/seed.ts:180` đọc
`data_tabs/sheet1_danhmuc_gid_0.csv` và `insert(editions).onConflictDoUpdate({target: editions.code})`
⇒ chạy lại seed là mất. Đã sửa cả CSV dòng 67. `seed.ts` cũng tự suy
`isbn_last4 = isbn.slice(-4)` nên đã sửa luôn `isbn_last4` trong DB cho khớp
(nếu không, cột tra cứu `idx_editions_isbn_last4` và nhãn "Đuối:" trong UI sẽ sai).

### Còn treo

- **Validate checksum ISBN-13 lúc nhập** — chủ để sau. Đây mới là nguyên nhân gốc.
- **`ed-h85`** (Đốt kho tái bản, 14 số) — chủ bảo bỏ qua lần này.

## 12. QUÀ TAY "Tặng thêm" — BẮT BUỘC QUA DUYỆT (04/10/2026)

**Đã xong, đã deploy.** Nhánh `fix/tang-them-qua-duyet` → `main` (`f61e335`),
Worker `bca52ad7-36e5-4dcb-bf6a-fe1d94c50ffd`.

### Lỗi đã sửa

Chủ báo: "tặng thêm lúc nào cũng được, không có xét duyệt, và modal thanh toán
vẫn cho thêm". Rà soát tìm ra **4 lỗi, trong đó lỗi 1 là lỗi MẤT TIỀN THẬT**:

1. **`addManualGift` không hề mở yêu cầu duyệt.** Mọi đường mở
   `isDiscountApprovalModalOpen` đều nằm trong `handleRequestDiscount`, mà hàm
   đó không được gọi bởi "Tặng thêm" ⇒ không có `discountApprovalId`.
2. **Khách bị thu ĐÚNG GIÁ cho món quà.** `order.service.ts:677` chỉ công nhận
   dòng quà nằm trong snapshot đã duyệt; dòng tay không có ⇒ bị hạ về dòng
   thường ở giá bìa, chỉ ghi `isGiftClaimedRejected` vào audit, **không báo lỗi
   ra màn hình**. Màn hình lại ghi "0 đ (sau duyệt)".
3. **Modal "Chi tiết Đơn & Thanh toán" vẫn cho thêm** sau khi giỏ đã khoá/duyệt.
4. **Giỏ không khoá sau duyệt** vì không có bước duyệt cho quà tay.

### Cách sửa (chỉ ở client, KHÔNG đụng server)

- `addManualGift` → gọi `requestManualGiftApproval()`: mở modal duyệt ngay với
  `pendingDiscountRate = discountRate || 0` (server cho phép rate 0 khi đơn có
  dòng quà tay — `discount-approval.service.ts:248`).
- Ô "Tặng thêm" **chỉ hiện cho `ROLE_CASHIER` và khi giỏ không khoá**
  (`showManualGiftUi`). Quản lý/owner **không** thấy: `approveRequest` chặn tự
  duyệt yêu cầu của chính mình (`:502`) ⇒ quà của họ không bao giờ được duyệt mà
  server lại hạ về giá thường.
- Dòng quà đã thêm **vẫn hiện** khi giỏ khoá (nút "Gỡ" bị khoá) để thu ngân
  thấy mình đang xin duyệt món nào; chỉ ô chọn món mới ẩn.
- `handleCheckout` chặn chốt đơn khi `manualGifts.length > 0 &&
  !approvedDiscountRequestId` — lưới an toàn cuối, trả lời rõ bằng chữ.
- Banner khoá giỏ nói đúng việc đang chờ duyệt ("duyệt quà tặng thêm" thay vì
  "duyệt chiết khấu 0%").

### Bằng chứng

- `scripts/test-manual-gift-approval.ts`: thêm case **CK đơn 10% + quà tay**
  (trước đó chỉ có case rate 0). 15/15 xanh.
- Suite browser riêng `npm run test:pos-gift`
  (`scripts/run-real-manual-gift-test.ts`, 6 khẳng định G1–G6) chạy trên
  component THẬT trong Chrome headless: 6/6 xanh.
- **Cắt code để kiểm test có bắt lỗi không (2 lần):** bỏ hook mở duyệt ⇒ G2 đỏ
  ("Timeout chờ: gửi yêu cầu duyệt"); bỏ lưới an toàn trong `handleCheckout` ⇒
  G4 đỏ ("Quà tay CHƯA duyệt mà đã gửi POST /api/orders").
- 6 suite DB liên quan xanh (`test-gift-forgery`, `test-gift-approval-hash`,
  `test-s3-discount-approval`, `test-discount-checkout-atomic`, `test-gift-offline`,
  `test-gift-subtotal`); `npx tsc --noEmit` sạch.
- `scripts/verify-pos-live.ts` (HTTP thật, chỉ đọc): **22/24**. Hai đỏ là dữ liệu
  DB dev, không phải hồi quy: #9 danh mục POS trả 0 món, #15 mã đơn dev không
  phải 13 lẫn 29 ký tự. Diff không đụng `src/app` lẫn `src/services` nên không
  thể do thay đổi này.

### Bài học

- **Suite component POS đã ROT từ lâu và không ai biết**: `browser-pos-terminal-test.tsx`
  chết ở Test 2 (`Test 6` cũng đỏ) nên **không test nào phía sau chạy tới**, và
  nó **không được nối vào runner nào** (`run-isolated.ts` không gọi). Vì vậy test
  của tính năng mới phải TÁCH suite riêng có npm script, không gài vào đó.
- **Harness phải mô phỏng đủ điều kiện thật**: không mock `/api/cashbox` và không
  truyền prop `actorId` thì nút chốt đơn bị disable và mọi khẳng định "chốt đơn bị
  chặn" đều **xanh vì lý do khác**. Đã bổ sung cả hai vào harness.
- `scripts/run-isolated.ts` **chưa** gọi `test:pos-gift` (cần Chrome + esbuild,
  không hợp với suite DB). Nên chạy tay trước khi sửa POS. **Việc treo.**

### Còn treo

- **Nối `test:pos-gift` vào CI/runner** để không tái diễn rot.
- **Thu ngân mất thói quen tặng tay**: sau khi Quản lý duyệt xong, giỏ khoá và
  dòng quà không gỡ được nữa (đúng luật, nhưng cần báo lại thu ngân).
- **Suite component POS cũ vẫn đỏ** ở Test 2/Test 6 — chưa sửa vì ngoài phạm vi.

## 13. VỆ SINH TEST POS (04/10/2026, sau mục 12)

Đã làm, **không đụng `src/`** ⇒ **không cần deploy**. Chi tiết ở
`docs/superpowers/plans/2026-10-04-ve-sinh-test-pos.md`. Tóm tắt:

- `scripts/run-isolated.ts` nay chạy **cả 2 suite component** (Chrome headless) sau
  danh sách DB. `--list` liệt kê chúng. Thiếu Chrome ⇒ báo **BỎ QUA** (không đỏ),
  trừ khi đặt `POS_REQUIRE_CHROME=1`.
- Suite POS cũ **xanh 14/14 trở lại** sau 5 sửa đúng bản chất: nhãn nút
  "Chốt Ngày"→"Báo Cáo Ngày", padding `p-3` của harness cho khớp `<main>` thật,
  selector không phụ thuộc thứ tự DOM, thông báo lỗi hủy duyệt đã đổi, luồng
  chuyển khoản giờ bắt **chụp ảnh** chứ không phải nút "Đã nhận tiền".
- **Nguyên nhân rot gốc**: `--window-size=375,640` bị Chrome ép về 500px rồi đổi
  lần nữa sau khi trang mount ⇒ `isMobileView` đảo giữa chừng ⇒ danh mục biến mất
  ⇒ mọi test phía sau chết. Đã đổi sang cửa sổ cố định `--window-size=1280,900`.
  Đây là loại lỗi mà người đọc log test không bao giờ đoán ra — nên giờ thông báo
  lỗi của Test 7 in ra **thủ phạm cụ thể** thay vì chỉ nói "tràn ngang".
