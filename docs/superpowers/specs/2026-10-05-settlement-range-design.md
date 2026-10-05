# Báo cáo kỳ: ngàytùy chọn + preset + cả chiến dịch

Ngày: 2026-10-05. Nguồn: yêu cầu chủ doanh nghiệp (kho hội chợ = chiến dịch có
kỳ; kho vật lý cần dải N ngày tùy nhập; màn hình và in cùng số).

## 1. Nguyên tắc

- SSOT: MỘT hàm gom kỳ trong `daily-settlement.service.ts`; modal màn hình,
  bản in, dashboard đọc chung. Không gom riêng ở client.
- Báo cáo ngày hiện tại GIỮ NGUYÊN hành vi (đường chốt sổ + in đã kiểm toán);
  refactor nội bộ dùng chung helper gom, khóa bằng suite settlement hiện có.
- Không migration, không bảng mới, không config server.

## 2. Phạm vi kỳ

- Ô từ ngày–đến ngày (tối đa 3 tháng) + preset: 1 tuần, 2 tuần, 1 tháng,
  3 tháng + "Cả chiến dịch" (chỉ kho FAIR_EVENT: min/max ngày có đơn COMPLETED
  tại kho đó, suy từ dữ liệu).
- 1 request duy nhất cho mọi kỳ (không fetch N ngày ở client).

## 3. Ngữ nghĩa gom (một nơi)

- Tiền/kênh/chiết khấu/top bán chạy: quét đơn COMPLETED trong kỳ, cùng helper
  bucket với báo cáo ngày (đơn vị ngày thay vì giờ trên trục).
- Tồn kho: cuối kỳ = phát lại sổ cái tới hết ngày cuối (đắt) → CHỐT: hiện tồn
  HIỆN TẠI + nhãn rõ "tồn hiện tại, không phải tồn cuối kỳ". Kỳ đang diễn ra
  thì hai cái bằng nhau.
- Két: mở đầu kỳ → đóng cuối kỳ; kỳ quá khứ không còn ca mở thì hiện tiền
  bàn giao cuối kỳ + ghi rõ.
- Đơn chờ: ảnh cuối kỳ + nhãn rõ (không cộng dồn qua ngày).
- Đơn PENDING chốt sau: tính vào kỳ chứa ngày chốt (đã đúng sẵn).

## 4. UI

- Modal Báo Cáo Ngày: thêm chế độ Ngày/Kỳ (toggle), giữ nguyên tab + bản in.
- Bản in kỳ: trục X theo ngày, top cả kỳ, mục két/tồn theo §3, tiêu đề ghi rõ kỳ.
- Dashboard: không đổi (biểu đồ 7 ngày/giờ giữ nguyên).

## 5. Kiểm thử

- Suite mới `test-settlement-range.ts`: kỳ 1 ngày == báo cáo ngày hiện tại
  (đồng nhất số); kỳ N ngày = tổng tay N ngày; tồn quá khứ nhãn đúng; trần
  3 tháng bị từ chối lịch sự.
- Chạy lại toàn bộ suite settlement + print hiện có.
