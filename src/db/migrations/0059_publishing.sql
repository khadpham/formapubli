-- 0059: Du an xuat ban - quan ly 5 giai doan chuoi san xuat.
-- Thu tu: THIET_KE_BIA -> BIEN_DICH -> BIEN_TAP -> DAN_TRANG -> DOC_MORAT

CREATE TABLE publishing_projects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE, -- VD: DA-2026-001
  book_title TEXT NOT NULL, -- Ten sach
  original_title TEXT, -- Ten goc (sach dich)
  author TEXT,
  translator TEXT, -- Dich gia
  book_size TEXT, -- Kho sach (VD: 128x190mm)
  page_count INTEGER, -- So trang du kien
  cover_price REAL, -- Gia bia du kien
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | IN_PROGRESS | COMPLETED | CANCELLED
  current_stage TEXT, -- Giai doan hien tai
  planned_print_date TEXT, -- Ngay in du kien
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE publishing_stages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES publishing_projects(id) ON DELETE CASCADE,
  stage TEXT NOT NULL, -- THIET_KE_BIA | BIEN_DICH | BIEN_TAP | DAN_TRANG | DOC_MORAT
  stage_order INTEGER NOT NULL, -- 1-5
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | IN_PROGRESS | DONE
  -- Hop dong
  contract_id TEXT REFERENCES contract_documents(id) ON DELETE SET NULL,
  contract_date TEXT, -- Ngay ky HD
  -- Nghiem thu
  acceptance_date TEXT, -- Ngay nghiem thu
  acceptance_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  -- Ke hoach
  planned_start TEXT,
  planned_end TEXT,
  -- Chi phi
  contract_amount REAL DEFAULT 0, -- Gia tri HD (gross)
  tax_amount REAL DEFAULT 0, -- Thue TNCN 10%
  net_amount REAL DEFAULT 0, -- Thuc nhan
  -- Nguoi thuc hien
  assignee_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, stage)
);
--> statement-breakpoint
CREATE INDEX idx_pub_projects_status ON publishing_projects(status);
--> statement-breakpoint
CREATE INDEX idx_pub_projects_code ON publishing_projects(code);
--> statement-breakpoint
CREATE INDEX idx_pub_stages_project ON publishing_stages(project_id);
--> statement-breakpoint
CREATE INDEX idx_pub_stages_status ON publishing_stages(status);
