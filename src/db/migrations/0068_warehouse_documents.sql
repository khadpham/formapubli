-- 0068: Warehouse documents - chứng từ kho (phiếu nhập/xuất/chuyển, biên bản kiểm kê)
-- Mỗi chứng từ được đánh số tự động, lưu trữ trên R2, liên kết với bút toán ledger.

CREATE TABLE warehouse_documents (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL, -- INBOUND | OUTBOUND | TRANSFER | COUNT_SHEET | COUNT_MINUTES
  doc_number TEXT NOT NULL, -- Số chứng từ: NK-2026-0001, XK-2026-0001, CK-2026-0001, BBKK-2026-0001
  doc_date TEXT NOT NULL, -- Ngày chứng từ (ISO)
  warehouse_id TEXT, -- Kho liên quan (với TRANSFER có thêm to_warehouse_id)
  to_warehouse_id TEXT, -- Kho đích (chỉ cho TRANSFER)
  partner_id TEXT, -- Đối tác (NCC cho nhập, KH/đại lý cho xuất)
  partner_name TEXT, -- Tên đối tác (snapshot tại thời điểm lập)
  total_quantity INTEGER DEFAULT 0, -- Tổng số lượng
  total_amount REAL DEFAULT 0, -- Tổng tiền (nếu có)
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | ISSUED | VOIDED
  r2_key TEXT, -- Key trên R2 (vd: chung-tu-kho/2026/NK-2026-0001.html)
  r2_url TEXT, -- URL truy cập
  ledger_refs TEXT, -- JSON array các document_ref trong ledger liên quan
  created_by TEXT, -- Người lập
  issued_by TEXT, -- Người phát hành/duyệt
  issued_at TEXT, -- Thời điểm phát hành
  voided_by TEXT, -- Người hủy
  voided_at TEXT, -- Thời điểm hủy
  void_reason TEXT, -- Lý do hủy
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_warehouse_documents_number ON warehouse_documents(doc_number);
--> statement-breakpoint
CREATE INDEX idx_warehouse_documents_type ON warehouse_documents(doc_type);
--> statement-breakpoint
CREATE INDEX idx_warehouse_documents_status ON warehouse_documents(status);
--> statement-breakpoint
CREATE INDEX idx_warehouse_documents_warehouse ON warehouse_documents(warehouse_id);
--> statement-breakpoint
-- Bảng chi tiết chứng từ
CREATE TABLE warehouse_document_items (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES warehouse_documents(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_code TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  note TEXT,
  sort_order INTEGER DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX idx_warehouse_document_items_doc ON warehouse_document_items(document_id);
--> statement-breakpoint
-- Bảng đếm số chứng từ theo loại + năm (để đánh số tự động)
CREATE TABLE warehouse_doc_counters (
  doc_type TEXT NOT NULL,
  year INTEGER NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);
