-- 0039: map ấn bản nội bộ <-> sản phẩm Shopee (đồng bộ tồn theo item_id số của sàn).
PRAGMA foreign_keys = off;
--> statement-breakpoint
CREATE TABLE `shopee_item_map` (
  `shop_id` integer NOT NULL,
  `edition_id` text NOT NULL,
  `item_id` integer NOT NULL,
  `model_id` integer NOT NULL DEFAULT 0,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`shop_id`, `edition_id`)
);
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
