# Quy Chuẩn Red-Team & Negative Testing (BẮT BUỘC — hiệu lực từ đợt vá security-patch-01, 09/2026)

> Bối cảnh: 23 suites xanh 100% nhưng bộ probes adversarial vẫn khui ra 9 lỗ hổng P0/P1 + 1 bug bundle.
> Nguyên nhân gốc không phải thiếu test, mà là thiếu **đúng loại test**.
> File này là luật. Mọi PR đụng tiền/kho/quyền mà vi phạm sẽ bị từ chối merge.

---

## 1. Bốn bài học trả học phí (không được quên)

1. **Test "đường ngay" không bắt được kẻ gian.** 23 suites chỉ assert hành vi đúng
   (bán 2 trừ 2, ledger cân). Chưa từng thử input ác ý: giá 1đ, số lẻ 1.5 cuốn,
   chiết khấu 200%, trả gấp đôi số đã bán.
2. **Guard đặt sai tầng = không có guard.** Trần chiết khấu/giá bìa nằm ở API route,
   còn service (tầng dưới) tin tất cả → gọi trực tiếp service là bypass.
   **Validate ở tầng sâu nhất, API chỉ là lớp phụ.**
3. **Lỗ hổng nằm ở khe nối module.** Gift→forecast, refund→két ca, TAX→shipments:
   từng module đúng, tương tác chéo sai. Tính năng mới đọc/ghi dữ liệu tính năng
   cũ mà không có test chéo là nợ bảo mật.
4. **Người xây không tự review được mình.** Red-team/probes là khâu bắt buộc,
   không phải optional. Không đổ lỗi — nhận và vá, rồi khóa bằng test.

---

## 2. Năm quy tắc bắt buộc

### R1. Negative test cho mọi PR đụng tiền / kho / quyền
Các bảng `orders`, `inventory_ledger`, `stock_balances`, discount, refund, két ca,
quỹ tài trợ, shipments: mỗi PR phải kèm ít nhất các case phá hoại:
giá lậu từ client, số lượng lẻ/âm/0, chiết khấu vượt trần/âm,
số lượng vượt tồn, sai vai trò (cashier/TAX làm việc của manager),
gửi trùng idempotency key, thao tác trên đơn sai trạng thái (PENDING/CANCELLED).

### R2. Không tin client ở quyết định tiền / giá / tồn
Giá bìa, chiết khấu, số lượng, tồn kho: service tự tra DB và tự validate
(khoảng giá trị, số nguyên, trần trần). Field client gửi cho các quyết định này
phải bị strip hoặc lờ ở API route **và** validate lại ở service.
Ngoại lệ duy nhất cần phê duyệt ghi danh (ví dụ đơn tặng `discount == 1` + cờ `isGift`).

### R3. Test ma trận tương tác chéo
Khi tính năng mới sinh/đọc dữ liệu của tính năng cũ, bắt buộc test qua khe nối.
Ma trận tối thiểu hiện tại (mở rộng dần):

| Tính năng mới | Phải check không phá |
|---|---|
| Đơn tặng / SPONSORSHIP (final 0đ) | Forecast velocity, báo cáo doanh số, két ca |
| Hoàn tiền (refund) | `expectedCash` chốt ca, doanh thu ròng |
| Trạng thái vận chuyển / webhook | Tuyệt đối không sinh bút toán kho |
| Đơn PENDING / giữ chỗ ATP | Không ledger, summary loại pending, TTL nhả chỗ |
| Phiếu trả / RMA / VOID | Guard lũy kế ≤ đã bán, chỉ đơn COMPLETED, đảo bằng bút toán (không xóa) |

### R4. Endpoint đọc mới phải có test phân quyền
Mọi GET/list mới mặc định viết test: TAX chỉ thấy `OFFICIAL_TAX`,
cashier/warehouse bị giới hạn đúng scope. Không có test scope = chưa xong.

### R5. Gate red-team trước merge nhạy cảm
PR đụng 4 nhóm (tiền, kho, quyền, đối soát) phải chạy bộ probes tương đương
trên DB review dùng một lần, lưu output JSON làm bằng chứng.
Thư mục `review.tmp/` (đang ignore) là nơi chứa probes + baseline + output.

---

## 3. Definition of Done — copy vào PR

```text
- [ ] Negative tests (R1) cho mọi input tiền/giá/tồn/quyền mới
- [ ] Validate tầng service, không tin client (R2)
- [ ] Test tương tác chéo theo ma trận R3 (ghi rõ đã chạy cặp nào)
- [ ] Test phân quyền role cho endpoint đọc mới (R4)
- [ ] Probes red-team chạy xanh trên DB review + output đính kèm (R5)
- [ ] test:isolated PASS, build 0 lỗi, prod DB nguyên vẹn
```

## 4. Sổ lỗi đã trả học phí (cập nhật mỗi đợt vá)

| Mã | Lỗi | Sửa ở | Suite hồi quy |
|---|---|---|---|
| FIX-01 | Cashier set giá 1đ | `order.service` tra giá DB + API strip | `test-order-guards` #1–2 |
| FIX-02 | Số lượng lẻ 1.5 | `Number.isInteger` items/bundles | `test-order-guards` #3 |
| FIX-03 | CK dòng 200% → tiền âm | Validate 0–1 tầng service | `test-order-guards` #4 |
| FIX-04 | 2 dòng trùng edition lách guard trả | Cộng dồn trong-request | `test-returns` (team bổ sung) |
| FIX-05 | Trả hàng trên đơn PENDING | Bắt `COMPLETED` | `test-returns` (team bổ sung) |
| FIX-06 | TAX đọc shipment nội bộ | Lọc `fiscalScope` ở GET | `test-shipments` (team bổ sung) |
| FIX-07 | RMA ghi dở (ticket mồ côi) | Validate + 1 transaction | `test` RMA (team bổ sung) |
| FIX-08 | Gift phình forecast/EOQ | Loại gift/sponsorship khỏi velocity | `test-order-guards` #5 |
| FIX-09 | Két ca ngó lơ refund | Trừ refund COMPLETED cùng ca | `test-order-guards` #6 |
| FIX-10 | Bundle req>1 tính lố tổng | Tổng dòng thay vì đơn giá | `test-order-guards` #7 |
