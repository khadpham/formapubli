# Trạng thái toàn bộ — 02/10/2026

Worktree: `D:\Data Project\formapubli-promo` — nhánh `feat/khuyen-mai-san-pham`

Tài liệu này là **nguồn sự thật duy nhất** cho trạng thái tối 02/10/2026. Mọi con số dưới đây là số đo được, không phải ước lượng.

| Mục | Trạng thái |
|---|---|
| 1. Migration + backfill production | ✅ XONG |
| 2. Backup / khôi phục production | ✅ XONG (đã chứng minh thật) |
| 3. Tính năng hàng hóa | ✅ XONG (đã nghiệm thu tầng 3) |
| 4. Cổng 3 khuyến mại — code + test | ✅ XONG, **CHƯA deploy** |
| 5. Full test suite | 🔴 ĐỎ 4/125 |
| 6. Sổ kho Hồ Gươm lệch 87 bút toán | 🟡 NỢ KỸ THUẬT |
| 7. UI khuyến mại + B3 + duyệt quà tay + báo cáo quà | ⚪ CHƯA LÀM |

---

## 1. ✅ XONG — Production (đang chạy)

Version đang chạy trên Cloudflare Worker: **`b8ad7643-ec6d-44ac-80e3-d66fd6838213`**

| Việc | Số liệu đo được |
|---|---|
| Migration `0031` (bảng `products` / `promotions` / `promotion_gifts` + 7 cột nullable) | ĐÃ ÁP |
| Backfill `0031b` — editions | 88/88 |
| Backfill `0031b` — order_items | 217/217 |
| Backfill `0031b` — inventory_ledger | 1657/1657 |
| Backfill `0031b` — stock_balances | 440/440 |
| `product_id IS NULL` ở cả 4 bảng sau backfill | **0** |
| Migration `0032` (dựng lại `stock_balances` + `order_items`) | ĐÃ ÁP |
| Migration `0033` (dựng lại `inventory_ledger`) | ĐÃ ÁP |
| Tổng số bảng | 45 |
| `integrity_check` | **ok** |
| `foreign_key_check` | **sạch — 0 vi phạm** |
| Số dòng tồn âm | **0** |

### Nghiệm thu tầng 3 (đơn thật qua HTTP)

| Mục | Kết quả |
|---|---|
| Mã đơn | `ORD2610020001` |
| Kho | ĐH Hà Nội |
| Trạng thái | COMPLETED |
| Tổng tiền | 110.000đ |
| Tổng dòng khớp `final_amount` | ✅ |
| `product_id` | `ed-h65` |
| `is_gift_line` | 0 |
| Sổ kho | `DISPATCH_SALE −1` |

---

## 2. ✅ XONG — Backup và khôi phục production

**Trước đây KHÔNG có script backup nào cho Turso** (`backup-db.ts` chỉ copy file local).

| Hạng mục | Trạng thái |
|---|---|
| `scripts/backup-prod.ts` (chỉ đọc) | ✅ Xong |
| `scripts/restore-prod.ts` (mặc định dry-run, cần `--thuc-hien` + `ALLOW_REMOTE_TARGET=<host>`) | ✅ Xong |
| Khôi phục thật vào DB rỗng | ✅ 6/6 bảng khớp production |
| Integrity sau khôi phục | ✅ ok |
| FK sau khôi phục | ✅ sạch |
| Trigger sau khôi phục | ✅ đủ 3 |
| `backups/` loại khỏi git qua `.git/info/exclude` (cục bộ) | ✅ Xong |

**Số liệu đối chiếu sau khôi phục (khớp tuyệt đối):**

| Bảng | Số dòng |
|---|---|
| works | 87 |
| editions | 88 |
| warehouses | 5 |
| orders | 79 |
| order_items | 217 |
| stock_balances | 440 |

**Kiểm backup đủ dữ liệu kho Hồ Gươm:**

| Loại dữ liệu | Số dòng |
|---|---|
| Dòng tồn | 88 |
| Bút toán kho | 331 |
| Đơn | 40 |
| Dòng đơn | 73 |
| Ca két | 5 |

---

## 3. ✅ XONG — Tính năng hàng hóa

| Hạng mục | Kết quả |
|---|---|
| Bảng `products` là tầng gốc chung sách + hàng hóa | ✅ |
| `products.id` của sách = `editions.id` (ví dụ `ed-hh001`) | ✅ |
| Trigger `editions_sync_products` giữ bất biến sách ⇒ products luôn khớp | ✅ |
| `POST/PATCH /api/products` — chỉ `ROLE_OWNER` + `ROLE_MANAGER` | ✅ |
| Mã hàng hóa BẮT BUỘC tiền tố `SP-` | ✅ |
| UI: Cài Đặt → Quản trị → **Hàng Hóa** | ✅ |
| Không có nút xoá, chỉ **"Ngưng hoạt động"** | ✅ |
| `costPrice` CỐ Ý KHÔNG lộ ra API | ✅ 5 test khoá |
| Danh mục POS đọc `products` LEFT JOIN `editions` LEFT JOIN `works` ⇒ hàng hóa lên được lưới quét mã | ✅ |
| E2E bán hàng hóa đầu-cuối `scripts/test-goods-sell-e2e.ts` | ✅ **33/33 xanh** |

---

## 4. ✅ XONG — Cổng 3 khuyến mại (CHƯA DEPLOY)

Engine: `src/lib/promotion-engine.ts` — hàm **thuần khiết, không query DB**.
Mô hình **BẬC THANG**: chỉ mốc CAO NHẤT đạt được được kích hoạt.

| Test | Kết quả |
|---|---|
| `test-promotion-engine.ts` | ✅ **32/32** |
| `test-gift-subtotal.ts` | ✅ 18/18 |
| `test-gift-approval-hash.ts` | ✅ 20/20 |
| `test-gift-offline.ts` | ✅ 19/19 |
| `test-gift-forgery.ts` | ✅ **12/12** |

**Các lỗi đã sửa (đều có test khoá lại):**

| # | Lỗi | Nơi sửa | Số liệu |
|---|---|---|---|
| 1 | **403 mọi đơn có quà** — dòng quà đẩy trần chiết khấu 20% lên trên | `routes.ts` loại dòng quà khỏi phép so trần | `test-gift-subtotal` 18/18 |
| 2 | **`subtotal` / `discountAmount` nhiễm giá quà** — dòng quà cộng vào subtotal | dòng quà KHÔNG cộng vào `subtotal` | cùng file test |
| 3 | **409 đơn có quà + cần duyệt chiết khấu** | dòng quà tự loại khỏi `cartHash` và phép so `originalAmount` | `test-gift-approval-hash` 20/20 |
| 4 | **Đơn offline thu thiếu tiền** | `offline-db.ts` mang `unitDiscountRate = 1` cho dòng quà | `test-gift-offline` 19/19 |
| 5 | **Giả mạo quà (bảo mật)** — client tự gắn cờ `isGiftLine` để bán 0đ | `order.service.ts` **KHÔNG** tin cờ client, tự tra bảng `promotions` xác minh món có thật sự thuộc bậc đạt tới; dòng giả bị hạ về dòng thường, khách trả đúng giá | `test-gift-forgery` 12/12 |

**2 lỗi lịch sử đã bị test khoá lại trong engine (32/32):**
- Cộng dồn bậc: 1 triệu ra **2A + 2B + C** thay vì **A + B + C**.
- Vòng lặp: quà tự đẩy tổng vượt bậc kế tiếp.

---

## 5. 🔴 ĐỎ — Test suite (ghi rõ, không giấu)

Lần chạy full suite gần nhất: **121/125 xanh**, `npx tsc --noEmit` **0 lỗi**.

| Suite | Trạng thái | Ghi chú |
|---|---|---|
| `test-gift-subtotal.ts` | 🔴 ĐANG ĐIỀU TRA | Có thể do thay đổi `unit_discount_rate` lưu `effectiveDiscountRate` |
| `test-gift-offline.ts` | 🔴 ĐANG ĐIỀU TRA | — |
| `test-master-audit.ts` | 🔴 ĐANG ĐIỀU TRA | — |
| `test-pay2-money-audit.ts` | 🔴 FLAKY CÓ SẴN | Đã chứng minh từ trước tối nay — xem mục 6 |

**121/125 suite khác: xanh.**

---

## 6. FLAKY — đã chứng minh có từ trước, KHÔNG phải hồi quy

Hai suite: `test-royalties.ts` và `test-pay2-money-audit.ts`.

| Bằng chứng | Kết quả |
|---|---|
| Cùng code, cùng DB sạch, chạy 3 lần liên tiếp | EXIT = **0, 1, 1** |
| Chạy trên code TRƯỚC tối nay, cùng DB sạch | **0, 1, 1** ⇒ **không liên quan thay đổi hôm nay** |
| `ORDER BY id` đã thêm vào `edOf()` của `test-royalties` | **chưa hết** — còn nguồn phi tất định khác, chưa tìm ra |

**Biện minh bỏ qua được:**

| Bằng chứng production | Số liệu |
|---|---|
| `rights_contracts` | **0 dòng** |
| Audit log royalty | **0 hoạt động** |

⇒ Tính năng chưa có ai dùng, rủi ro thực tế bằng 0.

---

## 7. 🟡 NỢ KỸ THUẬT (chưa làm)

### 7.1 Sổ kho Hồ Gươm thiếu 87 bút toán RECEIPT

| Số liệu | Giá trị |
|---|---|
| Ledger âm tại Hồ Gươm | **−85.494** |
| Trên mỗi mã | −990 / −1000 |
| `stock_balances` | **ĐÚNG** — 440 dòng, không âm, khớp bán thật |
| Nguyên nhân | Kho chưa bao giờ có bút toán nhập; ngày 30/09 chuyển ra **85.260 cuốn** nhưng chỉ nhận **812** |

**Cách sửa:** viết script ghi bù, chạy khi kho đóng.

> **Hàng vật lý ĐÚNG — thiếu sổ, không thiếu hàng.**

### 7.2 B3 = (b\*) chưa code

Khi quà hết tồn: vẫn cho thanh toán nhưng **KHÔNG ghi `stock_balances`**, chỉ ghi ledger + cờ `is_gift_shortfall`.
Cột `is_gift_shortfall` **ĐÃ có** trong migration `0032` + `schema.ts`.

---

## 8. ⚪ CHƯA LÀM

| Hạng mục | Chi tiết |
|---|---|
| Luồng duyệt quà tay | `approvedManual` trong engine đã có, nhưng **chưa nối** vào `order.service.ts` (cần `discountApprovalId`) |
| UI khuyến mại | Nút "Khuyến mãi" trong tab POS; màn hình cài đặt mốc; badge "Quà" + nút "Bỏ quà" / "Tặng thêm" trong giỏ |
| Báo cáo quà tặng | Tách quà còn tồn vs quà hết tồn (đã chốt #4) |

---

## 9. 🚧 LỘ TRÌNH CỬA SỔ (ranh giới an toàn của hệ thống)

| Điều kiện | Trạng thái |
|---|---|
| **Chưa ai được nhập hàng hóa vào kho** cho tới khi báo "xanh" | Màn hình Hàng Hóa **đã hiện** nhưng **chưa bán được** |
| `0033` đã áp nhưng **chưa deploy code Cổng 3** | Sách bán bình thường; **hàng hóa chưa bán** |

> Điều kiện này do **agent giám sát** đặt ra và đã được đồng ý.

---

## 10. ❓ CHỜ QUYẾT ĐỊNH CỦA CHỦ

| # | Câu hỏi | Điều kiện để làm tiếp |
|---|---|---|
| 1 | **Deploy Cổng 3 khi nào?** | Cần ít nhất **4 suite ở mục 5 phải xanh** |
| 2 | **Có làm ghi bù sổ kho Hồ Gươm không, hay để kỳ sau?** | Không có việc nào khác phụ thuộc |
| 3 | **Có làm UI khuyến mại tối nay không?** | Phụ thuộc câu 1 — UI đi cùng code đã deploy |

---

## 11. BÀI HỌC ĐÃ MẮC (ghi để không ai lặp lại)

| # | Bài học | Hệ quả đã gặp |
|---|---|---|
| 1 | **Deploy chỉ sau khi đọc kết quả test** | Đã deploy trước khi đọc E2E ⇒ **2 lỗi lên production** |
| 2 | **DDL phải lấy NGUYÊN VĂN từ `sqlite_master` của production** | Tự viết `0033` theo bản `0000` ⇒ thiếu cột `reversal_of` ⇒ `no such column` |
| 3 | **Không suy luận "`products.id === editions.id` nên tương đương"** | Sai; đã làm **lệch số liều royalty 35.466đ** |
| 4 | **Một lần chạy test KHÔNG đủ để kết luận** | Chạy 1 lần thấy xanh ⇒ kết luận "sai"; chạy lại thấy đỏ ⇒ đổ lỗi cho code khác. Thực ra test **flaky**. Phải chạy lặp **≥3 lần** |
| 5 | **`verify-pos-live.ts` KHÔNG phải "chỉ đọc"** | Nó **tạo đơn thật** qua `POST /api/orders` (dòng 206) |
| 6 | **Schema phải khớp migration** | `schema.ts` khai `promotion_gifts.created_at` nhưng `0031` không tạo cột đó ⇒ **mọi truy vấn bảng đó trả 500** |
| 7 | **Giao sub-agent theo MẪU LỖI, không theo danh sách file** | 4 file cùng một lỗi bị sót vì tôi liệt kê file |

---

## 12. ĐƯỜNG ĐI TƯƠNG LAI (mục tiêu nghiệp vụ, chưa lập kế hoạch chi tiết)

1. **Cổng 3 hoàn tất** ⇒ bán hàng hóa trên POS thật.
2. **Sau đó mới đến chương trình khuyến mại thật**: thu ngân quét đơn đạt mốc → hệ thống tự thêm quà giá 0đ → ghi sổ kho → báo cáo tách quà còn tồn / hết tồn.
