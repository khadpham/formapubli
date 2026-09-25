/**
 * POS Transfer Payment Photo — server side (Kilo).
 * Task 1: migration payment_expires_at + shared expiry rule.
 * Task 2: cashier authorization / proof gate / close-shift guard.
 * Task 3: pending creation + offline sync API contract.
 * Mỗi DB test dùng file -test- riêng qua test-guard.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { migrateFresh } from './migrate-fresh';
import { assertIsolatedTestDb } from './test-guard';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_transfer_payment.db');
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + suffix); } catch { /* fresh */ }
}

async function run() {
  process.env.DATABASE_URL = `file:${DB_FILE.split(path.sep).join('/')}`;
  assertIsolatedTestDb('test-transfer-payment-flow');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL });

  const raw = createClient({ url: process.env.DATABASE_URL });
  const columns = await raw.execute('PRAGMA table_info(orders)');
  const names = columns.rows.map((row: any) => row.name ?? row[1]);
  assert.ok(names.includes('payment_expires_at'), 'orders phải có payment_expires_at');

  const indexes = await raw.execute("SELECT name FROM sqlite_master WHERE type='index'");
  const indexNames = indexes.rows.map((row: any) => row.name ?? row[0]);
  assert.ok(indexNames.includes('idx_orders_payment_expires_at'));

  const { OrderService } = await import('../src/services/order.service');
  const explicit = new Date('2026-09-25T10:00:00.000Z');
  const legacy = new Date('2026-09-23T10:00:00.000Z');
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: explicit.toISOString(), paymentExpiresAt: '2026-09-25T10:30:00.000Z' })?.toISOString(),
    '2026-09-25T10:30:00.000Z'
  );
  assert.equal(
    OrderService.getPendingEffectiveExpiry({ createdAt: legacy.toISOString(), paymentExpiresAt: null })?.toISOString(),
    new Date(legacy.getTime() + 48 * 3600_000).toISOString()
  );

  raw.close();
  console.log('PAYMENT EXPIRY MIGRATION PASS');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
