-- 0032 dựng lại `stock_balances` và `order_items` nhưng BỎ SÓT `inventory_ledger`.
-- Hậu quả: `inventory_ledger.edition_id` VẪN NOT NULL + FK `editions(id)`, mà hàng
-- hóa không có dòng `editions` ⇒ `recordMovement` KHÔNG ghi được bút toán kho cho
-- hàng hóa ⇒ cả đơn bị rollback.
--
-- Bằng chứng: scripts/test-goods-sell-e2e.ts, probe thẳng:
--   edition_id = id hàng hóa  → SQLITE_CONSTRAINT_FOREIGNKEY
--   edition_id = NULL          → SQLITE_CONSTRAINT_NOTNULL
--
-- ⚠️ DDL BÊN DƯỚI LẤY NGUYÊN VĂN TỪ `sqlite_master` CỦA PRODUCTION, KHÔNG tự
-- viết. Lần đầu tôi tự viết theo bản `0000` và THIẾU `reversal_of`, đồng thời
-- tự cho `document_ref`/`actor_id` nullable ⇒ `no such column` và dữ liệu mất
-- ràng buộc. Đây đúng cái bài học trong AGENTS.md mục 6.
--
-- KHÁC VỚI 0032: `document_ref` và `actor_id` giữ nguyên NOT NULL. `recordMovement`
-- luôn truyền hai trường này, kể cả cho hàng hóa.
PRAGMA foreign_keys = off;
--> statement-breakpoint
CREATE TABLE `inventory_ledger__0033` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_id` text REFERENCES `editions`(`id`) ON UPDATE no action ON DELETE no action,
	`warehouse_id` text NOT NULL,
	`event_type` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`condition` text DEFAULT 'NEW',
	`document_ref` text NOT NULL,
	`note` text,
	`actor_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`recorded_at` text DEFAULT CURRENT_TIMESTAMP,
	`owner_id` text REFERENCES `partners`(`id`),
	`lot_id` text,
	`unit_cost_snapshot` real,
	`correlation_id` text,
	`reversal_of` text,
	`effective_at` text,
	`product_id` text NOT NULL REFERENCES `products`(`id`),
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `inventory_ledger__0033` (`id`, `edition_id`, `product_id`, `warehouse_id`, `event_type`, `quantity_delta`, `condition`, `document_ref`, `note`, `actor_id`, `idempotency_key`, `recorded_at`, `owner_id`, `lot_id`, `unit_cost_snapshot`, `correlation_id`, `reversal_of`, `effective_at`)
SELECT `id`, `edition_id`,
       COALESCE(`product_id`, `edition_id`),
       `warehouse_id`, `event_type`, `quantity_delta`, `condition`, `document_ref`,
       `note`, `actor_id`, `idempotency_key`, `recorded_at`, `owner_id`, `lot_id`,
       `unit_cost_snapshot`, `correlation_id`, `reversal_of`, `effective_at`
FROM `inventory_ledger`;
--> statement-breakpoint
DROP TABLE `inventory_ledger`;
--> statement-breakpoint
ALTER TABLE `inventory_ledger__0033` RENAME TO `inventory_ledger`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_ledger_idempotency_key_unique` ON `inventory_ledger` (`idempotency_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ledger_edition_warehouse` ON `inventory_ledger` (`edition_id`,`warehouse_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ledger_event_type` ON `inventory_ledger` (`event_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ledger_correlation_id` ON `inventory_ledger` (`correlation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ledger_product` ON `inventory_ledger` (`product_id`,`warehouse_id`,`condition`);
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;