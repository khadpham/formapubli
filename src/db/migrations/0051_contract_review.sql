-- 0051: Checklist phản biện + lịch sử review AI (Contract AI GĐ2).
-- contract_review_checklists: checklist theo loại HĐ, version hóa.
-- contract_reviews: lịch sử mỗi lần AI phân tích/phản biện (lưu kết quả JSON + hash).
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle).

CREATE TABLE contract_review_checklists (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  items TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_review_checklists_category ON contract_review_checklists(category);
--> statement-breakpoint
CREATE TABLE contract_reviews (
  id TEXT PRIMARY KEY,
  source_name TEXT,
  category TEXT,
  summary TEXT,
  issues TEXT,
  ai_model TEXT,
  content_hash TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_contract_reviews_hash ON contract_reviews(content_hash);
