ALTER TABLE `order_items` ADD `bundle_id` text REFERENCES seasonal_bundles(id);--> statement-breakpoint
ALTER TABLE `order_items` ADD `bundle_qty` integer;--> statement-breakpoint
CREATE INDEX `idx_order_items_bundle_id` ON `order_items` (`bundle_id`);
