# ĐẶC TẢ THIẾT KẾ KỸ THUẬT & KIẾN TRÚC FORMAPUBLI OS (BẢN V4.1 — LOCKED)

- **Ngày ban hành:** 22/09/2026 (V4.1 — V4 + team trả lời 7/7 câu hỏi mở, không còn điểm treo)
- **Trạng thái:** ✅ OFFICIALLY LOCKED FOR SPRINT 1 (đủ điều kiện thi công Sprint 1 ngay)
- **Cơ sở:** Giữ nguyên V4, khóa 7 quyết định tại mục 8. TOTP chuẩn RFC6238 và PDF-lib hoãn sang Pha 2.

---

## 0. CHANGELOG V3 → V4 (team phản biện ngược vào đúng 8 điểm này)

| # | Lỗi V3 | Fix V4 | Team có thể bác bỏ nếu... |
|---|--------|--------|---------------------------|
| 1 | `withDbRetry` bọc cả transaction → retry luôn cả lỗi nghiệp vụ 409 TOCTOU (vòng lặp vô nghĩa, spam DB) | Chỉ retry `SQLITE_BUSY / D1_BUSY / SQLITE_LOCKED`, **không retry `AppError` 4xx**. Thêm `dryRun` validate riêng. | Team chứng minh được `withDbRetry` hiện tại đã phân loại lỗi. |
| 2 | `documentRef: PCK-...` do client tự đặt → trùng số, nhảy số | PCK/PXK đều do server cấp từ `document_sequences` **trong cùng transaction** với insert phiếu. Client không được tự đặt mã. | Team muốn giữ client đặt mã vì lý do offline — phải đề xuất cơ chế chống trùng thay thế. |
| 3 | TOTP tự chế `TOTP(secret + shortCode + time)` — không dùng được với Google Authenticator, sai chuẩn RFC6238 | Tách 2 lớp: (a) Manager xác thực chuẩn TOTP/RFC6238 hoặc session; (b) nhập **ShortCode 4 số của đơn** để bind. Không tự chế crypto. | Team muốn giữ TOTP tự chế — phải chỉ ra thư viện nào implement được. |
| 4 | QR approve là URL trần `?reqId&nonce` — ai có link cũng duyệt được | QR chứa **JWT/HMAC có ký** (`reqId + cartHash + exp`), và endpoint approve **bắt buộc session Manager**. | Team cho rằng gian hàng tin tưởng nội bộ, không cần ký — phải chấp nhận rủi ro bằng văn bản. |
| 5 | `approval_method='OFFLINE_EMERGENCY'` xuất hiện trong schema nhưng không định nghĩa — backdoor | Định nghĩa chặt (mã khẩn cấp ngày, single-use, đối soát sau) HOẶC xóa. V4 chọn: **định nghĩa tối thiểu + giới hạn**. | Team muốn xóa hẳn offline-approve — phải chấp nhận quầy đứng im khi rớt mạng. |
| 6 | `PRAGMA journal_mode=WAL` áp cho cả D1 — D1 là managed, PRAGMA có thể bị ignore/lỗi | WAL/busy_timeout chỉ áp cho SQLite/LibSQL local. D1 dùng retry + batch, ghi rõ trong spec. | Team xác nhận D1 hỗ trợ PRAGMA — cho link docs. |
| 7 | Tên trạng thái loạn: V2 `INVALIDATED`, V3 `SUPERSEDED`, code mẫu không có | Chuẩn hóa 1 bộ duy nhất: `PENDING/APPROVED/REJECTED/EXPIRED/CONSUMED/SUPERSEDED`. Xóa `INVALIDATED`. | — |
| 8 | Thiếu định nghĩa ATP, thiếu reservation, thiếu sweeper TTL, thiếu breakdown thanh toán | Thêm công thức ATP, bảng `idempotency_keys`, sweeper lazy+cron, báo cáo tách Cash/QR. | Team có định nghĩa ATP khác đơn giản hơn — đề xuất. |

---

## 1. LỘ TRÌNH (LOCKED — 4 Sprint, 8–10.5 ngày)

```
S1 (2.5 ngày) Kho động + Batch Transfer (server-cấp PCK, dryRun, idempotency, draft-offline UUID)
  → S2 (2.5 ngày) POS cơ bản (khóa kho, lọc ATP>0, A-Z/Hot, CK lẻ)
  → S3 (3 ngày) Duyệt CK (1-chạm Web/Mobile + QR-JWT + mã khẩn cấp) + PXK (sequence trong tx + in window.print A4)
  → S4 (2 ngày) Chốt ngày (Cash/QR variance + kiểm kê kệ vs máy + drill)
```

> LOCKED theo Q7: S3 về đúng 3 ngày bằng 2 nhát cắt — (a) PXK in bằng HTML/CSS + `window.print()` + `@media print` A4, KHÔNG dùng PDF-lib; (b) hoãn TOTP app bên thứ 3 sang Pha 2, Sprint 3 chỉ làm 1-chạm + QR + mã khẩn cấp.

---

## 2. DATABASE (sửa bổ sung trên schema V3)

### 2.1 `warehouses` — giữ nguyên V3, thêm index + backfill bắt buộc

```sql
ALTER TABLE warehouses ADD COLUMN is_sellable_on_pos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouses ADD COLUMN warehouse_type TEXT NOT NULL DEFAULT 'PHYSICAL_MAIN';
CREATE INDEX IF NOT EXISTS idx_wh_sellable ON warehouses(is_active, is_sellable_on_pos);
-- MIGRATION BẮT BUỘC (V3 thiếu): với mỗi kho mới tạo, insert stock_balances cho mọi edition (qty 0).
-- Không có backfill → lọc ATP>0 crash / thiếu dòng.
```

### 2.2 `document_sequences` — giữ bảng, sửa cách dùng

```sql
-- Giữ nguyên DDL V3 (không sửa DB đã migrate), nhưng QUY TẮC SỬ DỤNG mới:
-- 1. getNextCode() BẮT BUỘC gọi trong cùng tx với INSERT phiếu (cùng commit/rollback).
--    Gọi riêng lẻ → rollback phiếu nhưng số đã tăng → nhảy số (đúng lỗi V3 muốn tránh).
-- 2. PCK dùng doc_type='PCK', PXK dùng 'PXK', REVERSAL dùng 'PXK_R' (namespace riêng,
--    tránh mã PXK-0005-REV phá vỡ tính liên tục của dãy PXK gốc).
```

### 2.3 `discount_approval_requests` — thêm 3 cột V3 thiếu

```sql
-- V3 thiếu: cart_snapshot (để đối chiếu khi tranh chấp), rejected_reason, version (optimistic lock).
ALTER TABLE discount_approval_requests ADD COLUMN cart_snapshot TEXT;      -- JSON canonical items
ALTER TABLE discount_approval_requests ADD COLUMN rejected_reason TEXT;
ALTER TABLE discount_approval_requests ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
-- Quy tắc chuyển trạng thái: UPDATE ... SET status=.., version=version+1
--   WHERE id=? AND version=? AND status='PENDING'  (approve/reject chỉ từ PENDING → idempotent)
```

### 2.4 Bảng mới bắt buộc: `idempotency_keys`

```sql
CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,          -- 'transfer-batch' | 'checkout' | 'pxk-create'
  response_json TEXT,           -- cache response lần đầu để trả lại khi retry
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
-- Mọi POST transfer-batch / checkout / pxk-create đều yêu cầu header Idempotency-Key (uuid-v7).
-- Retry trùng key → trả response cũ, không thực thi lại.
```

### 2.5 Công thức ATP — LOCKED theo Q5 (chia theo loại kho, YAGNI)

```
Tại Kho Hội Chợ (FAIR_EVENT):  ATP = physical_qty
  -- Sách đã ra gian hàng chỉ bán trực tiếp tại quầy. CẤM đơn online giữ chỗ ở kho hội chợ
  -- (enforce ở API giữ chỗ: fromWarehouse phải là PHYSICAL_MAIN, request kho FAIR → 422).
  -- Code nhẹ: không join bảng reservation, không sợ nghẽn quầy.

Tại Kho Chính (PHYSICAL_MAIN): ATP = physical_qty - reserved_online - pending_transfer_out
  -- reserved_online: đơn online giữ chỗ chưa thanh toán (TTL giữ chỗ 15 phút).
  -- Tránh lấy nhầm sách của khách online đem đi hội chợ.
POS lọc ATP > 0 (không phải physical > 0).
```

---

## 3. API TRANSFER-BATCH (fix lỗi retry + mã client-tự-đặt của V3)

```typescript
// V4: phân loại retry — ĐÂY LÀ FIX QUAN TRỌNG NHẤT
export async function withDbRetry<T>(fn: () => Promise<T>, opts = { max: 5, baseMs: 50 }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (e instanceof AppError) throw e;              // lỗi nghiệp vụ 4xx: KHÔNG retry (V3 retry nhầm chỗ này)
      if (!isTransientDbError(e) || attempt >= opts.max) throw e;  // chỉ retry SQLITE_BUSY/D1_BUSY/LOCKED
      await sleep(fullJitter(attempt, opts.baseMs));
    }
  }
}

// Endpoint validate riêng (dryRun) — nút "Kiểm tra tồn kho" gọi cái này, không gọi endpoint commit:
POST /api/inventory/transfer-batch/validate  { fromWarehouseId, items[] }
  → 200 { ok: true } | 409 { code:'TRANSFER_TOCTOU_ATP_STALE', data:{ staleItems[] } }

// Endpoint commit — server cấp PCK, client KHÔNG được tự đặt documentRef (bỏ field này so với V3):
POST /api/inventory/transfer-batch   Headers: Idempotency-Key: <uuid-v7>
  { fromWarehouseId, toWarehouseId, note, items[] }
  → chạy trong tx IMMEDIATE: re-validate ATP → getNextCode('PCK') trong cùng tx
     → insert TRANSFER_OUT/TRANSFER_IN → commit. Fail thì rollback cả số PCK.
```

---

## 4. DUYỆT CHIẾT KHẤU (fix crypto tự chế + QR trần của V3)

### 4.1 Canonical hash — thêm warehouse + order để khỏi đụng độ

```typescript
// V3 hash thiếu context → 2 đơn khác kho mà giỏ giống nhau cho cùng hash. V4 thêm vào:
tokens.push(`wh:${warehouseId}`, `ord:${orderCode}`, `rate:${Math.round(discountRate * 10000)}`);
```

### 4.2 QR có ký + bind ShortCode — LOCKED theo Q3 (TOTP hoãn Pha 2)

- **QR:** payload là JWT HS256 (secret server): `{ reqId, nonce, cartHash, exp: now+5m }`.
  Endpoint `POST /approve` verify chữ ký + `exp` + yêu cầu **session Manager** (cookie/token).
  QR bị chụp màn hình gửi ra ngoài cũng vô dụng nếu không có session Manager.
- **Luồng chính Sprint 3 (≤8s, dưới ngưỡng nghẽn 15s):** thu ngân báo đuôi đơn (vd `4821`) →
  quản lý mở app (đã đăng nhập session) thấy ngay đơn / gõ `4821` vào ô duyệt nhanh → bấm "Duyệt".
  Server check: session Manager hợp lệ + ShortCode khớp `orderCode` + request còn `PENDING` + `cartHash` khớp.
- **TOTP RFC6238 (HOÃN sang Pha 2 theo Q7):** Sprint 3 KHÔNG tích hợp app Authenticator.
  Chỉ bổ sung khi cần dùng thiết bị chung không session riêng.

### 4.3 `OFFLINE_EMERGENCY` — LOCKED theo Q2 (bắt buộc giữ + trần 25%)

```
- Mỗi sáng (mở ca), quản lý nhận 5 mã khẩn cấp single-use từ server (đã ký theo ngày + warehouse).
- TRẦN: mã khẩn cấp chỉ duyệt tối đa CK 25%. Vượt 25% → bắt buộc online (QR/1-chạm), không có ngoại lệ.
- Rớt mạng: quản lý đọc 1 mã cho thu ngân nhập → POS lưu đơn ở trạng thái APPROVED_OFFLINE_PENDING_SYNC.
- Có mạng lại: POS sync lên, server đối soát mã (đúng ngày + chưa dùng + đúng kho + trong trần) thì giữ, sai thì flag REVIEW.
- Hết ngày mã tự hết hạn. Dùng quá 5 mã/ngày → khóa, phải gọi điện cho owner.
```

### 4.4 Expiration — LOCKED theo Q6 (lazy-only, KHÔNG cron)

```
- KHÔNG dựng cron 1 phút (Vercel/Pages Free không hỗ trợ). Lazy expiration là cơ chế chính duy nhất.
- MỌI query đọc/ghi request duyệt BẮT BUỘC thêm điều kiện: status='PENDING' AND expires_at > CURRENT_TIMESTAMP.
  (Dashboard quản lý quên filter này sẽ hiện ma PENDING đã chết — review checklist Sprint 3 phải soát.)
- TTL 5 phút áp cho cả PENDING lẫn APPROVED chưa thanh toán: APPROVED quá hạn mà chưa CONSUMED → coi như EXPIRED, phải xin duyệt lại.
- Dọn rác: lệnh cleanup chạy khi mở ca + chốt ca (quét status IN (PENDING, APPROVED) AND expires_at<now → EXPIRED).
- Client polling backoff 2s→3s→5s, dừng sau TTL. (giữ nguyên V3)
- Thanh toán fail mà còn TTL + cartHash nguyên → giữ APPROVED, bấm lại được ngay. Đổi giỏ → cũ SUPERSEDED + sinh request mới.
```

---

## 5. PXK & REVERSAL (fix namespace + cùng-tx của V3)

```
- getNextCode('PXK'|'PCK'|'PXK_R') gọi TRONG CÙNG tx với insert phiếu (quy tắc mục 2.2).
- Reversal dùng namespace 'PXK_R' → mã PXK_R-2026-0001, field reversal_of trỏ PXK gốc.
  Dãy PXK gốc giữ liên tục, dãy REV có dãy riêng — kiểm toán đối chiếu 2 dãy.
- Lock: UPDATE delivery_orders SET status='DISPATCHED_LOCKED' chỉ từ 'DRAFT' (guard WHERE status='DRAFT').
  Original khi bị reverse → 'VOIDED_REVERSED'. Mọi sửa sau lock đều cấm ở app + audit log.
- SQLite local: tx IMMEDIATE + busy_timeout 10s. D1: KHÔNG dùng PRAGMA (managed) — chỉ dùng withDbRetry V4 + batch.
- IN ẤN (LOCKED theo Q7): PXK render HTML/CSS + `window.print()` với `@media print` khổ A4
  (đủ 4 chữ ký, QR xác thực mã phiếu). KHÔNG dùng PDF-lib ở Sprint 3. Xuất PDF/Excel sang Pha 2 nếu kế toán đòi.
```

---

## 6. BÁO CÁO CHỐT NGÀY (bổ sung breakdown V3 thiếu)

```
Giữ 3 mục V3 (két tiền variance, tồn kệ vs máy, chữ ký) + thêm bắt buộc:
4. Cơ cấu thanh toán: Cash / QR-Bank riêng (đối chiếu két vs sao kê).
5. Tổng chiết khấu đã cấp + list đơn duyệt đặc biệt (>20%).
6. Top sellers trong ngày theo kho (tái dùng aggregate S2).
7. Phân biệt ca (shift) vs ngày: mỗi ca có open/close riêng, hết ca bàn giao két ký xác nhận.
```

---

## 7. CÂU HỎI MỞ — ĐÃ KHÓA 7/7 (biên bản phản biện ngược, không còn điểm treo)

1. **Cấm client đặt PCK — ĐỒNG Ý 100%.** Bổ sung của tôi: cho phép tạo **draft offline bằng UUID local**, có mạng server mới cấp số PCK chính thức (kẻo kẹt khi cần lập phiếu trả hàng tại hội chợ). PCK là chứng từ nội bộ, không cần gap-free nghiêm như PXK.
2. **QR-JWT + mã khẩn cấp — ĐỒNG Ý.** JWT ~120 ký tự render <1ms, nghẽn là ở đường truyền chứ không phải QR. Đã khóa trần mã khẩn cấp 25% (mục 4.3).
3. **ShortCode + session ≤8s — ĐỒNG Ý.** Đã khóa: Sprint 3 chỉ cần session + ShortCode, TOTP hoãn Pha 2 (mục 4.2).
4. **Namespace PXK_R — ĐỒNG Ý, chốt luôn.**
5. **ATP chia theo kho — ĐỒNG Ý** (công thức mục 2.5) + enforce cấm giữ chỗ online ở kho hội chợ (422).
6. **Lazy-only, không cron — ĐỒNG Ý** (mục 4.4) + TTL áp cả APPROVED + cleanup khi mở/chốt ca.
7. **S3 về 3 ngày — ĐỒNG Ý** bằng 2 nhát cắt: window.print thay PDF-lib, hoãn TOTP (mục 1).

---
## 8. LỆNH XUẤT PHÁT SPRINT 1 (cho coder)

Phạm vi Sprint 1 (2.5 ngày, không hơn): migration `is_sellable_on_pos` + `warehouse_type` + backfill `stock_balances` + gỡ `SELLABLE_WAREHOUSE_IDS` + `POST /transfer-batch/validate` (dryRun) + `POST /transfer-batch` (server-cấp PCK trong cùng tx + `Idempotency-Key` + retry phân loại mục 3). Test bắt buộc: chuyển 40 dòng, 1 dòng thiếu → 409 `staleItems` → re-cap 1 chạm; double-click cùng key chỉ trừ kho 1 lần.

*V4.1 locked — coder thi công Sprint 1 ngay. Mọi thay đổi sau lock phải qua change-request, không sửa miệng.*
