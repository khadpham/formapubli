-- 0026: cho dismissal hết hạn.
-- 0025_notification_dismissals.sql tạo bảng với PK (actor_id, item_id) và KHÔNG có
-- expires_at → bấm "Xóa tất cả" là ẩn vĩnh viễn, yêu cầu duyệt PENDING không bao giờ
-- hiện lại. Dismissal chỉ là giảm ồn trên UI, không phải audit log, nên cho hạn 7 ngày.
-- Cột nullable + default NULL: dòng cũ (nếu có) được coi như "không hạn" → xem như chưa ẩn.
ALTER TABLE `notification_dismissals` ADD COLUMN `expires_at` text;
CREATE INDEX IF NOT EXISTS `idx_notif_dismiss_expires` ON `notification_dismissals` (`expires_at`);
