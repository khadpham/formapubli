# Thiết kế: Sản phẩm hàng hóa + Khuyến mại quà tặng

Ngày: 2026-10-01 · Trạng thái: **CHỜ DUYỆT** (chưa viết code)

---

## 0. Tóm tắt quyết định

| # | Quyết định | Chốt |
|---|---|---|
| 1 | Hướng dữ liệu: tách bảng `products` làm gốc, `editions` làm chi tiết sách | ✅ B |
| 2 | `products.id` của sách = `editions.id` hiện có (`ed-h01`) | ✅ |
| 3 | Hàng hóa mới có mã `SP-0001` (tiền tố riêng, không đụng mã sách) | ✅ |
| 4 | Thêm `cost_price` nullable, **không** đưa lên UI lúc này | ✅ |
| 5 | Quà tặng có tồn kho thật, trừ kho như bán thường | ✅ |
| 6 | Quà do hệ thống tự thêm → **không** cần duyệt | ✅ |
| 7 | Quà do người thêm tay → **Quản lý phải duyệt** | ✅ |
| 8 | Hết quà trong kho → **cảnh báo, vẫn cho thanh toán**, ghi tồn âm | ✅ |
| 9 | Mốc khuyến mại tính trên **tổng giá gốc** (trước chiết khấu) | ✅ |
| 10 | Hàng hóa vào chung danh sách POS, quét mã EAN lên như sách | ✅ |
| 11 | Nút **"Khuyến mãi"** trong tab POS, Quản lý trở lên | ✅ |
| 12 | Không làm thu hồi quà (UI trả hàng đã bị gỡ từ lâu, backend để nguyên) | ✅ |
| 13 | Mốc là **bậc thang**: chỉ mốc CAO NHẤT đạt được kích hoạt, không cộng dồn | ✅ |
| 14 | **"Tặng thêm"** (tay) → **luôn** phải Quản lý duyệt, kể cả đã có quà tự động | ✅ |
| 15 | **"Bỏ quà"** → **không** cần duyệt, đơn về bình thường thanh toán ngay | ✅ |
| 16 | "Bỏ quà" có tính **dính**: lên bậc cao hơn thì không tự quay lại | ✅ |
| 17 | Quà **có thể trùng** sản phẩm đang bán ("mua 4 tặng 1") | ✅ |
| 18 | Số lượng quà luôn **cố định**, không bao giờ theo tỉ lệ | ✅ |
| 19 | Hết kho mà thu ngân bấm "Tặng thêm" → **cho qua**, cảnh báo + ghi âm | ✅ |
| 20 | Bất đối xứng bảo mật: **tăng quà thì duyệt, giảm quà thì không** | ✅ |
| 21 | **"Tặng thêm" tặng được BẤT KỲ sản phẩm nào có tồn kho**, kể cả sách | ✅ A |
| 22 | `is_gift_item` chỉ để **gợi ý** trong bộ chọn quà, **không** phải rào chặn | ✅ |
| 23 | Phạm vi triển khai: **Cách 2** (đủ cả sách lẫn hàng hóa) | ✅ |
| 24 | Triển khai theo **3 cổng**, mỗi cổng tự rollback được | ✅ |

> **Từ giờ tài liệu này chỉ dùng "Sản phẩm A / B / C" làm ví dụ.**
> Bản đầu dùng "tù lù", "áo mưa", "móc khỏa" — đó là ví dụ bịa, không có trong DB,
> và vi phạm quy ước đã chốt: nói **"sản phẩm"** cho bao quát.
> Hiện DB **không có sản phẩm nào ngoài sách.** Đây là tính năng hoàn toàn mới.

---

## 1. Vì sao cơ chế "Tặng 100%" hiện tại **không** dùng lại được

Cơ chế cũ: `isGift` + `discountRate = 1` = **chiết khấu 100% cho CẢ ĐƠN**, kèm `giftReason` bắt buộc và Quản lý phê duyệt.

| | Cơ chế cũ | Nhu cầu mới |
|---|---|---|
| Phạm vi | Cả đơn | Từng dòng |
| Ai quyết | Con người, mỗi đơn | Quy tắc mốc tiền, tự động |
| Kết quả | Đơn 800k → thu 0đ | Đơn 800k → thu 800k + quà 0đ |

**Hai nghiệp vụ khác nhau, dùng chung chữ "tặng".** Từ nay phân biệt rõ:

- **"100%"** (nút 🎁 rút gọn): chiết khấu 100% cả đơn. Giữ nguyên cơ chế cũ.
- **"Quà tặng"**: dòng 0đ kèm theo theo chương trình khuyến mại. Cơ chế mới.

### 1.1 Vết bẩn của cơ chế cũ (giữ nguyên, không sửa trong đợt này)

- `isGift` được suy ra lại bằng `note.includes('[QUÀ TẶNG:')` (`order.service.ts:1123`) — dữ liệu quan trọng nằm trong text tự do.
- Đơn 100% vẫn ghi ledger `DISPATCH_SALE` như bán thường → làm giảm số lượng "đã bán" dù chưa bán.

Cả hai là **nợ kỹ thuật của cơ chế cũ**, tách khỏi phạm vi đợt này.

---

## 2. Schema mới

### 2.1 Bảng `products` (mới) — gốc chung cho sách và hàng hóa

```sql
CREATE TABLE `products` (
  `id`            text PRIMARY KEY NOT NULL,   -- sách: 'ed-h01' (khớp editions.id) | hàng hóa: 'pr-...'
  `code`          text NOT NULL,                -- UNIQUE. Sách: H01 | Hàng hóa: SP-0001
  `name`          text NOT NULL,
  `product_kind`  text NOT NULL DEFAULT 'BOOK', -- BOOK | GOODS
  `selling_price` real NOT NULL DEFAULT 0,     -- Giá bán (giá bìa niêm yết)
  `cost_price`    real,                         -- Giá vốn (NULL = chưa nhập, KHÔNG lên UI lúc này)
  `barcode`       text,                         -- EAN-13. NULL = chưa gán
  `description`   text,
  `is_gift_item`  integer NOT NULL DEFAULT 0,   -- 1 = được phép làm quà khuyến mại
  `is_active`     integer NOT NULL DEFAULT 1,
  `created_at`    text DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX `products_code_unique` ON `products` (`code`);
CREATE UNIQUE INDEX `products_barcode_unique` ON `products` (`barcode`) WHERE `barcode` IS NOT NULL;
```

**Vì sao `products.id` của sách = `editions.id`:** không phải viết lại khóa ngoại ở `order_items` / `inventory_ledger` / `stock_balances`; migration chỉ cần `UPDATE ... SET product_id = id`. Dữ liệu lịch sử tự nhiên hợp lệ.

**Vì sao `code` phải khác namespace:** sách đã chiếm `H01`, `HH042`… Hàng hóa bắt buộc tiền tố `SP-`. Nếu không, một sản phẩm tên `H01` sẽ trùng UNIQUE và chết.

### 2.2 Bảng `promotions` + `promotion_gifts` — chương trình khuyến mại

⚠️ **Thiết kế bản đầu (dạng phẳng: mỗi dòng = 1 mốc) đã bị bác — xem mục 3.1.**

```sql
-- 1. Chiến dịch
CREATE TABLE `promotions` (
  `id`          text PRIMARY KEY NOT NULL,
  `name`        text NOT NULL,                -- "Tặng sản phẩm theo mốc đơn"
  `is_active`   integer NOT NULL DEFAULT 1,
  `starts_at`   text,                         -- NULL = không giới hạn
  `ends_at`     text,
  `created_at`  text DEFAULT CURRENT_TIMESTAMP
);

-- 2. Quà của từng mốc. Các dòng CÙNG min_subtotal = cùng một mốc (một bậc).
CREATE TABLE `promotion_gifts` (
  `id`            text PRIMARY KEY NOT NULL,
  `promotion_id`  text NOT NULL REFERENCES promotions(id),
  `min_subtotal`  real NOT NULL,              -- Mốc tiền, TÍNH TRÊN GIÁ GỐC
  `product_id`    text NOT NULL REFERENCES products(id),
  `gift_quantity` integer NOT NULL DEFAULT 1, -- SỐ CỐ ĐỊNH, không bao giờ theo tỉ lệ
  UNIQUE(promotion_id, min_subtotal, product_id)
);
```

Ví dụ đúng ý nhân viên văn phòng:

| `min_subtotal` | `product_id` | `gift_quantity` | Nghĩa là |
|---|---|---|---|
| 500.000 | SP-A | 1 | mốc 500k → A |
| 800.000 | SP-A | 1 | mốc 800k → A |
| 800.000 | SP-B | 1 | mốc 800k → B |
| 1.000.000 | SP-A | 1 | mốc 1tr → A |
| 1.000.000 | SP-B | 1 | mốc 1tr → B |
| 1.000.000 | SP-C | 1 | mốc 1tr → C |

**Đơn 1 triệu → A + B + C một lần. KHÔNG phải 2A + 2B + C.** Xem mục 3.1.

Dùng 2 bảng thay vì 3 (`promotion_tiers` + `promotion_tier_gifts`) vì chưa có nhu cầu đặt tên riêng cho từng bậc hay tắt một bậc độc lập. Khi nào cần thì tách — `min_subtotal` đã là khóa nhóm.

### 2.3 Thêm cột

⚠️ **Bản đầu chỉ liệt kê 4 bảng — THIẾU 8 bảng nữa.** Tất cả đều `NOT NULL REFERENCES editions(id)`:

| Bảng | Vị trí | Ưu tiên |
|---|---|---|
| `editions` | `schema.ts:25` | Cao |
| `order_items` | `schema.ts:246` | Cao |
| `inventory_ledger` | `0000:78` | Cao |
| `stock_balances` | `0000:115` | Cao |
| `bundle_items` | `schema.ts:124` | Thấp (P5) |
| `customer_owned_books` | `schema.ts:152` | Thấp |
| `consignment_statement_lines` | `schema.ts:324` | Thấp |
| `counter_allocations` | `schema.ts:395` | Thấp |
| `transfer_shipment_items` | `schema.ts:435` | Thấp |
| `rma_tickets` | `schema.ts:451` | Thấp |
| `return_order_items` | `schema.ts:499` | Thấp |
| `sponsorship_drawdowns` | `schema.ts:546` | Thấp |
| `exchange_replacement_items` | `schema.ts:622` | Thấp |
| `delivery_order_items` | `schema.ts:714` | Thấp |

Cột thêm vào mỗi bảng: `product_id` → `products(id)`, **nullable**.

**Chỉ 4 bảng đầu** cần backfill ở Cổng 1. 10 bảng còn lại để Cổng 2 — không chặn việc hiện sản phẩm trong POS.

### 2.4 Ghi nhận dòng quà trong đơn

`order_items` cần **3 cột mới**, không phải 1:

| Cột | Ý nghĩa |
|---|---|
| `promotion_id` | nullable, trỏ `promotions(id)`. NULL = quà tay hoặc dòng thường |
| `is_gift_line` | 1 = dòng quà (bất kể tự động hay tay). **Cột chặn vòng lặp** |
| `is_manual` | 1 = thu ngân bấm "Tặng thêm", cần duyệt |

Dòng quà có `unit_discount_rate = 1` → giá 0đ (cột đã có sẵn, `schema.ts:249`).

**Vì sao cần `is_gift_line` riêng:** quà tay có `promotion_id = NULL`, nếu chỉ dựa `promotion_id` để loại khỏi `eligibleBase` thì **quà tay sẽ lọt vào tổng và phá vỡ quy tắc 3.1**.

**Vì sao `promotion_id` là bắt buộc:** không dùng cách suy ra từ `unit_discount_rate = 1`, vì chiết khấu 100% thủ công cũng cho ra giá trị đó. Không phân biệt được thì báo cáo "quà tặng" sẽ tính nhầm đơn chiết khấu thành quà tặng.

---

## 3. Luật tính quà (nguồn sự thật: SERVER)

### 3.0 Mô hình BẬC THANG — chỉ mốc cao nhất được kích hoạt

⚠️ Thiết kế bản đầu kích hoạt **mọi** mốc ≤ tổng → đơn 1 triệu ra 2A + 2B + C. **Sai.** Đã sửa theo mô hình nhân viên văn phòng mô tả:

```
eligibleBase = 1.000.000
Mốc đạt: 500.000 ✓  |  800.000 ✓  |  1.000.000 ✓
→ CHỊ chạy mốc CAO NHẤT = 1.000.000
→ tặng A + B + C (mỗi món 1 cái)
```

Quy tắc cho **từng chiến dịch riêng** (nếu sau này chạy song song 2 chương trình, mỗi cái lấy bậc cao nhất của chính nó, rồi hợp nhất quà).

### 3.1 Quy tắc VÀNG — chặn vòng lặp

`pricing.ts:20` định nghĩa `subtotal = giáBìa × sốLượng` — **không trừ chiết khấu**. Nghĩa là dòng quà giá 90.000đ bán 0đ vẫn **cộng 90.000đ vào tổng**.

→ **Mốc khuyến mại chỉ tính trên tổng của các dòng KHÔNG phải quà.** Tuyệt đối không dùng `orders.subtotal` để so sánh.

Mô hình bậc thang (3.0) **không** triệt tiêu vòng lặp:

```
Mốc 500.000 → tặng tù lù (giá 300.000đ)
Mốc 800.000 → tặng áo mưa (150.000đ)

Giỏ khách: 500.000đ
→ đạt bậc 500.000, tặng tù lù
→ NẾU tính cả tù lù: 800.000 → đạt bậc 800.000 → tặng thêm áo mưa
→ tính cả áo mưa: 950.000 → lên bậc tiếp…
```

Thu ngân chỉ bán 500k mà hệ thống tự bung 2 món quà. Quy tắc 3.1 chặn đúng.

#### 3.1.1 Trường hợp hợp lệ: quà TRÙNG sản phẩm đang bán

"Mua 4 áo tặng 1 áo" — hợp lệ, và quy tắc 3.1 **không** cản:

```
áo 100.000đ, mốc 300.000đ, tặng 1 áo
4 áo (dòng thường)      → eligibleBase = 400.000 ≥ 300.000 ✓
+1 áo (dòng quà)        → KHÔNG tính vào eligibleBase
→ eligibleBase vẫn 400.000, không đổi → không sinh thêm quà
```

Quy tắc loại **dòng quà**, không loại **sản phẩm quà**. 4 áo thường vẫn tính đủ.

⚠️ Điều kiện bắt buộc: **`gift_quantity` luôn là số CỐ ĐỊNH** (tặng 1 cái), **không bao giờ tính theo tỉ lệ**. Nếu để "mua 4 tặng 1" sinh động thì quà sinh quà — đó mới là vòng lặp thật.

### 3.2 Thuật toán

```
1. eligibleBase = Σ (giáGốc × sốLượng) của các dòng KHÔNG có promotion_id
2. Với từng chiến dịch đang bật:
     best = MAX(min_subtotal) mà eligibleBase ≥ min_subtotal
     nếu best tồn tại → lấy TẤT CẢ promotion_gifts có min_subtotal = best
3. Bỏ các dòng quà đã bị thu ngân bấm "Bỏ quà" (mục 3.3)
4. Cộng các dòng quà thủ công đã được Quản lý duyệt (mục 3.3)
5. Tổng đơn = Σ (giáSauChiếtKhấu × sốLượng) của TẤT CẢ dòng, gồm cả dòng quà (giá 0)
```

**Mốc tính trên GIÁ GỐC** (trước chiết khấu) — chốt sau khi phát hiện tính sau chiết khấu làm khách **mất** quà:

| Đơn gốc 1.000.000, giảm 20% | Tổng so mốc | Bậc cao nhất | Tặng |
|---|---|---|---|
| **Giá gốc** | 1.000.000 | 1.000.000 | **A + B + C** |
| Giá sau chiết khấu | 800.000 | 800.000 | A + B |

Tính theo giá gốc **hào phóng hơn cho khách**. Ngoài ra nó giải quyết lỗi "bấm chiết khấu làm quà tự biến mất".

### 3.3 Tính lại mỗi khi giỏ đổi

| Sự kiện | Hành vi |
|---|---|
| Thêm sản phẩm → đạt bậc cao hơn | Quà **đổi** theo bậc mới, hiện rõ chênh lệch |
| Gỡ sản phẩm → rớt bậc | Quà về theo bậc thấp hơn |
| Áp chiết khấu đơn | **Không đổi** (mốc tính giá gốc) |
| **"Bỏ quà"** | Bỏ sản phẩm đó khỏi giỏ. **Không cần duyệt.** Ghi log |
| **"Tặng thêm"** | Thêm quà thủ công. **Luôn cần Quản lý duyệt** |

#### 3.3.1 Hai nút riêng, KHÔNG dùng nút `+` / `−`

Nếu dùng nút tăng/giảm số lượng thường trên dòng quà, thu ngân bấm nhầm thì hệ thống phải đoán ý — mà đoán sai với tiền là tai nạn.

- Bỏ quà → nút **"Bỏ quà"**
- Thêm quà tay → nút **"Tặng thêm"**

#### 3.3.2 "Bỏ quà" có dính (sticky)

Đơn ở bậc B → tặng A+B → thu ngân bấm "Bỏ quà" với B → B nằm trong danh sách đã-bỏ.

Khi đơn **lên bậc C** (tặng A+B+C):
- B **không tự quay lại**. Thu ngân muốn thì bấm "Bỏ quà" B một lần nữa — nhưng nó vốn đã vắng nên không cần.
- Muốn **khôi phục** B → phải bấm "Tặng thêm" → **cần duyệt**.

Khi đơn **rớt về bậc A** rồi **lên lại bậc B** → B vẫn vắng. Khách đã từ chối một lần.

### 3.4 NGUYÊN TẮC BẢO MẬT

> **Mọi thao tác làm TĂNG giá trị cho khách đều phải duyệt.
> Mọi thao tác làm GIẢM giá trị cho khách đều không cần duyệt.**

Lý do: thêm quà = công ty mất tiền. Bỏ quà = công ty **được thêm**. Bất đối xứng này là cố ý.

| Thao tác | Tăng hay giảm | Duyệt? |
|---|---|---|
| "Tặng thêm" | Tăng | **Có** |
| Khôi phục quà đã bỏ | Tăng | **Có** |
| "Bỏ quà" | Giảm | **Không** |

→ Server chỉ kiểm tra những dòng **được thêm**. Dòng **vắng mặt** không cần kiểm — thiếu quà không phải gian lận.

### 3.4.1 Server không tin client — TÁCH HAI NGUỒN QUÀ

⚠️ Bản đầu của mục này viết: *"kiểm tra dòng quà có thật trong `promotion_gifts` không"*. **Câu đó giết chết tính năng "Tặng thêm"** — vì món người chọn tay thường không nằm sẵn trong bảng. Phải tách:

| Nguồn | Client gửi gì | Server kiểm gì |
|---|---|---|
| **Quà tự động** | **Không gửi gì** | Tự suy ra từ `eligibleBase`. Client không có quyền thêm |
| **Quà thủ công** | `promotion_id = NULL`, `is_manual = 1` | Chỉ kiểm **sản phẩm có tồn kho không** |

Server tự:
1. Tra `products.selling_price` từ DB (giống `order.service.ts:534`).
2. Tính `eligibleBase` và bậc cao nhất → tự thêm dòng quà tự động.
3. Cưỡng ép `unit_discount_rate = 1` cho **mọi** dòng quà, **không nhận giá client gửi**.
4. Dòng quà tay: chỉ cần `product_id` có tồn. Cần `discountApprovalId` hợp lệ.
5. Áp danh sách "đã bỏ quà" (mục 3.3.2) **sau** bước 2.

**Chốt quy tắc chặn vòng lặp:** dòng quà KHÔNG có `promotion_id` khi là quà tay — nhưng vẫn bị loại khỏi `eligibleBase` nhờ cột `is_gift_line` mới (xem mục 2.3). Nếu chỉ dựa `promotion_id`, quà tay sẽ lọt vào tổng và phá vòng lặp.

#### 3.4.1.1 Sửa mâu thuẫn ở mục 3.4.2 #6

Bản đầu ghi `is_gift_item = 0` → không hiện trong danh sách chọn quà. Điều này **mâu thuẫn** với chốt #21 (tặng được bất kỳ sản phẩm nào).

→ Sửa: `is_gift_item` **chỉ quyết định thứ tự hiển thị và gợi ý** trong bộ chọn quà của chương trình. Thu ngân bấm "Tặng thêm" thì tìm được **mọi** sản phẩm có tồn.

#### 3.4.2 Những lỗ hổng đã biết và cách chặn

| # | Lỗ hổng | Chặn bằng |
|---|---|---|
| 1 | Thu ngân tặng thêm chồng lên quà tự động để lấy nhiều hơn | Chỉ phần **vượt** phần tự động mới cần duyệt. Màn hình duyệt hiện rõ: *"Tặng thêm 3 × SP-0001 = 450.000đ"* |
| 2 | Mua hàng rẻ để lấy món quà đắt (mốc 500k, quà trị 500k) | Không chặn được bằng code. **Cảnh báo** khi `giá quà ≥ 50% mốc`. Sếp tự ra giá |
| 3 | Quản lý duyệt tay hàng loạt mà không biết mất bao nhiêu | Màn hình duyệt phải hiện **tổng giá trị quà** của đơn đó |
| 4 | Đơn offline tự thêm quà, về sync thì lệch | Server tính lại là chốt. Lệch → đánh dấu **cần người xem lại**, không tự ghi đè |
| 5 | Chiết khấu + quà cộng dồn gây nhầm lẫn | Màn hình POS hiện cả hai: giảm bao nhiêu, tặng giá trị bao nhiêu |
| 6 | ~~Sản phẩm không được làm quà~~ | ~~`is_gift_item = 0` → chặn~~ → **ĐÃ SỬA**: chỉ gợi ý, không chặn (xem 3.4.1.1) |

#### 3.4.3 Hết kho

- Quà tự động hết kho, hoặc thu ngân bấm "Tặng thêm" mà hết kho → **đều cho qua**.
- Cảnh báo trên POS, ghi tồn âm, màn hình Kho hiện tồn âm đỏ cho Quản lý.
- **Lý do không chặn:** chặn = mất đơn. Mất đơn 800k tệ hơn 1 món quà ghi âm.

⚠️ Nhưng bản đầu của thiết kế **nói sai**: viết *"nới trigger cho `DISPATCH_GIFT`"* là **không làm được**. Xem mục 6 #1 và #2.

## 5. Migration (`0031_products_promotions.sql`)

⚠️ **Không chạy bằng `migrate-fresh.ts`.** Đã kiểm chứng:
- `migrate-fresh.ts:77-97` **không transaction, không rollback**.
- Prod **không có** bảng `__drizzle_migrations` → chạy lại **không resume được**, chết ở câu không idempotent đầu tiên.
- Đường áp prod thật của dự án là **script riêng từng migration**: `apply-0027-prod.ts` … `apply-0030-prod.ts`, chặn bởi `ALLOW_PROD_WRITE=true` (`prod-write-guard.ts:23-31`).

→ Làm theo khuôn `scripts/apply-0030-prod.ts` (53 dòng): đọc `.env`, tạo client Turso, `PRAGMA table_info` kiểm tra trước, rồi mới `db.execute()` từng câu **một lần**.

### 5.1 Cổng 1 — chỉ ADD, không UPDATE

```sql
CREATE TABLE IF NOT EXISTS products (...);         -- mới
CREATE TABLE IF NOT EXISTS promotions (...);       -- mới
CREATE TABLE IF NOT EXISTS promotion_gifts (...);  -- mới
ALTER TABLE editions         ADD COLUMN product_id text;
ALTER TABLE order_items      ADD COLUMN product_id text;
ALTER TABLE inventory_ledger ADD COLUMN product_id text;
ALTER TABLE stock_balances   ADD COLUMN product_id text;
ALTER TABLE order_items      ADD COLUMN promotion_id text;
ALTER TABLE order_items      ADD COLUMN is_gift_line integer NOT NULL DEFAULT 0;
ALTER TABLE order_items      ADD COLUMN is_manual integer NOT NULL DEFAULT 0;
```

**`ALTER TABLE ADD COLUMN` là thao tác tức thời** — SQLite không đọc lại bảng, không giữ khoá lâu. Đã chứng minh trên prod: `apply-0030-prod.ts:31` làm đúng một câu `ALTER TABLE ... ADD COLUMN`.

**Cổng 1 KHÔNG chạy `UPDATE` backfill.** Xem mục 5.2.

### 5.2 ⚠️ Tách backfill — đây là điều tôi đã nói sai

Bản đầu nói Cổng 1 gồm cả `UPDATE order_items SET product_id = edition_id`. **Sai.**

`UPDATE` ghi **từng dòng một**. Nếu đang có hàng trăm đơn từ hội chợ, câu đó giữ khoá ghi DB **vài giây** → POS treo vài giây giữa lúc bán hàng thật.

| Cổng | Nội dung | Khi nào |
|---|---|---|
| **Cổng 1** | 3 bảng + 9 cột. **Không `UPDATE`.** | Bất kỳ lúc nào |
| **Cổng 1b** | Backfill 4 bảng + tạo index | **Chỉ lúc kho đóng (tối)** |

⚠️ **Không có script backup DB remote nào trong repo.** `scripts/backup-db.ts:9-10` chỉ copy file local và tự nói D1 có cơ chế riêng — nhưng prod là **Turso**, nên **không có đường restore nào**. Phải backup thủ công trước Cổng 1b.

### 5.3 Thứ tự index

Đặt `CREATE UNIQUE INDEX` **sau** backfill. Nếu backfill sinh trùng `code`, câu UNIQUE fail và **mọi câu sau nó không chạy** (không transaction).

---

## 6. LỖI CHẶN — đọc trước khi code

Mục này là kết quả **rà soát độc lập có dẫn chứng `file:dòng`**. 7 lỗi dưới đây **làm tính năng không chạy được** nếu không sửa. Bản đầu của thiết kế chỉ biết 1 cái và ghi sai cách xử lý.

### 🔴 B1 — MỌI đơn có quà sẽ bị chặn 403

`route.ts:334-346` đọc `unitDiscountRate` của **MỌI** dòng để so trần 20% (`route.ts:20`):

```ts
const maxDiscountRate = giftFlag ? 1 : Math.max(parsedOrderDiscount, ...effectiveItemDiscounts);
const exceedsHardCap = maxDiscountRate >= MAX_CASHIER_DISCOUNT_RATE;  // 0.2
```

Dòng quà có `unit_discount_rate = 1` → `maxDiscountRate = 1` ≥ 0.2 → thu ngân bị chặn ở `route.ts:408`. `giftFlag` chỉ true khi chiết khấu 100% **cấp đơn**; đơn khuyến mại có `discountRate = 0` nên `giftFlag = false`.

**Đây không phải lỗi hiếm — lỗi 100% sản phẩm.**

**Cách sửa:** loại dòng `is_gift_line = 1` ra khỏi `effectiveItemDiscounts` trước khi so trần. Dòng quà là quyền lợi đã cấu hình, không phải thu ngân tự ý chiết khấu.

Kiểm tra kép: `order.service.ts:839-844` cũng chặn khi có `discountApprovalId` mà bất kỳ dòng nào lệch `discountRate` — cũng phải miễn dòng quà.

### 🔴 B2 — "Cho qua khi hết quà" bị chặn ở **3 tầng**, không phải 1

Tầng 1 — `order.service.ts:780-789`:
```ts
const atp = atpMap.get(editionId) ?? 0;
if (atp < qty) throw AppError.atp(`HẾT HÀNG KHẢ DỤNG (ATP)...`);
```
Tầng 2 — `inventory.service.ts:204-212`: `UPDATE ... AND (physical_quantity + delta >= 0)`, `rowsAffected === 0` → lỗi ATP.
Tầng 3 — `PosCheckoutTerminal.tsx:1722-1734`: client chặn trước khi gọi API.

Bản đầu chỉ ghi "nới trigger". **Không đủ — phải nới cả 3 tầng.**

### 🔴 B3 — Trigger KHÔNG thể "nới cho `DISPATCH_GIFT`" — bản đầu viết sai

`0027_stock_non_negative_check.sql:30-35`:
```sql
CREATE TRIGGER check_stock_non_negative
BEFORE UPDATE ON stock_balances
FOR EACH ROW WHEN NEW.physical_quantity < 0
BEGIN SELECT RAISE(ABORT, '...'); END;
```

Trigger nằm trên `stock_balances`, **không có cột `event_type`** (`inventory_ledger` mới chứa). **Không tồn tại câu SQL nào cho phép âm "chỉ khi là quà"** mà không `DROP` trigger. Đường duy nhất ghi âm mà không đụng trigger là **không ghi `stock_balances`** ⇒ tồn sai lệch âm thầm, tệ hơn chặn.

0027/0029 **đã áp production** (chính comment trong file nói vậy) ⇒ phải thêm migration mới, không sửa file cũ.

**Quyết định cần chốt:** với mỗi lựa chọn, tác động khác nhau —
(a) Cho tồn âm thật → phải drop + tạo lại trigger.
(b) Không trừ kho khi hết quà → tồn lệch, nhưng **không đụng trigger**.
(c) Chặn đơn khi hết quà → đơt lập ngược chốt #8.

Tôi nghiêng **(b)**: ghi ledger xuất nhưng **không ghi `stock_balances`**, hiển thị cảnh báo. Tồn âm thật là thứ khó gỡ nhất sau này.

### 🔴 B4 — `subtotal` và `discountAmount` bị nhiễm giá quà

`pricing.ts:16-22`:
```ts
const subtotal = safeCoverPrice * safeQuantity;   // KHÔNG trừ chiết khấu
const discountAmount = subtotal - finalAmount;   // = giá bìa của dòng quà
```

Đơn 800k + tặng sản phẩm giá 300k → `daily-settlement.service.ts:101-102` ghi `grossSales` **1.100.000** và `totalDiscount` **300.000**, dù không có 1đ chiết khấu nào.

Quy tắc 3.1 của tôi chỉ nói *"đừng dùng `orders.subtotal` để so mốc"* — nhưng nó **không** nói `subtotal` ghi vào DB bị nhiễm. **Đây là lỗi tôi tự gây ra** bằng thiết kế "quà vẫn có giá bìa thật".

**Cách sửa (đề xuất):** dòng `is_gift_line` **không tính vào `subtotal`/`discountAmount`** của đơn, chỉ tính `finalAmount` (= 0). `subtotal` khi đó phản ánh đúng tiền khách trả trước chiết khấu.

### 🔴 B5 — Đơn vừa có quà vừa cần duyệt chiết khấu thì chết 409

`order.service.ts:850-867` truyền **toàn bộ** `preparedItems` (kể cả dòng quà) + `originalAmount: calculatedSubtotal`. `discount-approval.service.ts:815-833` so `originalAmount`, chênh lệch = giá quà ⇒ `conflict`.

**Cách sửa:** loại dòng quà khỏi mọi tham số approval (`originalAmount`, `cartHash`).

### 🔴 B6 — `cartHash` băm `unitDiscountRate` từng dòng ⇒ quà làm hỏng duyệt

`discount-approval.service.ts:111-116`:
```ts
return `${i.editionId}:${i.quantity}:${Math.round(i.unitPrice)}:${Math.round(lineRate * 10000)}`;
```

Dòng quà `rate = 1` ⇒ hash khác lúc xin duyệt ⇒ `discount-approval.service.ts:761-763` ném `FORBIDDEN` **cứng**. Nhánh này là **cố ý** (comment: *"không cho rẽ PIN vì PIN rửa được giỏ tráo"*).

→ Dòng quà phải bị loại khỏi cả hash. Nhưng cẩn thận: dòng quà **tay** vẫn phải vào hash, vì nó chính là thứ cần duyệt.

### 🔴 B7 — Hàng hóa **biến mất khỏi POS**

`pos-catalog.service.ts:71-72` dùng `innerJoin(works, ...)`. Hàng hóa không có `editions`/`works` ⇒ **không hiện trong lưới quét mã**.

Còn 8 chỗ `innerJoin editions` tương tự — **bản đầu chỉ liệt kê 4 và không có `pos-catalog.service`** (nguồn thật của lưới POS):

| File | Dòng | Hậu quả |
|---|---|---|
| `pos-catalog.service.ts` | 71 | **POS không hiện hàng hóa** |
| `api/pos/live-monitor/route.ts` | 289 | Màn hình giám sát trực tiếp |
| `inventory.service.ts` | 974 | Lịch sử bút toán kho — **không thấy quà đã xuất** |
| `analytics.service.ts` | 89 | Tổng tồn theo kho |
| `rma.service.ts` | 301 | RMA |
| `allocation.service.ts` | 141 | Phân bổ quầy |
| `reader-profile.service.ts` | 68, 140 | Hồ sơ người đọc |
| `bundle.service.ts` | 63 | Combo |

⚠️ Loại lỗi **không báo lỗi, chỉ thiếu dòng** — nguy hiểm nhất.

### 🟠 B8 — Offline POS đơn offline sẽ tính sai tiền

`offline-db.ts:7-13` — `OfflineOrderItem` **không có** `unitDiscountRate`, `promotionId`, `isManual`.
`PosCheckoutTerminal.tsx:772-777` gửi `unitDiscountRate` = chiết khấu cả đơn.

`order.service.ts:535` là `item.unitDiscountRate ?? discountRate` ⇒ dòng quà nhận chiết khấu cả đơn thay vì 1. Đơn offline 800k + quà 300k → `finalAmount` **1.040.000** — **thu 240k tiền quà từ khách**.

Đúng kịch bản hội chợ. P0 của Cổng 3.

### 🟠 B9 — Duyệt quà tay không chạy được với hàng hóa

`discount-approval.service.ts:201-211`:
```ts
const missing = editionIds.filter((id) => !editionPriceMap.has(id));
if (missing.length > 0) throw AppError.invalid(`Ấn bản không tồn tại...`);
```

Mọi luồng duyệt đều tra `editions.coverPrice`. Hàng hóa không có dòng `editions` ⇒ **không tạo được yêu cầu duyệt nào chứa hàng hóa**.

### 🟠 B10 — Hàng hóa bắt buộc phải có bản ghi `works` + `editions` giả

`schema.ts:25-28` — `workId`, `isbn`, `isbnLast4` đều **NOT NULL**. `order_items.edition_id` NOT NULL (`schema.ts:246`), `order.service.ts:533` chặn nếu không có `edition`.

Muốn bán 1 sản phẩm hàng hóa, bắt buộc tạo **bản ghi sách giả**. Bản ghi giả đó lọt vào `forecast.service.ts:179` (DoI), `analytics.service.ts:165` (trending), `executive-query.service.ts:485` (top tác giả), `pos-catalog.service.ts:71`.

→ **Đây chính là lý do phải tách `products` thật**, và cũng là lý do B1–B10 không có cách vá nấp.

### 🟠 B11 — Forecast/DoI tính quà là hàng bán

`forecast.service.ts:86-104` lọc `orders.discountRate < 1` (cấp **đơn**) rồi cộng `SUM(-quantityDelta)` cho mọi `DISPATCH_SALE`. Đơn quà có `discountRate = 0` nên qua bộ lọc ⇒ DoI thấp ⇒ đề xuất in nhiều hơn thực tế. Cùng lỗi ở `executive-query.service.ts:499-516`.

### 🔵 B12 — Hai nguồn sự thật cho mã SKU

Migration backfill `products.code` từ `editions.code`. `scripts/migrate-book-skus.ts:183-187` từng đổi `editions.code` (H01→HH001). Hai bảng có UNIQUE riêng, **không trigger đồng bộ** ⇒ chạy lại script đổi SKU là `products.code` cũ.

→ `products.code` cho sách nên để NULL, **tra cứu qua `editions.code`** khi cần hiển thị.

### 🔵 B13 — Mã vạch hàng hóa quét không lên, và trùng ISBN-13 treo quầy

`PosCheckoutTerminal.tsx:1217-1246` khớp **chỉ** trên `b.isbn`, `b.isbnLast4`, `b.code`. `products.barcode` **không chỗ nào đọc tới**. Khớp >1 dòng → `setAmbiguousMatches` (`:1243`).

EAN-13 hàng hóa trùng ISBN-13 sách là chuyện phổ biến với bút/túi bán kèm sách.

→ Phải thêm `barcode` vào điều kiện khớp, và quy định namespace mã vạch.

### 🔵 B14 — 2 nơi tính tiền phải giống hệt

Client `PosCheckoutTerminal.tsx:1606-1613` và server `order.service.ts:526-572`. **Lệch là lỗi nghiêm trọng nhất.** Kiểm bằng test: giá client = giá server, sai là đỏ.

### 🔵 B15 — ⚠️ Trần 50 subrequest — rủi ro làm sập POS

`order.service.ts:776-778` (đã kiểm chứng):
> *Workers free plan chỉ có 50 subrequest/lần gọi… Đơn ≥ 7 dòng là 500 "Too many subrequests" ⇒ KHÔNG chốt được đơn.*

`inventory.service.ts:272-276` — đơn 5 dòng hỏng trên prod, 20 dòng vẫn chạy local. **Test local không bắt được lỗi này.**

→ **Bắt buộc: mọi logic khuyến mại gom về 1–2 query cho CẢ đơn. Tuyệt đối không query trong vòng lặp dòng hàng.** Đây là rủi ro lớn nhất của Cổng 3.

---

## 7. Chia thành 3 CỔNG — mỗi cổng tự rollback được

⚠️ Bản đầu ghi *"Làm P0–P3 trước"* — **không có ranh giới rollback nào giữa các bước.** Nếu sập giữa chừng thì rollback code nhưng schema đã đổi.

Quy trình chuẩn của dự án (`2026-09-25-handoff-state.md:226-227`): **migration TRƯỚC, deploy SAU.** Đảo thứ tự là app 500 giữa hội chợ — `apply-0028-prod.ts:8-10` đã ghi cảnh báo này sau sự cố thật.

### Cổng 1 — SCHEMA (chưa ai đọc)

| Việc |
|---|
| `apply-0031-prod.ts` — 3 bảng + 9 cột. **Không `UPDATE`** |
| Cổng 1b (kho đóng): backfill 4 bảng + index |

**Sau Cổng 1:** sách đọc `editions` y như cũ → **POS không nhận ra gì thay đổi**.
**Nếu cần:** `DROP` 3 bảng + 9 cột. Vô hại.
**Rủi ro:** thấp.

### Cổng 2 — ĐỌC `products` (thay thế, không thêm)

| Việc |
|---|
| 9 chỗ `innerJoin editions` → `innerJoin products` (B7) |
| Khớp mã vạch đọc `products.barcode` (B13) |
| API tạo/sửa sản phẩm + UI nhập hàng hóa |
| 10 bảng còn lại thêm `product_id` (mục 2.3) |

**Sau Cổng 2:** **thêm và bán được sản phẩm hàng hóa, quét mã lên POS.**
Quan trọng: mọi truy vấn cho sách phải trả về **y hệt** trước đây.
**Nếu cần:** `wrangler rollback`. Cổng 1 chỉ thêm bảng chết.
**Rủi ro:** thấp–trung bình. Không đụng đường tiền.

### Cổng 3 — LOGIC KHUYẾN MẠI (đường tiền)

| Việc |
|---|
| Fix B1, B2, B3, B4, B5, B6, B8, B11, B15 |
| Engine tính quà client + server |
| UI cài đặt (nút "Khuyến mãi" trong POS) |
| `promotions` + `promotion_gifts` |
| Báo cáo quà tặng |

**Rủi ro:** **cao.** Đụng đường thanh toán production.

---

## 8. Quy trình lên production

| Bước | Lệnh / việc |
|---|---|
| 1 | `npx tsc --noEmit` |
| 2 | `npm run build` (dừng dev server trước — `AGENTS.md` mục 3) |
| 3 | `npx tsx scripts/run-isolated.ts` (DB file cách ly, không chạm Turso) |
| 4 | **Áp migration `ALLOW_PROD_WRITE=true npx tsx scripts/apply-0031-prod.ts` — TRƯỚC bước 5** |
| 5 | `git status --porcelain` — phải SẠCH trước khi deploy (`AGENTS.md` mục 3) |
| 6 | `npm run deploy` |
| 7 | `npx tsx scripts/verify-pos-live.ts` — nghiệm thu tầng 3 |
| 8 | Rollback: `npx wrangler versions list` → `npx wrangler rollback <id>` |

⚠️ Không có `--dry-run`. Không có rollback schema tự động. **Rollback được code, không được DB.**

⚠️ 5 script ghi thẳng production **không có guard**: `fix-prod-isbn-dashes.ts:29`, `normalize-prod-catalog.ts:36`, `purge-orphan-orders.ts:51`, `unblock-stuck-pending-orders.ts:39`, `repro-confirm-transfer.ts:22`. Cần cẩn thận khi chạy `npx tsx scripts/...`.

---

## 9. UI (nguyên tắc: text ngắn, tiếng Việt có dấu)

- Nút trong tab POS: **"Khuyến mãi"** — chỉ Quản lý / Chủ sở hữu thấy.
- Màn hình cài đặt: danh sách mốc. Mỗi dòng: `Từ 500.000đ` → chọn sản phẩm + số lượng.
- Bật/tắt: nút công tắc, nhãn aria rõ thao tác.
- Dòng quà trong giỏ: badge **"Quà"**, giá hiện **0đ**, nút **"Bỏ quà"** và **"Tặng thêm"**.
- Mốc tính trên giá gốc → hiển thị chữ **"Tính trên giá gốc"** trong cài đặt.
- Nút 🎁 cũ: rút gọn thành **"100%"** (đã chốt, việc UI — Cổng 3).

---

## 10. Cần bạn duyệt

1. **Quyết định B3** — xử lý tồn âm thế nào? Tôi nghiêng (b) không ghi `stock_balances`.
2. **Xác nhận phạm vi:** làm tới **Cổng 1** hay **Cổng 1 + 2**? Tôi khuyên Cổng 1 + 2.
3. Có thiếu trường nào của sản phẩm không? (đang có: mã, tên, loại, giá bán, giá vốn, mã vạch, mô tả, cờ gợi ý quà)