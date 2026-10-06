# BẢN THIẾT KẾ KIẾN TRÚC TÍCH HỢP TINH TÚY: 5 MẢNH GHÉP TỪ SHOPEE-SDK VÀO FORMAPUBLI
**Trạng thái tài liệu:** 🟡 **BẢN THẢO THIẾT KẾ (DRAFT / CHỜ KIỂM CHỨNG BẰNG SANDBOX SPIKE) — CHƯA ĐÓNG**
*(Chỉ chính thức đóng khi có một đơn hàng sandbox chạy thông luồng từ đầu đến cuối và số liệu khớp 100%).*

> ⚠️ **3 MỤC CHƯA KIỂM CHỨNG (CẦN XÁC MINH TRÊN SANDBOX THỰC TẾ):**
> 1. **File 08 (Đăng sản phẩm):** Các mã `category_id`, `attribute_id`, `logistic_id` hiện là số mẫu. Bắt buộc đối chiếu console Seller Center thật để lấy ID của ngành Sách.
> 2. **File 05 (Webhook code 3):** Mã sự kiện "hết hạn ủy quyền 365 ngày" cần đối chiếu bảng push notifications trên console Shopee.
> 3. **File 06 (Đối soát Escrow):** Tên các trường chi phí trong `v2.payment.get_escrow_detail` được đối chiếu theo schema SDK, cần gọi API thật trên Sandbox để đối soát cấu trúc JSON thực tế.

> **Tư tưởng cốt lõi (Ponytail Senior Dev Mode):** 
> Không cài nguyên cả thư viện đồ sộ (`@congminh1254/shopee-sdk` chứa hơn 30 manager rác như LiveStream, Video, Ads). 
> Chúng ta **chắt lọc đúng 5 mảnh ghép tinh túy nhất** của họ và cắm thẳng vào các mạch máu có sẵn trong FORMApubli:
> 1. Interface `TokenStorage` $\rightarrow$ Lưu CSDL Turso/LibSQL (không lưu file/RAM).
> 2. Quản lý Đơn hàng $\rightarrow$ Kéo đơn phân trang cursor + Map vào `orders.channel = 'SHOPEE'`.
> 3. Trừ tồn kho $\rightarrow$ Tái sử dụng 100% hàm `InventoryService.recordMovementsBatch`.
> 4. Đối soát tiền $\rightarrow$ Lấy `v2.payment.get_escrow_detail` nuôi số liệu cho tab **"Chủ"** (Câu 8 & Câu 11).
> 5. Bắn tin tức thì $\rightarrow$ Webhook `/api/shopee/push` trên Cloudflare Worker (không polling).

---

## MẢNH 1: XÁC THỰC & LƯU TRỮ TOKEN (AUTH & PLUGGABLE STORAGE)

### 1.1. Học tập từ SDK:
* Mẫu interface `TokenStorage` của SDK cực kỳ xuất sắc vì tách rời logic gọi API khỏi nơi lưu trữ Token.
* Thuật toán ký số HMAC-SHA256 (`signature.ts`) chuẩn xác 100%:
  ```text
  base_string = partner_id + api_path + timestamp [+ access_token + shop_id]
  sign = HMAC_SHA256(base_string, partner_key).toHex()
  ```

### 1.2. Áp vào FORMApubli:
* **Tuyệt đối không dùng `InMemoryTokenStorage`** của SDK mẫu (vì Cloudflare Worker tắt sau mỗi request sẽ làm bay màu token).
* **Giải pháp FORMApubli:** Tạo bảng `shopee_tokens` trong CSDL Turso và viết class `TursoTokenStorage`:

```sql
-- DDL thêm vào src/db/schema.ts
CREATE TABLE shopee_shop_tokens (
  shop_id INTEGER PRIMARY KEY,
  shop_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expired_at INTEGER NOT NULL,          -- Timestamp mili-giây hết hạn (Date.now() + expire_in*1000)
  refresh_expired_at INTEGER NOT NULL,  -- Timestamp hết hạn 30 ngày
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

```typescript
// src/services/shopee/turso-token-storage.ts
import { db, shopeeShopTokens } from '@/db';
import { eq } from 'drizzle-orm';

export interface AccessToken {
  access_token: string;
  refresh_token: string;
  expired_at: number;
  shop_id: number;
}

export class TursoTokenStorage {
  constructor(private shopId: number) {}

  async store(token: AccessToken): Promise<void> {
    await db.insert(shopeeShopTokens).values({
      shopId: this.shopId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiredAt: token.expired_at,
      refreshExpiredAt: Date.now() + 30 * 24 * 3600 * 1000,
    }).onConflictDoUpdate({
      target: shopeeShopTokens.shopId,
      set: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiredAt: token.expired_at,
        updatedAt: new Date().toISOString(),
      }
    });
  }

  async get(): Promise<AccessToken | null> {
    const row = await db.select().from(shopeeShopTokens).where(eq(shopeeShopTokens.shopId, this.shopId)).get();
    if (!row) return null;
    return {
      access_token: row.accessToken,
      refresh_token: row.refreshToken,
      expired_at: row.expiredAt,
      shop_id: row.shopId,
    };
  }
}
```

---

## MẢNH 2: KÉO ĐƠN & PHÂN TRANG (ORDER PIPELINE & CHANNEL MAPPING)

### 2.1. Học tập từ SDK:
* `v2.order.get_order_list`: Shopee giới hạn khoảng thời gian tối đa **15 ngày/lần gọi**. Phân trang không dùng số trang (Page 1, 2) mà dùng **Con trỏ (cursor)**:
  * Lần 1: `cursor = ""`
  * Lần tiếp: lấy `next_cursor` từ response cho đến khi `more === false`.

### 2.2. Áp vào FORMApubli:
* Trong `src/db/schema.ts:288`, cột `channel` hiện tại có:
  ```typescript
  channel: text('channel').notNull().default('FAIR_EVENT'), // FAIR_EVENT, RETAIL_OFFICE, WHOLESALE_PARTNER, ONLINE
  ```
* **Nâng cấp chuẩn:** Thêm giá trị **`SHOPEE`** vào `channel` (tách riêng khỏi `ONLINE` chung chung) để tiện đối soát doanh số riêng cho từng sàn:
  * `channel: 'SHOPEE'`
  * `idempotencyKey = 'shopee-' + order_sn` (Chống kéo trùng đơn tuyệt đối).
  * `customerName = recipient_address.name`
  * `note = 'Đơn Shopee #' + order_sn + ' - ' + recipient_address.full_address`
  * `carrier = 'SPX'`, `trackingCode = tracking_number`, `shippingFee = ...`, `codAmount = ...`

### 2.3. Ma trận ánh xạ trạng thái (Shopee $\rightarrow$ FORMApubli):
* Shopee `READY_TO_SHIP` $\rightarrow$ `status: 'COMPLETED'`, `shippingStatus: 'CREATED'` (Xuất kho đóng gói, đơn hợp lệ).
* Shopee `SHIPPED` $\rightarrow$ `status: 'COMPLETED'`, `shippingStatus: 'IN_TRANSIT'` (Đang giao trên đường).
* Shopee `COMPLETED` $\rightarrow$ `status: 'COMPLETED'`, `shippingStatus: 'DELIVERED'` (Giao thành công $\rightarrow$ tiền về ví Escrow).
* Shopee `CANCELLED` $\rightarrow$ `status: 'CANCELLED'`, `shippingStatus: 'FAILED'` (Hủy đơn $\rightarrow$ tự động hoàn kho `RETURN_INBOUND`).
* Shopee `TO_RETURN` $\rightarrow$ `status: 'COMPLETED'`, `shippingStatus: 'RETURNED'` (Khách trả hàng $\rightarrow$ lập phiếu hoàn kho).

> ⚠️ **ĐẦU VIỆC CHẶN (BLOCKING TASK — BẮT BUỘC SỬA TẦNG BÁO CÁO KHI CODE):**
> * Hiện tại toàn bộ báo cáo doanh thu (`analytics.service.ts:48,174,280,338`, `executive-digest.service.ts`) đang query:
>   `WHERE status = 'COMPLETED'` mà **HOÀN TOÀN CHƯA LỌC `shippingStatus`**.
> * **Nguy cơ phồng ảo:** Nếu đơn Shopee `READY_TO_SHIP` ghi `status: 'COMPLETED'` thì máy sẽ tính tiền ngay vào doanh số ngày dù khách chưa nhận hàng!
> * **Giải pháp bắt buộc:** Khi code module Shopee, **phải sửa đồng thời câu query báo cáo**: Đơn Shopee chỉ được tính vào doanh thu khi đã giao thành công:
>   `WHERE status = 'COMPLETED' AND (channel != 'SHOPEE' OR shippingStatus = 'DELIVERED')`.

> ⛔ **CẢNH BÁO BẮT BUỘC KHI CODE:** Luồng sync Shopee phải tạo đơn trực tiếp qua `db.insert(orders)`, **TUYỆT ĐỐI KHÔNG GỌI `OrderService.confirmOrder()`** vì hàm này đòi ảnh bill chuyển khoản (`paymentProofRequired`) của POS quầy và sẽ làm sập API kéo đơn!

---

## MẢNH 3: TRỪ TỒN KHO TỰ ĐỘNG (INVENTORY MOVEMENT INTEGRATION)

### 3.1. Nguyên tắc sống còn (Ponytail Rule):
* **KHÔNG VIẾT LẠI LOGIC KHO!** Không tự tiện `UPDATE stock_balances`.
* FORMApubli đã có sẵn hàm cốt lõi: `InventoryService.recordMovementsBatch(...)` (`src/services/inventory.service.ts:335`). Hàm này đã xử lý trọn vẹn:
  1. Kiểm tra tồn kho khả dụng (chặn tồn âm).
  2. Ghi nhận thẻ kho `inventory_ledger` với sự kiện `DISPATCH_SALE`.
  3. Cập nhật bảng cân đối tồn kho `stock_balances` (`src/db/schema.ts:255`) và `editions`.
  4. Chạy trong 1 transaction an toàn tuyệt đối.

### 3.2. Chốt bài toán: "Kho Shopee là kho nào?"
Hệ thống hiện tại có các loại kho (`warehouseType`): `PHYSICAL_MAIN`, `FAIR_EVENT`, `CONSIGNMENT`.
* **Quyết định kiến trúc:** Sách bán trên Shopee được đóng gói xuất phát từ **Kho Vật Lý Chính (`PHYSICAL_MAIN`)**.
* Khi đơn Shopee có trạng thái `READY_TO_SHIP`:
  ```typescript
  // Gọi trực tiếp hàm sẵn có của hệ thống
  await InventoryService.recordMovementsBatch(
    items.map(item => ({
      warehouseId: mainWarehouse.id,      // Kho Vật Lý Chính
      editionId: item.editionId,          // Map từ SKU/ISBN-13
      quantity: -item.quantityPurchased,  // Xuất kho (âm)
      unitCoverPrice: item.originalPrice,
      drawnValue: item.discountedPrice * item.quantityPurchased,
    })),
    {
      eventType: 'DISPATCH_SALE',
      documentRef: `SHOPEE_${order_sn}`,
      actorId: 'system-shopee-sync',
      note: `Xuất kho giao Shopee đơn #${order_sn}`,
    }
  );
  ```

---

## MẢNH 4: ĐỐI SOÁT TÀI CHÍNH ESCROW $\rightarrow$ NUÔI TAB "CHỦ"

### 4.1. Dữ liệu đắt giá từ SDK (`v2.payment.get_escrow_detail`):
Khi đơn hoàn tất, Shopee trả về cấu trúc chi tiết từng hào:
* `buyer_total_amount`: Doanh số khách trả (Giá bìa sau giảm).
* `escrow_amount`: **Tiền thực tế chuyển về tài khoản** của FORMApubli.
* Các loại phí sàn Shopee đã xén đi:
  * `commission_fee`: Phí hoa hồng cố định của sàn.
  * `transaction_fee`: Phí quẹt thẻ/thanh toán (thường 4%).
  * `service_fee`: Phí gói dịch vụ Freeship Xtra/Hoàn Xu.
  * `shopee_discount`: Tiền Shopee bỏ ra trợ giá cho người mua (Shopee hoàn lại cho mình).

### 4.2. Khớp thẳng vào Câu 8 & Câu 11 của Tab "Chủ":
* **Giải bài toán Câu 8 (VietQR/Tài khoản):** Dòng tiền từ Shopee không phải là tiền mặt tại két, mà là tiền chuyển khoản theo đợt từ ví Shopee về tài khoản ngân hàng của Anh. Hệ thống gom các `escrow_amount` lại thành **"Công nợ sàn Shopee chờ về"**.
* **Giải bài toán Câu 11 (Lợi nhuận ròng):** 
  ```text
  Lợi nhuận ròng Shopee = escrow_amount - Tiền vốn in sách (COGS) - Tiền hộp carton/đóng gói
  ```
  Số liệu này tự động đẩy vào biểu đồ hiệu quả kênh bán lẻ của tab **Chủ**.

---

## MẢNH 5: WEBHOOK BẮN TIN REALTIME THAY VÌ POLLING

### 5.1. Học tập từ SDK:
* SDK có `PushManager` xử lý các mã thông báo:
  * `code = 1`: `ORDER_STATUS_UPDATE` (Khách đặt, đơn sang Chờ giao, khách hủy).
  * `code = 2`: `TRACKING_NO_UPDATE` (Có mã vận đơn SPX/GHTK).

### 5.2. Đường dẫn công khai trên Cloudflare Worker:
Tạo route API công khai: `POST /api/shopee/push`

```typescript
// src/app/api/shopee/push/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const shopeeSign = req.headers.get('authorization') || '';
  const webhookUrl = req.url; // URL đầy đủ
  const partnerKey = process.env.SHOPEE_PARTNER_KEY!;

  // 1. Xác minh chữ ký bảo mật Webhook (chống hacker gửi tin giả)
  const baseString = `${webhookUrl}|${rawBody}`;
  const calculatedSign = crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');

  if (calculatedSign !== shopeeSign) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // 2. Xử lý sự kiện tức thì
  const payload = JSON.parse(rawBody);
  const { code, data } = payload;

  if (code === 1) { // ORDER_STATUS_UPDATE
    if (data.status === 'READY_TO_SHIP') {
      // Kéo chi tiết đơn & trừ tồn kho ngay lập tức!
    } else if (data.status === 'CANCELLED') {
      // Hoàn trả sách về kho chính!
    }
  }

  // Bắt buộc trả về HTTP 200 để Shopee không gửi lại
  return NextResponse.json({ status: 'ok' });
}
```

---

## TỔNG KẾT: CHECKLIST CHO DEVELOPER & AGENT

Khi bắt tay vào code, chỉ cần mở file này ra và làm theo 5 bước:
- [ ] **Bước 1:** Thêm bảng `shopee_shop_tokens` vào `schema.ts` và chạy migration.
- [ ] **Bước 2:** Bổ sung giá trị `'SHOPEE'` vào `orders.channel` (`src/db/schema.ts:288`).
- [ ] **Bước 3:** Viết hàm gọi API Shopee gọn nhẹ (dùng `generateSignature` và `TursoTokenStorage`).
- [ ] **Bước 4:** Nối luồng trừ kho Shopee vào `InventoryService.recordMovementsBatch` (Kho Chính).
- [ ] **Bước 5:** Mở route `/api/shopee/push` để nhận thông báo tức thời.
