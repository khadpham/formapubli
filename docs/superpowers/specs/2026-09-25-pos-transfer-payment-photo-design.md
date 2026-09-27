# Đặc tả thiết kế: Thanh toán chuyển khoản/QR theo đơn và ảnh xác nhận cục bộ

- Ngày: 25/09/2026
- Trạng thái: Draft đã duyệt phạm vi, chờ rà soát văn bản
- Phạm vi: POS cashier, order state machine, offline queue, camera cục bộ

## 1. Mục tiêu

Thay luồng hiện tại “xác nhận đã nhận tiền trước, rồi mới tạo đơn” bằng luồng đúng nghiệp vụ:

1. Tạo đơn trước.
2. Khách quét QR và chuyển khoản.
3. Thu ngân chụp màn hình điện thoại khách để tự xác nhận.
4. Lưu ảnh trên máy thu ngân.
5. Xác nhận đơn và ghi nhận doanh thu.

Hệ thống phải hỗ trợ thực tế mất mạng tại quầy nhưng không được âm thầm ghi tồn hoặc bỏ qua xung đột ATP.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Kiến trúc | Hybrid server/local |
| QR online | Tạo sau khi đã có đơn PENDING thật |
| QR offline | Tạo từ tài khoản ngân hàng cache và đơn local |
| Ảnh | Bắt buộc trước khi thu ngân xác nhận đơn chuyển khoản/QR |
| Nơi lưu ảnh | IndexedDB trên máy thu ngân, không upload |
| Retention | Tối đa 100 ảnh thường hoặc 30 ngày; ảnh cần đối soát được miễn tự xóa |
| Người xác nhận | Cashier tự xác nhận đơn của mình; Owner/Manager xác nhận mọi đơn |
| Xung đột offline | Giữ đơn và ảnh để đối soát; không ghi âm tồn |
| Cache tài khoản | Theo kho, tối đa 24 giờ |
| OCR/đối chiếu | Không làm |

## 3. Không nằm trong phạm vi

- OCR hoặc đọc nội dung ảnh.
- Kiểm tra số tiền trong ảnh với số tiền đơn.
- Gọi API ngân hàng để xác minh giao dịch.
- Upload ảnh lên server.
- Mã hóa ảnh local.
- Quy trình quản lý gửi yêu cầu ảnh từ xa.
- Phân tích máy ảnh, chống gian lận ảnh hoặc chống chụp lại màn hình.
- Tự động hoàn tiền hoặc tự động hủy giao dịch đã thu tiền.

Ảnh là bước vận hành để thu ngân tự xác nhận, không phải bằng chứng kiểm toán hay cơ chế bảo mật.

## 4. Hệ thống hiện tại

### 4.1. POS đang làm gì

`PosCheckoutTerminal.tsx` hiện hiển thị `VietQrPay` và nút xác nhận tiền trước khi gọi `POST /api/orders`. Route `api/orders/route.ts` từ chối `BANK_TRANSFER`/`QR_CODE` nếu `moneyReceived !== true`.

### 4.2. Máy trạng PENDING có thể tái sử dụng

`OrderService.createOrder({ confirmImmediately: false })` đã tạo `PENDING_CONFIRMATION`:

- Giữ ATP nhưng chưa trừ tồn vật lý.
- `OrderService.getATP()` trừ lượng giữ của đơn PENDING còn hạn.
- `OrderService.confirmOrder()` chuyển PENDING sang COMPLETED và trừ kho trong transaction.
- `OrderService.cancelOrder()` hủy PENDING và giải phóng ATP.
- Đơn PENDING hiện dùng TTL 48 giờ.

`confirmOrder()` và `cancelOrder()` hiện chỉ cho Owner/Manager. Route cũng chặn Cashier trước khi gọi service.

### 4.3. QR không phụ thuộc mạng sau khi có cấu hình kho

`src/lib/vietqr.ts` và thư viện `qrcode` tạo hoàn toàn trên máy. `/api/bank-accounts` là nguồn cấu hình duy nhất cần mạng.

## 5. Kiến trúc mục tiêu

### 5.1. Thanh toán tiền mặt và đơn tặng

- Không thay đổi.
- Tạo và hoàn tất đơn trong một request.
- Không cần ảnh.

### 5.2. Chuyển khoản/QR có mạng

1. Thu ngân chọn chuyển khoản/QR.
2. POS hiển thị nút “Tạo đơn & hiện QR”.
3. Client gửi `confirmImmediately: false`.
4. Server tạo `PENDING_CONFIRMATION`, đặt `paymentExpiresAt = now + 30 phút`, giữ ATP.
5. POS nhận `orderId` và `orderCode` thật.
6. `VietQrPay` tạo QR từ tài khoản nhận của kho, số tiền thật và nội dung chuyển khoản là mã đơn thật.
7. Khách chuyển khoản.
8. Thu ngân mở camera, chụp, xem lại và lưu ảnh local.
9. Client gửi xác nhận đơn kèm thời điểm đã lưu ảnh.
10. Service kiểm tra quyền, hạn, két và ATP; trừ kho rồi chuyển `COMPLETED`.

### 5.3. Chuyển khoản/QR mất mạng

1. Nếu kho có cache tài khoản hợp lệ, POS tạo đơn local `AWAITING_PAYMENT`.
2. POS tạo QR offline với `orderCode` UUID do client sinh.
3. Khách chuyển khoản.
4. Thu ngân chụp và lưu ảnh local.
5. Đơn local chuyển sang `PAID_PENDING_SYNC`.
6. Khi có mạng, client sync một lần bằng cùng `id`, `orderCode` và `idempotencyKey`, kèm `moneyReceived: true`, `paymentProofId` và `paymentProofCapturedAt`.
7. Nếu ATP và két hợp lệ, server tạo `COMPLETED` và trừ kho trong một transaction.
8. Nếu không đủ ATP, két đã đóng hoặc dữ liệu mâu thuẫn, đơn chuyển `NEEDS_RECONCILIATION`; giữ ảnh và thông báo rõ nguyên nhân.

Offline là soft hold. Không có khoá tồn phân tán giữa các thiết bị.

## 6. State machine

### 6.1. Server

```text
PENDING_CONFIRMATION
  |-- cashier xác nhận đơn của mình, còn hạn, đủ ATP, két mở --> COMPLETED
  |-- manager/owner xác nhận --> COMPLETED
  |-- cashier của đơn hoặc manager/owner hủy --> CANCELLED
  |-- quá paymentExpiresAt --> CANCELLED
```

`COMPLETED` và `CANCELLED` là terminal. Retry xác nhận trên `COMPLETED` trả idempotent success nếu có bút toán hợp lệ.

### 6.2. Local offline

```text
AWAITING_PAYMENT
  |-- chụp và lưu ảnh thành công --> PAID_PENDING_SYNC
  |-- đóng modal/hủy trước khi chụp --> CANCELLED_LOCAL

PAID_PENDING_SYNC
  |-- sync thành công --> SYNCED
  |-- ATP/két/xung đột --> NEEDS_RECONCILIATION

NEEDS_RECONCILIATION
  |-- sửa nguyên nhân rồi retry --> PAID_PENDING_SYNC
  |-- quyết định hủy/đối soát thủ công --> CANCELLED_LOCAL
```

Đơn tiền mặt offline dùng `READY_TO_SYNC` và không cần ảnh.

## 7. Dữ liệu server

### 7.1. Migration

Thêm cột nullable:

```sql
ALTER TABLE orders ADD COLUMN payment_expires_at TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_payment_expires_at
  ON orders(payment_expires_at);
```

Quy tắc:

- POS counter transfer đặt `payment_expires_at` sau 30 phút.
- Đơn PENDING cũ không có giá trị này tiếp tục dùng TTL 48 giờ.
- `getATP`, `confirmOrder`, `cancelOrder` và `cleanupExpiredPending` phải dùng cùng một helper xác định hạn.

### 7.2. Audit

Mỗi lần xác nhận hoặc hủy đơn chuyển khoản ghi:

- `orderId`, `orderCode`
- actor role và actor id
- thời điểm
- `paymentProofId` và `paymentProofCapturedAt` do client gửi
- kết quả

`confirmOrder()` và luồng sync offline đều từ chối thanh toán chuyển khoản/QR nếu thiếu `paymentProofId` hoặc `paymentProofCapturedAt`. Đây là chốt quy trình để chặn bấm nhầm; server không kiểm chứng ảnh thật. Các giá trị proof chỉ là dữ liệu vận hành.

## 8. Dữ liệu local

### 8.1. Store ảnh

Tăng IndexedDB version và tạo object store `payment_proof_photos`:

```ts
interface PaymentProofPhoto {
  id: string;
  orderId?: string;
  orderCode: string;
  warehouseId: string;
  cashierId: string;
  amount: number;
  paymentMethod: 'BANK_TRANSFER' | 'QR_CODE';
  capturedAt: string;
  blob: Blob;
  syncState: 'LOCAL_ONLY' | 'ORDER_SYNCED' | 'NEEDS_RECONCILIATION';
}
```

Tên file khi chia sẻ: `payment-{orderCode}-{timestamp}.jpg`.

### 8.2. Retention

Sau mỗi lần lưu:

1. Xóa ảnh thường đã hơn 30 ngày.
2. Nếu số ảnh thường còn vượt 100, xóa ảnh thường cũ nhất cho đến khi còn 100.
3. Ảnh có `syncState = NEEDS_RECONCILIATION` được miễn tự xóa theo cả tuổi và số lượng; chỉ xóa khi thu ngân xóa thủ công hoặc đơn được xử lý xong.

### 8.3. Migration offline order hiện có

Thêm `paymentState` với giá trị suy ra khi đọc record cũ:

| Loại bản ghi cũ | State |
|---|---|
| Tiền mặt | `READY_TO_SYNC` |
| Chuyển khoản/QR có `moneyReceived=true` | `PAID_PENDING_SYNC` |
| Chuyển khoản/QR thiếu `moneyReceived` | `NEEDS_RECONCILIATION` |

Auto-sync chỉ lấy `READY_TO_SYNC` và `PAID_PENDING_SYNC`.

## 9. Cache tài khoản ngân hàng

Cache JSON theo kho, tối đa 24 giờ:

```ts
interface CachedBankAccounts {
  warehouseId: string;
  cachedAt: number;
  defaultId: string | null;
  accounts: Array<{
    id: string;
    label: string;
    bankBin: string;
    accountNo: string;
    accountName?: string | null;
  }>;
}
```

- Có mạng: fetch và làm mới cache.
- Mất mạng: dùng cache nếu còn hạn.
- Hết hạn hoặc chưa có cache: chặn QR offline và hướng dẫn dùng tiền mặt.
- UI phải hiển thị tên khoản, số tài khoản và nhãn dữ liệu cache.

## 10. Quyền

### 10.1. Xác nhận

- Owner/Manager: xác nhận mọi đơn PENDING.
- Cashier: chỉ xác nhận đơn PENDING có `cashierId` bằng actor hiện tại.
- Chỉ `BANK_TRANSFER`/`QR_CODE` được cashier tự xác nhận.
- Mọi xác nhận chuyển khoản/QR phải có `paymentProofId` và `paymentProofCapturedAt`; thiếu thì service từ chối.
- Service kiểm tra lại sau khi đọc order trong transaction; route không phải lớp bảo vệ duy nhất.

### 10.2. Hủy

- Cashier chỉ hủy đơn PENDING của mình.
- Owner/Manager hủy mọi đơn PENDING.

### 10.3. Đóng ca

`CashboxService.closeSession()` phải từ chối đóng ca nếu session còn bất kỳ order `PENDING_CONFIRMATION` nào. Thông báo phải yêu cầu xác nhận hoặc hủy các đơn đó trước.

## 11. Giao diện

### 11.1. Giỏ hàng

Với chuyển khoản/QR:

- Không hiện QR trước khi tạo đơn.
- Không hiện nút toggle “Đã nhận tiền”.
- Nút chính: “Tạo đơn & hiện QR”.

### 11.2. Transfer payment modal

Hiển thị:

- Mã đơn thật hoặc mã local đã sinh.
- Số tiền.
- QR.
- Thời gian đếm ngược online.
- Trạng thái cache tài khoản offline.
- Nút “Chụp màn hình xác nhận”.
- Nút “Khách chuyển sau” hoặc “Hủy đơn”.

### 11.3. Camera

- Dùng `navigator.mediaDevices.getUserMedia`.
- Camera sau theo mặc định; cho đổi trước/sau.
- Nút chụp lớn, không phụ thuộc OCR.
- Chụp vào canvas, xuất JPEG chất lượng khoảng 0.8, cạnh dài tối đa 1280px.
- Preview và hai lựa chọn: “Chụp lại”, “Dùng ảnh này”.
- Dừng toàn bộ media track khi đóng.
- Dùng portal và focus trap hiện có.
- Lỗi quyền, thiết bị và play được hiển thị rõ; đóng modal không hủy đơn.

Chỉ khi lưu ảnh local thành công mới gọi API xác nhận.

### 11.4. Gallery

Nút “Ảnh thanh toán (n)” trên POS:

- Mới nhất trước.
- Tìm theo mã đơn.
- Xem ảnh lớn.
- Web Share API với file nếu hỗ trợ.
- Tải ảnh nếu không hỗ trợ chia sẻ.
- Xóa thủ công.

## 12. Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Camera bị từ chối | Đơn giữ PENDING; cho phép mở lại hoặc chờ quản lý |
| Không có camera | Tư vấn dùng thiết bị khác; không bypass |
| Lưu ảnh lỗi | Không gọi API xác nhận |
| Mất mạng khi xác nhận | Giữ ảnh và PENDING; retry idempotent |
| Đơn đã COMPLETED | Retry trả idempotent success |
| Hết 30 phút | Server chuyển CANCELLED, giải phóng ATP |
| Hết ATP | Không hoàn tất; giữ đơn local để đối soát nếu offline |
| Đơn server bị gắn két đã đóng | Không xác nhận được; cashier/manager hủy rồi tạo lại nếu phù hợp |
| Đơn local offline gắn két đã đóng | Giữ ảnh và đơn; dùng flow gán lại ca mới đã có trước khi sync lại |
| Cache tài khoản hết hạn | Chặn QR offline |
| Nhiều cashier cùng kho | Mã đơn riêng; ATP chỉ quyết định tại thời điểm tạo/xác nhận server |

## 13. Nhiều thu ngân cùng kho

- Mỗi cashier có cashbox session riêng.
- Bank account được cache và chọn theo kho, không theo cashier.
- `orderCode` là UUID suffix nên không trùng giữa các máy.
- Nội dung chuyển khoản giúp đối chiếu từng đơn.
- Online, ATP được giữ bởi server.
- Offline, mỗi máy chỉ có dữ liệu local; không thể ngăn hai máy cùng bán cuốn sách cuối. Xung đột chỉ phát hiện khi sync và phải vào đối soát.

## 14. Thay đổi dự kiến

### Thành phần mới

- `src/components/pos/TransferPaymentModal.tsx`
- `src/components/pos/PaymentProofCamera.tsx`
- `src/components/pos/PaymentPhotoGallery.tsx`
- `src/lib/bank-account-cache.ts`

### Thành phần sửa

- `src/components/pos/PosCheckoutTerminal.tsx`
- `src/components/pos/VietQrPay.tsx`
- `src/services/order.service.ts`
- `src/app/api/orders/route.ts`
- `src/lib/offline-db.ts`
- `src/db/schema.ts`
- Một migration additive cho `payment_expires_at`
- Smoke/integration test liên quan

`offline-db.ts` phải sở hữu việc mở IndexedDB vì tất cả object store dùng chung một database version; không tạo module DB riêng cùng version.

## 15. Kiểm thử

### 15.1. Online

- Tạo pending transfer không cần `moneyReceived`.
- QR dùng mã đơn thật và số tiền thật.
- Cashier xác nhận được đơn của mình.
- Cashier không xác nhận được đơn người khác.
- Owner/Manager xác nhận/hủy được mọi đơn.
- Cashier hủy được đơn của mình.
- Retry sau COMPLETED trả idempotent success.
- Hết hạn chuyển CANCELLED và giải phóng ATP.
- Đóng két bị chặn khi còn pending.

### 15.2. Offline

- Cache tài khoản theo kho và quy tắc 24 giờ.
- Tạo QR offline khi cache hợp lệ.
- Không tạo QR offline khi cache thiếu/hết hạn.
- Đơn local chỉ sync sau khi ảnh lưu thành công.
- Sync thành công tạo COMPLETED và trừ kho một lần.
- Xung đột ATP chuyển `NEEDS_RECONCILIATION`, không ghi âm tồn.
- Record offline cũ được migrate đúng `paymentState`.

### 15.3. Camera và gallery

- Mở/đóng camera dừng media track.
- Permission lỗi không làm hỏng POS.
- Chụp lại và dùng ảnh hoạt động đúng.
- Lưu ảnh thất bại thì không gọi confirm.
- Lọc gallery theo mã đơn.
- Xóa thủ công.
- Retention 30 ngày/100 ảnh.
- Các record cần đối soát không bị auto-prune.

### 15.4. Hồi quy

- Tiền mặt không đổi.
- Đơn tặng không yêu cầu ảnh.
- Discount approval và cart freeze không đổi.
- Offline queue hiện tại không mất record.
- Nhiều cashier cùng kho: mã đơn khác nhau, ATP không bị giữ trùng.
- Toàn bộ isolated test suite hiện tại vẫn xanh.

## 16. Tiêu chí chấp nhận

1. Không thể hoàn tất đơn chuyển khoản/QR từ giao diện POS nếu chưa lưu ảnh chụp.
2. Online, đơn PENDING tồn tại trước khi QR hiển thị và giữ ATP đúng hạn.
3. Offline, POS vẫn tạo và hiển thị QR khi cache tài khoản hợp lệ.
4. Xung đột offline không bao giờ dẫn tới tồn âm hoặc đơn tự hoàn tất.
5. Mỗi cashier chỉ xác nhận/hủy đơn PENDING của chính mình; Owner/Manager xử lý mọi đơn.
6. Ảnh lưu cục bộ, có thể xem/chia sẻ/xóa, tự prune theo retention.
7. Nhiều cashier cùng kho không tạo trùng mã đơn hoặc lẫn nội dung chuyển khoản.
8. Toàn bộ test hiện tại và test mới đều pass.

## 17. Rủi ro đã chấp nhận

- Ảnh không chứng minh giao dịch thật.
- Client có thể bị bypass nếu gọi API trực tiếp; đây là giới hạn trust model hiện hữu.
- Offline không có reservation xuyên thiết bị.
- Xóa dữ liệu trình duyệt làm mất ảnh.
- Cache tài khoản có thể cũ trong 24 giờ.
- Nhiều thiết bị có thể tạo đơn trùng hàng khi offline; server xử lý khi sync.
