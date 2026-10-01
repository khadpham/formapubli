/**
 * scripts/test-s2-pos-catalog.ts — Kiểm thử backend Sprint 2 (V4.1 S2.0).
 * DB riêng formapubli_test_s2.db. Chạy:
 * DATABASE_URL=file:formapubli_test_s2.db npx tsx scripts/test-s2-pos-catalog.ts
 */
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

assertIsolatedTestDb('test-s2-pos-catalog');

const failures: string[] = [];
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`✅ PASS: ${name}`);
  else { console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_s2.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

async function main() {
  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-s2-pos-catalog');

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('../src/db/schema');
  const { WarehouseService } = await import('../src/services/warehouse.service');
  const { PosCatalogService } = await import('../src/services/pos-catalog.service');
  const { OrderService } = await import('../src/services/order.service');
  const { toActorContext } = await import('../src/services/actor-context');
  const { eq } = await import('drizzle-orm');

  const MGR = toActorContext('s2-manager', 'ROLE_MANAGER');
  const MAIN = 'wh-main';
  const FAIR = 'wh-fair-a';

  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });
  const raw = createClient({ url: process.env.DATABASE_URL! });
  const seedDb = drizzle(raw);
  await seedDb.insert(schema.works).values([
    { id: 'work-s2-a', code: 'S2-A', title: 'S2 Alpha', author: 'S2' },
    { id: 'work-s2-b', code: 'S2-B', title: 'S2 Beta', author: 'S2' },
  ]);
  await seedDb.insert(schema.editions).values([
    { id: 'ed-s2-a', code: 'S2-A', workId: 'work-s2-a', isbn: '9786000001001', isbnLast4: '1001', coverPrice: 100000 },
    { id: 'ed-s2-b', code: 'S2-B', workId: 'work-s2-b', isbn: '9786000001002', isbnLast4: '1002', coverPrice: 200000 },
  ]);
  await seedDb.insert(schema.warehouses).values([
    { id: MAIN, code: 'KHO_MAIN', name: 'Kho chinh', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: FAIR, code: 'KHO_FAIR_A', name: 'Kho fair A', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' },
    { id: 'wh-dead', code: 'KHO_DEAD', name: 'Kho ngung', isActive: false, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: 'wh-transit', code: 'KHO_TR', name: 'Trung chuyen', isActive: true, isSellableOnPos: false, warehouseType: 'IN_TRANSIT' },
  ]);
  for (const [eid, qty] of [['ed-s2-a', 50], ['ed-s2-b', 5]] as const) {
    await seedDb.insert(schema.inventoryLedger).values({
      id: `led-s2-${eid}`, editionId: eid, productId: eid, warehouseId: MAIN, eventType: 'OPENING_BALANCE',
      quantityDelta: qty, condition: 'NEW', documentRef: 'OPEN-S2', actorId: 's2', idempotencyKey: `idem-s2-${eid}`,
    });
    await seedDb.insert(schema.stockBalances).values({ id: `sb-s2-${eid}`, productId: eid, editionId: eid, warehouseId: MAIN, condition: 'NEW', physicalQuantity: qty });
  }
  raw.close();

  // 1. listSellable: chỉ main + fair (loại inactive + transit).
  const sell = await WarehouseService.listSellable();
  const ids = sell.map((w) => w.id).sort();
  ok('C1 listSellable = [main, fair]', JSON.stringify(ids) === JSON.stringify([FAIR, MAIN]), JSON.stringify(ids));

  // 2. catalog main: atp đủ, soldToday = 0.
  const c0: any = await PosCatalogService.getCatalog(MAIN);
  const a0 = c0.items.find((i: any) => i.editionId === 'ed-s2-a');
  const b0 = c0.items.find((i: any) => i.editionId === 'ed-s2-b');
  ok('C2 catalog main atp (50/5), soldToday 0', a0?.atp === 50 && b0?.atp === 5 && a0?.soldToday === 0, JSON.stringify(c0.items));

  // 3. bán 3 cuốn A tại main → soldToday main = 3, fair = 0.
  await OrderService.createOrder({
    warehouseId: MAIN, channel: 'FAIR_EVENT', customerName: 'S2', idempotencyKey: 's2-ord-1',
    items: [{ editionId: 'ed-s2-a', quantity: 3 }], actorContext: MGR,
  });
  const cMain: any = await PosCatalogService.getCatalog(MAIN);
  const cFair: any = await PosCatalogService.getCatalog(FAIR);
  ok('C3 soldToday main A = 3', cMain.items.find((i: any) => i.editionId === 'ed-s2-a')?.soldToday === 3);
  ok('C3 soldToday fair A = 0 (tách theo kho)', cFair.items.find((i: any) => i.editionId === 'ed-s2-a')?.soldToday === 0);
  ok('C3 fair atp = physical = 0 (chưa chuyển hàng)', cFair.items.every((i: any) => i.atp === 0));

  // 4. pending giữ chỗ ở main trừ atp catalog.
  await OrderService.createOrder({
    warehouseId: MAIN, channel: 'ONLINE', customerName: 'OL', confirmImmediately: false,
    idempotencyKey: 's2-pend-1', items: [{ editionId: 'ed-s2-b', quantity: 2 }], actorContext: MGR,
  });
  const c4: any = await PosCatalogService.getCatalog(MAIN);
  ok('C4 catalog main B atp = 5-2 giữ chỗ = 3', c4.items.find((i: any) => i.editionId === 'ed-s2-b')?.atp === 3);
  ok('C4 pending KHÔNG tính soldToday', c4.items.find((i: any) => i.editionId === 'ed-s2-b')?.soldToday === 0);

  // 5. ĐƠN CHUYỂN KHOẢN QUẦY HẾT HẠN PHẢI NHẢ ATP (lỗi đã sửa 2026-09-29).
  // Trước đây pos-catalog cộng thẳng mọi đơn PENDING trong 48h, bỏ qua
  // payment_expires_at, nên đơn quầy hết hạn sau 30 phút vẫn chặn ATP tới 48
  // giờ ⇒ quầy báo hết hàng oan, khác hẳn OrderService.getBatchATP.
  const pend: any = await OrderService.createOrder({
    warehouseId: MAIN, channel: 'FAIR_EVENT', customerName: 'CK', paymentMethod: 'BANK_TRANSFER',
    confirmImmediately: false, idempotencyKey: 's2-pend-2',
    items: [{ editionId: 'ed-s2-b', quantity: 1 }], actorContext: MGR,
  });
  ok('C6 đơn CK quầy được đặt hạn 30 phút', !!pend?.paymentExpiresAt, String(pend?.paymentExpiresAt));
  const heldLive = await PosCatalogService.getCatalog(MAIN);
  ok('C6 đơn CK còn hạn vẫn giữ ATP', heldLive.items.find((i: any) => i.editionId === 'ed-s2-b')?.atp === 2,
     String(heldLive.items.find((i: any) => i.editionId === 'ed-s2-b')?.atp));

  // Lùi payment_expires_at về quá khứ để giả lập đơn quá hạn 30 phút.
  // Client `raw` đã đóng ở trên (dòng seed xong), nên mở client riêng cho 1 lệnh.
  const fixClient = createClient({ url: process.env.DATABASE_URL! });
  const fixDb = drizzle(fixClient);
  const back = await fixDb.update(schema.orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 60_000).toISOString() })
    .where(eq(schema.orders.id, pend.orderId));
  fixClient.close();
  ok('C6 lùi được payment_expires_at về quá khứ', Number(back.rowsAffected ?? 0) === 1, String(back.rowsAffected));

  const afterExpiry = await PosCatalogService.getCatalog(MAIN);
  ok('C6 đơn CK quá hạn KHÔNG còn giữ ATP (trả lại đủ 3)', afterExpiry.items.find((i: any) => i.editionId === 'ed-s2-b')?.atp === 3,
     String(afterExpiry.items.find((i: any) => i.editionId === 'ed-s2-b')?.atp));

  // Cùng lúc đó, quy tắc của OrderService phải KHỚP — chỉ còn một nơi quyết định.
  const atpViaOrder = await OrderService.getATP('ed-s2-b', MAIN);
  ok('C6 catalog KHỚP OrderService.getATP', atpViaOrder === 3, String(atpViaOrder));

  // 6. kho ngưng → INVALID_INPUT.
  let err5: any = null;
  try { await PosCatalogService.getCatalog('wh-dead'); } catch (e: any) { err5 = e; }
  ok('C5 kho ngưng → INVALID_INPUT', err5?.code === 'INVALID_INPUT', err5?.code);

  if (failures.length > 0) { console.error(`\n❌ S2-backend: ${failures.length} case FAIL`); process.exit(1); }
  console.log('\n🎉 S2 BACKEND (warehouses + catalog): tất cả cases PASS!');
}

main().catch((e) => { console.error('❌ S2-backend sập:', e); process.exit(1); });
