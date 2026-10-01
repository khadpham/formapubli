-- 0034: phạm vi kho cho chương trình khuyến mại.
--
-- Trước đây `promotions` không có khái niệm kho: chiến dịch bật là chạy MỌI
-- kho, màn hình cài đặt cũng không có chỗ chọn. Chủ cần mốc riêng từng hội
-- chợ (vd chỉ Hồ Gươm tặng, ĐH Hà Nội không).
--
-- `warehouse_id` NULL = áp dụng MỌI kho (giữ nguyên hành vi cũ cho mọi chiến
-- dịch đã có). Có giá trị = chỉ kho đó. Chỉ ADD COLUMN nullable nên an toàn
-- tuyệt đối, không đụng dữ liệu cũ.
PRAGMA foreign_keys = off;
--> statement-breakpoint
ALTER TABLE `promotions` ADD COLUMN `warehouse_id` text REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action;
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
