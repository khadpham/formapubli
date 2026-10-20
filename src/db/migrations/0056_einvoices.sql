-- 0056: Hóa đơn điện tử (e-invoices) - tích hợp MS-Invoice.
-- Lưu thông tin hóa đơn đã phát hành qua API, liên kết với đơn hàng.
-- Không xóa khi hoàn trả - dùng hóa đơn điều chỉnh/thay thế.

CREATE TABLE einvoices (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  -- Thông tin hóa đơn theo quy định
  invoice_number TEXT, -- Số hóa đơn (VD: 0000001)
  invoice_serial TEXT, -- Ký hiệu (VD: C26TVN)
  invoice_form INTEGER DEFAULT 1, -- 1: GTGT, 2: bán hàng
  -- MS-Invoice API
  msinvoice_id TEXT, -- Invoice ID từ MS-Invoice
  is_signed TEXT DEFAULT 'N', -- Y/N
  cert_sn TEXT, -- Mã chứng thư dùng để ký
  -- Số tiền
  subtotal REAL NOT NULL DEFAULT 0, -- Tiền hàng chưa VAT
  vat_rate REAL NOT NULL DEFAULT 0, -- Thuế suất (5, 8, 10)
  vat_amount REAL NOT NULL DEFAULT 0, -- Tiền VAT
  total_amount REAL NOT NULL DEFAULT 0, -- Tổng thanh toán
  -- Trạng thái
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | ISSUED | ADJUSTED | REPLACED | CANCELLED
  issued_at TEXT, -- Thời điểm phát hành
  pdf_url TEXT, -- Link PDF hóa đơn
  -- Hóa đơn điều chỉnh/thay thế
  adjusted_for_id TEXT REFERENCES einvoices(id) ON DELETE SET NULL, -- HĐ gốc bị điều chỉnh
  adjustment_type TEXT, -- ADJUST | REPLACE
  -- Audit
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_einvoices_order ON einvoices(order_id);
--> statement-breakpoint
CREATE INDEX idx_einvoices_status ON einvoices(status);
--> statement-breakpoint
CREATE INDEX idx_einvoices_serial ON einvoices(invoice_serial, invoice_number);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_einvoices_msinvoice ON einvoices(msinvoice_id) WHERE msinvoice_id IS NOT NULL;
