CREATE TABLE `bundle_items` (
	`id` text PRIMARY KEY NOT NULL,
	`bundle_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`quantity_in_bundle` integer DEFAULT 1,
	`is_mandatory` integer DEFAULT true,
	FOREIGN KEY (`bundle_id`) REFERENCES `seasonal_bundles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_owned_books` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`order_ref` text,
	`acquired_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customer_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_code` text NOT NULL,
	`customer_id` text NOT NULL,
	`bundle_id` text NOT NULL,
	`subscription_type` text NOT NULL,
	`total_amount` real NOT NULL,
	`payment_status` text DEFAULT 'PENDING',
	`fulfillment_status` text DEFAULT 'UNFULFILLED',
	`destination_warehouse_id` text,
	`shipping_fee` real DEFAULT 0,
	`carrier_tracking_code` text,
	`hold_until_season` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bundle_id`) REFERENCES `seasonal_bundles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destination_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`email` text,
	`channel` text DEFAULT 'FACEBOOK',
	`channel_url` text,
	`segment` text DEFAULT 'RETAIL',
	`address_province` text,
	`address_district` text,
	`address_ward` text,
	`address_detail` text,
	`shipping_note` text,
	`total_spent` real DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `editions` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`isbn` text NOT NULL,
	`isbn_last4` text NOT NULL,
	`edition_number` integer DEFAULT 1,
	`cover_price` real NOT NULL,
	`vat_rate` real DEFAULT 0.05,
	`format_size` text,
	`pages` integer,
	`publication_year` integer,
	`suggested_location` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`work_id`) REFERENCES `works`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`event_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`condition` text DEFAULT 'NEW',
	`document_ref` text NOT NULL,
	`note` text,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`recorded_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`contact_info` text,
	`discount_rate` real DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `seasonal_bundles` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`season_name` text NOT NULL,
	`release_date` text NOT NULL,
	`combo_price` real NOT NULL,
	`total_cover_price` real NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `stock_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`condition` text DEFAULT 'NEW',
	`physical_quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `works` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`original_title` text,
	`author` text NOT NULL,
	`translator` text,
	`category` text,
	`short_code` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_customer_edition` ON `customer_owned_books` (`customer_id`,`edition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_subscriptions_subscription_code_unique` ON `customer_subscriptions` (`subscription_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `customers_code_unique` ON `customers` (`code`);--> statement-breakpoint
CREATE INDEX `idx_customers_phone` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_customers_full_name` ON `customers` (`full_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `editions_isbn_unique` ON `editions` (`isbn`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_editions_isbn` ON `editions` (`isbn`);--> statement-breakpoint
CREATE INDEX `idx_editions_isbn_last4` ON `editions` (`isbn_last4`);--> statement-breakpoint
CREATE INDEX `idx_editions_work_id` ON `editions` (`work_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_ledger_idempotency_key_unique` ON `inventory_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_ledger_edition_warehouse` ON `inventory_ledger` (`edition_id`,`warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_ledger_event_type` ON `inventory_ledger` (`event_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ledger_idempotency` ON `inventory_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `partners_code_unique` ON `partners` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `seasonal_bundles_code_unique` ON `seasonal_bundles` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_stock_bucket` ON `stock_balances` (`edition_id`,`warehouse_id`,`condition`);--> statement-breakpoint
CREATE UNIQUE INDEX `warehouses_code_unique` ON `warehouses` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `works_code_unique` ON `works` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_works_code` ON `works` (`code`);--> statement-breakpoint
CREATE INDEX `idx_works_short_code` ON `works` (`short_code`);