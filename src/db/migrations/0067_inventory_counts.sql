-- 0064: Kiem ke kho - dot kiem ke dinh ky va dieu chinh chenh lech.
-- inventory_counts: 1 dong = 1 dot kiem ke cho 1 kho.
-- inventory_count_items: chi tiet tung san pham trong dot.

CREATE TABLE inventory_counts (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'DRAFT', -- DRAFT | COUNTING | PENDING_APPROVAL | APPROVED | CANCELLED
  note TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_inventory_counts_warehouse ON inventory_counts(warehouse_id);
--> statement-breakpoint
CREATE INDEX idx_inventory_counts_status ON inventory_counts(status);

--> statement-breakpoint
CREATE TABLE inventory_count_items (
  id TEXT PRIMARY KEY,
  count_id TEXT NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  edition_id TEXT REFERENCES editions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  system_qty INTEGER NOT NULL DEFAULT 0, -- so tren so tai thoi diem tao dot
  counted_qty INTEGER, -- so thuc te (NULL = chua dem)
  difference INTEGER GENERATED ALWAYS AS (COALESCE(counted_qty, 0) - system_qty) VIRTUAL,
  note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_count_items_count ON inventory_count_items(count_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_count_items_unique ON inventory_count_items(count_id, product_id, edition_id);
