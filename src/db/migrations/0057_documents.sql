-- 0057: Quản lý tài liệu (documents) - lưu trên Cloudflare R2.
-- Metadata trong DB, file thật trên R2. ERP là nguồn sự thật duy nhất.

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, -- Tên hiển thị
  original_name TEXT, -- Tên file gốc
  mime_type TEXT, -- application/pdf, image/jpeg, ...
  file_size INTEGER, -- Bytes
  -- R2 storage
  r2_key TEXT NOT NULL UNIQUE, -- Key trên R2 (VD: contracts/2026/abc.pdf)
  r2_bucket TEXT NOT NULL DEFAULT 'formapubli-docs',
  -- Phân loại
  category TEXT NOT NULL DEFAULT 'OTHER', -- CONTRACT | INVOICE | LICENSE | RECEIPT | PROJECT | HR | OTHER
  -- Liên kết đa hình tới nghiệp vụ
  related_type TEXT, -- order | contract | project | employee | product
  related_id TEXT,
  -- Mô tả và tags
  description TEXT,
  tags TEXT, -- JSON array
  -- Audit
  uploaded_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_documents_category ON documents(category);
--> statement-breakpoint
CREATE INDEX idx_documents_related ON documents(related_type, related_id);
--> statement-breakpoint
CREATE INDEX idx_documents_created ON documents(created_at);
