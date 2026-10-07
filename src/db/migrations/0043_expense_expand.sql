-- 0043: mở rộng chi phí GĐ2 — lương gắn nhân viên + kỳ định kỳ + audit sửa.
-- ALTER TABLE ADD COLUMN KHÔNG có IF NOT EXISTS trong SQLite: script áp tay
-- (apply-0043-prod.ts) kiểm cột trước khi chạy, đã có thì bỏ qua.
ALTER TABLE `expense_entries` ADD COLUMN `staff_id` text;
--> statement-breakpoint
ALTER TABLE `expense_entries` ADD COLUMN `recurrence` text NOT NULL DEFAULT 'ONE_TIME';
--> statement-breakpoint
ALTER TABLE `expense_entries` ADD COLUMN `updated_by` text;
--> statement-breakpoint
ALTER TABLE `expense_entries` ADD COLUMN `updated_at` text;
