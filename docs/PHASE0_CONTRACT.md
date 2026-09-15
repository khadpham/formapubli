# formapubli OS — HỢP ĐỒNG TÍCH HỢP ĐỢT 0 (PHASE 0 CONTRACT)
> **Phiên bản:** 1.0.0-draft  
> **Áp dụng cho:** Lane A (Danh tính, API & UI) và Lane B (Nghiệp vụ, Giao dịch & Đối soát)  
> **Quy tắc bất biến:** Một file một chủ sở hữu. Mọi thay đổi hợp đồng phải được hai bên đồng thuận trước khi sửa code.

---

## 1. HỢP ĐỒNG DANH TÍNH (ACTOR CONTEXT)

Lane A trích xuất danh tính từ Session Cookie hợp lệ và truyền xuống các hàm nghiệp vụ của Lane B dưới dạng tham số độc lập (tách biệt hoàn toàn khỏi payload do client gửi lên).

```typescript
export interface ActorContext {
  staffId: string;       // Định danh ổn định của nhân viên trong bảng staff_accounts (VD: 'NV-01', 'KHO-01')
  role: UserRole;        // 'ROLE_OWNER' | 'ROLE_MANAGER' | 'ROLE_CASHIER' | 'ROLE_WAREHOUSE' | 'ROLE_TAX'
  fullName?: string;     // Tên hiển thị (chỉ dùng cho UI/Audit log, không dùng làm khóa phân quyền)
  sessionId?: string;    // ID phiên làm việc để hỗ trợ thu hồi (revocation)
}
```

### Quy tắc áp dụng:
1. **Chống mạo danh (Non-spoofable)**: Mọi thao tác ghi sổ cái kho, tạo đơn, duyệt đổi trả đều lấy danh tính thực hiện từ `actorContext.staffId`. Client gửi trường `actorId` / `cashierId` khác đều bị Lane A loại bỏ hoặc chỉ ghi nhận như một ghi chú.
2. **Phân định Người thực hiện vs Đối tượng bị tác động**:
   - Khi Manager đóng ca két cho Cashier: Người thực hiện là `actorContext.staffId` (Manager), nhưng chủ sở hữu ca két vẫn là `cashboxSession.cashierId` (Cashier).
   - Không được ghi đè máy móc mã nhân viên của người khác.

---

## 2. HỢP ĐỒNG MÃ LỖI CHUẨN (ERROR CONTRACT)

Lane B ném ra (throw) hoặc trả về lỗi nghiệp vụ có cấu trúc (`AppError` hoặc `BusinessError`). Lane A bắt lỗi và chuyển đổi thành HTTP Status Code + Response JSON chuẩn:

```typescript
export interface ErrorResponse {
  success: false;
  code: 'AUTH_REQUIRED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'INSUFFICIENT_ATP' | 'STATE_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
  message: string;
  details?: any;
}
```

### Bảng ánh xạ mã lỗi:
| Mã lỗi (`code`) | HTTP Status | Ý nghĩa nghiệp vụ | Ví dụ phát sinh |
| :--- | :---: | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Chưa đăng nhập hoặc Session hết hạn | Truy cập API khi chưa có cookie `formapubli_session` |
| `FORBIDDEN` | 403 | Đã xác thực nhưng không đủ thẩm quyền action | Thu ngân gọi duyệt đơn online hoặc chuyển kho |
| `INVALID_INPUT` | 400 | Dữ liệu đầu vào sai định dạng / vi phạm kiểu | Số lượng sách lẻ (1.5), số âm, thiếu trường bắt buộc |
| `INSUFFICIENT_ATP` | 409 | Không đủ tồn khả dụng (vật lý - giữ chỗ) | Đặt 2 cuốn nhưng ATP chỉ còn 1 cuốn |
| `STATE_CONFLICT` | 409 | Trạng thái thực tế của dữ liệu đã bị đổi | Duyệt một đơn đã bị hủy hoặc duyệt phiếu đổi trả 2 lần |
| `IDEMPOTENCY_CONFLICT`| 409 | Cùng Idempotency-Key nhưng payload khác | Client gửi lại key cũ với số lượng sản phẩm mới |
| `RATE_LIMITED` | 429 | Bị giới hạn tần suất đăng nhập / thao tác | Nhập sai mật khẩu quá 5 lần trên 1 tài khoản/IP |

---

## 3. HỢP ĐỒNG TỒN KHẢ DỤNG (ATP) & GIỮ HÀNG

### 3.1. Phân loại tình trạng hàng
- **Chỉ hàng có tình trạng `condition = 'NEW'` tại kho xuất bán** mới được tính vào tồn bán được.
- Hàng lỗi `DEFECTIVE`, cách ly `QUARANTINE`, hay hư hại nhẹ `MINOR_DAMAGE` tuyệt đối không tính vào tồn khả dụng.

### 3.2. Công thức ATP chuẩn mực
$$\text{ATP}_{\text{available}} = \text{PhysicalStock}_{\text{NEW}} - \sum \text{PendingHeld}_{\text{active}}$$
Trong đó:
- `PhysicalStock`: Số dư thực tế trong bảng `stock_balances` tại kho xuất.
- `PendingHeld`: Tổng số lượng của các đơn có `status = 'PENDING_CONFIRMATION'` và `createdAt > now - 48h`.

### 3.3. Quy tắc các luồng tiêu thụ hàng:
1. **Luồng Bán Ngay (POS / Direct)**: Bắt buộc kiểm tra $\text{Qty} \le \text{ATP}$. Nếu không đủ $\rightarrow$ trả mã lỗi `INSUFFICIENT_ATP`. Không có ngoại lệ client tự ý bypass.
2. **Luồng Tạo Giữ Chỗ (Pending Online)**: Kiểm tra $\text{Qty} \le \text{ATP}$. Khi thành công, số lượng giữ chỗ tăng lên, làm giảm ATP của các đơn tiếp theo ngay lập tức.
3. **Luồng Duyệt Đơn Pending (`CONFIRM`)**:
   - Không được kiểm tra lại toàn bộ ATP làm tính trùng 2 lần số lượng của chính đơn đó.
   - Công thức kiểm tra khi duyệt: $\text{PhysicalStock} \ge \text{Qty}$ VÀ $\text{ATP} + \text{Qty}_{\text{đơn này}} \ge \text{Qty}$.
4. **Các luồng khác làm giảm tồn**: Chuyển kho (`TRANSFER_OUT`), Đổi hàng (`EXCHANGE`), Xuất ký gửi (`CONSIGNMENT_DISPATCH`) đều phải tuân thủ trần ATP khả dụng, không được xâm phạm vào hàng đang giữ chỗ của khách.
5. **Idempotency**: Gửi lại cùng `idempotencyKey` và cùng nội dung $\rightarrow$ Trả về kết quả đã ghi nhận trước đó, không được trừ kho hoặc cộng dồn giữ chỗ lần 2.

---

## 4. HỢP ĐỒNG ĐỐI SOÁT TỒN KHO & BÁO CÁO TÀI CHÍNH

### 4.1. Kịch bản mẫu chuẩn đối soát (Bán $\rightarrow$ Trả $\rightarrow$ Hoàn tiền $\rightarrow$ Két)
Giả sử tựa sách H01 có giá bìa 100.000 đ:
1. **Thao tác 1 (Bán hàng)**: Thu ngân bán 2 cuốn H01, chiết khấu 10% (10.000 đ/cuốn), thu tiền mặt 180.000 đ.
   - Thẻ kho: Xuất 2 cuốn NEW (`quantityDelta = -2`).
   - Đơn hàng: `finalAmount = 180.000 đ`.
   - Tiền mặt ca thu ngân: `+180.000 đ`.
2. **Thao tác 2 (Khách trả lại 1 cuốn lành)**: Lập phiếu hoàn trả 1 cuốn, hoàn tiền mặt 90.000 đ từ két đang mở.
   - Thẻ kho: Nhập lại 1 cuốn NEW (`quantityDelta = +1`).
   - Phiếu hoàn trả: `refundAmount = 90.000 đ`.
   - Tiền mặt ca thu ngân: `-90.000 đ` (Tiền thực tế trong két còn 90.000 đ).
3. **Thao tác 3 (Báo cáo tổng hợp)**:
   - **Doanh thu gộp (Gross Sales)**: 180.000 đ.
   - **Giá trị hoàn trả (Returns/Refunds)**: 90.000 đ.
   - **Doanh thu ròng (Net Sales)**: $180.000 - 90.000 = 90.000\text{ đ}$. Khớp đúng 100% với dòng tiền thực thu trong két.
   - Kỳ ghi nhận hoàn trả: Ghi nhận theo ngày phát sinh phiếu hoàn trả thực tế.

---

## 5. PHÂN CHIA QUYỀN SỞ HỮU FILE (CODEBASE BOUNDARIES)

| Bên phụ trách | Phạm vi file được phép sửa |
| :--- | :--- |
| **LANE A (Antigravity)** | • `src/app/api/**` (Toàn bộ API routes & guards)<br/>• `src/app/page.tsx` & `src/components/**` (UI & Server Component render)<br/>• `src/lib/auth-session.ts`, `rbac-guard.ts`, `roles.ts`, `manager-pin.ts`<br/>• `src/db/schema.ts`, migrations, `package.json`, `.env.example`<br/>• `scripts/setup-test-db.ts`, `run-isolated.ts` |
| **LANE B (Nhóm chuyên gia)** | • `src/services/**` (OrderService, InventoryService, AnalyticsService...)<br/>• `src/db/index.ts`, helper transaction & retry logic<br/>• Test suites nghiệp vụ trong `scripts/test-*.ts` (ngoại trừ test auth) |

Lane A đóng vai trò Integrator: Khởi tạo migration, kiểu dữ liệu chung và kiểm thử tích hợp cuối cùng.
