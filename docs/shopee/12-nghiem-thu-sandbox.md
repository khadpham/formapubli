# NGHIỆM THU SANDBOX SHOPEE — CHECKLIST A-Z

> Trạng thái: script + checklist SẴN SÀNG (06/10). Chờ `partner_id/key` từ nhân viên Shopee.
> Khi có key: làm theo mục 1→5 dưới đây, không cần đọc lại docs khác.

## 1. Xin từ Shopee (chờ bên ngoài)

1. Tài khoản **Open Platform dev** + app Sandbox (In-house App).
2. `partner_id`, `partner_key` (Sandbox).
3. `shop_id` + shop Sandbox + tài khoản Seller Center Sandbox để đặt đơn test.
4. Trên console: cấu hình **Webhook** code 1 (đơn mới) + code 2 (hủy) + code 3 (vận chuyển) trỏ về
   `https://<domain-dev>/api/shopee/push`, thời gian sống 365 ngày, bấm **Verify URL**.

## 2. Biến môi trường (đặt trong `.env` máy dev)

```env
SHOPEE_PARTNER_ID=<số>
SHOPEE_PARTNER_KEY=<chuỗi — TUYỆT ĐỐI không commit>
SHOPEE_SHOP_ID=<số>
SHOPEE_BASE_URL=https://partner.test-stable.shopeemobile.com
SHOPEE_UI_ENABLED=1
# Kho xuất có thể đặt env hoặc cấu hình trong app (app thắng env):
# SHOPEE_WAREHOUSE_ID=wh-au-co
```

## 3. Trình tự nghiệm thu (4 lệnh)

| Bước | Lệnh | Kỳ vọng |
|---|---|---|
| Cấu hình + token | `npx tsx scripts/verify-shopee-sandbox.ts env` | Base URL test-stable, kho xuất đã chọn, token có trong DB. Chưa có token ⇒ mở link ủy quyền bằng tài khoản Chủ trong app |
| Kéo đơn + trừ kho | `... sync` | Đặt 1 đơn test trên Seller Center sandbox trước (bán 2-3 cuốn, SKU trùng `editions.isbn`). pulled ≥ 1, mỗi dòng có bút toán `DISPATCH_SALE` ref `SHOPEE_<sn>`, tồn còn ≥ 0 |
| Giao + in A6 | `... ship --orderSn=<sn>` | tracking trả về, PDF > 1 KB, `shippingStatus → PICKED_UP` |
| Đối soát escrow | `... escrow --orderSn=<sn>` | **Chỉ chạy khi đơn DELIVERED trên sàn.** escrow = khách trả − phí − trợ giá ±1đ; COGS/lãi ròng in rõ |

Kèm: thử 1 đơn với **SKU lạ** ở bước sync ⇒ phải vào cách ly (quarantine), tồn không đổi.
Sau khi nghiệm thu xong: đối chiếu webhook (đơn mới tự vào không cần bấm sync).

## 4. Bản ghi 55 listing

Lấy `item_id`/`model_id` của từng listing trên Seller Center → nhập bảng `shopee_item_map`
(script/test hiện có đã đọc bảng này; cấm bịa id).

## 5. Khi tất cả xanh

Ghi kết quả vào `docs/shopee/10-ke-hoach-trien-khai-shopee.md` (mục trạng thái):
"Đã đóng cửa ải sandbox ngày __/__, đơn test #___ khớp từng đồng." — khi đó docs README
chuyển trạng thái 🟢 chính thức (luật đóng docs theo README).
