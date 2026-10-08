-- 0052: Dự án/sự kiện + cột mốc hợp đồng (Contract AI GĐ4).
-- contract_projects: dự án/sự kiện cần ký nhiều hợp đồng theo cột mốc.
-- contract_milestones: từng cột mốc — loại HĐ cần ký, hạn, liên kết HĐ đã ký.
-- Xóa dự án: milestones theo (cascade); hợp đồng đã ký GIỮ NGUYÊN (SET NULL).
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle).

CREATE TABLE contract_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE contract_milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES contract_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  needed_category TEXT NOT NULL,
  contract_id TEXT REFERENCES contract_documents(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_milestones_project ON contract_milestones(project_id);
--> statement-breakpoint
CREATE INDEX idx_milestones_due ON contract_milestones(due_date, status);
