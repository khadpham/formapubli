/**
 * Suite vòng đời chiến dịch (DB cách ly).
 * Chạy: npx tsx scripts/run-isolated.ts --only=test-campaign-lifecycle
 * Bao phủ: create→DRAFT; start→ACTIVE + kho FAIR_EVENT; start lại→conflict;
 * chuyển hàng vào kho CD; end(duyệt tồn thừa)→ENDED + kho ngưng + staff gỡ gán;
 * end khi tồn 0; end lại→lỗi; kho ngưng tay giữa kỳ rồi end→lỗi rõ.
 */
import { db, campaigns, warehouses, stockBalances, staffAccounts } from '../src/db';
import { eq } from 'drizzle-orm';
import { CampaignService } from '../src/services/campaign.service';
import { WarehouseService } from '../src/services/warehouse.service';
import { InventoryService } from '../src/services/inventory.service';
import { ProductService } from '../src/services/product.service';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-campaign-lifecycle');

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${seq++}`;
const shortTag = Date.now().toString(36).toUpperCase(); // gọn để vừa luật mã hàng (≤20 ký tự sau SP-)
const actor = { staffId: 'CD-TEST-MGR', role: 'ROLE_MANAGER' as const };

async function dbCampaign(id: string) {
  const rows = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return rows[0] as any;
}

async function run() {
  console.log('🏕️ KIỂM THỬ VÒNG ĐỜI CHIẾN DỊCH (DB cách ly)');
  let passed = 0;
  const total = 11;
  const ok = (name: string, cond: boolean, extra = '') => {
    if (cond) { passed++; console.log(`✅ PASS: ${name}${extra ? ` (${extra})` : ''}`); }
    else console.log(`❌ FAIL: ${name}${extra ? ` (${extra})` : ''}`);
  };

  const tag = uniq('CD');
  const src = await WarehouseService.createWarehouse({ code: `KHO_NGUON_${tag}`, name: `Kho nguon ${tag}`, warehouseType: 'PHYSICAL_MAIN' });
  const prod = await ProductService.create({ code: `SP-CD-${shortTag}`, name: `SP campaign ${tag}`, sellingPrice: 10000 });
  await InventoryService.recordMovement({
    editionId: prod.id!, isBook: false, warehouseId: src.id, eventType: 'OPENING_BALANCE',
    quantityDelta: 10, condition: 'NEW', documentRef: `CD-OPEN-${tag}`, note: 'seed suite',
    idempotencyKey: `idem-cd-open-${tag}`, actorId: 'CD-TEST',
  });

  // 1. create → DRAFT
  const { id: cdId } = await CampaignService.create({
    name: `Hoi cho ${tag}`, startDate: '2026-10-10', endDate: '2026-10-17',
    sourceWarehouseId: src.id, actorId: 'CD-TEST-MGR',
  });
  ok('1. Tao campaign DRAFT', (await dbCampaign(cdId))?.status === 'DRAFT');

  // 2. create sai ngày / sai kho nguồn → lỗi
  let bad = 0;
  try { await CampaignService.create({ name: 'x', startDate: '2026-10-17', endDate: '2026-10-10', sourceWarehouseId: src.id, actorId: 't' }); } catch { bad++; }
  try { await CampaignService.create({ name: 'x', startDate: '2026-10-10', endDate: '2026-10-17', sourceWarehouseId: 'khong-co', actorId: 't' }); } catch { bad++; }
  ok('2. Chan ngay sai + kho nguon ao', bad === 2);

  // 3. start → ACTIVE + kho FAIR_EVENT
  const started = await CampaignService.start({ campaignId: cdId, actor });
  const c3 = await dbCampaign(cdId);
  const wh3 = await WarehouseService.getWarehouse(started.warehouseId);
  ok('3. Start ACTIVE + kho FAIR_EVENT', c3.status === 'ACTIVE' && c3.warehouseId === started.warehouseId && (wh3 as any)?.warehouseType === 'FAIR_EVENT');

  // 4. start lại → conflict, không sinh kho thứ 2
  let conflict = false;
  try { await CampaignService.start({ campaignId: cdId, actor }); } catch (e: any) { conflict = /bắt đầu|kết thúc|conflict/i.test(e.message); }
  ok('4. Start lai bi chan', conflict);

  // 5. chuyển 10 cuốn vào kho CD
  await InventoryService.transferBatch({
    fromWarehouseId: src.id, toWarehouseId: started.warehouseId,
    items: [{ editionId: prod.id!, quantity: 10 }], note: 'cap hang hoi cho',
    actorContext: actor, idempotencyKey: `idem-cd-in-${tag}`,
  });
  const balSrc = await InventoryService.getBalance(prod.id!, src.id);
  const balCd = await InventoryService.getBalance(prod.id!, started.warehouseId);
  ok('5. Chuyen hang vao kho CD', balSrc === 0 && balCd === 10, `nguon=${balSrc} cd=${balCd}`);

  // 6. xem trước tồn thừa
  const left = await CampaignService.getLeftover({ campaignId: cdId });
  ok('6. Xem truoc ton thua', left.length === 1 && Number(left[0].quantity) === 10);

  // 7. gán staff vào kho CD rồi end → staff gỡ gán, kho ngưng, ENDED
  const staffId = uniq('CDNV');
  await db.insert(staffAccounts).values({
    staffId, fullName: 'NV chien dich', role: 'ROLE_CASHIER',
    passcodeHash: 'x', salt: 'y', allowedWarehouseIds: JSON.stringify([started.warehouseId]),
  });
  await CampaignService.end({ campaignId: cdId, items: [{ editionId: prod.id!, quantity: 4 }], actor });
  const c7 = await dbCampaign(cdId);
  const wh7 = await WarehouseService.getWarehouse(started.warehouseId);
  const st7 = (await db.select().from(staffAccounts).where(eq(staffAccounts.staffId, staffId)).limit(1))[0] as any;
  const src7 = await InventoryService.getBalance(prod.id!, src.id);
  ok('7. End: ENDED + kho ngung + staff go gan + ton ve 4',
    c7.status === 'ENDED' && (wh7 as any)?.isActive === false
    && !JSON.parse(st7.allowedWarehouseIds).includes(started.warehouseId) && src7 === 4);

  // 8. end lại + xem tồn sau end → lỗi
  let bad8 = 0;
  try { await CampaignService.end({ campaignId: cdId, items: [], actor }); } catch { bad8++; }
  try { await CampaignService.getLeftover({ campaignId: cdId }); } catch { bad8++; }
  ok('8. End lai + xem ton sau end bi chan', bad8 === 2);

  // 9. kho ngưng tay giữa kỳ rồi end → lỗi rõ
  const { id: cd2 } = await CampaignService.create({
    name: `Hoi cho 2 ${tag}`, startDate: '2026-10-10', endDate: '2026-10-17',
    sourceWarehouseId: src.id, actorId: 'CD-TEST-MGR',
  });
  const s2 = await CampaignService.start({ campaignId: cd2, actor });
  await WarehouseService.updateWarehouse(s2.warehouseId, { isActive: false });
  let loud = '';
  try { await CampaignService.end({ campaignId: cd2, items: [{ editionId: prod.id!, quantity: 1 }], actor }); }
  catch (e: any) { loud = e.message; }
  ok('9. End khi kho ngung tay bao ro', /ngưng|tồn tại| ACTIVE|bắt đầu/i.test(loud), loud.slice(0, 60));

  // 10. end khi tồn thừa 0 → vẫn ENDED + kho ngưng
  const { id: cd3 } = await CampaignService.create({
    name: `Hoi cho 3 ${tag}`, startDate: '2026-10-10', endDate: '2026-10-17',
    sourceWarehouseId: src.id, actorId: 'CD-TEST-MGR',
  });
  const s3 = await CampaignService.start({ campaignId: cd3, actor });
  await CampaignService.end({ campaignId: cd3, items: [], actor });
  const c10 = await dbCampaign(cd3);
  const wh10 = await WarehouseService.getWarehouse(s3.warehouseId);
  ok('10. End ton 0 van ENDED + ngung kho', c10.status === 'ENDED' && (wh10 as any)?.isActive === false);

  // 11. bẫy test-giả-xanh: cắt service mà test vẫn xanh là test hỏng — kiểm tra
  // ngược: campaign vừa end KHÔNG còn ACTIVE (đọc trực tiếp, không qua service).
  const raw = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, cdId));
  ok('11. Doc truc tiep DB khop ENDED', raw[0]?.status === 'ENDED');

  console.log(`\n${passed}/${total} PASS`);
  process.exit(passed === total ? 0 : 1);
}
run().catch((e) => { console.error('FAIL ngoai le:', e?.message || e); process.exit(1); });
