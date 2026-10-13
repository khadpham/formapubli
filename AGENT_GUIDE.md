# HƯỚNG DẪN CHO CODING AGENT (đọc trước khi làm bất kỳ việc gì)

## Quy trình bắt buộc

1. **Đọc docs trước khi code.** Trước khi nhận nhiệm vụ mới, đọc các tài liệu sau trên nhánh `dev`:
   - `FORMAPUBLI_MASTER_BLUEPRINT.md` - kiến trúc tổng thể, đặc biệt các mục mới nhất ở cuối file (mục 23.x về dự án xuất bản, các cập nhật ngày gần nhất)
   - `AGENT_GUIDE.md` (file này) - quy trình làm việc

2. **Làm việc trên nhánh `dev`.** Không bao giờ push trực tiếp `main`. Không tạo nhánh dev mới - nhánh dev đã có sẵn trên GitHub.

3. **Môi trường dev độc lập.** Code trên dev không ảnh hưởng production. Database dev là SQLite local. Test trên `https://dev.formapubli.vn` trước khi báo xong.

4. **Không tạo PR từ dev lên main** khi dev còn việc chưa test. Tách từng phần nhỏ đã test xong ra PR riêng.

## Quy tắc tuyệt đối

- Không dùng dấu gạch ngang dài (— hoặc –). Chỉ dùng "-".
- Mọi thời gian dùng múi giờ Asia/Ho_Chi_Minh (UTC+7).
- Không sửa production DB trực tiếp.
- Chạy `npx tsc --noEmit` phải pass trước khi commit.
- Nếu phát hiện yêu cầu mâu thuẫn với blueprint, nêu trong PR description, không tự quyết.

## Khi nhận brief mới

Brief từ anh Kha luôn đầy đủ context. Đọc kỹ toàn bộ brief, đối chiếu với blueprint, rồi mới bắt đầu. Nếu có điểm chưa rõ, hỏi lại trước khi code.
