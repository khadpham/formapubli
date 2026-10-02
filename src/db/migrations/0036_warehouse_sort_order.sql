-- 0036: thứ tự sắp xếp kho hiển thị trên POS và quản trị kho vận
PRAGMA foreign_keys = off;
--> statement-breakpoint
ALTER TABLE `warehouses` ADD COLUMN `sort_order` integer DEFAULT 0;
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
