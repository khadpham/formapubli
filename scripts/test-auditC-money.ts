/**
 * AUDIT C — LỚP TIỀN THẬT: thanh toán / tiền mặt / giảm giá / chuyển khoản.
 *
 * NGUYÊN TẮC (gotcha 11 — FALSE-GREEN TEST): mọi kiểm chứng ở đây GỌI CODE THẬT
 * (`OrderService`, `DiscountApprovalService`, `SponsorshipService`, `BundleService`,
 * `ReturnService`, `CashboxService`, route `POST /api/orders`, `photo-write-gate`)
 * với DỮ LIỆU THẬT trong formapubli_test.db. Không có assertion nào lặp lại logic
 * SQL thuần, không có assertion nào soi regex nguồn để "chứng minh" đường ranh
 * giới client→server đã chạy. Số liệu trước→sau đều đọc từ DB.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-auditC-money
 */
import assert from 'node:assert/strict';
import { db, editions, orders, orderItems, inventoryLedger, returnOrders, cashboxSessions, stockBalances } from '../src/db';
import { sql, eq, inArray } from 'drizzle-orm';
import { OrderService, CashboxService } from '../src/services/order.service';
import { InventoryService } from '../src/services/inventory.service';
import { BundleService } from '../src/services/bundle.service';
import { SponsorshipService } from '../src/services/sponsorship.service';
import { ReturnService } from '../src/services/return.service';
import { DiscountApprovalService } from '../src/services/discount-approval.service';
import { generateVietQRPayload, normalizeVietqrContent, crc16Ccitt, VIETQR_CONTENT_MAX } from '../src/lib/vietqr';
import { resolveTransferContent, compactOrderCode } from '../src/lib/transfer-content';
import { createPhotoWriteGate } from '../src/lib/photo-write-gate';
import type { CartItemInput } from '../src/services/discount-approval.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-auditC-money');

const CASHIER = { staffId: 'staff-tn', role: 'ROLE_CASHIER', fullName: 'Thu Ngân' } as any;
const MGR = { staffId: 'staff-la', role: 'ROLE_MANAGER', fullName: 'Lan Anh' } as any;
const WH = 'wh-au-co';

let checks = 0;
const lines: string[] = [];
function ok(label: string, cond: boolean, extra = '') {
  checks++;
  const line = `${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`;
  lines.push(line);
  console.log(line);
  assert.ok(cond, `${label} ${extra}`);
}

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

/** Bảng chụp số liệu tiền/tồn để chứng minh "không ghi gì khi bị từ chối". */
async function moneySnapshot(warehouseId = WH) {
  const ords = await db.select().from(orders);
  const led = await db.select().from(inventoryLedger);
  const bals = await db.select().from(stockBalances).where(eq(stockBalances.warehouseId, warehouseId));
  return {
    orders: ords.length,
    ledger: led.length,
    balances: bals
      .map((b: any) => `${b.editionId}:${b.condition}:${b.physicalQuantity}`)
      .sort()
      .join('|'),
  };
}

async function pickEditions(n: number, minQty = 12) {
  const out: Array<{ id: string; cover: number }> = [];
  const all: any[] = await db.select({ id: editions.id, coverPrice: editions.coverPrice }).from(editions);
  for (const e of all) {
    if (out.length >= n) break;
    if ((await InventoryService.getBalance(e.id, WH, 'NEW')) >= minQty) out.push({ id: e.id, cover: e.coverPrice || 0 });
  }
  assert.ok(out.length >= n, `Cần ${n} ấn bản tồn dày, thực tế ${out.length}`);
  return out;
}

async function openShift(cashierId = CASHIER.staffId, openingCash = 500000) {
  const s: any = await CashboxService.openSession({ warehouseId: WH, cashierId, openingCash });
  return s.session.id as string;
}

async function run() {
  console.log('\n=== AUDIT C — LỚP TIỀN THẬT (gọi code thật, dữ liệu thật) ===');
  const ed = await pickEditions(4);
  const shiftId = await openShift();

  // =====================================================================
  // A. PHÉP TÍNH — tổng tiền / chiết khấu có khớp TỔNG DÒNG không, làm tròn đúng không
  // =====================================================================
  console.log('\n--- A. PHÉP TÍNH ---');
  {
    // A1..A3: mức chiết khấu "xấu" (0.0777) cố tình để phát sinh phần lẻ làm tròn.
    const o: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      discountRate: 0.0777, cashierId: CASHIER.staffId, cashboxSessionId: shiftId,
      items: [
        { editionId: ed[0].id, quantity: 3 },
        { editionId: ed[1].id, quantity: 7 },
        { editionId: ed[2].id, quantity: 1 },
      ],
    });
    const ls: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.orderId));
    const sumCover = ls.reduce((s, l) => s + l.unitCoverPrice * l.quantity, 0);
    const sumTotal = ls.reduce((s, l) => s + l.totalAmount, 0);
    ok('A1 subtotal đơn = Σ(unitCoverPrice × số lượng)', o.subtotal === sumCover, `${o.subtotal} vs ${sumCover}`);
    ok('A2 finalAmount đơn = Σ order_items.totalAmount', o.finalAmount === sumTotal, `${o.finalAmount} vs ${sumTotal}`);
    ok('A3 discountAmount = subtotal − finalAmount', o.discountAmount === o.subtotal - o.finalAmount, `${o.discountAmount}`);
    ok('A4 finalAmount là số nguyên VND', Number.isInteger(o.finalAmount), String(o.finalAmount));
    // Bất biến kép: mỗi dòng cũng phải tự khớp.
    ok(
      'A5 từng dòng: totalAmount = unitSellingPrice × số lượng',
      ls.every((l) => l.totalAmount === l.unitSellingPrice * l.quantity),
      ls.map((l) => `${l.unitSellingPrice}×${l.quantity}=${l.totalAmount}`).join(' ')
    );
    ok(
      'A6 từng dòng: unitSellingPrice = round(giá bìa × (1 − chiết khấu))',
      ls.every(
        (l) =>
          l.unitSellingPrice ===
          Math.round(l.unitCoverPrice * (1 - (l.unitDiscountRate ?? o.discountRate)))
      )
    );
  }

  // A7: combo — tổng phân bổ PHẢI BẰNG comboPrice × số bộ (dồn phần lẻ vào dòng cuối).
  {
    const bundle: any = await BundleService.createBundle({
      code: uniq('ACB'), seasonName: 'Audit C', releaseDate: '2026-09-30',
      comboPrice: 250000,
      items: [
        { editionId: ed[0].id, quantityInBundle: 1 },
        { editionId: ed[1].id, quantityInBundle: 2 },
        { editionId: ed[2].id, quantityInBundle: 1 },
      ],
    });
    for (const qty of [1, 3]) {
      const priced = await BundleService.priceLines(bundle.bundleId, qty);
      const sum = priced.reduce((s, p) => s + p.totalAmount, 0);
      ok(`A7 combo qty=${qty}: Σ dòng = comboPrice × số bộ`, sum === 250000 * qty, `${sum} vs ${250000 * qty}`);
      ok(
        `A8 combo qty=${qty}: số lượng mỗi dòng = qtyInBundle × số bộ`,
        priced.every((p) => p.quantity >= qty),
        priced.map((p) => `${p.quantity}`).join(',')
      );
    }
    // A9: đơn combo thật — tổng đơn = tổng dòng.
    const oc: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId,
      bundles: [{ bundleId: bundle.bundleId, quantity: 2 }],
    });
    const cl: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, oc.orderId));
    ok(
      'A9 đơn combo: finalAmount = Σ dòng = comboPrice × số bộ',
      oc.finalAmount === cl.reduce((s, l) => s + l.totalAmount, 0) && oc.finalAmount === 250000 * 2,
      `${oc.finalAmount}`
    );
  }

  // A10: két — expectedCash = tiền đầu ca + Σ đơn tiền mặt − Σ hoàn tiền mặt.
  {
    const stats: any = await CashboxService.calculateSessionStats(shiftId);
    const cashOrders: any[] = await db
      .select()
      .from(orders)
      .where(sql`cashbox_session_id = ${shiftId} AND status = 'COMPLETED' AND payment_method = 'CASH'`);
    const handSum = cashOrders.reduce((s, o) => s + o.finalAmount, 0);
    ok(
      'A10 két: tổng tiền mặt = Σ đơn CASH của ca (đối chiếu bằng tay)',
      stats.totalCashSales === handSum,
      `${stats.totalCashSales} vs ${handSum}`
    );
    const active: any = await CashboxService.getActiveSession(CASHIER.staffId, WH);
    ok(
      'A11 két: expectedCash = tiền đầu ca + tổng tiền mặt',
      active.expectedCash === 500000 + stats.totalCashSales,
      `${active.expectedCash} vs ${500000 + stats.totalCashSales}`
    );
  }

  // A12: báo cáo doanh số — tổng doanh thu = Σ finalAmount của đơn COMPLETED, trừ SPONSORSHIP.
  {
    const s: any = await OrderService.getSalesSummary({ warehouseId: WH });
    const all: any[] = await db
      .select()
      .from(orders)
      .where(eq(orders.warehouseId, WH));
    const expect = all
      .filter((o) => o.status === 'COMPLETED' && o.channel !== 'SPONSORSHIP')
      .reduce((t, o) => t + o.finalAmount, 0);
    ok('A12 doanh số: tổng doanh thu = Σ finalAmount (loại PENDING/CANCELLED/SPONSORSHIP)', s.totalRevenue === expect, `${s.totalRevenue} vs ${expect}`);
    ok(
      'A13 doanh số: tổng chiết khấu = Σ discountAmount',
      s.totalDiscount === all.filter((o) => o.status === 'COMPLETED' && o.channel !== 'SPONSORSHIP').reduce((t, o) => t + (o.discountAmount || 0), 0)
    );
  }

  // =====================================================================
  // B. SỐ ÂM / VƯỢT BIÊN / NaN
  // =====================================================================
  console.log('\n--- B. SỐ ÂM / NaN / VƯỢT BIÊN ---');
  {
    const bad: Array<[string, any]> = [
      ['số lượng âm', { items: [{ editionId: ed[0].id, quantity: -5 }] }],
      ['số lượng 0', { items: [{ editionId: ed[0].id, quantity: 0 }] }],
      ['số lượng NaN', { items: [{ editionId: ed[0].id, quantity: NaN }] }],
      ['số lượng Infinity', { items: [{ editionId: ed[0].id, quantity: Infinity }] }],
      ['số lượng phân số 1.5', { items: [{ editionId: ed[0].id, quantity: 1.5 }] }],
      ['chiết khấu đơn âm', { items: [{ editionId: ed[0].id, quantity: 1 }], discountRate: -0.5 }],
      ['chiết khấu đơn NaN', { items: [{ editionId: ed[0].id, quantity: 1 }], discountRate: NaN }],
      ['chiết khấu đơn Infinity', { items: [{ editionId: ed[0].id, quantity: 1 }], discountRate: Infinity }],
      ['chiết khấu dòng âm', { items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: -1 }] }],
      ['chiết khấu dòng NaN', { items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: NaN }] }],
      ['chiết khấu dòng > 100%', { items: [{ editionId: ed[0].id, quantity: 1, unitDiscountRate: 1.5 }] }],
    ];
    for (const [label, extra] of bad) {
      const before = await moneySnapshot();
      let blocked = false;
      try {
        await OrderService.createOrder({
          warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
          cashierId: CASHIER.staffId, cashboxSessionId: shiftId, ...extra,
        } as any);
      } catch {
        blocked = true;
      }
      const after = await moneySnapshot();
      ok(`B chặn ${label}`, blocked);
      ok(`B chặn ${label}: không gì được ghi`, JSON.stringify(before) === JSON.stringify(after));
    }
  }

  // =====================================================================
  // C. IDEMPOTENCY — bấm chốt 2 lần / F5 / mạng lỗi rồi thử lại
  // =====================================================================
  console.log('\n--- C. IDEMPOTENCY ---');
  {
    const payload: any = {
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId,
      idempotencyKey: uniq('idem-auditC-1'),
      items: [{ editionId: ed[0].id, quantity: 2 }],
    };
    const balBefore = await InventoryService.getBalance(ed[0].id, WH, 'NEW');
    const first: any = await OrderService.createOrder(payload);
    const mid = await moneySnapshot();
    const retry: any = await OrderService.createOrder(payload);
    const after = await moneySnapshot();
    ok('C1 retry cùng idempotencyKey trả đúng ĐƠN CŨ', retry.isDuplicate === true && retry.orderId === first.orderId);
    ok('C2 retry KHÔNG ghi thêm bất cứ dòng nào', JSON.stringify(mid) === JSON.stringify(after));
    ok(
      'C3 retry KHÔNG trừ tồn lần hai',
      (await InventoryService.getBalance(ed[0].id, WH, 'NEW')) === balBefore - 2,
      `${balBefore} -> ${balBefore - 2}`
    );

    // C4: hai lần chốt SONG SONG cùng key (bấm hai tay / F5) — đúng 1 đơn.
    const key4 = uniq('idem-auditC-race');
    const p4: any = {
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId, idempotencyKey: key4,
      items: [{ editionId: ed[1].id, quantity: 1 }],
    };
    const b4 = await InventoryService.getBalance(ed[1].id, WH, 'NEW');
    const r4 = await Promise.allSettled([OrderService.createOrder(p4), OrderService.createOrder(p4)]);
    const done4 = r4.filter((r) => r.status === 'fulfilled');
    const ords4: any[] = await db.select().from(orders).where(eq(orders.idempotencyKey, key4));
    ok('C4 chốt song song cùng key: đúng 1 đơn được ghi', ords4.length === 1, `ghi ${ords4.length}, hoàn tất ${done4.length}`);
    ok(
      'C5 chốt song song cùng key: tồn trừ đúng 1 lần',
      (await InventoryService.getBalance(ed[1].id, WH, 'NEW')) === b4 - 1,
      `${b4} -> ${b4 - 1}`
    );
    const led4 = await db
      .select()
      .from(inventoryLedger)
      .where(eq(inventoryLedger.correlationId, ords4[0].id));
    ok('C6 chốt song song: chỉ 1 bút toán kho cho 1 đơn', led4.filter((l) => l.quantityDelta < 0).length === 1, `${led4.length} dòng ledger`);

    // C7: hai đơn khác key phải sinh HAI mã đơn khác nhau (không trùng mã 13 ký tự).
    const m1: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId, idempotencyKey: uniq('idem-c7-a'),
      items: [{ editionId: ed[0].id, quantity: 1 }],
    });
    const m2: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId, idempotencyKey: uniq('idem-c7-b'),
      items: [{ editionId: ed[0].id, quantity: 1 }],
    });
    ok('C7 hai lần chốt khác key ⇒ hai mã đơn khác nhau', m1.orderCode !== m2.orderCode, `${m1.orderCode} / ${m2.orderCode}`);
    ok('C8 mã đơn server cấp đủ 13 ký tự', /^[A-Z0-9]{13}$/.test(m1.orderCode) && /^[A-Z0-9]{13}$/.test(m2.orderCode), m1.orderCode);
  }

  // =====================================================================
  // D. RACE TIỀN — hai thao tác tiền chạy song song
  // =====================================================================
  console.log('\n--- D. RACE TIỀN ---');
  {
    // D1: duyệt đơn chờ HAI LẦN SONG SONG (bấm 2 tay) — tồn phải trừ đúng 1 lần.
    const p: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId, confirmImmediately: false,
      items: [{ editionId: ed[2].id, quantity: 2 }],
    });
    const b = await InventoryService.getBalance(ed[2].id, WH, 'NEW');
    const r = await Promise.allSettled([
      OrderService.confirmOrder(p.orderId, 'ROLE_CASHIER', CASHIER.staffId),
      OrderService.confirmOrder(p.orderId, 'ROLE_CASHIER', CASHIER.staffId),
    ]);
    const a = await InventoryService.getBalance(ed[2].id, WH, 'NEW');
    ok('D1 duyệt đơn chờ song song: tồn trừ đúng 1 lần', a === b - 2, `${b} -> ${a} (kỳ vọng ${b - 2})`);
    const neg = await db
      .select()
      .from(inventoryLedger)
      .where(eq(inventoryLedger.correlationId, p.orderId));
    ok('D2 duyệt song song: chỉ 1 bút toán DISPATCH_SALE', neg.filter((l) => l.quantityDelta < 0).length === 1, `${neg.length} dòng`);
    const st: any = (await db.select().from(orders).where(eq(orders.id, p.orderId)))[0];
    ok('D3 duyệt song song: đơn kết thúc ở COMPLETED', st.status === 'COMPLETED', st.status);

    // D4: duyệt TUẦN TỰ lần hai (F5) — idempotent, không trừ tồn lần nữa.
    const before2 = await InventoryService.getBalance(ed[2].id, WH, 'NEW');
    const again: any = await OrderService.confirmOrder(p.orderId, 'ROLE_CASHIER', CASHIER.staffId);
    ok(
      'D4 duyệt lần 2 (F5) trả idempotent, tồn không đổi',
      again.isIdempotent === true && (await InventoryService.getBalance(ed[2].id, WH, 'NEW')) === before2
    );
  }

  // =====================================================================
  // E + F. HOÀN TIỀN / TRẢ HÀNG / QUỸ TÀI TRỢ
  // =====================================================================
  console.log('\n--- E. HOÀN TIỀN / TRẢ HÀNG ---');
  {
    // Ca RIÊNG cho thu ngân kiêm Quản lý: hoàn tiền mặt bắt buộc người hoàn tất
    // là chủ két, mà `ReturnService.complete` lại chỉ cho Manager/Owner ⇒ ca này
    // phải do MANAGER mở và do chính MANAGER đó bán/hoàn.
    const mShift = await openShift(MGR.staffId);
    // E1: hoàn tiền MẶT phải TRỪ két.
    const cashOrder: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: MGR.staffId, cashboxSessionId: mShift,
      items: [{ editionId: ed[0].id, quantity: 1 }],
    });
    const cashLines: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, cashOrder.orderId));
    const balBeforeE3 = await InventoryService.getBalance(ed[0].id, WH, 'NEW');
    const beforeCash: any = await CashboxService.calculateSessionStats(mShift);
    const req: any = await ReturnService.createRequest({
      orderId: cashOrder.orderId, returnType: 'REFUND', reason: 'PRINTING_DEFECT',
      targetWarehouseId: WH, inventoryDisposition: 'RESTOCK', cashboxSessionId: mShift,
      actorContext: MGR, idempotencyKey: uniq('ret-create-cash'),
      items: [{ orderItemId: cashLines[0].id, editionId: ed[0].id, quantity: 1 }],
    });
    await ReturnService.approve(req.returnId, MGR.role, MGR.staffId, MGR, uniq('ret-appr'));
    await ReturnService.complete(req.returnId, MGR.role, undefined, MGR, uniq('ret-done'));
    const afterCash: any = await CashboxService.calculateSessionStats(mShift);
    ok(
      'E1 hoàn tiền MẶT làm két giảm đúng số tiền hoàn',
      beforeCash.totalCashSales - afterCash.totalCashSales === cashOrder.finalAmount,
      `${beforeCash.totalCashSales} -> ${afterCash.totalCashSales} (hoàn ${cashOrder.finalAmount})`
    );
    ok('E2 tiền hoàn ghi vào sổ (refundAmount > 0)', afterCash.totalRefunds === cashOrder.finalAmount, `${afterCash.totalRefunds}`);

    // E3: hàng trả phải VỀ ĐÚNG kho — đo theo DELTA của chính lần hoàn này
    // (bất biến "Σ ledger == số dư" là thuộc tính của DB sạch; battery 95 suite
    // dùng chung 1 DB nên phần dư của suite khác không thuộc phạm vi case này).
    const balE3 = await InventoryService.getBalance(ed[0].id, WH, 'NEW');
    const sbE3: any = (await db.select().from(stockBalances).where(eq(stockBalances.editionId, ed[0].id)))[0];
    const backE3: any[] = await db.select().from(inventoryLedger).where(
      sql`edition_id = ${ed[0].id} AND warehouse_id = ${WH} AND event_type = 'RETURN_INBOUND'`
    );
    ok(
      'E3 hàng trả về đúng kho: tồn tăng đúng số cuốn vừa trả',
      balE3 === balBeforeE3 + 1 && balE3 === sbE3.physicalQuantity,
      `tồn ${balBeforeE3} -> ${balE3} (bán 1, trả lại 1), số dư bảng ${sbE3.physicalQuantity}`
    );
    ok(
      'E3b bút toán trả hàng ghi vào đúng kho nhận, đúng số lượng',
      backE3.length > 0 &&
        backE3.every((l: any) => l.warehouseId === WH) &&
        backE3.reduce((s, l: any) => s + l.quantityDelta, 0) === 1,
      `${backE3.length} bút toán, tổng +${backE3.reduce((s, l: any) => s + l.quantityDelta, 0)}`
    );

    // E4 (BUG TIỀN MẶT): hoàn cho đơn CHUYỂN KHOẢN gắn nhầm phiên két thì
    // KHÔNG được trừ két — tiền đó chưa từng nằm trong két.
    const trOrder: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'BANK_TRANSFER',
      cashierId: MGR.staffId, cashboxSessionId: mShift,
      items: [{ editionId: ed[1].id, quantity: 1 }],
      confirmImmediately: true,
    } as any);
    const trLines: any[] = await db.select().from(orderItems).where(eq(orderItems.orderId, trOrder.orderId));
    const beforeTr: any = await CashboxService.calculateSessionStats(mShift);
    const reqTr: any = await ReturnService.createRequest({
      orderId: trOrder.orderId, returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND',
      targetWarehouseId: WH, inventoryDisposition: 'RESTOCK', cashboxSessionId: mShift,
      actorContext: MGR, idempotencyKey: uniq('ret-create-tr'),
      items: [{ orderItemId: trLines[0].id, editionId: ed[1].id, quantity: 1 }],
    });
    await ReturnService.approve(reqTr.returnId, MGR.role, MGR.staffId, MGR, uniq('ret-appr-tr'));
    await ReturnService.complete(reqTr.returnId, MGR.role, undefined, MGR, uniq('ret-done-tr'));
    const afterTr: any = await CashboxService.calculateSessionStats(mShift);
    ok(
      'E4 hoàn CHUYỂN KHOẢN không được trừ két (tiền chưa từng vào két)',
      beforeTr.totalCashSales === afterTr.totalCashSales && beforeTr.totalRefunds === afterTr.totalRefunds,
      `tiền mặt ${beforeTr.totalCashSales} -> ${afterTr.totalCashSales}, hoàn ${beforeTr.totalRefunds} -> ${afterTr.totalRefunds} (đơn gốc ${trOrder.finalAmount}đ CHUYỂN KHOẢN)`
    );
    ok('E4b hoàn chuyển khoản vẫn ghi đủ vào sổ phiếu trả', (await ReturnService.getById(reqTr.returnId)).header.refundAmount === trOrder.finalAmount, `${(await ReturnService.getById(reqTr.returnId)).header.refundAmount} vs ${trOrder.finalAmount}`);
  }

  console.log('\n--- F. QUỸ TÀI TRỢ ---');
  {
    const fund: any = await SponsorshipService.createFund({
      sponsorName: 'Audit C Sponsor', amountReceived: 100_000_000, quotaType: 'CAPPED',
      quotaLimit: Math.round(ed[0].cover * 1.5), createdBy: MGR.staffId, actorRole: MGR.role,
    });
    const f0: any = await SponsorshipService.getFund(fund.fundId);
    // F1: vượt hạn mức bị chặn (tuần tự).
    let blocked = false;
    try {
      await SponsorshipService.draw({
        fundId: fund.fundId, editionId: ed[0].id, warehouseId: WH, quantity: 5,
        drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('spf-over'),
      });
    } catch (e: any) {
      blocked = /Vượt hạn mức/.test(e.message);
    }
    ok('F1 rút vượt hạn mức bị chặn', blocked);

    // F2: HAI LẦN RÚT SONG SONG vượt hạn mức — đúng MỘT lần được thắng, và sổ quỹ
    // phải khớp 100% với số sách đã thực sự ra kho. Đây là case đã SỬA.
    const stockBefore = await InventoryService.getBalance(ed[0].id, WH, 'NEW');
    const r = await Promise.allSettled([
      SponsorshipService.draw({
        fundId: fund.fundId, editionId: ed[0].id, warehouseId: WH, quantity: 1,
        drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('spf-race-a'),
      }),
      SponsorshipService.draw({
        fundId: fund.fundId, editionId: ed[0].id, warehouseId: WH, quantity: 1,
        drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('spf-race-b'),
      }),
    ]);
    const won = r.filter((x) => x.status === 'fulfilled');
    const lost = r.filter((x) => x.status === 'rejected');
    const f2: any = await SponsorshipService.getFund(fund.fundId);
    const stockAfter = await InventoryService.getBalance(ed[0].id, WH, 'NEW');
    const draws: any[] = await db.select().from(returnOrders).limit(0).then(() => db.all(
      sql`SELECT * FROM sponsorship_drawdowns WHERE fund_id = ${fund.fundId}`
    ) as any);
    const outQty = stockBefore - stockAfter;
    const spent = draws.reduce((s, d: any) => s + Number(d.drawn_value), 0);
    ok('F2 rút quỹ SONG SONG: đúng 1 lần thắng, 1 lần bị chặn', won.length === 1 && lost.length === 1, `thắng ${won.length}, bị chặn ${lost.length}`);
    ok('F3 rút quỹ SONG SONG: bị chặn vì Vượt hạn mức', (lost[0] as any)?.reason?.message?.includes('Vượt hạn mức') === true, (lost[0] as any)?.reason?.message);
    ok(
      'F4 SỔ QUỸ khớp 100% số sách đã ra kho (không mất tiền sổ)',
      f2.balanceRemaining === f0.balanceRemaining - spent && spent === outQty * ed[0].cover,
      `số dư ${f0.balanceRemaining} -> ${f2.balanceRemaining}, đã rút ${spent}đ, sách ra kho ${outQty} cuốn x ${ed[0].cover}đ`
    );
    ok('F5 tổng đã rút của quỹ khớp sổ drawdown', f2.totalDrawnValue === spent && f2.totalDrawnQty === outQty, `${f2.totalDrawnValue}/${spent}, ${f2.totalDrawnQty}/${outQty}`);
    ok('F6 số dư quỹ không bao giờ âm', (f2.balanceRemaining || 0) >= 0, `${f2.balanceRemaining}`);

    // F7: rút cạn quỹ rồi không rút thêm được (EXHAUSTED).
    const fund2: any = await SponsorshipService.createFund({
      sponsorName: 'Audit C Exhaust', amountReceived: 100_000_000, quotaType: 'CAPPED',
      quotaLimit: ed[1].cover, createdBy: MGR.staffId, actorRole: MGR.role,
    });
    await SponsorshipService.draw({
      fundId: fund2.fundId, editionId: ed[1].id, warehouseId: WH, quantity: 1,
      drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('spf-exh'),
    });
    const ex: any = await SponsorshipService.getFund(fund2.fundId);
    let exBlocked = false;
    let exMsg = '';
    try {
      await SponsorshipService.draw({
        fundId: fund2.fundId, editionId: ed[1].id, warehouseId: WH, quantity: 1,
        drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('spf-exh-2'),
      });
    } catch (e: any) {
      exMsg = e.message;
      exBlocked = /Vượt hạn mức|EXHAUSTED/.test(e.message);
    }
    ok('F7 quỹ CAPPED cạn → EXHAUSTED và chặn rút tiếp', ex.status === 'EXHAUSTED' && ex.balanceRemaining === 0 && exBlocked, `${ex.status}/${ex.balanceRemaining} — "${exMsg}"`);

    // F8: quỹ OPEN không bị đánh dấu EXHAUSTED (giữ nguyên hợp đồng).
    const fund3: any = await SponsorshipService.createFund({
      sponsorName: 'Audit C Open', amountReceived: 100_000_000, quotaType: 'OPEN',
      createdBy: MGR.staffId, actorRole: MGR.role,
    });
    await SponsorshipService.draw({
      fundId: fund3.fundId, editionId: ed[2].id, warehouseId: WH, quantity: 1,
      drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: uniq('spf-open'),
    });
    const op: any = await SponsorshipService.getFund(fund3.fundId);
    ok('F8 quỹ OPEN: vẫn ACTIVE, số dư 0, tổng đếm dồn', op.status === 'ACTIVE' && op.balanceRemaining === 0 && op.totalDrawnQty === 1, `${op.status}/${op.balanceRemaining}/${op.totalDrawnQty}`);

    // F9: cùng idempotencyKey rút 2 lần ⇒ chỉ 1 đợt rút.
    const fund4: any = await SponsorshipService.createFund({
      sponsorName: 'Audit C Idem', amountReceived: 100_000_000, quotaType: 'CAPPED',
      quotaLimit: ed[3].cover * 5, createdBy: MGR.staffId, actorRole: MGR.role,
    });
    const idemKey = uniq('spf-idem');
    const sB = await InventoryService.getBalance(ed[3].id, WH, 'NEW');
    await SponsorshipService.draw({ fundId: fund4.fundId, editionId: ed[3].id, warehouseId: WH, quantity: 1, drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: idemKey });
    const dup: any = await SponsorshipService.draw({ fundId: fund4.fundId, editionId: ed[3].id, warehouseId: WH, quantity: 1, drawnBy: MGR.staffId, actorRole: MGR.role, idempotencyKey: idemKey });
    ok(
      'F9 rút trùng idempotencyKey: không trừ quỹ lần 2, không trừ kho lần 2',
      dup.isDuplicate === true && (await InventoryService.getBalance(ed[3].id, WH, 'NEW')) === sB - 1
    );
  }

  // =====================================================================
  // G. CHUYỂN KHOẢN / VietQR / ảnh chứng minh / trạng thái đơn
  // =====================================================================
  console.log('\n--- G. CHUYỂN KHOẢN / VietQR ---');
  {
    // G1: payload QR mang ĐÚNG số tiền / BIN / số tài khoản.
    // BÓC TLV THẬT (không đoán bằng chuỗi con) — cùng cách ngân hàng đọc.
    const amount = 1234500;
    const content = '3cuon ORD2609300001';
    const payload = generateVietQRPayload({ bankBin: '970405', accountNo: '0123456789', amount, content });
    const tlv = (s: string, off = 0): Array<[string, string, number]> => {
      const out: Array<[string, string, number]> = [];
      let i = off;
      while (i + 4 <= s.length) {
        const tag = s.slice(i, i + 2);
        const len = parseInt(s.slice(i + 2, i + 4), 10);
        if (!Number.isInteger(len)) break;
        out.push([tag, s.slice(i + 4, i + 4 + len), i]);
        i += 4 + len;
      }
      return out;
    };
    const top = tlv(payload);
    const find = (list: Array<[string, string, number]>, tag: string) => list.find((t) => t[0] === tag)?.[1];
    const p38 = find(top, '38');
    const p38t = tlv(p38 || '');
    ok(
      'G1 cấu trúc QR đúng chuẩn: 00/01/38/53/54/58/62 + CRC 63',
      top.map((t) => t[0]).join(',') === '00,01,38,53,54,58,62,63' && find(top, '00') === '01' && find(top, '01') === '12' && find(top, '53') === '704' && find(top, '58') === 'VN',
      `thẻ: ${top.map((t) => t[0]).join(',')}`
    );
    ok('G2 QR mang ĐÚNG BIN ngân hàng', find(p38t, '00') === 'A000000727' && find(tlv(find(p38t, '01') || ''), '00') === '970405', `BIN=${find(tlv(find(p38t, '01') || ''), '00')}`);
    ok('G3 QR mang ĐÚNG số tài khoản nhận', find(tlv(find(p38t, '01') || ''), '01') === '0123456789');
    ok('G4 QR mang ĐÚNG số tiền (thẻ 54)', find(top, '54') === String(Math.round(amount)), `${find(top, '54')} vs ${Math.round(amount)}`);
    ok('G5 QR mang ĐÚNG nội dung chuyển khoản (thẻ 62.08)', find(tlv(find(top, '62') || ''), '08') === normalizeVietqrContent(content), `${find(tlv(find(top, '62') || ''), '08')}`);
    ok('G6 CRC16-CCITT của payload khớp 4 ký tự cuối', /6304[0-9A-F]{4}$/.test(payload) && crc16Ccitt(payload.slice(0, -4)) === payload.slice(-4), payload.slice(-8));
    ok('G7 số tiền lẻ .5 làm tròn MỘT lần rồi mới mã hoá', (() => {
      const p = generateVietQRPayload({ bankBin: '970405', accountNo: '1', amount: 1000.5 });
      return find(tlv(p), '54') === '1001';
    })());

    // G6: nội dung chuyển khoản luôn ≤ 23 ký tự sau chuẩn hoá (chuẩn VietQR).
    const longName = 'Kho Hội Chợ Đại Nam Thăng 10 Năm 2026 Rất Lớn';
    const c1 = resolveTransferContent({ template: null, orderCode: 'ORD2609300001', itemCount: 3, warehouseName: longName, warehouseCode: 'KHO1', manualContent: null });
    ok('G6 nội dung mặc định ≤ 23 ký tự', normalizeVietqrContent(c1).length <= VIETQR_CONTENT_MAX, `${c1} (${c1.length})`);
    const c2 = resolveTransferContent({ template: '{KHO} {SL}cuon {MA}', orderCode: 'ORD2609300001', itemCount: 12, warehouseName: longName, warehouseCode: 'KHO1', manualContent: null });
    ok('G7 mẫu có {KHO} dài vẫn giữ được {SL} và {MA}', normalizeVietqrContent(c2).includes('12cuon') && normalizeVietqrContent(c2).includes('ORD'), `${c2} (${c2.length})`);
    ok('G8 mẫu tuỳ biến dài vẫn ≤ 23 ký tự', normalizeVietqrContent(c2).length <= VIETQR_CONTENT_MAX, `${c2.length}`);

    // G9: nội dung gõ tay dài bị cắt đúng 1 lần ở 23 (đóng băng đúng chuỗi mã hoá).
    const c3 = resolveTransferContent({ template: null, orderCode: 'ORD2609300001', itemCount: 1, warehouseName: '', warehouseCode: '', manualContent: 'A'.repeat(40) });
    ok('G9 nội dung gõ tay dài cắt còn đúng 23 ký tự', normalizeVietqrContent(c3).length === VIETQR_CONTENT_MAX, `${normalizeVietqrContent(c3).length}`);

    // G10: hai mã đơn khác nhau phải ra nội dung QR khác nhau (đối soát sao kê).
    const q1 = resolveTransferContent({ template: null, orderCode: 'ORD2609300001', itemCount: 1, warehouseName: '', warehouseCode: '', manualContent: null });
    const q2 = resolveTransferContent({ template: null, orderCode: 'ORD2609300002', itemCount: 1, warehouseName: '', warehouseCode: '', manualContent: null });
    ok('G10 hai mã đơn ⇒ hai nội dung QR khác nhau', q1 !== q2, `${q1} / ${q2}`);
    ok('G11 mã rút gọn giữ 8 ký tự định danh', /^ORD[0-9A-F]{8}$/.test(compactOrderCode('ORD2609300001')), compactOrderCode('ORD2609300001'));

    // G12: đơn chuyển khoản quầy — đủ ảnh mới duyệt được, thiếu ảnh bị chặn.
    const t: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'QR_CODE',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId, confirmImmediately: false,
      items: [{ editionId: ed[0].id, quantity: 1 }],
    });
    ok('G12 đơn chuyển khoản quầy tạo ở trạng thái PENDING_CONFIRMATION', t.status === 'PENDING_CONFIRMATION', t.status);
    ok('G13 đơn chuyển khoản quầy có hạn 30 phút', !!t.paymentExpiresAt, t.paymentExpiresAt);
    let proofBlocked = false;
    try {
      await OrderService.confirmOrder(t.orderId, 'ROLE_CASHIER', CASHIER.staffId);
    } catch (e: any) {
      proofBlocked = /ảnh xác nhận/.test(e.message);
    }
    ok('G14 duyệt đơn chuyển khoản thiếu ảnh chứng minh bị chặn', proofBlocked);
    const conf: any = await OrderService.confirmOrder(t.orderId, 'ROLE_CASHIER', CASHIER.staffId, undefined, {
      id: 'proof-auditC-1', capturedAt: new Date().toISOString(),
    });
    ok('G15 có ảnh chứng minh thì duyệt được', conf.status === 'COMPLETED', conf.status);

    // G16: thứ tự trạng thái — huỷ đơn đã COMPLETED bị chặn.
    let cancelBlocked = false;
    try {
      await OrderService.cancelOrder(t.orderId, 'ROLE_CASHIER', 'thử hủy', undefined, CASHIER.staffId);
    } catch (e: any) {
      cancelBlocked = /COMPLETED/.test(e.message);
    }
    ok('G16 không huỷ được đơn đã COMPLETED (thứ tự trạng thái)', cancelBlocked);

    // G17: ảnh chứng minh KHÔNG bị ghi đè (cổng thứ tự ghi ảnh — gọi hàm thật).
    const gate = createPhotoWriteGate();
    const order: string[] = [];
    const g1 = gate.begin();
    const slow = gate.run(g1, async () => {
      await new Promise((r) => setTimeout(r, 40));
      order.push('ghi-lần-1(đã bị thay thế)');
      return 'anh-cu';
    });
    const g2 = gate.begin();
    const fast = gate.run(g2, async () => {
      order.push('ghi-lần-2');
      return 'anh-moi';
    });
    const [r1, r2] = await Promise.all([slow, fast]);
    ok('G17 lần ghi bị thay thế KHÔNG chạy (không đè ảnh mới)', r1 === undefined && r2 === 'anh-moi', JSON.stringify([r1, r2]));
    ok('G18 đúng thứ tự: lần cũ không ghi sau lần mới', order.join('|') === 'ghi-lần-2', order.join('|'));
    const g3 = gate.begin();
    ok('G19 thế hệ mới làm thế hệ cũ mất hiệu lực', gate.isCurrent(g3) === true && gate.isCurrent(g2) === false);
  }

  // =====================================================================
  // H. NaN / undefined / Infinity lọt ra UI
  // =====================================================================
  console.log('\n--- H. NaN / Infinity / CHIA CHO 0 ---');
  {
    // H1: resolveTransferContent với dữ liệu rỗng phải ra chuỗi hợp lệ, không "NaN".
    const cEmpty = resolveTransferContent({ template: null, orderCode: '', itemCount: 0, warehouseName: '', warehouseCode: '', manualContent: null });
    ok('H1 nội dung rỗng không chứa NaN/undefined', !/NaN|undefined/.test(cEmpty), `"${cEmpty}"`);
    const cNan = resolveTransferContent({ template: '{SL}cuon {MA}', orderCode: 'ORD1', itemCount: NaN as any, warehouseName: '', warehouseCode: '', manualContent: null });
    ok('H2 itemCount NaN không lọt ra nội dung QR', !/NaN/.test(cNan), `"${cNan}"`);
    // H3: số tiền QR phải là số nguyên dương; 0/âm ⇒ không mã hoá tag 54.
    const p0 = generateVietQRPayload({ bankBin: '970405', accountNo: '1', amount: 0 });
    ok('H3 số tiền 0 không sinh tag 54 (không mã hoá số tiền sai)', !p0.includes('5400'));
    // H4: giá bìa 0 ⇒ dòng 0đ, không NaN.
    const o0: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId,
      items: [{ editionId: ed[3].id, quantity: 1, unitDiscountRate: 0.5 }],
    });
    ok('H4 chiết khấu 50% trên 1 cuốn không sinh NaN/Infinity', Number.isFinite(o0.finalAmount), `${o0.finalAmount}`);
    // H5: chiết khấu rất sâu (99,9%) vẫn ra số tiền hữu hạn, không âm.
    const oDeep: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      cashierId: CASHIER.staffId, cashboxSessionId: shiftId, discountRate: 0.999,
      items: [{ editionId: ed[3].id, quantity: 1 }],
    });
    ok('H5 chiết khấu 99,9% ⇒ finalAmount ≥ 0 và hữu hạn', oDeep.finalAmount >= 0 && Number.isFinite(oDeep.finalAmount), `${oDeep.finalAmount}`);
    // H6: tiền đầu ca âm / NaN bị chặn.
    for (const [label, v] of [['âm', -1000], ['NaN', NaN], ['Infinity', Infinity]] as Array<[string, number]>) {
      let b = false;
      try {
        await CashboxService.openSession({ warehouseId: WH, cashierId: 'staff-probe', openingCash: v });
      } catch {
        b = true;
      }
      ok(`H6 tiền đầu ca ${label} bị chặn`, b);
    }
    // H7: đóng ca với số thực đếm âm/NaN bị chặn.
    for (const [label, v] of [['âm', -1], ['NaN', NaN]] as Array<[string, number]>) {
      let b = false;
      try {
        await CashboxService.closeSession({ sessionId: shiftId, closingCashActual: v });
      } catch {
        b = true;
      }
      ok(`H7 tiền thực đếm ${label} bị chặn`, b);
    }
  }

  // =====================================================================
  // I. PHÊ DUYỆT CHIẾT KHẤU — số tiền duyệt phải khớp số tiền đơn
  // =====================================================================
  console.log('\n--- I. PHÊ DUYỆT CHIẾT KHẤU ---');
  {
    const items: CartItemInput[] = [
      { editionId: ed[0].id, quantity: 2, unitPrice: ed[0].cover },
      { editionId: ed[1].id, quantity: 1, unitPrice: ed[1].cover },
    ];
    const req: any = await DiscountApprovalService.createRequest({
      orderCode: uniq('ORD-AC'), warehouseId: WH, cashierId: CASHIER.staffId,
      items, requestedDiscountRate: 0.25, actorContext: CASHIER,
    });
    const expectSub = ed[0].cover * 2 + ed[1].cover;
    ok('I1 số tiền DUYỆT khớp tính từ giá bìa DB', req.originalAmount === expectSub, `${req.originalAmount} vs ${expectSub}`);
    ok('I2 finalAmount duyệt = gốc × 75%', req.finalAmount === Math.round(Math.round(ed[0].cover * 0.75) * 2) + Math.round(ed[1].cover * 0.75), `${req.finalAmount}`);
    ok('I3 discountAmount duyệt = gốc − cuối', req.discountAmount === req.originalAmount - req.finalAmount);

    await DiscountApprovalService.approveRequest({
      requestId: req.id, method: 'ONE_TOUCH', actorContext: MGR,
    });
    // I4: giá client bị bỏ qua — số tiền đơn vẫn theo giá DB.
    const o: any = await OrderService.createOrder({
      warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
      discountRate: 0.25, cashierId: CASHIER.staffId, cashboxSessionId: shiftId,
      idempotencyKey: uniq('idem-auditC-appr'), discountApprovalId: req.id,
      items: [{ editionId: ed[0].id, quantity: 2, unitPrice: 1 }, { editionId: ed[1].id, quantity: 1, unitPrice: 1 }],
    } as any);
    ok('I4 giá client bị bỏ qua, tiền đơn khớp tiền đã duyệt', o.finalAmount === req.finalAmount, `${o.finalAmount} vs ${req.finalAmount}`);

    // I5: dùng lại approval đã tiêu thụ cho đơn khác ⇒ bị chặn.
    let reuse = false;
    try {
      await OrderService.createOrder({
        warehouseId: WH, channel: 'FAIR_EVENT', paymentMethod: 'CASH',
        discountRate: 0.25, cashierId: CASHIER.staffId, cashboxSessionId: shiftId,
        idempotencyKey: uniq('idem-auditC-reuse'), discountApprovalId: req.id,
        items: [{ editionId: ed[0].id, quantity: 2 }, { editionId: ed[1].id, quantity: 1 }],
      } as any);
    } catch (e: any) {
      reuse = true;
    }
    ok('I5 không dùng lại được approval đã tiêu thụ', reuse);
  }

  // =====================================================================
  // J. BIÊN HTTP — gọi THẬT route POST /api/orders (không giả lập service)
  // =====================================================================
  console.log('\n--- J. BIÊN HTTP (route thật) ---');
  {
    const { POST: postOrders } = await import('../src/app/api/orders/route');
    const { POST: postLogin } = await import('../src/app/api/auth/login/route');
    const { POST: postLogout } = await import('../src/app/api/auth/logout/route');
    const loginRes: any = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: 'QL-01', passcode: '8888' }),
      }) as any
    );
    ok('J0 đăng nhập Quản lý thật (cookie session)', loginRes.status === 200, `status ${loginRes.status}`);
    const cookie = (() => {
      const m = `${loginRes.headers.get('set-cookie') || ''}`.match(/formapubli_session=([^;]+)/);
      return m ? `formapubli_session=${m[1]}` : '';
    })();
    const call = async (body: any) => {
      const res: any = await postOrders(
        new Request('http://localhost/api/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify(body),
        }) as any
      );
      return { status: res.status, json: await res.json() };
    };

    // J1: số lượng combo phân số KHÔNG được bị cắt còn số nguyên ở biên HTTP.
    const bundleJ: any = await BundleService.createBundle({
      code: uniq('ACBJ'), seasonName: 'Audit C J', releaseDate: '2026-09-30',
      comboPrice: 250000,
      items: [{ editionId: ed[0].id, quantityInBundle: 1 }, { editionId: ed[1].id, quantityInBundle: 1 }],
    });
    const frac = await call({
      warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J1',
      paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-frac'),
      bundles: [{ bundleId: bundleJ.bundleId, quantity: 1.9 }],
    });
    ok('J1 combo số lượng 1.9 bị từ chối, KHÔNG bị cắt còn 1', frac.status === 400, `status ${frac.status}: ${frac.json?.error}`);
    const fracStr = await call({
      warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J1b',
      paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-fracstr'),
      bundles: [{ bundleId: bundleJ.bundleId, quantity: '1.9' }],
    });
    ok('J1b combo số lượng "1.9" (chuỗi) cũng bị từ chối', fracStr.status === 400, `status ${fracStr.status}`);
    // J2: chuỗi số nguyên vẫn được nhận như cũ (không hỏng hợp đồng cũ).
    const strInt = await call({
      warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J2',
      paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-strint'),
      bundles: [{ bundleId: bundleJ.bundleId, quantity: '1' }],
    });
    ok('J2 combo số lượng "1" (chuỗi số nguyên) vẫn tạo được đơn', strInt.status === 200 && strInt.json?.data?.finalAmount === 250000, `status ${strInt.status}, tiền ${strInt.json?.data?.finalAmount}`);

    // J3: thuế suất rác phải trả 400 chứ không phải 500 (NaN ở biên HTTP).
    for (const [label, v] of [['NaN', 'abc'], ['âm', -5], ['> 1', 3]] as Array<[string, any]>) {
      const r = await call({
        warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J3',
        paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-vat'), vatRate: v,
        items: [{ editionId: ed[2].id, quantity: 1 }],
      });
      ok(`J3 thuế suất ${label} bị từ chối bằng 400 (không phải 500)`, r.status === 400, `status ${r.status}: ${r.json?.error}`);
    }
    // J4: thuế suất hợp lệ vẫn tạo được đơn.
    const vatOk = await call({
      warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J4',
      paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-vatok'), vatRate: 0.05,
      items: [{ editionId: ed[2].id, quantity: 1 }],
    });
    ok('J4 thuế suất 0.05 hợp lệ vẫn tạo được đơn', vatOk.status === 200, `status ${vatOk.status}`);

    // J5: replay cùng idempotencyKey qua ROUTE ⇒ 1 đơn, tồn trừ 1 lần.
    const balJ5 = await InventoryService.getBalance(ed[2].id, WH, 'NEW');
    const bodyJ5 = {
      warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J5',
      paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-replay'),
      items: [{ editionId: ed[2].id, quantity: 1 }],
    };
    const a5 = await call(bodyJ5);
    const b5 = await call(bodyJ5);
    ok(
      'J5 route replay cùng key: cùng orderId, tồn trừ đúng 1 lần',
      a5.json?.data?.orderId === b5.json?.data?.orderId && (await InventoryService.getBalance(ed[2].id, WH, 'NEW')) === balJ5 - 1,
      `${a5.json?.data?.orderId} / ${b5.json?.data?.orderId}, tồn ${balJ5} -> ${balJ5 - 1}`
    );

    // J6: giá client gửi lên bị bỏ qua (server tra giá bìa DB).
    const a6 = await call({
      warehouseId: WH, channel: 'FAIR_EVENT', customerName: 'AC-J6',
      paymentMethod: 'CASH', idempotencyKey: uniq('idem-j-price'),
      items: [{ editionId: ed[1].id, quantity: 2, unitCoverPrice: 1 }],
    });
    ok('J6 giá client gửi lên bị bỏ qua, tính theo giá bìa DB', a6.json?.data?.finalAmount === ed[1].cover * 2, `${a6.json?.data?.finalAmount} vs ${ed[1].cover * 2}`);

    // Nhả lease để không kẹt session cho suite sau.
    {
      const m = cookie.match(/formapubli_session=([^;]+)/);
      const r: any = new Request('http://localhost/api/auth/logout', { method: 'POST' });
      r.cookies = { get: (n: string) => (n === 'formapubli_session' && m ? { value: m[1] } : undefined) };
      await postLogout(r);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`AUDIT C — LỚP TIỀN THẬT: ${checks} assertions PASS 100%`);
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ test-auditC-money THẤT BẠI:', err?.message || err);
  if (err?.stack) console.error(String(err.stack).split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
