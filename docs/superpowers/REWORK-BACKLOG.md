# BACKLOG làm lại toàn bộ (chủ đã chốt hướng, 05/10/2026)

> Danh sách nhắc việc — bàn luận, phân tích, thảo luận lại từng mục rồi mới làm.
> Không tự ý triển khai khi chưa có spec + duyệt từng mục.

1. **Tab Doanh thu (Doanh Số & Sổ Kép)** — còn nhiều chỉnh sửa (chủ sẽ nói cụ thể
   sau). Đã làm: sort + overlay + CSV 4 bảng, Top 100, nút Báo Cáo.
2. **Tab Phân tích ( studio)** — rà soát lại toàn bộ.
3. **Tab Chủ (Owner)** — rà soát lại toàn bộ.
4. **AI Copilot** — rà soát lại toàn bộ.
5. **Tab Kho hàng riêng cho Thủ kho Shopee** — kho Shopee là luồng riêng
   (đóng gói/đối soát sàn), cần view riêng cho vai trò thủ kho.
6. **Phân quyền lại Quản lý / Chủ / etc.** — rà soát ma trận quyền toàn app.
   - CHỐT 05/10: Quản lý giữ sự kiện đang diễn ra (xem ngày + Trạng Thái Hội
     Chợ); nút Kỳ ẩn hẳn với Quản lý, API Kỳ chỉ Chủ. ĐÃ LÀM.
7. **Tab Chủ — chi phí**: CHỜ chủ xác nhận thông tin, TẠM BỎ QUA. Ghi chú đây
   là hạng mục sẽ xử lý (tiền két, đối soát, lợi nhuận sau chi phí?).
7. **Quà trong số cuốn** (đã báo 04/10): `itemQty` gồm dòng quà → số cuốn 7 ngày
   + KPI phình; Top bán chạy thì loại quà. Chờ chốt có trừ không.
8. **Mã thanh toán cũ `TRANSFER`** — đơn cũ rơi vào nhóm nào? Cần 1 câu SQL đếm.
9. **Reviewer findings còn tồn** (Important I2, I4–I13 + Minor, đợt sales/range):
   két kỳ vs ngày, sort reset khi overlay, CSV chưa theo sort, ... — chờ chốt.
