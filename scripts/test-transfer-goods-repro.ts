/**
 * Repro: chuyển kho 1-cuốn 403 allowlist + hàng hóa (GOODS) không nhập/chuyển được.
 * Chạy cách ly: npx tsx scripts/run-isolated.ts --only=test-transfer-goods-repro
 *
 * FAIL trước fix:
 *  A. transfer() sách giữa 2 kho vật lý, KHÔNG cấu hình allowlist → 403 allowlist.
 *  B. recordMovement RECEIPT cho hàng hóa → FK editions(id) vi phạm.
 *  C. transferBatch chứa hàng hóa → "Ấn bản không tồn tại trong danh mục".
 *  D. transfer() 1-cuốn cho hàng hóa → 403 (chặn trước cả lỗi hàng hóa).
 */
import { InventoryService } from '../src/services/inventory.service';
import { toActorContext } from '../src/services/actor-context';
import { resetDirectTransferAllowlist } from '../src/services/direct-transfer-policy';
import { db, editions, products, warehouses } from '../src/db';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-transfer-goods-repro');

const ICTX = (id: string) => toActorContext(id, 'ROLE_MANAGER');
let failures = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

async function main() {
  resetDirectTransferAllowlist(); // mô phỏng prod: chưa cấu hình cặp nào

  const allWh = await db.select().from(warehouses);
  const act = allWh.filter((w) => w.isActive === true);
  if (act.length < 2) throw new Error('DB cách ly thiếu 2 kho active');
  const [wA, wB] = act;
  console.log(`Kho A: ${wA.name} (${wA.id}) | Kho B: ${wB.name} (${wB.id})`);

  const [book] = await db.select().from(editions).orderBy(editions.code).limit(1);
  if (!book) throw new Error('Thiếu ấn bản seed');

  // Hàng hóa repro (idempotent theo code).
  const gid = 'prod-repro-sp';
  const exist = await db.select().from(products).where((await import('drizzle-orm')).eq(products.id, gid));
  if (exist.length === 0) {
    await db.insert(products).values({ id: gid, code: 'SP-REPRO', name: 'Bookmark repro', productKind: 'GOODS', sellingPrice: 5000 });
  }

  // Nhập lót đường cho sách ở kho A (đường RECEIPT sách vẫn chạy).
  await InventoryService.recordMovement({
    editionId: book.id, warehouseId: wA.id, eventType: 'RECEIPT', quantityDelta: 50,
    documentRef: `PNK-REPRO-${Date.now()}`, actorId: 'repro', idempotencyKey: `repro-book-seed-${Date.now()}`,
  });

  // A. Chuyển 1-cuốn sách, không allowlist → phải thành công (kho vật lý active).
  try {
    const beforeA = await InventoryService.getBalance(book.id, wA.id, 'NEW');
    const r = await InventoryService.transfer({
      editionId: book.id, fromWarehouseId: wA.id, toWarehouseId: wB.id, quantity: 5,
      documentRef: `PCK-REPRO-A-${Date.now()}`, actorContext: ICTX('repro-a'), idempotencyKey: `repro-a-${Date.now()}`,
    });
    ok('A: transfer 1-cuốn không cần allowlist tĩnh', r.fromWarehouse!.newQuantity === beforeA - 5, `tồn ${beforeA}→${r.fromWarehouse!.newQuantity}`);
  } catch (e: any) {
    ok('A: transfer 1-cuốn không cần allowlist tĩnh', false, e?.message);
  }

  // B. Nhập hàng hóa mới (RECEIPT) → phải thành công, không FK.
  try {
    const r = await InventoryService.recordMovement({
      editionId: gid, warehouseId: wA.id, eventType: 'RECEIPT', quantityDelta: 100,
      documentRef: `PNK-REPRO-B-${Date.now()}`, actorId: 'repro', idempotencyKey: `repro-b-${Date.now()}`,
    });
    ok('B: RECEIPT hàng hóa không FK', r.newQuantity === 100);
  } catch (e: any) {
    ok('B: RECEIPT hàng hóa không FK', false, e?.message);
  }

  // C. Chuyển hàng loạt chứa hàng hóa → phải thành công.
  try {
    const r = await InventoryService.transferBatch({
      fromWarehouseId: wA.id, toWarehouseId: wB.id,
      items: [{ editionId: gid, quantity: 10 }],
      actorContext: ICTX('repro-c'), idempotencyKey: `repro-c-${Date.now()}`,
    });
    ok('C: transferBatch hàng hóa', (r as any).lines?.length === 1);
  } catch (e: any) {
    ok('C: transferBatch hàng hóa', false, e?.message);
  }

  // D. Chuyển 1-cuốn hàng hóa → phải thành công.
  try {
    await InventoryService.transfer({
      editionId: gid, fromWarehouseId: wA.id, toWarehouseId: wB.id, quantity: 5,
      documentRef: `PCK-REPRO-D-${Date.now()}`, actorContext: ICTX('repro-d'), idempotencyKey: `repro-d-${Date.now()}`,
    });
    const bal = await InventoryService.getBalance(gid, wB.id, 'NEW');
    ok('D: transfer 1-cuốn hàng hóa', bal === 15, `tồn B=${bal}`);
  } catch (e: any) {
    ok('D: transfer 1-cuốn hàng hóa', false, e?.message);
  }

  if (failures > 0) { console.log(`❌ ${failures} case FAIL`); process.exit(1); }
  console.log('🎉 REPRO XANH — chuyển kho + hàng hóa thông.');
}

main().catch((e) => { console.error('REPRO CRASH:', e?.message); process.exit(1); });
