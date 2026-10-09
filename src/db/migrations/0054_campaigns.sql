-- 0054: campaigns — chiến dịch bán ngắn hạn gắn kho FAIR_EVENT
-- key-value: xem docs/superpowers/specs/2026-10-09-campaign-lifecycle-design.md
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  warehouse_id TEXT REFERENCES warehouses(id),
  source_warehouse_id TEXT REFERENCES warehouses(id),
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
