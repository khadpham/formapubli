-- 0038: token OAuth gian hàng Shopee (access 4h + refresh 30 ngày).
-- Token CẤM nằm RAM/file trên Workers — bảng này là nguồn sự thật duy nhất.
PRAGMA foreign_keys = off;
--> statement-breakpoint
CREATE TABLE `shopee_shop_tokens` (
  `shop_id` integer PRIMARY KEY,
  `shop_name` text,
  `access_token` text NOT NULL,
  `refresh_token` text NOT NULL,
  `expired_at` integer NOT NULL,
  `refresh_expired_at` integer NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
PRAGMA foreign_keys = on;
--> statement-breakpoint
PRAGMA foreign_key_check;
