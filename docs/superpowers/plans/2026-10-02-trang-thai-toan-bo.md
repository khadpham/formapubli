# TÀI LIỆU BÀN GIAO — Cổng 3 Khuyến Mại + Hàng Hóa

**Ngày:** 02/10/2026 · **Trạng thái:** LÕI XONG, CHƯA DEPLOY · **Độc giả:** agent tiếp nhận, phải làm tiếp được NGAY

| Hạng mục | Giá trị |
|---|---|
| Repo gốc | `D:\Data Project\formapli` (ghi đúng: `D:\Data Project\formapubli`) |
| **Worktree đang làm** | `D:\Data Project\formapubli-promo` |
| Branch | `feat/khuyen-mai-san-pham` |
| HEAD | `fb3783f` |
| Số commit chưa merge vào `main` | **8** |
| Production version đang chạy | `b8ad7643-ec6d-44ac-80e3-d66fd6838213` |

> **NGƯỜI ĐỌC PHẢI LÀM ĐƯỢC NGAY, KHÔNG PHẢI SUY LUẬN.** Mọi con số dưới đây là số đo được, không phải ước lượng. Lệnh copy chạy được nguyên văn.

---

## 1. TÓM TẮT 1 TRANG

| Nhóm | Làm được gì | Chưa làm gì | Rủi ro |
|---|---|---|---|
| **Hàng hóa** | ✅ Đầy đủ: bảng `products`, API, UI Cài Đặt → Quản trị → Hàng Hóa, E2E **33/33** | Chưa bán được trên production | Migration đã lên production nhưng code bán hàng hóa **chưa deploy** |
| **Cổng 3 — engine** | ✅ Hàm thuần khiết, mô hình bậc thang, `test-promotion-engine` **32/32** | UI chưa có gì | Không |
| **Cổng 3 — server** | ✅ 5 lỗi đã sửa, 5 test khoá lại (20/20, 20/20, 21/21, 12/12) | B3 (quà hết tồn), duyệt quà tay chưa nối | Client có thể gửi cờ quà giả — **đã chặn** |
| **Cổng 3 — deploy** | — | 🔴 **CHƯA DEPLOY** | Deploy sớm = 2 lỗi lên production (đã xảy ra 1 lần) |
| **Test suite** | 124/125 xanh | `test-pay2-money-audit.ts` đỏ | Đã chứng minh flaky có sẵn từ trước, không phải hồi quy |
| **Sổ kho** | `stock_balances` ĐÚNG (440 dòng, 0 âm) | 🔴 ledger Hồ Gươm lệch **87 bút toán RECEIPT** | Hàng vật lý đúng; **thiếu sổ, không thiếu hàng** |
| **Backup** | ✅ `backup-prod.ts` + `restore-prod.ts`, đã khôi phục thật 6/6 bảng khớp | — | Trước đây KHÔNG có script backup Turso |
| **TypeScript** | `npx tsc --noEmit` **0 lỗi** | — | — |

**Ba việc kế tiếp theo thứ tự:** (1) UI khuyến mại → (2) B3 quà hết tồn → (3) luồng duyệt quà tay.

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

`npx tsc --noEmit` **0 lỗi** · **124/125 suite xanh**.

---

## 7. 🔴 ĐANG ĐỎ — 1 suite

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

## 8. ⚪ CÒN LẠI — theo thứ tự nên làm

### 8.1 UI khuyến mại — ⚪ CHƯA LÀM GÌ

| Hạng mục | Cần làm |
|---|---|
| Nút "Khuyến mãi" trong tab POS | Chỉ hiện cho **Quản lý / Chủ** |
| Màn hình cài đặt mốc | Mỗi dòng: `Từ 500.000đ` → chọn sản phẩm + số lượng |
| Badge "Quà" trong giỏ | + nút **"Bỏ quà"** |
| Nút **"Tặng thêm"** | Thêm quà thủ công ngoài chương trình |
| Cảnh báo giá quà | Khi `giá quà ≥ 50% mốc` — dùng **`giftValueWarning()` đã có sẵn trong `promotion-engine.ts`** |

Kiểm chứng: mở POS bằng tài khoản Quản lý → thấy nút Khuyến mãi; tạo mốc; quét đơn đủ tiền → giỏ tự hiện badge "Quà"; bấm "Bỏ quà" → dòng quà biến mất.

### 8.2 B3 = (b\*) — quà hết tồn

**Nguyên nhân:** hiện tại `order.service.ts` **chặn cả đơn** khi quà hết tồn ⇒ mất đơn hợp lệ.

**Sửa ở đâu:** `src/services/order.service.ts` (nhánh xử lý dòng quà).

**Làm gì:** quà hết tồn **vẫn cho thanh toán** nhưng **KHÔNG ghi `stock_balances`**; chỉ ghi `inventory_ledger` + bật cờ `is_gift_shortfall`.

Cờ `is_gift_shortfall` **ĐÃ CÓ** trong migration `0032` + `schema.ts` — **code chưa viết**.

Kiểm chứng: đặt tồn quà = 0, chạy `scripts/test-gift-subtotal.ts` và `scripts/test-gift-offline.ts` ⇒ đơn vẫn 201, `stock_balances` không đổi, `is_gift_shortfall = 1`, ledger có bút toán tương ứng.

### 8.3 Luồng duyệt quà tay

**Nguyên nhân:** engine đã có tham số **`approvedManual`** nhưng **chưa nối** vào `order.service.ts`.

**Sửa ở đâu:** `src/services/order.service.ts` — truyền `approvedManual` xuống engine và gắn **`discountApprovalId`**.

Kiểm chứng: đơn có quà tay mà chưa duyệt ⇒ **409**; sau khi duyệt ⇒ **201** và `discount_approval_id` không null.

### 8.4 Báo cáo quà tặng

**Nguyên nhân:** báo cáo gộp chung quà còn tồn và quà hết tồn.

**Sửa ở đâu:** báo cáo bán hàng — tách 2 nhóm theo cờ **`is_gift_shortfall`**.

### 8.5 🔴 Sổ kho Hồ Gươm — thiếu 87 bút toán RECEIPT

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

---

## 9. LỘ TRÌNH CỬA SỔ

| Điều kiện | Trạng thái hiện tại |
|---|---|
| **Chưa ai được nhập hàng hóa vào kho** cho tới khi có xác nhận "xanh" | Màn hình Hàng Hóa **đã hiện** nhưng **chưa bán được** |
| Migration `0031`–`0033` đã áp | ✅ Nhưng **chưa deploy code Cổng 3** |

**Lý do:** hàng hóa chưa bán được trên production. Điều kiện này do **agent giám sát** đặt ra và **đã được chủ đồng ý**.

**Sau khi "xanh" bao gồm:** Cổng 3 deploy xong + hàng hóa bán được trên production.

---

## 10. BÀI HỌC ĐÃ MẮC (8 bài — đọc để không lặp lại)

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

---

## 11. DANH SÁCH FILE QUAN TRỌNG

### Code Cổng 3

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
| `scripts/test-goods-sell-e2e.ts` | 33/33 |
| `scripts/test-promotion-engine.ts` | 32/32 |
| `scripts/test-gift-subtotal.ts` | 20/20 |
| `scripts/test-gift-approval-hash.ts` | 20/20 |
| `scripts/test-gift-offline.ts` | 21/21 |
| `scripts/test-gift-forgery.ts` | 12/12 |
| `scripts/test-pay2-money-audit.ts` | 🔴 flaky có sẵn (mục 7) |
| `scripts/test-royalties.ts` | Cùng triệu chứng flaky |

### Migration

`src/db/migrations/0031_*.sql` · `0031b` (backfill) · `0032_*.sql` (có cột `is_gift_shortfall`) · `0033_*.sql`

---

## 12. LỘ TRÌNH SAU KHI NHẬN BÀN GIAO

| Bước | Việc | Điều kiện kết thúc |
|---|---|---|
| 1 | `git branch --show-current` xác nhận đúng branch | Trả `feat/khuyen-mai-san-pham` |
| 2 | Đọc mục 8.1 → làm UI khuyến mại | Nút + mốc + badge + 2 nút chạy tay trên POS |
| 3 | Chạy `npx tsx scripts/run-isolated.ts` | **124/125** hoặc tốt hơn, `tsc` 0 lỗi |
| 4 | Làm mục 8.2 (B3) → 8.3 (duyệt quà tay) → 8.4 (báo cáo) | Mỗi mục có test riêng xanh |
| 5 | **Báo cáo kết quả trước khi deploy** | Chủ duyệt |
| 6 | Deploy + rollback nếu cần | `npm run deploy`; `npx wrangler rollback <id>` |
| 7 | Mục 8.5 ghi bù sổ kho Hồ Gươm | **Chạy khi kho đóng** |
| 8 | Báo "xanh" để mở lộ trình cửa sổ nhập hàng hóa | Có xác nhận từ chủ |
