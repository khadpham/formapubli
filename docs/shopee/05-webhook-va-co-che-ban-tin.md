# TÀI LIỆU 05: WEBHOOK & CƠ CHẾ BẮN TIN SỰ KIỆN (PUSH MECHANISM)

---

## 1. TẠI SAO PHẢI DÙNG WEBHOOK THAY VÌ POLLING?

* **Cách cũ (Polling):** Cứ 5 phút phần mềm FORMApubli lại gọi Shopee 1 lần: *"Có đơn mới không?"*. Cách này vừa tốn băng thông, dễ chạm ngưỡng giới hạn (Rate Limit), vừa làm đơn hàng bị trễ tới 5 phút.
* **Cách chuẩn (Webhook / Push Mechanism):** FORMApubli mở 1 đường dẫn nhận tin (Endpoint) trên Cloudflare Worker. Ngay khi khách đặt đơn, Shopee chủ động "bắn" gói tin dữ liệu sang máy chủ FORMApubli trong **vòng 1 giây**.

---

## 2. CẤU HÌNH WEBHOOK TRÊN SHOPEE CONSOLE

1. Đăng nhập [Shopee Open Platform Console](https://open.shopee.com).
2. Vào **App Management** $\rightarrow$ chọn App của FORMApubli $\rightarrow$ **Push Mechanism**.
3. Điền **Callback URL**: `https://formapubli.vn/api/shopee/push`.
4. Bấm **"Verify URL"**: Shopee sẽ gửi một gói tin kiểm tra. Nếu server trả về HTTP `200` kèm JSON rỗng `{}`, liên kết sẽ được kích hoạt thành công.

---

## 3. CƠ CHẾ XÁC MINH CHỮ KÝ WEBHOOK (CHỐNG TIN GIẢ MẠO)

Khi Shopee bắn dữ liệu sang, Shopee đính kèm chữ ký trên Header `Authorization`. Máy chủ FORMApubli bắt buộc phải xác minh chữ ký này trước khi xử lý dữ liệu:

```typescript
import crypto from 'node:crypto';

export function verifyShopeeWebhook(
  rawBody: string,
  shopeeSignHeader: string,
  webhookUrl: string,
  partnerKey: string
): boolean {
  // Chuỗi cơ sở tính chữ ký webhook: URL đầy đủ + "|" + nội dung Body
  const baseString = `${webhookUrl}|${rawBody}`;
  const expectedSign = crypto
    .createHmac('sha256', partnerKey)
    .update(baseString)
    .digest('hex');

  return expectedSign === shopeeSignHeader;
}
```

---

## 4. CÁC MÃ SỰ KIỆN CẦN LẮNG NGHE

Shopee phân loại sự kiện qua trường `code` trong gói tin JSON:

```json
{
  "code": 1,
  "shop_id": 12345678,
  "timestamp": 1728000000,
  "data": {
    "order_sn": "241004ABCD1234",
    "status": "READY_TO_SHIP",
    "update_time": 1728000000
  }
}
```

| Mã sự kiện (`code`) | Tên sự kiện | Hành động của FORMApubli |
|---|---|---|
| **1** | `ORDER_STATUS_UPDATE` | Khi trạng thái đổi sang `READY_TO_SHIP`: Kéo chi tiết đơn về & trừ tồn kho.<br>Khi đổi sang `CANCELLED`: Hoàn trả số lượng sách về Kho Chính. |
| **2** | `TRACKING_NO_UPDATE` | Cập nhật mã vận đơn và đường link tra cứu SPX/GHTK vào đơn hàng nội bộ. |
| **3** | `SHOP_AUTHORIZATION_EXPIRE` | Cảnh báo: Gian hàng sắp hết hạn ủy quyền 365 ngày $\rightarrow$ Báo cho Chủ vào bấm gia hạn. |
| **4** | `ITEM_PROMOTION_UPDATE` | Sách đang tham gia Flash Sale của Shopee $\rightarrow$ Đồng bộ mức giá chiết khấu. |
