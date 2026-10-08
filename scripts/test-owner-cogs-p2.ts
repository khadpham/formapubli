/**
 * scripts/test-owner-cogs-p2.ts — tab Chủ GĐ3-P2: lệnh in mang giá vốn + lô + FIFO.
 *
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-owner-cogs-p2
 */
import { assertIsolatedTestDb } from './test-guard';
import fs from 'node:fs';
import path from 'node:path';
import { db, products, warehouses, inventoryLedger } from '../src/db';
import { sql, eq } from 'drizzle-orm';
import { AppError } from '../src/services/app-error';
import { PrintOrderService } from '../src/services/print-order.service';
import { InventoryService } from '../src/services/inventory.service';
import {
  listPendingCostLots,
  setLotCost,
  allocateFifoCogs,
  type LotMovement,
} from '../src/services/owner-finance.service';

assertIsolatedTestDb('test-owner-cogs-p2');

let pass = 0;
let fail = 0;
function eq2(label: string, actual: unknown, expected: unknown) {
  if (Object.is(actual, expected)) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ FAIL: ${label} — nhận ${String(actual)}, cần ${String(expected)}`);
  }
}
async function expectCode(label: string, fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    fail++;
    console.log(`  ❌ FAIL: ${label} — không ném lỗi`);
  } catch (e) {
    eq2(label, e instanceof AppError ? e.code : 'NOT_APP_ERROR', code);
  }
}

async function main() {
  // 1. Migration 0047 có bảng print_orders.
  const tbl: any[] = await db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='print_orders'`);
  eq2('migration 0047 tạo bảng print_orders', tbl.length, 1);

  // 2. RBAC: non-owner bị chặn mọi thao tác giá vốn.
  await expectCode('quản lý không tạo được lệnh in', () =>
    PrintOrderService.create({ productId: 'x', quantityPlanned: 1, unitCostAgreed: 1, actorRole: 'ROLE_MANAGER' as any, actorId: 'QL-01' }), 'FORBIDDEN');
  await expectCode('thủ kho không xem được lô chờ giá vốn', () =>
    listPendingCostLots('ROLE_WAREHOUSE' as any), 'FORBIDDEN');
  await expectCode('kế toán thuế không đặt được giá vốn lô', () =>
    setLotCost({ lotId: 'LOT-X', unitCost: 1, actorRole: 'ROLE_TAX' as any, actorId: 'KT-01' }), 'FORBIDDEN');

  await db.insert(products).values({ id: 'prod-p2-1', name: 'Sách P2', productKind: 'GOODS' });
  await db.insert(warehouses).values({ id: 'wh-p2', code: 'KHO_P2', name: 'Kho P2' });

  // 3. Chủ tạo lệnh in kèm giá vốn thỏa thuận.
  const po = await PrintOrderService.create({
    productId: 'prod-p2-1', quantityPlanned: 100, unitCostAgreed: 20000,
    note: 'In đợt 1', actorRole: 'ROLE_OWNER', actorId: 'ADMIN-01',
  });
  eq2('lệnh in có mã', po.code.startsWith('LIN-'), true);
  eq2('trạng thái CONFIRMED', po.status, 'CONFIRMED');

  // 4. Nhập kho theo lệnh in: server tự gắn lô + giá vốn (mô phỏng route).
  const lot = await PrintOrderService.getLotInfo(po.id);
  const lotId = `LOT-${lot.code}`;
  await InventoryService.recordMovement({
    editionId: 'prod-p2-1', isBook: false, warehouseId: 'wh-p2', eventType: 'RECEIPT',
    quantityDelta: 100, documentRef: 'PN-P2-001', actorId: 'KHO-01',
    idempotencyKey: 'idem-p2-rcpt-1', lotId, unitCostSnapshot: lot.unitCostAgreed,
  });
  await PrintOrderService.addReceived(po.id, 100, db);
  const ledgers: any[] = await db.all(sql`SELECT lot_id, unit_cost_snapshot FROM inventory_ledger WHERE document_ref='PN-P2-001'`);
  eq2('bút toán nhập có lotId', ledgers[0]?.lot_id, lotId);
  eq2('bút toán nhập có giá vốn từ lệnh in', ledgers[0]?.unit_cost_snapshot, 20000);
  const poAfter = await PrintOrderService.getById(po.id, 'ROLE_OWNER');
  eq2('lệnh in cập nhật đã nhận', Number(poAfter.quantityReceived), 100);
  eq2('lệnh in DONE khi nhận đủ', poAfter.status, 'DONE');

  // 5. Nhập kho không theo lệnh in → lô chờ nhập giá vốn.
  await InventoryService.recordMovement({
    editionId: 'prod-p2-1', isBook: false, warehouseId: 'wh-p2', eventType: 'RECEIPT',
    quantityDelta: 50, documentRef: 'PN-P2-002', actorId: 'KHO-01',
    idempotencyKey: 'idem-p2-rcpt-2', lotId: 'LOT-MANUAL-P2',
  });
  const pending = await listPendingCostLots('ROLE_OWNER');
  eq2('1 lô chờ nhập giá vốn', pending.length, 1);
  eq2('đúng lô manual', pending[0]?.lotId, 'LOT-MANUAL-P2');
  eq2('số lượng 50', pending[0]?.receivedQty, 50);

  // 6. Chủ nhập giá vốn sau cho lô chờ.
  const set1: any = await setLotCost({ lotId: 'LOT-MANUAL-P2', unitCost: 25000, actorRole: 'ROLE_OWNER', actorId: 'ADMIN-01' });
  eq2('điền giá vốn cho 1 dòng', set1.updatedEntries, 1);
  const pendingAfter = await listPendingCostLots('ROLE_OWNER');
  eq2('hết lô chờ', pendingAfter.length, 0);

  // 7. Lô đã có giá vốn: không force → CONFLICT; force → ghi đè + audit.
  await expectCode('ghi đè không force bị chặn', () =>
    setLotCost({ lotId: 'LOT-MANUAL-P2', unitCost: 26000, actorRole: 'ROLE_OWNER', actorId: 'ADMIN-01' }), 'STATE_CONFLICT');
  await setLotCost({ lotId: 'LOT-MANUAL-P2', unitCost: 26000, force: true, actorRole: 'ROLE_OWNER', actorId: 'ADMIN-01' });
  const led2: any[] = await db.all(sql`SELECT unit_cost_snapshot FROM inventory_ledger WHERE lot_id='LOT-MANUAL-P2'`);
  eq2('ghi đè thành 26000', led2[0]?.unit_cost_snapshot, 26000);
  const audits: any[] = await db.all(sql`SELECT COUNT(*) c FROM audit_logs WHERE action='LOT_COST'`);
  eq2('có audit log giá vốn lô', Number(audits[0]?.c) >= 2, true);

  // 8. FIFO thuần logic: lô A 100@20k (t0), lô B 100@25k (t1).
  const mv: LotMovement[] = [
    { lotId: 'A', unitCost: 20000, qty: 100, at: '2026-10-01T00:00:00' },
    { lotId: 'B', unitCost: 25000, qty: 100, at: '2026-10-02T00:00:00' },
    { lotId: null, unitCost: null, qty: -150, at: '2026-10-10T00:00:00' },
  ];
  const r1 = allocateFifoCogs(mv, '2026-10-01T00:00:00', '2026-11-01T00:00:00');
  eq2('FIFO: xuất 150', r1.dispatchedQty, 150);
  eq2('FIFO: giá vốn = 100*20k + 50*25k', r1.cogs, 3250000);
  eq2('FIFO: không có unknown', r1.unknownQty, 0);

  // 9. Lô chưa có giá vốn → unknownQty, không tính bừa 0.
  const mv2: LotMovement[] = [
    { lotId: 'C', unitCost: null, qty: 50, at: '2026-10-01T00:00:00' },
    { lotId: null, unitCost: null, qty: -30, at: '2026-10-10T00:00:00' },
  ];
  const r2 = allocateFifoCogs(mv2, '2026-10-01T00:00:00', '2026-11-01T00:00:00');
  eq2('lô chưa có giá vốn: cogs = 0', r2.cogs, 0);
  eq2('lô chưa có giá vốn: unknown = 30', r2.unknownQty, 30);

  // 10b. F1: datetime lẫn format ISO ('T') và space — sắp xếp và lọt kỳ phải đúng.
  const mvMixed: LotMovement[] = [
    { lotId: 'M1', unitCost: 10000, qty: 100, at: '2026-09-01 00:00:00' },
    // 16:59:59 UTC = 23:59:59 giờ VN 30/09 → TRƯỚC kỳ, phải loại dù 'T' > ' '.
    { lotId: null, unitCost: null, qty: -10, at: '2026-09-30T16:59:59.000Z' },
    // 17:00:00 UTC = 00:00:00 giờ VN 01/10 → ĐẦU kỳ, phải tính.
    { lotId: null, unitCost: null, qty: -20, at: '2026-09-30T17:00:00.000Z' },
  ];
  const rMixed = allocateFifoCogs(mvMixed, '2026-09-30 17:00:00', '2026-10-31 17:00:00');
  eq2('F1: chỉ tính xuất trong kỳ dù lẫn format', rMixed.dispatchedQty, 20);
  eq2('F1: giá vốn đúng', rMixed.cogs, 200000);
  const mv3: LotMovement[] = [
    { lotId: 'D', unitCost: 10000, qty: 100, at: '2026-09-01T00:00:00' },
    { lotId: null, unitCost: null, qty: -40, at: '2026-09-15T00:00:00' },
    { lotId: null, unitCost: null, qty: -30, at: '2026-10-10T00:00:00' },
    { lotId: null, unitCost: null, qty: -20, at: '2026-11-05T00:00:00' },
  ];
  const r3 = allocateFifoCogs(mv3, '2026-10-01T00:00:00', '2026-11-01T00:00:00');
  eq2('chỉ tính xuất trong kỳ', r3.dispatchedQty, 30);
  eq2('giá vốn kỳ = 30*10k', r3.cogs, 300000);

  // 11. Quét rò rỉ giá vốn: không API non-owner nào được chạm 2 định danh này,
  // trừ route movement (gắn server-side, không trả về) và các route owner/.
  const apiDir = path.join(process.cwd(), 'src', 'app', 'api');
  const allowed = new Set([
    path.join(apiDir, 'owner'),
    path.join(apiDir, 'inventory', 'movement', 'route.ts'),
  ]);
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.ts')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (!/unitCostSnapshot|unitCostAgreed/.test(src)) continue;
      const isAllowed = [...allowed].some((a) => p === a || p.startsWith(a + path.sep));
      if (!isAllowed) leaks.push(path.relative(process.cwd(), p));
    }
  };
  walk(apiDir);
  eq2('không rò rỉ giá vốn ra API non-owner', leaks.length, 0);
  if (leaks.length) console.log('   rò rỉ tại:', leaks.join(', '));

  console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}: ${pass} đạt, ${fail} hỏng`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('❌ EXCEPTION:', e);
  process.exit(1);
});
