-- 0063: Portal san pham - quan tri noi dung san pham cho portal ban sach.
-- portal_products: 1 dong = 1 san pham hien thi tren portal (sach le, combo, qua tang).
-- Du lieu import 1 lan tu Google Sheet, sau do quan tri tren UI ERP.
CREATE TABLE portal_products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE, -- url-friendly, vd: ondine-la-motte-fouque
  sku TEXT, -- ma SKU tu sheet (HH004, TP0004, COMBO01...)
  name TEXT NOT NULL,
  author TEXT,
  translator TEXT,
  description TEXT, -- mo ta marketing
  cover_price REAL NOT NULL DEFAULT 0, -- gia bia
  sale_price REAL, -- gia khuyen mai, NULL = ban dung gia bia
  product_type TEXT NOT NULL DEFAULT 'SINGLE', -- SINGLE | COMBO | GIFT
  category TEXT, -- the loai
  isbn TEXT,
  cover_image TEXT, -- URL anh bia (iili.io, sau nay co the chuyen R2)
  is_visible INTEGER NOT NULL DEFAULT 1, -- 1 = hien tren portal, 0 = an
  is_featured INTEGER NOT NULL DEFAULT 0, -- 1 = san pham noi bat
  sort_order INTEGER NOT NULL DEFAULT 0, -- thu tu sap xep (so nho len truoc)
  -- Thong tin sach chi tiet (JSON)
  details_json TEXT, -- {pages, size, publisher, publishYear, coverType, language}
  erp_product_id TEXT, -- lien ket toi bang products cua ERP (de tao don, tru kho)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_portal_products_visible ON portal_products(is_visible, sort_order);
--> statement-breakpoint
CREATE INDEX idx_portal_products_slug ON portal_products(slug);
--> statement-breakpoint
CREATE INDEX idx_portal_products_type ON portal_products(product_type);
--> statement-breakpoint

-- portal_product_images: anh phu cua san pham (ngoai anh bia).
CREATE TABLE portal_product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES portal_products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0, -- 1 = anh chinh (trung voi cover_image)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_portal_images_product ON portal_product_images(product_id, sort_order);
--> statement-breakpoint

-- portal_combo_items: sach trong combo. 1 combo gom nhieu san pham SINGLE.
CREATE TABLE portal_combo_items (
  id TEXT PRIMARY KEY,
  combo_product_id TEXT NOT NULL REFERENCES portal_products(id) ON DELETE CASCADE,
  item_product_id TEXT NOT NULL REFERENCES portal_products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(combo_product_id, item_product_id)
);
--> statement-breakpoint
CREATE INDEX idx_combo_items_combo ON portal_combo_items(combo_product_id);
--> statement-breakpoint

-- portal_reviews: danh gia cua khach hang ve san pham.
-- Chi khach da mua moi duoc danh gia. Trang thai cho duyet truoc khi hien.
CREATE TABLE portal_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES portal_products(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL, -- tham chieu customers(id), khong FK cung de tranh khoa cheo
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT -- ngay duyet/tu choi
);
--> statement-breakpoint
CREATE INDEX idx_portal_reviews_product ON portal_reviews(product_id, status);
--> statement-breakpoint
CREATE INDEX idx_portal_reviews_customer ON portal_reviews(customer_id);
