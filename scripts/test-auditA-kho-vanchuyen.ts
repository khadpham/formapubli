/**
 * AUDIT A — Lớp KHO / VẬN CHUYỂN / TRẢ HÀNG.
 *
 * QUY TẮC 11: test này GỌI SERVICE THẬT + DB THẬT (migrateFresh trên file
 * riêng). Không có regex file nguồn, không lặp lại logic SQL.
 *
 * DB riêng: formapubli_test_auditA_kho.db (assertIsolatedTestDb chặn nếu
 * trỏ nhầm formapubli.db production).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { assertIsolatedTestDb } from './test-guard';
import { migrateFresh } from './migrate-fresh';

const DB_FILE = path.resolve(process.cwd(), 'formapubli_test_auditA_kho.db');
for (const s of ['', '-wal', '-shm', '-journal']) {
  try { fs.unlinkSync(DB_FILE + s); } catch { /* fresh */ }
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function catchErr(fn: () => Promise<any>) {
  try { await fn(); return null as any; } catch (e: any) { return e; }
}

async function run() {
  console.log('--- AUDIT A: KHO / VẬN CHUYỂN / TRẢ HÀNG ---');

  process.env.DATABASE_URL = 'file:' + DB_FILE.split(path.sep).join('/');
  assertIsolatedTestDb('test-auditA-kho-vanchuyen');
  await migrateFresh({ targetUrl: process.env.DATABASE_URL! });

  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const { and, eq } = await import('drizzle-orm');
  const schema = await import('../src/db/schema');
  const { DeliveryOrderService } = await import('../src/services/delivery-order.service');
  const { RmaService } = await import('../src/services/rma.service');
  const { ReturnService } = await import('../src/services/return.service');
  const { AllocationService } = await import('../src/services/allocation.service');
  const { InventoryService } = await import('../src/services/inventory.service');

  const rawClient = createClient({ url: process.env.DATABASE_URL! });
  const db = drizzle(rawClient);

  // ---------------------------------------------------------------- seed
  const WH1 = 'wh-au-co';
  const WH2 = 'wh-hn-01';
  const PARTNER = 'part-x';
  await db.insert(schema.warehouses).values([
    { id: WH1, code: 'KHO_AU_CO', name: 'Kho Âu Cơ', isActive: true, isSellableOnPos: true, warehouseType: 'PHYSICAL_MAIN' },
    { id: WH2, code: 'KHO_HN01', name: 'Kho Hội Chợ', isActive: true, isSellableOnPos: true, warehouseType: 'FAIR_EVENT' },
  ]);
  await db.insert(schema.partners).values([
    { id: PARTNER, code: 'NS_X', name: 'Nhà sách X', type: 'WHOLESALE', discountRate: 0.4 },
  ]);
  const EDS = ['ed-1', 'ed-2', 'ed-3', 'ed-4'];
  await db.insert(schema.works).values(EDS.map((_, i) => ({ id: `w-${i}`, code: `W${i}`, title: `Tác phẩm ${i}`, author: `TG${i}` })));
  await db.insert(schema.editions).values(EDS.map((id, i) => ({
    id, code: `B0${i + 1}`, workId: `w-${i}`, isbn: `97800000000${i}`, isbnLast4: `000${i}`, coverPrice: 100000,
  })));
  const STAFF = { staffId: 'staff-tk', role: 'ROLE_WAREHOUSE', fullName: 'Thủ Kho' };

  const bal = async (editionId: string, wh = WH1, cond = 'NEW') => {
    const r = await db.select().from(schema.stockBalances).where(and(
      eq(schema.stockBalances.editionId, editionId),
      eq(schema.stockBalances.warehouseId, wh),
      eq(schema.stockBalances.condition, cond),
    )).limit(1);
    return r[0]?.physicalQuantity ?? null;
  };
  const setBal = async (editionId: string, qty: number, wh = WH1) => {
    await db.insert(schema.stockBalances).values({
      id: `sb-${editionId}-${wh}-NEW`, productId: editionId, editionId, warehouseId: wh, condition: 'NEW', physicalQuantity: qty,
    }).onConflictDoNothing();
    await db.update(schema.stockBalances)
      .set({ physicalQuantity: qty })
      .where(and(eq(schema.stockBalances.editionId, editionId), eq(schema.stockBalances.warehouseId, wh)));
  };

  // =====================================================================
  // A1. createDraft KHÔNG validate số lượng => số âm BÙNG TỒN
  // =====================================================================
  // A1. createDraft PHẢI validate số lượng (trước fix: số âm làm tồn TĂNG 0 -> 5
  //     và sổ cái ghi bút toán DƯƠNG +5 cho một lệnh xuất; trigger 0027/0029 chỉ
  //     chặn tồn ÂM nên không bắt được).
  // =====================================================================
  console.log('\n[A1] delivery-order: chặn số lượng âm / thập phân / NaN và đơn giá âm');
  await setBal('ed-1', 0);
  const before1 = await bal('ed-1');
  const eNeg = await catchErr(() => DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-1', quantity: -5 as any, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  }));
  ok('A1.1 số lượng âm bị từ chối', eNeg?.code === 'INVALID_INPUT', `code = ${eNeg?.code || 'không ném'}`);
  ok('A1.2 tồn KHÔNG bị bùng tăng (trước fix: 0 -> 5)', (await bal('ed-1')) === before1,
    `tồn ${before1} -> ${await bal('ed-1')}`);
  const negRows = await db.select().from(schema.deliveryOrders)
    .where(eq(schema.deliveryOrders.partnerId, PARTNER));
  ok('A1.3 không có phiếu nào chứa số lượng âm / tiền âm',
    negRows.every((r: any) => r.status === 'DRAFT' && r.subtotal >= 0),
    `số phiếu đang tồn = ${negRows.length}`);

  await setBal('ed-1', 50);
  const e2 = await catchErr(() => DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-1', quantity: 1.5, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  }));
  ok('A1.4 số lượng phân thập phân bị từ chối', e2?.code === 'INVALID_INPUT', `code = ${e2?.code || 'không ném'}`);

  const e3 = await catchErr(() => DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-1', quantity: Number('abc') as any, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  }));
  ok('A1.5 số lượng NaN bị từ chối', e3?.code === 'INVALID_INPUT', `code = ${e3?.code || 'không ném'}`);

  const e4 = await catchErr(() => DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-1', quantity: 2, unitCoverPrice: 100000, unitSellingPrice: -60000 },
    ], actorContext: STAFF,
  }));
  ok('A1.6 đơn giá bán âm bị từ chối (âm tiền bán số âm)', e4?.code === 'INVALID_INPUT', `MSG=${e4?.message}`);

  const e4b = await catchErr(() => DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-1', quantity: 2, unitCoverPrice: -100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  }));
  ok('A1.7 đơn giá bìa âm bị từ chối (giá vốn âm làm sai số liệu)', e4b?.code === 'INVALID_INPUT', `MSG=${e4b?.message}`);

  const draftOk3 = await DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-2', quantity: 3, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  });
  await setBal('ed-2', 10);
  await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: draftOk3.id, idempotencyKey: 'auditA-a1-frac', actorContext: STAFF,
  });
  ok('A1.7 số lượng nguyên không làm tồn phân lẻ', (await bal('ed-2')) === 7, `tồn = ${await bal('ed-2')}`);

  // =====================================================================
  // A2. dispatchAndLock kiểm PHYSICAL chứ không ATP
  // =====================================================================
  console.log('\n[A2] delivery-order: ATP guard dùng tồn vật lý, không trừ tồn đang giữ cho đơn online');
  await setBal('ed-3', 5);
  await db.insert(schema.orders).values({
    id: 'ord-pending-1', orderCode: 'ORD-PENDING-1', warehouseId: WH1, channel: 'ONLINE',
    subtotal: 500000, finalAmount: 500000, paymentMethod: 'BANK_TRANSFER',
    status: 'PENDING_CONFIRMATION', cashierId: 'staff-tn', idempotencyKey: 'idem-ord-pending-1',
  });
  await db.insert(schema.orderItems).values({
    id: 'oi-pending-1', productId: 'ed-3', orderId: 'ord-pending-1', editionId: 'ed-3', quantity: 5,
    unitCoverPrice: 70000, unitSellingPrice: 100000, totalAmount: 500000,
  });
  const { OrderService } = await import('../src/services/order.service');
  const atpNow = await OrderService.getATP('ed-3', WH1);
  ok('A2.0 ATP thực = 0 (5 tồn vật lý đều giữ cho đơn online)', atpNow === 0, `ATP = ${atpNow}`);

  const draftSteal = await DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-3', quantity: 5, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  });
  const eSteal = await catchErr(() => DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: draftSteal.id, idempotencyKey: 'auditA-a2-steal', actorContext: STAFF,
  }));
  const after2 = await bal('ed-3');
  ok('A2.1 xuất sỉ phải bị chặn vì ATP = 0', eSteal?.code === 'INSUFFICIENT_ATP', `code = ${eSteal?.code || 'không ném'}`);
  ok('A2.2 tồn không bị lấy mất cho đại lý', after2 === 5, `tồn = ${after2}`);

  // =====================================================================
  // A3. Idempotency replay không đối chiếu fingerprint
  // =====================================================================
  console.log('\n[A3] delivery-order: dùng lại idempotencyKey cho phiếu khác trả về phiếu cũ');
  await setBal('ed-4', 100);
  const dA = await DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-4', quantity: 4, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  });
  const dB = await DeliveryOrderService.createDraft({
    partnerId: PARTNER, fromWarehouseId: WH1, items: [
      { editionId: 'ed-4', quantity: 7, unitCoverPrice: 100000, unitSellingPrice: 60000 },
    ], actorContext: STAFF,
  });
  const lockA = await DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: dA.id, idempotencyKey: 'auditA-a3-shared', actorContext: STAFF,
  });
  const balAfterA = await bal('ed-4');
  const eA3 = await catchErr(() => DeliveryOrderService.dispatchAndLock({
    deliveryOrderId: dB.id, idempotencyKey: 'auditA-a3-shared', actorContext: STAFF,
  }));
  const bRow = (await db.select().from(schema.deliveryOrders).where(eq(schema.deliveryOrders.id, dB.id)))[0];
  ok('A3.1 replay key cho phiếu KHÁC phải 409 chứ không phải trả kết quang',
    eA3?.code === 'IDEMPOTENCY_CONFLICT', `code = ${eA3?.code || 'không ném'}`);
  ok('A3.2 phiếu B vẫn ở DRAFT (không bị đổi mã theo phiếu A)',
    bRow?.status === 'DRAFT', `status = ${bRow?.status}`);
  ok('A3.3 tồn không bị trừ nhầm do replay sai', (await bal('ed-4')) === balAfterA,
    `tồn ${balAfterA} -> ${await bal('ed-4')}`);
  ok('A3.4 replay CÙNG phiếu + CÙNG key vẫn trả kết quang (không phải 409)',
    (await DeliveryOrderService.dispatchAndLock({
      deliveryOrderId: dA.id, idempotencyKey: 'auditA-a3-shared', actorContext: STAFF,
    })).code === lockA.code, `code = ${lockA.code}`);

  // =====================================================================
  // A4. RmaService.resolveTicket KHÔNG atomic
  // =====================================================================
  console.log('\n[A4] RMA: resolveTicket không bọc transaction');
  await setBal('ed-1', 100);
  const ticket = await RmaService.createTicket({
    warehouseId: WH1, editionId: 'ed-1', quantity: 6, defectReason: 'PRINT_DEFECT',
    sourceCondition: 'NEW', targetCondition: 'QUARANTINE', inspectedBy: STAFF.staffId,
  });
  ok('A4.0 tồn NEW 100->94, QUARANTINE = 6',
    (await bal('ed-1', WH1, 'NEW')) === 94 && (await bal('ed-1', WH1, 'QUARANTINE')) === 6,
    `NEW=${await bal('ed-1', WH1, 'NEW')} QUA=${await bal('ed-1', WH1, 'QUARANTINE')}`);

  await rawClient.execute(`CREATE TRIGGER auditA_boom BEFORE INSERT ON inventory_ledger
    WHEN NEW.condition = 'NEW' AND NEW.document_ref = '${ticket.id}'
    BEGIN SELECT RAISE(ABORT, 'auditA: fault injection'); END`);

  const qBefore = await bal('ed-1', WH1, 'QUARANTINE');
  const nBefore = await bal('ed-1', WH1, 'NEW');
  const eA4 = await catchErr(() => RmaService.resolveTicket({
    ticketId: ticket.id, action: 'REPAIRED_RESTOCK', actorId: STAFF.staffId, notes: 'audit',
  }));
  const qAfter = await bal('ed-1', WH1, 'QUARANTINE');
  const nAfter = await bal('ed-1', WH1, 'NEW');
  const tkRow = (await db.select().from(schema.rmaTickets).where(eq(schema.rmaTickets.id, ticket.id)))[0];
  ok('A4.1 resolveTicket lỗi giữa chừng phải rollback trọn vẹn (tồn lệch hoàn toàn)',
    qAfter === qBefore && nAfter === nBefore, `QUA ${qBefore}->${qAfter}, NEW ${nBefore}->${nAfter}`);
  ok('A4.2 phiếu RMA vẫn QUARANTINED sau lỗi (không mới thành RESOLVED)',
    tkRow?.status === 'QUARANTINED', `status = ${tkRow?.status}`);
  ok('A4.3 lỗi được báo ra cho caller', eA4 !== null, `lỗi = ${(eA4?.message || 'không').slice(0, 40)}`);

  await rawClient.execute('DROP TRIGGER IF EXISTS auditA_boom');
  const eRetry = await catchErr(() => RmaService.resolveTicket({
    ticketId: ticket.id, action: 'REPAIRED_RESTOCK', actorId: STAFF.staffId, notes: 'audit retry',
  }));
  const qRetry = await bal('ed-1', WH1, 'QUARANTINE');
  const nRetry = await bal('ed-1', WH1, 'NEW');
  ok('A4.4 gọi lại sau lỗi phải thành công và tồn về đúng lệch (không trừ 2 lần)',
    eRetry === null && qRetry === 0 && nRetry === 100,
    `lỗi lần 2 = ${(eRetry?.message || 'không').slice(0, 60)} | QUA=${qRetry} NEW=${nRetry}`);

  // Vùng dữ liệu đã hỏng: dựng lại tồn + phiếu mới cho các mục sau.
  await setBal('ed-1', 100);
  await db.update(schema.stockBalances).set({ physicalQuantity: 0 })
    .where(and(eq(schema.stockBalances.editionId, 'ed-1'), eq(schema.stockBalances.condition, 'QUARANTINE')));
  const ticket2 = await RmaService.createTicket({
    warehouseId: WH1, editionId: 'ed-1', quantity: 3, defectReason: 'PRINT_DEFECT',
    sourceCondition: 'NEW', targetCondition: 'QUARANTINE', inspectedBy: STAFF.staffId,
  });
  const res2 = await RmaService.resolveTicket({
    ticketId: ticket2.id, action: 'WRITE_OFF_SCRAP', actorId: STAFF.staffId,
  });
  ok('A4.5 phiếu RMA hợp lệ chuyển SCRAPPED và tồn về 97',
    res2.status === 'SCRAPPED' && (await bal('ed-1', WH1, 'NEW')) === 97,
    `status=${res2?.status} NEW=${await bal('ed-1', WH1, 'NEW')}`);

  // A4.6: chỉ phiếu QUARANTINED mới được giải tỏa. Trạng thái khác
  // (ví dụ PENDING_INSPECTION — còn chờ kiểm định) phải bị chặn, và tồn
  // không được đụng. Trước fix: chỉ kiểm RESOLVED/SCRAPPED rồi chạy thẳng
  // bút toán ⇒ xử lý phiếu chưa được thẩm định là tự tạo tồn.
  const ticket3 = await RmaService.createTicket({
    warehouseId: WH1, editionId: 'ed-1', quantity: 2, defectReason: 'PRINT_DEFECT',
    sourceCondition: 'NEW', targetCondition: 'QUARANTINE', inspectedBy: STAFF.staffId,
  });
  await db.update(schema.rmaTickets).set({ status: 'PENDING_INSPECTION' })
    .where(eq(schema.rmaTickets.id, ticket3.id));
  const qBefore6 = await bal('ed-1', WH1, 'QUARANTINE');
  const nBefore6 = await bal('ed-1', WH1, 'NEW');
  const e46 = await catchErr(() => RmaService.resolveTicket({
    ticketId: ticket3.id, action: 'REPAIRED_RESTOCK', actorId: STAFF.staffId,
  }));
  ok('A4.6 phiếu chưa QUARANTINED bị từ chối giải tỏa', e46 !== null,
    `lỗi = ${(e46?.message || 'không ném').slice(0, 50)}`);
  ok('A4.7 tồn không bị đụng khi phiếu chưa được thẩm định',
    (await bal('ed-1', WH1, 'QUARANTINE')) === qBefore6 && (await bal('ed-1', WH1, 'NEW')) === nBefore6,
    `QUA=${await bal('ed-1', WH1, 'QUARANTINE')} NEW=${await bal('ed-1', WH1, 'NEW')}`);

  // =====================================================================
  // A5. ReturnService.list limit 200 rồi filter JS => mất phiếu
  // =====================================================================
  // =====================================================================
  // A5. ReturnService.list limit 200 rồi filter JS => mất phiếu
  //
  // Bố cục CỐ Ý để mỗi bộ lọc đều "gánh" trọng số:
  //   - 300 phiếu MỚI của đơn khác (đẩy mọi phiếu cũ ra ngoài 200 dòng đầu).
  //   - 3 phiếu CŨ của đơn đích, trạng thái COMPLETED.
  // Bỏ bộ lọc nào trong SQL thì bộ lọc đó trả 0 dòng ⇒ test phải đỏ.
  // =====================================================================
  console.log('\n[A5] returns: list() limit 200 trước lọc trong JS');
  const orderId = 'ord-ret-list';
  const otherOrderId = 'ord-ret-noise';
  for (const o of [orderId, otherOrderId]) {
    await db.insert(schema.orders).values({
      id: o, orderCode: o.toUpperCase(), warehouseId: WH1, channel: 'RETAIL_OFFICE',
      subtotal: 100000, finalAmount: 100000, paymentMethod: 'BANK_TRANSFER',
      status: 'COMPLETED', cashierId: 'staff-tn', idempotencyKey: `idem-${o}`,
    });
    await db.insert(schema.orderItems).values({
      id: `oi-${o}`, productId: 'ed-2', orderId: o, editionId: 'ed-2', quantity: 300,
      unitCoverPrice: 70000, unitSellingPrice: 100000, totalAmount: 30000000,
    });
  }
  const noiseRows: any[] = [];
  for (let i = 0; i < 300; i++) {
    noiseRows.push({
      id: `ret-noise-${i}`, orderId: otherOrderId, returnCode: `RET-N-${i}`, returnType: 'REFUND',
      reason: 'WRONG_ITEM', targetWarehouseId: WH1, inventoryDisposition: 'RESTOCK',
      status: 'REQUESTED', refundAmount: 0, createdBy: 'staff-tn',
      idempotencyKey: `idem-ret-noise-${i}`, fingerprint: `fpn-${i}`,
      createdAt: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
    });
  }
  for (let i = 0; i < noiseRows.length; i += 60) await db.insert(schema.returnOrders).values(noiseRows.slice(i, i + 60));
  const targetRows: any[] = [];
  for (let i = 0; i < 3; i++) {
    targetRows.push({
      id: `ret-target-${i}`, orderId, returnCode: `RET-T-${i}`, returnType: 'REFUND',
      reason: 'WRONG_ITEM', targetWarehouseId: WH1, inventoryDisposition: 'RESTOCK',
      status: 'COMPLETED', refundAmount: 0, createdBy: 'staff-tn',
      idempotencyKey: `idem-ret-target-${i}`, fingerprint: `fpt-${i}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    });
  }
  await db.insert(schema.returnOrders).values(targetRows);
  const byOrder = await ReturnService.list({ orderId });
  ok('A5.1 lọc theo orderId phải tìm được phiếu nằm ngoài 200 dòng đầu',
    byOrder.length === 3, `trả về = ${byOrder.length} (mong = 3)`);
  const byStatus = await ReturnService.list({ status: 'COMPLETED' });
  ok('A5.2 lọc theo status phải tìm được phiếu nằm ngoài 200 dòng đầu',
    byStatus.length === 3, `trả về = ${byStatus.length} (mong = 3)`);
  const byBoth = await ReturnService.list({ orderId, status: 'COMPLETED' });
  ok('A5.3 lọc cả hai chiều vẫn đúng 3 phiếu', byBoth.length === 3, `trả về = ${byBoth.length}`);
  const all = await ReturnService.list({});
  ok('A5.4 không lọc thì vẫn giới hạn 200 dòng (không kéo cả bảng)',
    all.length === 200, `trả về = ${all.length}`);

  // =====================================================================
  // A6. Allocation: quota bàn quầy không khớp kho
  // =====================================================================
  console.log('\n[A6] allocation: quota bàn quầy không có kho nào');
  await setBal('ed-2', 50, WH1);
  await setBal('ed-2', 0, WH2);
  await AllocationService.allocateBooksToCounter({
    warehouseId: WH1, counterName: 'Bàn 1', allocations: [{ editionId: 'ed-2', allocatedQuantity: 3 }],
  });
  const leak: any = await (AllocationService as any).checkCounterQuota('Bàn 1', 'ed-2', 1, WH2);
  ok('A6.1 checkCounterQuota phải biết kho để biết mắm (không có hạn ngạch)',
    leak?.hasAllocation === false, `hasAllocation = ${leak?.hasAllocation}`);
  const leak2: any = await (AllocationService as any).checkCounterQuota('Bàn 1', 'ed-2', 1, WH1);
  ok('A6.2 cùng tên bàn + cùng kho vẫn thấy hạn ngạch', leak2?.hasAllocation === true,
    `hasAllocation = ${leak2?.hasAllocation}`);

  await (AllocationService as any).recordCounterSales('Bàn 1', [{ editionId: 'ed-2', quantity: 2 }], WH2);
  const afterLeak2 = await (AllocationService as any).checkCounterQuota('Bàn 1', 'ed-2', 1, WH1);
  ok('A6.3 recordCounterSales khớp nhầm của kho khác không được đụng hạn ngạch kho này',
    afterLeak2?.sold === 0, `sold kho ${WH1} = ${afterLeak2?.sold}`);

  // =====================================================================
  // A7. allocateBooksToCounter không atomic
  // =====================================================================
  console.log('\n[A7] allocation: chốt hàng loạt không atomic');
  await db.insert(schema.works).values({ id: 'w-ok', code: 'WOK', title: 'Tác phẩm OK', author: 'TG OK' });
  await db.insert(schema.editions).values({
    id: 'ed-ok', code: 'BOK', workId: 'w-ok', isbn: '978000000099', isbnLast4: '0099', coverPrice: 50000,
  });
  const eA7 = await catchErr(() => AllocationService.allocateBooksToCounter({
    warehouseId: WH1, counterName: 'Bàn 2',
    allocations: [
      { editionId: 'ed-ok', allocatedQuantity: 5 },
      { editionId: 'ed-khong-ton-tai', allocatedQuantity: 5 },
    ],
  }));
  const half = await db.select().from(schema.counterAllocations)
    .where(eq(schema.counterAllocations.counterName, 'Bàn 2'));
  ok('A7.1 dòng đầu ghi thành công, dòng sau lỗi phải rollback hết (all-or-nothing)',
    half.length === 0, `số dòng còn ghi = ${half.length} (mong = 0)`);
  ok('A7.2 lỗi được báo ra cho caller', eA7 !== null, `lỗi = ${(eA7?.message || 'không').slice(0, 50)}`);

  // =====================================================================
  // A8. recordMovement: quantityDelta không phải số nguyên
  // =====================================================================
  console.log('\n[A8] inventory.recordMovement: delta thập phân lọt vào tồn');
  await setBal('ed-3', 10);
  const eA8 = await catchErr(() => InventoryService.recordMovement({
    editionId: 'ed-3', warehouseId: WH1, eventType: 'ADJUSTMENT', quantityDelta: 1.5,
    documentRef: 'AUDIT-A8', idempotencyKey: 'auditA-a8-frac',
  }));
  ok('A8.1 recordMovement từ chối delta thập phân', eA8?.code === 'INVALID_INPUT',
    `code = ${eA8?.code || 'không ném'}`);
  ok('A8.2 tồn không bị lẻn phân thập phân', (await bal('ed-3')) === 10, `tồn = ${await bal('ed-3')}`);

  // ---------------------------------------------------------------- tổng
  console.log(`\n=== KẾT QUẢ: ${pass} PASS / ${fail} FAIL ===`);
  if (failures.length) {
    console.log('Các mục FAIL:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (fail > 0) process.exit(1);
  console.log('PASS toàn bộ.');
}

run().catch((e) => { console.error('CRASH:', e); process.exit(2); });
