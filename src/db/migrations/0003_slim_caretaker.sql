ALTER TABLE `inventory_ledger` ADD `owner_id` text REFERENCES partners(id);--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD `lot_id` text;--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD `unit_cost_snapshot` real;--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD `correlation_id` text;--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD `reversal_of` text;--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD `effective_at` text;--> statement-breakpoint
CREATE INDEX `idx_ledger_correlation_id` ON `inventory_ledger` (`correlation_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/