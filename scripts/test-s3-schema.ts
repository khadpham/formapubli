import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  discountApprovalRequests,
  deliveryOrders,
  deliveryOrderItems,
  warehouses,
  partners,
  works,
  editions,
} from '../src/db/schema';
import { eq } from 'drizzle-orm';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_s3_schema.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function run() {
  console.log('--- TEST S3 SCHEMA: discount_approval_requests & delivery_orders ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-s3-schema');

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const client = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(client, {
    schema: {
      discountApprovalRequests,
      deliveryOrders,
      deliveryOrderItems,
      warehouses,
      partners,
      works,
      editions,
    },
  });

  // Seed reference data
  await db.insert(warehouses).values([
    { id: 'wh-au-co', code: 'KHO_AU_CO', name: 'Kho 1 - Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-quynh-mai', code: 'KHO_QUYNH_MAI', name: 'Kho 2 - Quỳnh Mai', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
  ]);

  await db.insert(partners).values([
    { id: 'part-direct', code: 'BAN_LE_DIRECT', name: 'Kênh Bán lẻ Trực tiếp', type: 'INTERNAL', discountRate: 0.0 },
    { id: 'part-ca-chep', code: 'NS_CA_CHEP', name: 'Nhà sách Cá Chép', type: 'CONSIGNMENT', discountRate: 0.4 },
  ]);

  await db.insert(works).values([
    { id: 'work-1', code: 'WORK-TEST-01', title: 'Tác phẩm Test', originalTitle: 'Test Work', author: 'Tác giả' },
  ]);

  await db.insert(editions).values([
    { id: 'ed-h01', code: 'H01', workId: 'work-1', title: 'Sách H01', isbn: '9786040000001', isbnLast4: '0001', formatSize: 'PAPERBACK', coverPrice: 250000 },
  ]);

  // 1. Verify discountApprovalRequests table insertion and querying
  const reqId = 'req-test-001';
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  await db.insert(discountApprovalRequests).values({
    id: reqId,
    orderCode: 'ORD-TEST-001',
    warehouseId: 'wh-au-co',
    cashierId: 'staff-thu-ngan',
    cartHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    cartSnapshot: JSON.stringify([{ editionId: 'ed-h01', qty: 2, price: 150000 }]),
    requestedDiscountRate: 0.25,
    originalAmount: 300000,
    discountAmount: 75000,
    finalAmount: 225000,
    status: 'PENDING',
    nonce: 'nonce-12345',
    expiresAt,
    version: 1,
  });

  const [req] = await db
    .select()
    .from(discountApprovalRequests)
    .where(eq(discountApprovalRequests.id, reqId));

  assert.ok(req, 'Phải tìm thấy discount_approval_request vừa tạo');
  assert.equal(req.status, 'PENDING');
  assert.equal(req.requestedDiscountRate, 0.25);
  assert.equal(req.version, 1);
  console.log('✓ discountApprovalRequests insert & query OK');

  // 2. Verify deliveryOrders & deliveryOrderItems insertion and querying
  const deliveryOrderId = 'do-test-001';
  const pxkCode = 'PXK-2026-0001';

  await db.insert(deliveryOrders).values({
    id: deliveryOrderId,
    code: pxkCode,
    partnerId: 'part-ca-chep',
    fromWarehouseId: 'wh-au-co',
    subtotal: 5000000,
    discountRate: 0.4,
    finalAmount: 3000000,
    fiscalScope: 'COMMERCIAL_WHOLESALE',
    status: 'DRAFT',
    createdBy: 'staff-thu-kho',
  });

  await db.insert(deliveryOrderItems).values({
    id: 'doi-test-001',
    deliveryOrderId,
    editionId: 'ed-h01',
    quantity: 20,
    unitCoverPrice: 250000,
    unitSellingPrice: 150000,
    totalAmount: 3000000,
  });

  const [deliveryOrder] = await db
    .select()
    .from(deliveryOrders)
    .where(eq(deliveryOrders.id, deliveryOrderId));

  assert.ok(deliveryOrder, 'Phải tìm thấy deliveryOrder vừa tạo');
  assert.equal(deliveryOrder.code, pxkCode);
  assert.equal(deliveryOrder.status, 'DRAFT');
  assert.equal(deliveryOrder.discountRate, 0.4);

  const items = await db
    .select()
    .from(deliveryOrderItems)
    .where(eq(deliveryOrderItems.deliveryOrderId, deliveryOrderId));

  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 20);
  assert.equal(items[0].totalAmount, 3000000);
  console.log('✓ deliveryOrders & deliveryOrderItems insert & query OK');

  // 3. Unique code on deliveryOrders
  let duplicateError = false;
  try {
    await db.insert(deliveryOrders).values({
      id: 'do-test-002',
      code: pxkCode, // Duplicate
      partnerId: 'part-ca-chep',
      fromWarehouseId: 'wh-au-co',
      subtotal: 1000000,
      discountRate: 0.4,
      finalAmount: 600000,
      status: 'DRAFT',
      createdBy: 'staff-thu-kho',
    });
  } catch (err: any) {
    duplicateError = true;
  }
  assert.ok(duplicateError, 'Insert trùng mã PXK phải ném lỗi UNIQUE constraint');
  console.log('✓ Unique constraint trên PXK code OK');

  client.close();
  for (const s of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(DB_FILE + s); } catch {}
  }
  console.log('🎉 TOÀN BỘ TEST S3 SCHEMA PASS 100%!');
}

run().catch((err) => {
  console.error('❌ Test thất bại:', err);
  process.exit(1);
});
