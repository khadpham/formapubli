import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 1. Works / Master Titles (Tầng 1: Tác phẩm)
export const works = sqliteTable('works', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // e.g. FORMA-046, XBK-001
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  author: text('author').notNull(),
  translator: text('translator'),
  category: text('category'),
  shortCode: text('short_code'), // Acronym for fast lookup, e.g. 'bty', 'nbl', 'dddhc'
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  codeIdx: uniqueIndex('idx_works_code').on(table.code),
  shortCodeIdx: index('idx_works_short_code').on(table.shortCode),
}));

// 2. Editions / ISBN Lots (Tầng 2: Ấn bản & Lô in)
export const editions = sqliteTable('editions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // SKU code from sheet: e.g. H01, H21, H36, H81
  workId: text('work_id').notNull().references(() => works.id),
  title: text('title'), // Specific edition title if variant (e.g. 'Le Spleen de Paris (Bìa tím)')
  isbn: text('isbn').notNull(), // 13-digit standard ISBN (non-unique to support re-prints with same ISBN like H21 & H36)
  isbnLast4: text('isbn_last4').notNull(), // Last 4 digits for rapid lookup
  editionNumber: integer('edition_number').default(1),
  coverPrice: real('cover_price').notNull(),
  vatRate: real('vat_rate').default(0.05),
  formatSize: text('format_size'),
  pages: integer('pages'),
  publicationYear: integer('publication_year'),
  publisher: text('publisher'), // e.g. 'NXB Hội nhà văn', 'NXB Tri thức'
  suggestedLocation: text('suggested_location'), // e.g. 'Kệ A2, tầng 3'
  status: text('status').default('IN_STOCK'), // 'IN_STOCK', 'SOLD_OUT', 'PREORDER'
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  codeIdx: uniqueIndex('idx_editions_code').on(table.code),
  isbnIdx: index('idx_editions_isbn').on(table.isbn),
  isbnLast4Idx: index('idx_editions_isbn_last4').on(table.isbnLast4),
  workIdIdx: index('idx_editions_work_id').on(table.workId),
}));

// 3. Physical Warehouses (3 Kho vật lý)
export const warehouses = sqliteTable('warehouses', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // KHO_AU_CO, KHO_QUYNH_MAI, KHO_DU_PHONG
  name: text('name').notNull(),
  address: text('address'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// 4. Commercial Partners (Đối tác phân phối)
export const partners = sqliteTable('partners', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(), // CONSIGNMENT, WHOLESALE, PRINTER, LIBRARY, INTERNAL
  contactInfo: text('contact_info'),
  discountRate: real('discount_rate').default(0.0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// 5. Customers / Readers (Hồ sơ Độc giả 360 độ)
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // CUST-0001
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  channel: text('channel').default('FACEBOOK'), // FACEBOOK, INSTAGRAM, ZALO, TIKTOK, DIRECT
  channelUrl: text('channel_url'),
  segment: text('segment').default('RETAIL'), // LOYALTY_READER, WHOLESALE, LIBRARY, REVIEWER, DIPLOMAT, RETAIL
  addressProvince: text('address_province'),
  addressDistrict: text('address_district'),
  addressWard: text('address_ward'),
  addressDetail: text('address_detail'),
  shippingNote: text('shipping_note'),
  totalSpent: real('total_spent').default(0.0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  phoneIdx: index('idx_customers_phone').on(table.phone),
  fullNameIdx: index('idx_customers_full_name').on(table.fullName),
}));

// 6. Seasonal Bundles (Gói phát hành theo mùa)
export const seasonalBundles = sqliteTable('seasonal_bundles', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(), // BUNDLE_HA_2024, BUNDLE_XUAN_2026
  seasonName: text('season_name').notNull(), // Mùa Hạ 2024, Mùa Xuân 2026
  releaseDate: text('release_date').notNull(),
  comboPrice: real('combo_price').notNull(),
  totalCoverPrice: real('total_cover_price').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// 7. Bundle Items (Chi tiết sách trong gói mùa)
export const bundleItems = sqliteTable('bundle_items', {
  id: text('id').primaryKey(),
  bundleId: text('bundle_id').notNull().references(() => seasonalBundles.id),
  editionId: text('edition_id').notNull().references(() => editions.id),
  quantityInBundle: integer('quantity_in_bundle').default(1),
  isMandatory: integer('is_mandatory', { mode: 'boolean' }).default(true),
});

// 8. Customer Subscriptions (Đăng ký mua theo mùa)
export const customerSubscriptions = sqliteTable('customer_subscriptions', {
  id: text('id').primaryKey(),
  subscriptionCode: text('subscription_code').notNull().unique(), // SUB-2026-0001
  customerId: text('customer_id').notNull().references(() => customers.id),
  bundleId: text('bundle_id').notNull().references(() => seasonalBundles.id),
  subscriptionType: text('subscription_type').notNull(), // FULL_BUNDLE, PARTIAL_BUNDLE, ADDON_ONLY
  totalAmount: real('total_amount').notNull(),
  paymentStatus: text('payment_status').default('PENDING'), // PENDING, PAID_LA, PAID_COMPANY
  fulfillmentStatus: text('fulfillment_status').default('UNFULFILLED'), // UNFULFILLED, READY_TO_PACK, SHIPPED, HOLD_FOR_NEXT_SEASON
  destinationWarehouseId: text('destination_warehouse_id').references(() => warehouses.id),
  shippingFee: real('shipping_fee').default(0.0),
  carrierTrackingCode: text('carrier_tracking_code'),
  holdUntilSeason: text('hold_until_season'),
  notes: text('notes'),
  createdBy: text('created_by').notNull(), // Lan Anh, Admin...
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// 9. Customer Owned Books (Tủ sách độc giả đã sở hữu)
export const customerOwnedBooks = sqliteTable('customer_owned_books', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id),
  editionId: text('edition_id').notNull().references(() => editions.id),
  orderRef: text('order_ref'),
  acquiredAt: text('acquired_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  custEditionIdx: uniqueIndex('uq_customer_edition').on(table.customerId, table.editionId),
}));

// 10. Append-Only Inventory Ledger (Sổ cái Kho Bất biến)
export const inventoryLedger = sqliteTable('inventory_ledger', {
  id: text('id').primaryKey(),
  editionId: text('edition_id').notNull().references(() => editions.id),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  eventType: text('event_type').notNull(), // RECEIPT, DISPATCH_SALE, DISPATCH_GIFT, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, OPENING_BALANCE
  quantityDelta: integer('quantity_delta').notNull(), // Positive or negative non-zero
  condition: text('condition').default('NEW'), // NEW, MINOR_DAMAGE, DEFECTIVE
  documentRef: text('document_ref').notNull(), // Goods Receipt, Dispatch Note, Stocktake Voucher
  note: text('note'),
  actorId: text('actor_id').notNull(), // Operator identifier
  idempotencyKey: text('idempotency_key').notNull().unique(), // Replay prevention
  recordedAt: text('recorded_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  editionWarehouseIdx: index('idx_ledger_edition_warehouse').on(table.editionId, table.warehouseId),
  eventIdx: index('idx_ledger_event_type').on(table.eventType),
  idempotencyIdx: uniqueIndex('idx_ledger_idempotency').on(table.idempotencyKey),
}));

// 11. Real-time Stock Balances (Bảng cân đối tồn kho tức thời)
export const stockBalances = sqliteTable('stock_balances', {
  id: text('id').primaryKey(),
  editionId: text('edition_id').notNull().references(() => editions.id),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  condition: text('condition').default('NEW'), // NEW, MINOR_DAMAGE, DEFECTIVE
  physicalQuantity: integer('physical_quantity').notNull().default(0),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  bucketIdx: uniqueIndex('uq_stock_bucket').on(table.editionId, table.warehouseId, table.condition),
}));
