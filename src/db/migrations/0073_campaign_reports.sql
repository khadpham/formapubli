-- 0073: Báo cáo kỳ tự sinh khi chiến dịch bán ngắn hạn kết thúc
-- Mỗi chiến dịch kết thúc (tay hoặc tự động) sinh 1 bản ghi báo cáo

CREATE TABLE IF NOT EXISTS campaign_reports (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  generated_by TEXT NOT NULL DEFAULT 'system-auto',
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  revenue REAL NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  items_sold INTEGER NOT NULL DEFAULT 0,
  leftover_quantity INTEGER NOT NULL DEFAULT 0,
  leftover_items TEXT NOT NULL DEFAULT '[]',
  sold_items TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_campaign_reports_campaign ON campaign_reports(campaign_id);
