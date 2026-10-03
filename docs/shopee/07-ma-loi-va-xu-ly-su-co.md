# TÀI LIỆU 07: BẢNG MÃ LỖI & XỬ LÝ SỰ CỐ (ERROR CODES & RATE LIMITS)

---

## 1. GIỚI HẠN TẦN SUẤT GỌI API (RATE LIMITS)

Shopee áp dụng cơ chế điều tiết lưu lượng (Throttling) để bảo vệ hệ thống:
* **Giới hạn toàn cầu của App (Global App Limit):** Tối đa 100 yêu cầu/giây (100 QPS).
* **Giới hạn trên từng Shop (Per-shop Limit):** Tối đa 50 yêu cầu/giây (50 QPS).
* **Nếu vượt ngưỡng:** Shopee sẽ trả về mã lỗi HTTP `429 Too Many Requests` hoặc mã lỗi `error_too_many_requests`.

### Cơ chế xử lý trong code của FORMApubli (Exponential Backoff)
Khi gặp lỗi 429 hoặc lỗi nghẽn mạng:
```typescript
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 1000): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, options, retries - 1, delayMs * 2);
    }
    throw err;
  }
}
```

---

## 2. BẢNG MÃ LỖI THƯỜNG GẶP VÀ CÁCH KHẮC PHỤC

| Mã lỗi (`error`) | Nguyên nhân gốc rễ | Cách khắc phục tự động / Thủ công |
|---|---|---|
| `error_sign` | Sai chữ ký HMAC-SHA256 hoặc sai `partner_key`. | Kiểm tra lại thứ tự ghép chuỗi `base_string` và đồng hồ máy chủ (timestamp không được lệch quá 5 phút). |
| `error_auth` / `error_access_token` | `access_token` đã hết hạn (quá 4 giờ) hoặc bị thu hồi. | Gọi ngay API `v2/auth/access_token/get` bằng `refresh_token` để lấy token mới và thử lại request. |
| `error_refresh_token` | `refresh_token` đã hết hạn (quá 30 ngày) hoặc Shop đổi mật khẩu tài khoản. | Buộc phải gửi cảnh báo lên giao diện: Yêu cầu Chủ Shop bấm "Ủy quyền lại" trên Console. |
| `error_item_not_found` | Mã `item_id` hoặc SKU không tồn tại trên gian hàng Shopee. | Kiểm tra lại xem sản phẩm đã được đăng lên Shopee chưa, hoặc kiểm tra mã vạch ISBN có gõ nhầm số không. |
| `error_stock_out_of_range` | Số lượng tồn kho cập nhật âm hoặc vượt quá 999.999 cuốn. | Chặn logic ở frontend/service: Số tồn phải nằm trong khoảng từ `0` đến `99.999`. |
| `error_logistics` | Kênh vận chuyển của đơn hàng chưa được kích hoạt hoặc đơn vị vận chuyển từ chối. | Đăng nhập Kênh Người Bán Shopee kiểm tra xem kho đã cấu hình địa chỉ lấy hàng và kích hoạt đơn vị vận chuyển SPX/GHTK chưa. |
