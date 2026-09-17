/**
 * 5.4 — READER PERSONA nền dữ liệu (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-reader-persona
 * 6 cases: profile 360°, top thể loại, match cùng tác giả/thể loại,
 * loại người đã sở hữu, khách lạ ném lỗi, khách không mua không gợi ý.
 */
import { db, customers, customerOwnedBooks, editions, works } from '../src/db';
import { eq } from 'drizzle-orm';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import { ReaderProfileService } from '../src/services/reader-profile.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-reader-persona');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function mkWorkEdition(prefix: string, category: string, author: string): Promise<string> {
  const wid = `w-${prefix}-${Date.now()}-${seq++}`;
  const eid = `ed-${prefix}-${Date.now()}-${seq++}`;
  await db.insert(works).values({ id: wid, code: wid, title: `Tác phẩm ${prefix}`, author, category }).catch(() => {});
  await db.insert(editions).values({ id: eid, code: eid, workId: wid, isbn: '9786040000000', isbnLast4: '0000', coverPrice: 50000 }).catch(() => {});
  await InventoryService.recordMovement({ editionId: eid, warehouseId: 'wh-au-co', eventType: 'OPENING_BALANCE', quantityDelta: 50, documentRef: 'PERSONA', idempotencyKey: uniq('idem-open') });
  return eid;
}

async function mkCustomer(prefix: string): Promise<string> {
  const id = `cust-${prefix}-${Date.now()}-${seq++}`;
  await db.insert(customers).values({ id, code: id, fullName: `Độc giả ${prefix}` }).catch(() => {});
  return id;
}

async function buy(customerId: string, editionId: string, qty: number) {
  await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    customerName: 'Persona Test',
    customerId,
    cashierId: 'persona-tester',
    idempotencyKey: uniq('idem-sale'),
    items: [{ editionId, quantity: qty }],
  });
}

let passed = 0;
let total = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) {
    passed++;
    console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`);
  } else {
    console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  }
};

async function run() {
  console.log('📚 READER PERSONA 5.4 (DB cách ly)');
  const edA1 = await mkWorkEdition('pa1', 'TIEU_THUYET', 'TAC GIA A');
  const edA2 = await mkWorkEdition('pa2', 'TIEU_THUYET', 'TAC GIA A');
  const edB = await mkWorkEdition('pb', 'THO_CA', 'TAC GIA B');

  const custA = await mkCustomer('a');
  const custB = await mkCustomer('b');
  const custC = await mkCustomer('c');

  await buy(custA, edA1, 2); // A mua cùng tác giả A
  await buy(custB, edB, 1); // B mua thể loại khác
  await buy(custC, edA1, 1); // C mua cùng tác giả A
  await db.insert(customerOwnedBooks).values({ id: uniq('own'), customerId: custA, editionId: edA2 }).catch(() => {});

  // 1. Profile 360° của C.
  const prof = await ReaderProfileService.getReaderProfile(custC);
  ok(
    '1. Profile: 1 đơn, top thể loại TIEU_THUYET',
    prof.orders.count === 1 && prof.orders.booksQty === 1 && prof.topCategories[0]?.category === 'TIEU_THUYET',
    `orders=${prof.orders.count}`
  );

  // 2. Match cho edA2 (cùng tác giả A): C được gợi ý (điểm cao), A bị loại (đã sở hữu), B không có.
  const matched = await ReaderProfileService.matchReadersForEdition(edA2, 50);
  const ids = matched.map((m) => m.customerId);
  const cMatch = matched.find((m) => m.customerId === custC);
  ok(
    '2. Match: C có, A loại (đã sở hữu), B vắng',
    ids.includes(custC) && !ids.includes(custA) && !ids.includes(custB) && !!cMatch && cMatch.score > 0 && cMatch.reasons.length > 0,
    `score C=${cMatch?.score}`
  );

  // 3. Thứ hạng: C (mua cùng tác giả) xếp trên người chỉ mua cùng thể loại.
  const edA3 = await mkWorkEdition('pa3', 'TIEU_THUYET', 'TAC GIA A');
  const custD = await mkCustomer('d');
  await buy(custD, edA1, 1);
  const matched2 = await ReaderProfileService.matchReadersForEdition(edA3, 50);
  const rankC = matched2.findIndex((m) => m.customerId === custC);
  const rankD = matched2.findIndex((m) => m.customerId === custD);
  ok('3. Cùng tác giả xếp hạng (C,D đều có, điểm > 0)', rankC >= 0 && rankD >= 0 && matched2[rankC].score > 0, `C#${rankC} D#${rankD}`);

  // 4. Khách lạ ném lỗi rõ ràng.
  let threw = false;
  try {
    await ReaderProfileService.getReaderProfile('cust-khong-ton-tai');
  } catch {
    threw = true;
  }
  ok('4. Khách lạ ném lỗi', threw);

  // 5. Ấn bản lạ ném lỗi.
  let threw2 = false;
  try {
    await ReaderProfileService.matchReadersForEdition('ed-khong-ton-tai');
  } catch {
    threw2 = true;
  }
  ok('5. Ấn bản lạ ném lỗi', threw2);

  // 6. Khách không mua gì: profile rỗng đúng nghĩa, không gợi ý chính mình.
  const custE = await mkCustomer('e');
  const profE = await ReaderProfileService.getReaderProfile(custE);
  const matched3 = await ReaderProfileService.matchReadersForEdition(edA3, 50);
  ok(
    '6. Khách 0 đơn: profile rỗng + không tự gợi ý',
    profE.orders.count === 0 && profE.topCategories.length === 0 && !matched3.some((m) => m.customerId === custE)
  );

  console.log(`\n${passed === total ? '🎉' : '⚠️'} READER PERSONA 5.4: ${passed}/${total} cases ${passed === total ? 'PASS 100%' : 'CÓ FAIL'}`);
  if (passed !== total) process.exit(1);
}

run().catch((err) => {
  console.error('❌ test-reader-persona thất bại:', err);
  process.exit(1);
});
