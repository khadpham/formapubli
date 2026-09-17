ALTER TABLE `transfer_shipments` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `transfer_shipments` ADD `fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transfer_ship_idempotency` ON `transfer_shipments` (`idempotency_key`);--> statement-breakpoint
ALTER TABLE `return_orders` ADD `fingerprint` text;--> statement-breakpoint
ALTER TABLE `return_order_items` ADD `order_item_id` text REFERENCES `order_items`(`id`);--> statement-breakpoint
CREATE INDEX `idx_return_items_order_item` ON `return_order_items` (`order_item_id`);--> statement-breakpoint
ALTER TABLE `rma_tickets` ADD `transfer_shipment_id` text REFERENCES `transfer_shipments`(`id`);--> statement-breakpoint
CREATE INDEX `idx_rma_transfer_shipment` ON `rma_tickets` (`transfer_shipment_id`);--> statement-breakpoint
CREATE TABLE `transfer_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`resulting_status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`shipment_id`) REFERENCES `transfer_shipments`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_transfer_actions_shipment` ON `transfer_actions` (`shipment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_transfer_actions_idempotency` ON `transfer_actions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `return_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`resulting_status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`return_id`) REFERENCES `return_orders`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `idx_return_actions_return` ON `return_actions` (`return_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_return_actions_idempotency` ON `return_actions` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `exchange_replacement_items` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`return_id`) REFERENCES `return_orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `idx_exchange_rep_return` ON `exchange_replacement_items` (`return_id`);--> statement-breakpoint
CREATE INDEX `idx_exchange_rep_edition` ON `exchange_replacement_items` (`edition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_exchange_rep_unique` ON `exchange_replacement_items` (`return_id`, `edition_id`);
