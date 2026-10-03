-- 0037: danh sách kho POS được phép theo tài khoản (JSON array id, trống = mọi kho)
PRAGMA foreign_keys = off;
--> statement-breakpoint
ALTER TABLE `staff_accounts` ADD COLUMN `allowed_warehouse_ids` text DEFAULT '[]';
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
