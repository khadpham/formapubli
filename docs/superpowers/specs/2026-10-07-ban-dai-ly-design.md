# Bán đại lý — Design (xuất bán + ký gửi + phiếu PXK)

Ngày: 2026-10-07. Nền: `main` đã lên Next 16.3.8 + React 19 (xong spike
`spike/next16`, đã merge). Quy ước: gọi là **bán đại lý** (không dùng
"bán buôn/bán sỉ/wholesale" trong UI mới).

## 1. Mục tiêu + phạm vi (5 mảng, không thêm)

1. DB đối tác từ `thong tin dai ly.csv` — chỉ lấy cột C/D/E/G (Type, Đại Lý,
   Thông tin công ty, % ck). Bỏ cột H và dòng tổng. Chừa chỗ cho DB customer sau.
2. Xuất bán ở tab Kho: chọn Xuất bán → dropdown đại lý → dán 2 cột (tên + SL)
   → kiểm tra tồn → in nháp → xác nhận trừ kho.
3. Bán đứt vào doanh thu kênh bán đại lý. Ký gửi gửi hàng KHÔNG ghi doanh thu.
4. Báo bán ký gửi bằng dán nhanh + đối soát kỳ + thu tiền nhiều lần.
5. Kho đối tác là view tính (không tạo kho mới, giữ kho ảo `wh-consign-*`).

## 2. Hai luật sắt (chống xung đột với code hiện tại)

1. **PXK (`delivery_orders`) là cửa duy nhất của bán đại lý.** Ngừng tạo
   `orders` kênh `WHOLESALE_PARTNER` mới; đơn cũ giữ nguyên để đọc.
   Lý do: hai cửa ghi sổ song song = trùng tồn + lệch báo cáo (đã kiểm
   `order.service.ts:33` và `delivery-order.service.ts:52`).
2. **Phiếu `DRAFT` in thoải mái; chỉ `DISPATCHED_LOCKED` mới trừ kho
   (`DISPATCH_SALE`) + vào doanh thu.** In không lock.

## 3. Hiện trạng (đã kiểm trong code, không đoán)

- `partners` (`schema.ts:141`): `code, name, type
  [CONSIGNMENT|WHOLESALE|PRINTER|LIBRARY|INTERNAL], contactInfo,
  discountRate` — thiếu địa chỉ/SĐT/MST/người nhận.
- `customers` (`schema.ts:152`) đã tồn tại riêng — không gộp.
- `delivery_orders` + items (`schema.ts:803`): `code PXK-YYYY-XXXX`,
  `fiscalScope [COMMERCIAL_WHOLESALE|CONSIGNMENT_DISPATCH]`,
  `status [DRAFT|DISPATCHED_LOCKED|VOIDED_REVERSED]` + service
  `createDraft/dispatchAndLock/reverse` (test xanh `test-s3-delivery-orders`).
- Ký gửi: khung đủ 14 hàm `ConsignmentService` + API `/api/consignments` +
  `ConsignmentPanel` (mới xem kỳ + thu tiền, chưa có gửi/nhận/báo bán nhanh).
- Dán 2 cột: `BatchTransferModal.tsx:99` + `batch-paste-parser` (mặc định
  thiếu SL = 5) — tái dùng nguyên.
- In: `WholesaleDispatchModal.tsx` + `DeliveryReceiptPrint` (HTML) đã có.
- Lỗ hổng: `AnalyticsService.byChannel` chỉ đọc `orders` → PXK bán ra mà
  báo cáo vẫn 0đ nếu không sửa.

## 4. DB: mở rộng `partners` (migration, không bảng mới)

Thêm nullable, additive-only: `address`, `phone`, `email`, `taxCode`,
`receiverName`, `shipNote`. `type` giữ nguyên enum; `discountRate` giữ
mặc định theo hợp đồng (cho sửa tay từng phiếu).

Map CSV (`thong tin dai ly.csv`, UTF-8, bỏ dòng tổng + ô multi-line):

| CSV | partners | Ghi chú |
|---|---|---|
| C `Type` | `type` | Ký gửi→CONSIGNMENT, Bán đứt→WHOLESALE |
| D `Đại Lý` | `name` | `code` sinh từ tên (slug + chống trùng) |
| E `Thông tin công ty` | `taxCode/phone/email/address` | Tách bằng regex `Tên DN/MST/Địa chỉ/Điện thoại/Email` |
| G `% ck` | `discountRate` | Số → /100 (30 → 0.30) |

## 5. Luồng xuất bán (tab Kho → nút Xuất bán)

1. Dropdown đại lý (tìm kiếm TV không dấu) → tự đổ chiết khấu + địa chỉ
   nhận, cho sửa tay từng phiếu.
2. Thêm dòng: tái dùng paste parser (Tên + SL) + tìm kiếm thêm tay.
3. Kiểm tra tồn 2 lớp: cảnh báo mềm tự chạy khi dán + nút cứng
   "Kiểm tra tồn kho" (ATP theo kho xuất) trước khi in.
4. Nút "In phiếu nháp" (HTML, xem §7) ở mọi trạng thái `DRAFT`.
5. Nút "Xác nhận xuất kho": kiểm ATP lần cuối + `dispatchAndLock`
   (cấp mã `PXK-YYYY-XXXX` liên tục, `Idempotency-Key` bắt buộc) →
   `DISPATCHED_LOCKED`, trừ `stock_balances`, ghi `DISPATCH_SALE`.
6. Hủy sau xuất: `reverse` sinh `PXK_R` (đã có service, thêm UI).

## 6. Luồng ký gửi (tab Đối tác/Đại lý)

1. Gửi hàng: ghi nhận XUẤT một lần duy nhất vào kho ảo `wh-consign-*`
   của đại lý (nối PXK `CONSIGNMENT_DISPATCH` với `sendToConsignment` có sẵn
   ở plan — cấm ghi 2 bút toán cho cùng 1 lần giao). Không doanh thu,
   không công nợ lúc gửi.
2. Báo bán: dán Tên + SL đã bán → `recordSale` từng dòng
   (`CONSIGNMENT_SOLD`, trừ tồn quầy). Engine tính
   `sold × giá bìa × (1 − CK)` đúng công thức chốt.
3. Cuối kỳ: `createStatement` (DRAFT) → đối chiếu → `confirm`
   (khóa sổ + snapshot AR `totalReceivable`).
4. Thu tiền: `consignment_payments` nhiều lần/kỳ (CASH/BANK_TRANSFER +
   mã bill bắt buộc), hủy bằng VOID có lý do. Thu tiền chỉ trừ nợ,
   không chạm doanh thu lần 2.
5. Kho đối tác (view, không kho mới): đã nhập = SUM PXK đã khóa;
   đã bán = SUM `reportedSold`; tồn = nhập − bán − trả; kèm tốc độ
   bán (cuốn/ngày) + ngày tồn còn lại + AR theo tuổi.

## 7. Phiếu in (học layout mẫu Đông Tây, gọn như vậy)

Khung HTML (mở rộng `DeliveryReceiptPrint`, bỏ hẳn `.docx`):
- Header 3 khối: bên giao FORMApubli (+MST/địa chỉ) + mã phiếu + ngày/
  người lập; bên nhận = đại lý + địa chỉ gửi sách + SĐT.
- Bảng: Tên, Giá bìa, CK%, Giá sau CK, Số lượng, Thành tiền
  (làm tròn VND, không lẻ đồng; ký gửi thay cột tiền bằng giá bìa
  tham khảo).
- Chân: tổng tiền + chữ ký (giao/nhận/kho) + QR tra cứu mã phiếu.
  Không in URL nội bộ, không nút Export.

## 8. Doanh thu & báo cáo (sửa, không đập)

- `byChannel`/`cashflow`: UNION `orders COMPLETED` + PXK
  `DISPATCHED` (`COMMERCIAL_WHOLESALE` → kênh bán đại lý).
- Ký gửi chỉ ghi nhận khi kỳ `CONFIRMED` (số AR), tách dòng với bán đứt.
- Map `fiscalScope` PXK ↔ `orders` trước khi code (enum lệch nhau).
- Guard: không sinh `orders` sỉ song song với PXK (luật sắt §2.1).

## 9. Todo list (theo phase, mỗi phase nghiệm thu riêng)

- [ ] P0: duyệt spec này → viết plan (`writing-plans`).
- [ ] P1: migration mở rộng `partners` + script import CSV (C/D/E/G,
  bỏ dòng tổng + cột H) + test round-trip.
- [ ] P2: modal Xuất bán ở tab Kho (§5.1–5.3: dropdown + dán + kiểm tồn).
- [ ] P3: in nháp + xác nhận khóa sổ + hủy đảo (§5.4–5.6, §7).
- [ ] P4: báo bán nhanh + đối soát kỳ + thu tiền (§6.2–6.4).
- [ ] P5: kho đối tác view + analytics UNION (§6.5, §8).
- [ ] P6: full suite + preview + demo trên điện thoại (dev:https).

## 10. Rủi ro + câu hỏi mở

1. Cột H (`Tiền về TK nào?`, giá trị `₫/CT`) đã bỏ theo chốt — nếu sau cần
   tách tiền mặt/chuyển khoản theo đại lý thì thêm sau, không sửa P1.
2. `discountRate` CSV là số nguyên phần trăm — import chia 100, cho sửa
   tay từng phiếu (hợp đồng có ngoại lệ).
3. Tên đại lý trùng sau slug → `code` thêm hậu tố số, báo lại danh sách.
4. `dev:https` + cert LAN khi demo điện thoại (quy trình cũ trong AGENTS.md).
