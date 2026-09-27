CREATE TABLE `notification_dismissals` (
  `actor_id` text NOT NULL,
  `item_id` text NOT NULL,
  `dismissed_at` text DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`actor_id`, `item_id`)
);
