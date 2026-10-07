-- 0046: Quản lý mẫu hợp đồng, hợp đồng đã soạn, bộ đếm số HĐ, thông tin công ty, preset nhanh.
-- 5 bảng. Lấy nguyên văn file này khi cần DDL — không tự viết lại.
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle);
-- cấm viết literal marker text bên trong comment — split sẽ cắt nhầm chunk.

CREATE TABLE contract_templates (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'TAC_QUYEN',
  description TEXT,
  template_filename TEXT NOT NULL,
  template_data TEXT NOT NULL,
  schema_fields TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
CREATE INDEX idx_contract_templates_category ON contract_templates(category)
--> statement-breakpoint
CREATE TABLE contract_documents (
  id TEXT PRIMARY KEY,
  contract_number TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL REFERENCES contract_templates(id),
  template_version INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  partner_id TEXT REFERENCES partners(id),
  work_id TEXT REFERENCES works(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  payload_data TEXT NOT NULL,
  rendered_docx TEXT,
  final_docx TEXT,
  final_filename TEXT,
  created_by TEXT NOT NULL,
  signed_date TEXT,
  effective_date TEXT,
  expiry_date TEXT,
  total_amount INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
CREATE INDEX idx_contract_documents_partner ON contract_documents(partner_id)
--> statement-breakpoint
CREATE INDEX idx_contract_documents_work ON contract_documents(work_id)
--> statement-breakpoint
CREATE INDEX idx_contract_documents_status ON contract_documents(status)
--> statement-breakpoint
CREATE TABLE contract_counters (
  category TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category, year)
)
--> statement-breakpoint
CREATE TABLE contract_company_profile (
  id TEXT PRIMARY KEY,
  ten_cong_ty TEXT NOT NULL DEFAULT 'FORMApubli',
  dai_dien TEXT,
  chuc_vu TEXT DEFAULT 'Giám đốc',
  dia_chi TEXT,
  mst TEXT,
  sdt TEXT,
  email TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
INSERT INTO contract_company_profile (id, ten_cong_ty, dai_dien, chuc_vu)
VALUES ('main', 'FORMApubli', 'Phạm Đam Ca', 'Giám đốc')
--> statement-breakpoint
CREATE TABLE contract_presets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  values_json TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
CREATE INDEX idx_contract_presets_sort ON contract_presets(sort_order)
--> statement-breakpoint
INSERT INTO contract_presets (id, label, values_json, sort_order)
VALUES ('preset-giam-doc', 'Giám đốc — Phạm Đam Ca',
        '{"ben_a_dai_dien":"Phạm Đam Ca","ben_a_chuc_vu":"Giám đốc"}', 0)
