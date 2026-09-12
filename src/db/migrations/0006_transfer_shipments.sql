CREATE TABLE `transfer_shipment_items` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`edition_id` text NOT NULL,
	`dispatched_qty` integer NOT NULL,
	`received_qty` integer,
	`damaged_qty` integer,
	`lost_qty` integer,
	`notes` text,
	FOREIGN KEY (`shipment_id`) REFERENCES `transfer_shipments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edition_id`) REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `transfer_shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`from_warehouse_id` text NOT NULL,
	`to_warehouse_id` text NOT NULL,
	`dispatcher_id` text NOT NULL,
	`receiver_id` text,
	`status` text DEFAULT 'IN_TRANSIT' NOT NULL,
	`vehicle_info` text,
	`notes` text,
	`dispatched_at` text DEFAULT CURRENT_TIMESTAMP,
	`received_at` text,
	FOREIGN KEY (`from_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_transfer_ship_item_shipment` ON `transfer_shipment_items` (`shipment_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_ship_item_edition` ON `transfer_shipment_items` (`edition_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_ship_status` ON `transfer_shipments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_transfer_ship_from` ON `transfer_shipments` (`from_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_ship_to` ON `transfer_shipments` (`to_warehouse_id`);--> statement-breakpoint
CREATE INDEX `idx_transfer_ship_dispatched_at` ON `transfer_shipments` (`dispatched_at`);
