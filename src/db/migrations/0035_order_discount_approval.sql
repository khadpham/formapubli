-- 0035: đường nối phê duyệt chiết khấu ↔ đơn hàng.
--
-- VÌ SAO: `discount_approval_requests.order_code` do MÁY thu ngân sinh (29 ký
-- tự dạng `ORD-20261002-BFC3DCBC00CB7738`) còn `orders.order_code` do SERVER cấp
-- (13 ký tự dạng `ORD2609290001`). Hai bảng không bao giờ trùng mã nên không có
-- đường nối nào giữa "yêu cầu đã duyệt" và "đơn đã bán" — báo cáo đối soát ca buộc
-- phải suy từ mã, thành gắn nhầm mọi đơn vượt trần thành "quản lý duyệt tại
-- quầy", và không dựng lại được lịch sử sau sự cố.
--
-- THAY ĐỔI: thêm cột nullable + index. NULL cho mọi đơn cũ (đã bán không cần duyệt
-- chiết khấu thì không có yêu cầu nào để nối), nên ADD COLUMN nullable là an toàn
-- tuyệt đối: không đụng dữ liệu cũ, không cần backfill, không khóa bảng ghi.
--
-- KHÔNG thêm FOREIGN KEY: đây là bảng log chống gian lận, đơn hàng phải sống
-- lâu hơn mọi quy trình duyệt; siết FK ở đây chỉ để đổi lấy ràng buộc không dùng.
--
-- Phần 2: `discount_approval_requests.client_order_code` — mã phiếu tạm do máy
-- thu ngân sinh, trước đây nằm nhầm trong `order_code`. Cần cột riêng vì mã đơn
-- thật (server cấp) phải chiếm `order_code`: đó là mã thu ngân đọc cho quản lý
-- và mà báo cáo đối soát ca nối, còn mã phiếu tạm chỉ là khoá nhận diện phiên.
PRAGMA foreign_keys = off;
--> statement-breakpoint
ALTER TABLE `orders` ADD COLUMN `discount_approval_id` text;
--> statement-breakpoint
CREATE INDEX `idx_orders_discount_approval` ON `orders` (`discount_approval_id`);
--> statement-breakpoint
ALTER TABLE `discount_approval_requests` ADD COLUMN `client_order_code` text;
--> statement-breakpoint
-- KHÔNG backfill `client_order_code` cho dữ liệu cũ: mã cũ đã chính là mã đơn thật
-- của đơn đó, nên để NULL là đúng. Backfill bằng chính `order_code` cũ sẽ làm cột
-- này thành lỗi âm thầm — mọi truy vấn sau đó phải chịu hai nghĩa.
CREATE INDEX `idx_disc_appr_client_order` ON `discount_approval_requests` (`client_order_code`);
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;