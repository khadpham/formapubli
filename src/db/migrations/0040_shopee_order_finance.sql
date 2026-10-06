-- 0040: đối soát tài chính đơn Shopee (escrow từng hào + lãi ròng cho tab Chủ).
PRAGMA foreign_keys = off;
--> statement-breakpoint
CREATE TABLE `shopee_order_finance` (
  `order_sn` text PRIMARY KEY,
  `buyer_total` real NOT NULL DEFAULT 0,
  `escrow_amount` real NOT NULL DEFAULT 0,
  `commission_fee` real NOT NULL DEFAULT 0,
  `transaction_fee` real NOT NULL DEFAULT 0,
  `service_fee` real NOT NULL DEFAULT 0,
  `seller_discount` real NOT NULL DEFAULT 0,
  `shopee_discount` real NOT NULL DEFAULT 0,
  `cogs` real,
  `net_profit` real,
  `synced_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
