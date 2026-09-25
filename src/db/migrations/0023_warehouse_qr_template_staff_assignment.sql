ALTER TABLE `warehouses` ADD COLUMN `qr_transfer_template` text;
--> statement-breakpoint
ALTER TABLE `staff_accounts` ADD COLUMN `assigned_warehouse_id` text REFERENCES `warehouses`(`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_staff_assigned_warehouse` ON `staff_accounts` (`assigned_warehouse_id`);
--> statement-breakpoint
