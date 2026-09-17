import { db, editions, transferShipments, inventoryLedger } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { TransferService, TRANSIT_WAREHOUSE_ID } from '../src/services/transfer.service';
import { toActorContext } from '../src/services/actor-context';
import { eq, sql } from 'drizzle-orm';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-in-transit');

// CP3-B1.1 (mục 5): caller legacy bổ sung actorContext (ROLE_MANAGER thủ kho)
// + idempotencyKey hợp lệ; không đổi assertion nào.
const TCTX = (id: string) => toActorContext(id, 'ROLE_MANAGER');
const TKEY = (tag: string) => `transit-${tag}-${Date.now()}`;

async function runTransitTests() {
  console.log('🚚 ========================================================');
  console.log('🚚 KIỂM THỬ ĐỘNG CƠ LUÂN CHUYỂN 2 BƯỚC QUA TRẠM IN_TRANSIT');
  console.log('🚚 ========================================================\n');

  let passed = 0;
  let total = 0;
  const ok = (cond: boolean, name: string, detail = '') => {
    total++;
    if (cond) {
      passed++;
      console.log(`  ✅ [PASS ${total}] ${name}${detail ? `\n     ↳ ${detail}` : ''}`);
    } else {
      console.error(`  ❌ [FAIL ${total}] ${name}${detail ? ` — ${detail}` : ''}`);
      throw new Error(`Kiểm thử thất bại: ${name}`);
    }
  };

  const allEditions = await db.select().from(editions).limit(2);
  if (allEditions.length < 2) throw new Error('Test DB chưa seed đủ ấn bản.');
  const bookA = allEditions[0];
  const bookB = allEditions[1];
  const QM = 'wh-quynh-mai';
  const AUCO = 'wh-au-co';

  // Chuẩn bị tồn tại Quỳnh Mai cho các phiếu test.
  await InventoryService.recordMovement({
    editionId: bookA.id, warehouseId: QM, eventType: 'RECEIPT', quantityDelta: 100,
    condition: 'NEW', documentRef: 'TEST-TRANSIT-PREP', actorId: 'test-runner',
    idempotencyKey: `transit-prep-a-${Date.now()}`,
  });
  await InventoryService.recordMovement({
    editionId: bookB.id, warehouseId: QM, eventType: 'RECEIPT', quantityDelta: 100,
    condition: 'NEW', documentRef: 'TEST-TRANSIT-PREP', actorId: 'test-runner',
    idempotencyKey: `transit-prep-b-${Date.now()}`,
  });

  // TEST 1: Dispatch QM -> Âu Cơ, hàng vào trạm transit.
  const srcBefore = await InventoryService.getBalance(bookA.id, QM, 'NEW');
  const disp = await TransferService.dispatch({
    fromWarehouseId: QM,
    toWarehouseId: AUCO,
    actorContext: TCTX('thu-kho-qm'),
    idempotencyKey: TKEY('t1'),
    vehicleInfo: 'Xe tải test biển 30H-0001',
    items: [{ editionId: bookA.id, quantity: 20 }],
  });
  const srcAfter = await InventoryService.getBalance(bookA.id, QM, 'NEW');
  const transitAfter = await InventoryService.getBalance(bookA.id, TRANSIT_WAREHOUSE_ID, 'NEW');
  ok(disp.status === 'IN_TRANSIT', 'Dispatch mở phiếu IN_TRANSIT', `Phiếu: ${disp.shipmentId}`);
  ok(srcAfter === srcBefore - 20, 'Kho gửi trừ đúng 20 cuốn', `${srcBefore} -> ${srcAfter}`);
  ok(transitAfter === 20, 'Trạm transit cộng đúng 20 cuốn', `transit = ${transitAfter}`);

  // TEST 2: Receive đủ -> kho đích +20, transit về 0, đóng phiếu FULL.
  const destBefore = await InventoryService.getBalance(bookA.id, AUCO, 'NEW');
  const recv = await TransferService.receive({
    shipmentId: disp.shipmentId,
    actorContext: TCTX('thu-kho-au-co'),
    idempotencyKey: TKEY('t1-recv'),
    items: [{ editionId: bookA.id, receivedQty: 20, damagedQty: 0, lostQty: 0 }],
  });
  const destAfter = await InventoryService.getBalance(bookA.id, AUCO, 'NEW');
  const transitEnd = await InventoryService.getBalance(bookA.id, TRANSIT_WAREHOUSE_ID, 'NEW');
  ok(recv.status === 'RECEIVED_FULL', 'Receive đủ đóng phiếu RECEIVED_FULL');
  ok(destAfter === destBefore + 20, 'Kho đích cộng đúng 20 cuốn', `${destBefore} -> ${destAfter}`);
  ok(transitEnd === 0, 'Trạm transit về 0 sau nhận đủ');

  // TEST 3: Dispatch + nhận lệch (lành/hỏng/mất) -> hạch toán đủ 3 ngả.
  const disp2 = await TransferService.dispatch({
    fromWarehouseId: QM,
    toWarehouseId: AUCO,
    actorContext: TCTX('thu-kho-qm'),
    idempotencyKey: TKEY('t2'),
    items: [{ editionId: bookB.id, quantity: 10 }],
  });
  const destBBefore = await InventoryService.getBalance(bookB.id, AUCO, 'NEW');
  const quarBBefore = await InventoryService.getBalance(bookB.id, AUCO, 'QUARANTINE');
  const recv2 = await TransferService.receive({
    shipmentId: disp2.shipmentId,
    actorContext: TCTX('thu-kho-au-co'),
    idempotencyKey: TKEY('t2-recv'),
    items: [{ editionId: bookB.id, receivedQty: 7, damagedQty: 2, lostQty: 1 }],
  });
  const destBAfter = await InventoryService.getBalance(bookB.id, AUCO, 'NEW');
  const quarBAfter = await InventoryService.getBalance(bookB.id, AUCO, 'QUARANTINE');
  const transitBAfter = await InventoryService.getBalance(bookB.id, TRANSIT_WAREHOUSE_ID, 'NEW');
  ok(recv2.status === 'RECEIVED_DISCREPANCY', 'Nhận lệch đóng phiếu RECEIVED_DISCREPANCY');
  ok(destBAfter === destBBefore + 7, 'Kho đích cộng đúng 7 cuốn lành');
  ok(quarBAfter === quarBBefore + 2, '2 cuốn ướt/rách vào QUARANTINE chờ RMA');
  ok(transitBAfter === 0, 'Transit về 0 (7 về đích + 2 cách ly + 1 mất đã hạch toán)');
  const lossRows = await db
    .select()
    .from(inventoryLedger)
    .where(eq(inventoryLedger.correlationId, disp2.shipmentId));
  const lossRow = lossRows.find((r: any) => r.eventType === 'TRANSFER_LOSS' && r.quantityDelta === -1);
  ok(!!lossRow, 'Bút toán TRANSFER_LOSS -1 cuốn gắn đúng correlationId phiếu');

  // TEST 4: Xuất vượt tồn khi dispatch bị chặn (atomic, không mở phiếu rác).
  const shipCountBefore = (await db.select().from(transferShipments)).length;
  let blocked = false;
  try {
    await TransferService.dispatch({
      fromWarehouseId: QM,
      toWarehouseId: AUCO,
      actorContext: TCTX('thu-kho-qm'),
      idempotencyKey: TKEY('t4-over'),
      items: [{ editionId: bookB.id, quantity: 99999 }],
    });
  } catch {
    blocked = true;
  }
  const shipCountAfter = (await db.select().from(transferShipments)).length;
  ok(blocked && shipCountAfter === shipCountBefore, 'Dispatch vượt tồn bị chặn, không sinh phiếu rác');

  // TEST 5: Nhận 2 lần bị từ chối + Hủy phiếu trả hàng về kho gửi.
  let doubleBlocked = false;
  try {
    await TransferService.receive({
      shipmentId: disp2.shipmentId,
      actorContext: TCTX('thu-kho-au-co'),
      idempotencyKey: TKEY('t5-double'),
      items: [{ editionId: bookB.id, receivedQty: 10 }],
    });
  } catch {
    doubleBlocked = true;
  }
  ok(doubleBlocked, 'Nhận trùng phiếu đã đóng bị từ chối');

  const srcCBefore = await InventoryService.getBalance(bookB.id, QM, 'NEW');
  const disp3 = await TransferService.dispatch({
    fromWarehouseId: QM,
    toWarehouseId: AUCO,
    actorContext: TCTX('thu-kho-qm'),
    idempotencyKey: TKEY('t5-disp'),
    items: [{ editionId: bookB.id, quantity: 5 }],
  });
  const cancelled = await TransferService.cancel({
    shipmentId: disp3.shipmentId,
    actorContext: TCTX('quan-ly-kho'),
    idempotencyKey: TKEY('t5-cancel'),
  });
  const srcCAfter = await InventoryService.getBalance(bookB.id, QM, 'NEW');
  const transitCAfter = await InventoryService.getBalance(bookB.id, TRANSIT_WAREHOUSE_ID, 'NEW');
  ok(cancelled.status === 'CANCELLED', 'Hủy phiếu khi còn IN_TRANSIT');
  ok(srcCAfter === srcCBefore, 'Hàng hủy được rút về kho gửi đủ 5 cuốn');
  ok(transitCAfter === 0, 'Transit về 0 sau hủy phiếu');

  // TEST 6: Cảnh báo phiếu kẹt quá timeout.
  const disp4 = await TransferService.dispatch({
    fromWarehouseId: QM,
    toWarehouseId: AUCO,
    actorContext: TCTX('thu-kho-qm'),
    idempotencyKey: TKEY('t6-disp'),
    items: [{ editionId: bookA.id, quantity: 3 }],
  });
  await db.run(
    sql`UPDATE transfer_shipments SET dispatched_at = datetime('now', '-13 hours') WHERE id = ${disp4.shipmentId}`
  );
  const stale = await TransferService.listStaleShipments(12);
  ok(
    stale.some((s) => s.id === disp4.shipmentId),
    'Phiếu kẹt 13h lọt vào danh sách cảnh báo timeout 12h'
  );
  await TransferService.cancel({
    shipmentId: disp4.shipmentId,
    actorContext: TCTX('quan-ly-kho'),
    idempotencyKey: TKEY('t6-cancel'),
  });

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST IN-TRANSIT 2 BƯỚC ĐẠT 100%!`);
  console.log('========================================================\n');
}

runTransitTests().catch((err) => {
  console.error('❌ test-in-transit thất bại:', err);
  process.exit(1);
});
