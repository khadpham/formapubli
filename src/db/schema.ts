import { sqliteTable, text, integer, real, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
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
  ownerId: text('owner_id').references(() => partners.id), // PARTNER_FORMAPUBLI or consignment partner
  lotId: text('lot_id'), // Printing lot or batch identifier
  eventType: text('event_type').notNull(), // RECEIPT, DISPATCH_SALE, DISPATCH_GIFT, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, OPENING_BALANCE
  quantityDelta: integer('quantity_delta').notNull(), // Positive or negative non-zero
  unitCostSnapshot: real('unit_cost_snapshot'), // Cost of goods snapshot at transaction time
  condition: text('condition').default('NEW'), // NEW, MINOR_DAMAGE, DEFECTIVE, QUARANTINE
  documentRef: text('document_ref').notNull(), // Goods Receipt, Dispatch Note, Stocktake Voucher
  note: text('note'),
  actorId: text('actor_id').notNull(), // Operator identifier
  correlationId: text('correlation_id'), // Linked transaction ID (e.g. transfer pair)
  reversalOf: text('reversal_of'), // Reversal link to an original ledger entry
  idempotencyKey: text('idempotency_key').notNull().unique(), // Replay prevention
  effectiveAt: text('effective_at').default(sql`CURRENT_TIMESTAMP`),
  recordedAt: text('recorded_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  editionWarehouseIdx: index('idx_ledger_edition_warehouse').on(table.editionId, table.warehouseId),
  eventIdx: index('idx_ledger_event_type').on(table.eventType),
  idempotencyIdx: uniqueIndex('idx_ledger_idempotency').on(table.idempotencyKey),
  correlationIdx: index('idx_ledger_correlation_id').on(table.correlationId),
}));

// 11. Real-time Stock Balances (Bảng cân đối tồn kho tức thời)
export const stockBalances = sqliteTable('stock_balances', {
  id: text('id').primaryKey(),
  editionId: text('edition_id').notNull().references(() => editions.id),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  condition: text('condition').default('NEW'), // NEW, MINOR_DAMAGE, DEFECTIVE, QUARANTINE
  physicalQuantity: integer('physical_quantity').notNull().default(0),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  bucketIdx: uniqueIndex('uq_stock_bucket').on(table.editionId, table.warehouseId, table.condition),
  nonNegativeCheck: check('check_stock_non_negative', sql`${table.physicalQuantity} >= 0`),
}));

// 12. Commercial Sales Orders (Đơn hàng Bán sách - Sổ Kép)
export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(), // UUID v7 or unique client ID
  orderCode: text('order_code').notNull().unique(), // e.g. ORD-20260911-0001
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  channel: text('channel').notNull().default('FAIR_EVENT'), // FAIR_EVENT, RETAIL_OFFICE, WHOLESALE_PARTNER, ONLINE
  partnerId: text('partner_id').references(() => partners.id), // Đại lý / Đối tác phân phối sỉ nếu bán buôn
  customerId: text('customer_id').references(() => customers.id), // Độc giả thân thiết (tùy chọn)
  customerName: text('customer_name'), // Tên khách hàng (vãng lai hoặc đại lý phân phối)
  subtotal: real('subtotal').notNull(), // Tổng giá bìa trước chiết khấu
  discountRate: real('discount_rate').default(0.0), // Chiết khấu tổng (%): e.g. 0.35, 0.40
  discountAmount: real('discount_amount').default(0.0), // Tiền chiết khấu
  finalAmount: real('final_amount').notNull(), // Tiền thực thu sau chiết khấu
  paymentMethod: text('payment_method').notNull().default('CASH'), // CASH, BANK_TRANSFER, QR_CODE
  fiscalScope: text('fiscal_scope').notNull().default('INTERNAL_MANAGEMENT'), // OFFICIAL_TAX vs INTERNAL_MANAGEMENT
  vatRate: real('vat_rate').default(0.0), // 0.05 hoặc 0.0
  vatInvoiceRequired: integer('vat_invoice_required', { mode: 'boolean' }).default(false),
  vatInvoiceCode: text('vat_invoice_code'), // Số hóa đơn điện tử nếu có
  status: text('status').notNull().default('COMPLETED'), // COMPLETED, CANCELLED
  syncStatus: text('sync_status').notNull().default('SYNCED'), // SYNCED, PENDING_SYNC
  cashierId: text('cashier_id').notNull().default('staff-admin'),
  cashboxSessionId: text('cashbox_session_id'), // ID phiên két tiền ca làm việc
  idempotencyKey: text('idempotency_key').notNull().unique(),
  note: text('note'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  fiscalScopeIdx: index('idx_orders_fiscal_scope').on(table.fiscalScope),
  warehouseIdx: index('idx_orders_warehouse').on(table.warehouseId),
  cashboxSessionIdx: index('idx_orders_cashbox_session').on(table.cashboxSessionId),
  createdAtIdx: index('idx_orders_created_at').on(table.createdAt),
}));

// 13. Order Line Items (Chi tiết từng cuốn sách trong đơn)
export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  editionId: text('edition_id').notNull().references(() => editions.id),
  quantity: integer('quantity').notNull(), // Số lượng bán (> 0)
  unitCoverPrice: real('unit_cover_price').notNull(), // Giá bìa niêm yết
  unitDiscountRate: real('unit_discount_rate').default(0.0), // Chiết khấu riêng nếu có
  unitSellingPrice: real('unit_selling_price').notNull(), // Đơn giá thực bán
  totalAmount: real('total_amount').notNull(), // Thành tiền = quantity * unitSellingPrice
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  orderIdIdx: index('idx_order_items_order_id').on(table.orderId),
  editionIdIdx: index('idx_order_items_edition_id').on(table.editionId),
}));

// 14. Audit Logs (Nhật ký kiểm toán truy cập Sổ Kép & Thao tác nhạy cảm)
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  action: text('action').notNull(), // VIEW_FISCAL_MANAGEMENT, EXPORT_SALES_REPORT, VOID_ORDER, ADJUST_STOCK
  actorRole: text('actor_role').notNull(),
  actorId: text('actor_id').notNull(),
  resource: text('resource').notNull(), // e.g. /api/orders, SalesLedgerView
  details: text('details'), // JSON string or description
  ipAddress: text('ip_address'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  actionIdx: index('idx_audit_logs_action').on(table.action),
  actorIdx: index('idx_audit_logs_actor').on(table.actorId),
  createdAtIdx: index('idx_audit_logs_created_at').on(table.createdAt),
}));

// 15. Cashbox Sessions (Két Tiền Ca Thu Ngân & Kiểm Kê Tiền Mặt Quầy)
export const cashboxSessions = sqliteTable('cashbox_sessions', {
  id: text('id').primaryKey(), // UUID v7 or cbs-xxx
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  cashierId: text('cashier_id').notNull(), // Tên hoặc ID thu ngân
  openingCash: real('opening_cash').notNull().default(0), // Tiền bàn giao đầu ca
  closingCashActual: real('closing_cash_actual'), // Tiền mặt thực đếm khi chốt ca
  expectedCash: real('expected_cash'), // Tiền mặt hệ thống tính = openingCash + tổng đơn CASH
  cashDiscrepancy: real('cash_discrepancy'), // Chênh lệch = closingCashActual - expectedCash
  totalCashSales: real('total_cash_sales').default(0), // Tổng tiền mặt thu trong ca
  totalTransferSales: real('total_transfer_sales').default(0), // Tổng chuyển khoản / QR trong ca
  totalOrdersCount: integer('total_orders_count').default(0), // Tổng số đơn trong ca
  status: text('status').notNull().default('OPEN'), // OPEN, CLOSED
  notes: text('notes'),
  openedAt: text('opened_at').default(sql`CURRENT_TIMESTAMP`),
  closedAt: text('closed_at'),
}, (table) => ({
  cashierIdx: index('idx_cashbox_cashier').on(table.cashierId),
  statusIdx: index('idx_cashbox_status').on(table.status),
  warehouseIdx: index('idx_cashbox_warehouse').on(table.warehouseId),
  openedAtIdx: index('idx_cashbox_opened_at').on(table.openedAt),
}));

// 16. Counter Allocations ("Chia Mâm" Sách Bàn Quầy Hội Chợ)
export const counterAllocations = sqliteTable('counter_allocations', {
  id: text('id').primaryKey(),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  counterName: text('counter_name').notNull(), // Tên bàn quầy: e.g. "Bàn 1 - Thiếu nhi"
  cashboxSessionId: text('cashbox_session_id').references(() => cashboxSessions.id),
  editionId: text('edition_id').notNull().references(() => editions.id),
  allocatedQuantity: integer('allocated_quantity').notNull().default(0), // Hạn ngạch giao cho bàn
  soldQuantity: integer('sold_quantity').notNull().default(0), // Số lượng đã bán từ bàn này
  status: text('status').notNull().default('ACTIVE'), // ACTIVE, CLOSED, RECONCILED
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  counterIdx: index('idx_counter_alloc_name').on(table.counterName),
  editionIdx: index('idx_counter_alloc_edition').on(table.editionId),
  warehouseIdx: index('idx_counter_alloc_warehouse').on(table.warehouseId),
  sessionIdx: index('idx_counter_alloc_session').on(table.cashboxSessionId),
}));

// 17. RMA & Defective Quarantine Tickets (Cách Ly Sách Lỗi & Đổi Trả)
export const rmaTickets = sqliteTable('rma_tickets', {
  id: text('id').primaryKey(), // e.g. RMA-202609-0001
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  orderId: text('order_id').references(() => orders.id),
  editionId: text('edition_id').notNull().references(() => editions.id),
  quantity: integer('quantity').notNull(),
  defectReason: text('defect_reason').notNull(), // PRINT_DEFECT, BINDING_DEFECT, TRANSIT_DAMAGE, CUSTOMER_RETURN, WATER_DAMAGE, OTHER
  quarantineCondition: text('quarantine_condition').notNull().default('QUARANTINE'), // QUARANTINE, DEFECTIVE
  resolutionAction: text('resolution_action').default('HOLD_IN_QUARANTINE'), // HOLD_IN_QUARANTINE, RETURN_TO_SUPPLIER, WRITE_OFF_SCRAP, REPAIRED_RESTOCK
  inspectedBy: text('inspected_by').notNull().default('staff-admin'),
  status: text('status').notNull().default('QUARANTINED'), // PENDING_INSPECTION, QUARANTINED, RESOLVED, SCRAPPED
  notes: text('notes'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  resolvedAt: text('resolved_at'),
}, (table) => ({
  warehouseIdx: index('idx_rma_warehouse').on(table.warehouseId),
  editionIdx: index('idx_rma_edition').on(table.editionId),
  orderIdx: index('idx_rma_order').on(table.orderId),
  statusIdx: index('idx_rma_status').on(table.status),
}));


