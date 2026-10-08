-- 0047: Lệnh in mang giá vốn (GĐ3-P2). Chủ tạo lệnh in kèm đơn giá vốn thỏa thuận
-- với nhà in; thủ kho nhập kho đối chiếu lệnh in → hệ thống tự gắn giá vốn vào
-- lô hàng. Thủ kho không bao giờ thấy con số.
-- MỌI câu cách nhau bằng statement-breakpoint marker (quy ước migrate-fresh/drizzle);
-- cấm viết literal marker text bên trong comment — split sẽ cắt nhầm chunk.

CREATE TABLE print_orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  edition_id TEXT REFERENCES editions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_planned INTEGER NOT NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  unit_cost_agreed REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)
--> statement-breakpoint
CREATE INDEX idx_print_orders_status ON print_orders(status)
--> statement-breakpoint
CREATE INDEX idx_print_orders_edition ON print_orders(edition_id)
