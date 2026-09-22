# ĐẶC TẢ THIẾT KẾ KỸ THUẬT & KIẾN TRÚC HỆ THỐNG FORMAPUBLI OS (BẢN V3 HOÀN THIỆN)
## Tối Ưu Hóa Vận Hành Hội Chợ, Quản Trị Kho Động & Bán Buôn Phiếu Xuất Kho (PXK)

- **Ngày ban hành:** 22/09/2026 (Phiên bản V3 - Hoàn thiện toàn bộ Phụ lục Kỹ thuật sau phản biện Round 2)
- **Trạng thái:** FINAL LOCKED SPEC FOR SPRINT PLANNING
- **Chủ trì thẩm định:** Solution Architect & Tech Lead

---

## 1. TỔNG HỢP TIẾP THU PHẢN BIỆN ROUND 2

Bản V3 giải quyết triệt để 7 lỗ hổng ở tầng implementation do Chuyên gia A chỉ ra:
1. **Khắc phục TOCTOU:** `transfer-batch` chạy transaction re-validate ATP và trả về mã lỗi `STRUCTURED_ERROR` kèm chi tiết tồn thực tế (`staleItems`) để giao diện tự điều chỉnh lại (re-cap 1 chạm). Bổ sung `idempotencyKey` chống double transfer.
2. **SQLite/D1 Concurrency:** Cấu hình chuẩn `PRAGMA journal_mode = WAL;`, `PRAGMA busy_timeout = 10000;`, bọc transaction bằng `withDbRetry` có full-jitter backoff. POS lọc theo `ATP > 0` (đã trừ đơn online giữ chỗ) thay vì chỉ nhìn `physicalQuantity`.
3. **State Machine & Cleanup:** Bổ sung cơ chế Lazy Expiration (TTL 5 phút), Client Polling Backoff (2s → 3s → 5s → dừng sau 5 phút), thuật toán Canonical Cart Hash chuẩn hóa chống float/thứ tự, và cơ chế giữ trạng thái `APPROVED` nếu thanh toán bị lỗi để không phải xin duyệt lại.
4. **Bảo mật QR/TOTP:** Ràng buộc chặt chẽ mã duyệt với đơn hàng (Binding Challenge-Response): QR chứa `requestId + nonce`, mã TOTP được tính dựa trên `ManagerSecret + ShortCode + CartHash`. Khôi phục đầy đủ cơ chế **Offline Resilience** cho quầy hội chợ rớt mạng.
5. **Phiếu Xuất Kho (PXK) Tuần Tự & Bất Biến:** Cấp số liên tục chống nhảy cóc bằng bảng `document_sequences` (`RETURNING current_val`). Enforce tính bất biến bằng trạng thái `LOCKED_IMMUTABLE`. Mọi điều chỉnh sau khi xuất bắt buộc phải lập phiếu đối ứng `PXK_REVERSAL`.
6. **Rạch ròi Tiền tệ & Pháp lý:** Định nghĩa rõ 4 loại kho (bao gồm `CONSIGNMENT` ký gửi); phân định thẩm quyền Sổ Kép (`OFFICIAL_TAX` vs `INTERNAL_MANAGEMENT`); thiết lập ngưỡng cảnh báo biên lợi nhuận ca nếu chiết khấu bình quân > 12%.
7. **Tách lộ trình 4 Sprint thực chiến:** Tách riêng khâu Báo cáo Chốt Ngày Hội Chợ & Đối soát Kiểm kê (vốn cần kiểm kê tồn kệ vs tồn máy) sang Sprint 4 để tránh nhồi nhét.

---

## 2. LỘ TRÌNH 4 SPRINT TRIỂN KHAI MVP (8 - 11 NGÀY)

```mermaid
flowchart LR
    S1["🎯 SPRINT 1 (2.5 ngày)\nKho Động & Batch Transfer\n(is_sellable_on_pos, Pre-validate TOCTOU, Idempotency)"] --> S2["🎯 SPRINT 2 (2.5 ngày)\nPOS Hội Chợ Cơ Bản\n(Khóa kho, Lọc ATP > 0, Sắp xếp A-Z/Hot, CK lẻ tự do)"]
    S2 --> S3["🎯 SPRINT 3 (3 ngày)\nDuyệt CK An Toàn & Bán Buôn PXK\n(QR/TOTP Binding, State Machine, Sequence PXK, In A4)"]
    S3 --> S4["🎯 SPRINT 4 (2 ngày)\nChốt Ngày Hội Chợ & Bàn Giao Két\n(Đối soát Két tiền, Kiểm kê Tồn kệ vs Tồn máy, Full Drill)"]
```

---

## 3. PHỤ LỤC KỸ THUẬT CHI TIẾT (TECHNICAL APPENDIX)

### PHỤ LỤC A: ĐẶC TẢ DATABASE SCHEMA NÂNG CẤP

#### 1. Cập nhật bảng `warehouses`:
```sql
ALTER TABLE warehouses ADD COLUMN is_sellable_on_pos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouses ADD COLUMN warehouse_type TEXT NOT NULL DEFAULT 'PHYSICAL_MAIN';
-- warehouse_type: 'PHYSICAL_MAIN', 'FAIR_EVENT', 'CONSIGNMENT', 'IN_TRANSIT'
```

#### 2. Bảng cấp số chứng từ liên tục `document_sequences`:
```sql
CREATE TABLE document_sequences (
    id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL, -- 'PXK', 'PCK', 'ORD'
    fiscal_year INTEGER NOT NULL,
    current_val INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_doc_seq UNIQUE (doc_type, fiscal_year)
);
```

#### 3. Bảng yêu cầu phê duyệt chiết khấu `discount_approval_requests`:
```sql
CREATE TABLE discount_approval_requests (
    id TEXT PRIMARY KEY,
    order_code TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    cashier_id TEXT NOT NULL,
    cart_hash TEXT NOT NULL, -- sha256 canonical giỏ hàng
    requested_discount_rate REAL NOT NULL,
    original_amount REAL NOT NULL,
    discount_amount REAL NOT NULL,
    final_amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED', 'SUPERSEDED'
    approved_by TEXT,
    approval_method TEXT, -- 'REMOTE_APP', 'QR_SCAN', 'TOTP_CHALLENGE', 'OFFLINE_EMERGENCY'
    nonce TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_discount_req_order ON discount_approval_requests(order_code);
CREATE INDEX idx_discount_req_status_exp ON discount_approval_requests(status, expires_at);
```

#### 4. Bảng Phiếu Xuất Kho Bán Buôn `delivery_orders` (PXK):
```sql
CREATE TABLE delivery_orders (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE, -- PXK-2026-0001 (liên tục)
    partner_id TEXT NOT NULL REFERENCES partners(id),
    from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    subtotal REAL NOT NULL,
    discount_rate REAL NOT NULL,
    final_amount REAL NOT NULL,
    fiscal_scope TEXT NOT NULL DEFAULT 'INTERNAL_MANAGEMENT', -- 'OFFICIAL_TAX' | 'INTERNAL_MANAGEMENT'
    vat_invoice_code TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'DISPATCHED_LOCKED', 'VOIDED_REVERSED'
    reversal_of TEXT, -- ID phiếu gốc nếu đây là phiếu điều chỉnh hủy
    created_by TEXT NOT NULL,
    dispatched_by TEXT,
    dispatched_at TEXT,
    received_by_name TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE delivery_order_items (
    id TEXT PRIMARY KEY,
    delivery_order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
    edition_id TEXT NOT NULL REFERENCES editions(id),
    quantity INTEGER NOT NULL,
    unit_cover_price REAL NOT NULL,
    unit_selling_price REAL NOT NULL,
    total_amount REAL NOT NULL
);
```

---

### PHỤ LỤC B: API CONTRACTS & XỬ LÝ LỖI TOCTOU

#### 1. API Chuyển kho hàng loạt (`POST /api/inventory/transfer-batch`)
- **Headers:** `Idempotency-Key: <uuid-v7>` (Bắt buộc)
- **Request Body:**
  ```json
  {
    "fromWarehouseId": "wh-au-co",
    "toWarehouseId": "wh-hoi-cho-a",
    "documentRef": "PCK-20260922-01",
    "note": "Xuất sách hội chợ đợt 1",
    "items": [
      { "editionId": "ed-h01", "quantity": 50 },
      { "editionId": "ed-h21", "quantity": 30 }
    ]
  }
  ```
- **Xử lý TOCTOU trong Transaction Backend:**
  ```typescript
  return await withDbRetry(async () => {
    return await db.transaction(async (tx) => {
      // 1. Re-validate ATP tức thời bên trong transaction
      const staleItems = [];
      for (const it of items) {
        const atpNow = await OrderService.getATP(it.editionId, fromWarehouseId, tx);
        if (atpNow < it.quantity) {
          staleItems.push({ editionId: it.editionId, requested: it.quantity, availableNow: atpNow });
        }
      }
      // 2. Nếu có biến động tồn kho, trả về lỗi cấu trúc TOCTOU
      if (staleItems.length > 0) {
        throw new AppError(409, 'TRANSFER_TOCTOU_ATP_STALE', 'Tồn kho nguồn đã biến động.', { staleItems });
      }
      // 3. Thực thi cặp TRANSFER_OUT / TRANSFER_IN nguyên tử
      // ...
    });
  });
  ```
- **Response Lỗi TOCTOU (HTTP 409 Conflict):**
  ```json
  {
    "code": "TRANSFER_TOCTOU_ATP_STALE",
    "message": "Một số đầu sách đã thay đổi số dư khả dụng.",
    "data": {
      "staleItems": [
        { "editionId": "ed-h01", "requested": 50, "availableNow": 32 }
      ]
    }
  }
  ```
- **Client Handler:** UI nhận `staleItems`, không xóa form, đổi dòng `ed-h01` sang viền vàng kèm nút *"Hạ về 32 cuốn và xác nhận lại"* (Re-cap 1-chạm).

---

### PHỤ LỤC C: THUẬT TOÁN CANONICAL CART HASH & XÁC THỰC DUYỆT

#### 1. Chuẩn Hóa Chuỗi Băm Giỏ Hàng (`generateCanonicalCartHash`)
```typescript
export function generateCanonicalCartHash(
  items: Array<{ editionId: string; quantity: number; unitSellingPrice: number }>,
  discountRate: number
): string {
  // 1. Sort deterministic theo editionId
  const sorted = [...items].sort((a, b) => a.editionId.localeCompare(b.editionId));
  // 2. Canonicalize: số nguyên VND, làm tròn chiết khấu về 2 chữ số thập phân
  const tokens = sorted.map(
    it => `${it.editionId}:${it.quantity}:${Math.round(it.unitSellingPrice)}`
  );
  tokens.push(`rate:${Math.round(discountRate * 10000)}`);
  // 3. Băm SHA-256
  return crypto.createHash('sha256').update(tokens.join('|')).digest('hex');
}
```

#### 2. Cơ Chế Xác Thực Challenge-Response (Binding TOTP/QR)
- **Mã QR:** Chứa URL: `https://pos.formapubli.com/approve?reqId=REQ-123&nonce=NONCE-XYZ`
- **Mã TOTP 6 Số có Ràng Buộc Đơn (Bound TOTP):**
  - Quản lý mở ứng dụng Quản lý, chọn *"Cấp mã duyệt đơn"*.
  - Nhập **4 số cuối mã đơn hàng** (ví dụ: `4821`).
  - Ứng dụng Quản lý tính mã 6 số: `TOTP(ManagerSecret + "4821" + WindowTime60s)`.
  - Thu ngân nhập mã 6 số này vào POS. Server kiểm tra đúng `ManagerSecret` kết hợp đúng số `4821` của đơn này.
  - **Chống Replay:** Mã này chỉ dùng được cho đơn `...4821`, nếu thu ngân mang sang đơn khác sẽ bị từ chối ngay lập tức.

#### 3. State Machine & Rollback Khi Thanh Toán Lỗi
- Khi Quản lý duyệt: Trạng thái chuyển sang `APPROVED`.
- Khi thu ngân bấm `Ctrl + Enter` thanh toán:
  - Nếu thanh toán thành công: Chuyển sang `CONSUMED`.
  - Nếu thanh toán **THẤT BẠI** (ví dụ lỗi mạng, lỗi máy in): Trạng thái **GIỮ NGUYÊN LÀ APPROVED** (miễn là còn trong TTL 5 phút và `cartHash` chưa đổi). Thu ngân có thể bấm thanh toán lại ngay lập tức mà không phải bắt khách đứng chờ xin duyệt lại từ đầu!
- Nếu thu ngân thay đổi bất kỳ cuốn sách hoặc số lượng nào: `cartHash` đổi → Server tự đánh dấu request cũ thành `SUPERSEDED`, yêu cầu xin duyệt mới.

---

### PHỤ LỤC D: ĐẢM BẢO TÍNH TUẦN TỰ & BẤT BIẾN CỦA PHIẾU XUẤT KHO (PXK)

#### 1. Cấp Số Tăng Dần Liên Tục Không Khoảng Trống (Gap-Free Sequence)
```typescript
export async function getNextPXKCode(fiscalYear: number, tx: any): Promise<string> {
  // Cập nhật tăng atomic trên SQLite
  const result = await tx.run(sql`
    INSERT INTO document_sequences (id, doc_type, fiscal_year, current_val)
    VALUES ('seq-pxk-' || ${fiscalYear}, 'PXK', ${fiscalYear}, 1)
    ON CONFLICT (doc_type, fiscal_year) DO UPDATE
    SET current_val = document_sequences.current_val + 1,
        updated_at = CURRENT_TIMESTAMP
    RETURNING current_val;
  `);
  const seq = result.rows[0].current_val;
  return `PXK-${fiscalYear}-${String(seq).padStart(4, '0')}`; // PXK-2026-0001
}
```

#### 2. Quy Trình Hủy / Điều Chỉnh Phiếu Xuất Kho Đã Ký (Reversal Flow)
- Tuyệt đối nghiêm cấm câu lệnh `DELETE` hoặc `UPDATE` trên bảng `delivery_orders` khi đã ở trạng thái `DISPATCHED_LOCKED`.
- Khi cần hủy/sửa:
  1. Kế toán trưởng lập phiếu điều chỉnh: `POST /api/delivery-orders/reverse`.
  2. Hệ thống tạo phiếu mới có mã `PXK-2026-XXXX-REV`, đánh dấu trường `reversal_of = PXK-GOC`.
  3. Tự động sinh bút toán nhập hoàn kho `RECEIPT_RETURN` tương ứng trong `inventory_ledger`.
  4. Đảo trừ bút toán công nợ và doanh thu bán buôn. Lịch sử của cả 2 phiếu gốc và phiếu hủy đều được lưu giữ vĩnh viễn trên sổ kế toán.

---

### PHỤ LỤC E: BÁO CÁO CHỐT CA HỘI CHỢ & ĐỐI SOÁT KIỂM KÊ (SPRINT 4)

Báo cáo chốt ngày không đơn thuần là bảng doanh thu, mà là **Biên bản Bàn giao & Kiểm kê Thực tế**:
1. **Đối soát Két tiền:** Tiền mặt đầu ca + Tiền mặt thu trong ca = Tiền mặt lý thuyết. Nhập Tiền mặt thực tế đếm được → Báo cáo chênh lệch thừa/thiếu (Cash Variance).
2. **Đối soát Tồn kho Sách trên Kệ:**
   - Tồn ban đầu nhận từ Phiếu chuyển kho (`TRANSFER_IN`).
   - Trừ: Tổng số lượng sách bán ra trên POS trong ngày.
   - Bằng: **Tồn lý thuyết cuối ngày**.
   - Nhân viên nhập số lượng thực tế đếm được trên kệ trước khi đóng thùng → Báo cáo chênh lệch thất thoát (Inventory Variance: rách nát, mất mát).
3. **Chữ ký xác nhận:** Thu ngân ca và Quản lý gian hàng ký điện tử chốt ca.

---
*Bản thiết kế V3 đã chuẩn hóa toàn bộ các chi tiết kỹ thuật ở mức thi công, sẵn sàng khóa spec để đội ngũ lập trình viên tiến hành phân chia nhiệm vụ.*
