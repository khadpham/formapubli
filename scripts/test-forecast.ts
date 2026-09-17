import { db, works, editions } from '../src/db';
import { InventoryService } from '../src/services/inventory.service';
import { OrderService } from '../src/services/order.service';
import {
  ForecastService,
  classifyLevel,
  computeDoI,
  computeEOQ,
  computeReprintSuggestion,
} from '../src/services/forecast.service';
import { GET as ForecastGET } from '../src/app/api/forecast/route';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-forecast');

// Quy ước cách ly: ấn bản test dùng prefix FC- và chỉ suite này động tới.
// Suite chạy CUỐI runner nên không nhiễu kiểm toán đếm 81 ấn bản.
async function ensureTestEdition(code: string, coverPrice: number): Promise<string> {
  const workId = `w-${code.toLowerCase()}`;
  const editionId = `ed-${code.toLowerCase()}`;
  await db.insert(works).values({
    id: workId, code: `W-${code}`, title: `Sách forecast ${code}`, author: 'Forecast Tester', isActive: true,
  }).onConflictDoNothing();
  await db.insert(editions).values({
    id: editionId, code, workId, title: `Sách forecast ${code}`,
    isbn: `9780000${code}`, isbnLast4: code.slice(-4), coverPrice, isActive: true,
  }).onConflictDoNothing();
  return editionId;
}

async function receipt(editionId: string, qty: number, tag: string) {
  await InventoryService.recordMovement({
    editionId, warehouseId: 'wh-au-co', eventType: 'RECEIPT', quantityDelta: qty,
    condition: 'NEW', documentRef: `FC-PREP-${tag}`, actorId: 'forecast-test',
    idempotencyKey: `fc-prep-${editionId}-${tag}-${Date.now()}`,
  });
}

async function sell(editionId: string, qty: number, tag: string) {
  await OrderService.createOrder({
    warehouseId: 'wh-au-co',
    channel: 'RETAIL_OFFICE',
    customerName: `Khách forecast ${tag}`,
    fiscalScope: 'INTERNAL_MANAGEMENT',
    cashierId: 'forecast-test',
    items: [{ editionId, quantity: qty }],
    idempotencyKey: `fc-sell-${editionId}-${tag}-${Date.now()}`,
  });
}

async function runForecastTests() {
  console.log('📉 ========================================================');
  console.log('📉 KIỂM THỬ DỰ BÁO TÁI BẢN THEO VẬN TỐC BÁN (V_sale)');
  console.log('📉 ========================================================\n');

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

  const edRed = await ensureTestEdition('FC-RED', 100000);
  const edYel = await ensureTestEdition('FC-YEL', 100000);
  const edOk = await ensureTestEdition('FC-OK', 100000);
  const edZero = await ensureTestEdition('FC-ZERO', 100000);

  await receipt(edRed, 60, 'red');
  await sell(edRed, 45, 'red');
  await receipt(edYel, 23, 'yel');
  await sell(edYel, 10, 'yel');
  await receipt(edOk, 200, 'ok');
  await sell(edOk, 5, 'ok');
  await receipt(edZero, 50, 'zero');

  // TEST 1: RED — V=1.5/ngày, tồn 15 -> DoI=10, EOQ=158.
  const red = await ForecastService.forecastEdition(edRed, 30);
  ok(
    red.level === 'RED_ALERT' && red.doi === 10 && red.suggestedReprintQty === 158,
    'RED_ALERT khi DoI=10 (V=1.5, tồn 15, đề xuất 158 cuốn)',
    `V=${red.vSale}, DoI=${red.doi}, EOQ=${red.suggestedReprintQty}`
  );

  // TEST 2: YELLOW — V=1/3/ngày, tồn 13 -> DoI=39.
  const yel = await ForecastService.forecastEdition(edYel, 30);
  ok(
    yel.level === 'YELLOW_WARNING' && Math.abs((yel.doi ?? 0) - 39) < 1e-6,
    'YELLOW_WARNING khi DoI=39 (V=0.33, tồn 13)',
    `V=${yel.vSale}, DoI=${yel.doi}`
  );

  // TEST 3: HEALTHY tồn dày — DoI=1170.
  const healthy = await ForecastService.forecastEdition(edOk, 30);
  ok(
    healthy.level === 'HEALTHY_NORMAL' && Math.abs((healthy.doi ?? 0) - 1170) < 1e-6,
    'HEALTHY_NORMAL khi DoI=1170 (V=0.167, tồn 195)'
  );

  // TEST 4: Không bán được cuốn nào -> DoI vô cùng, EOQ 0, vẫn HEALTHY.
  const zero = await ForecastService.forecastEdition(edZero, 30);
  ok(
    zero.vSale === 0 && zero.doi === null && zero.suggestedReprintQty === 0 &&
    zero.level === 'HEALTHY_NORMAL',
    'V=0 -> DoI vô cùng, EOQ 0, HEALTHY (chậm lưu thông, không báo đỏ)'
  );

  // TEST 5: Cửa sổ ngắn làm nóng cảnh báo (cùng tồn 13, window 7d -> DoI≈9.1 RED).
  const yel7 = await ForecastService.forecastEdition(edYel, 7);
  ok(
    yel7.level === 'RED_ALERT' && Math.abs(yel7.vSale - 10 / 7) < 1e-6,
    'Window 7 ngày: cùng tồn kho nhưng V cao hơn -> RED',
    `V7=${yel7.vSale}, DoI7=${yel7.doi}`
  );

  // TEST 6: Biên phân cấp chuẩn RED<=30 < YELLOW<=45.
  ok(
    classifyLevel(30) === 'RED_ALERT' &&
    classifyLevel(30.0001) === 'YELLOW_WARNING' &&
    classifyLevel(45) === 'YELLOW_WARNING' &&
    classifyLevel(45.0001) === 'HEALTHY_NORMAL' &&
    classifyLevel(null) === 'HEALTHY_NORMAL' &&
    computeDoI(100, 0) === null &&
    computeEOQ(0) === 0 &&
    computeEOQ(1.5) === 158 &&
    computeReprintSuggestion(0) === 0 &&
    computeReprintSuggestion(1.5) === 158,
    'Biên phân cấp + công thức thuần đúng tuyệt đối'
  );

  // TEST 7: Lọc theo kho xuất.
  const redAuCo = await ForecastService.forecastEdition(edRed, 30, 'wh-au-co');
  ok(redAuCo.totalStock === 15, 'Lọc warehouseId=wh-au-co cho đúng tồn quầy Âu Cơ');

  // TEST 8: API smoke — lọc RED chứa FC-RED + summary.
  const apiReq = new Request('http://localhost/api/forecast?level=RED_ALERT&limit=200', {
    headers: { 'x-formapubli-role': 'ROLE_OWNER', 'x-formapubli-actor': 'owner-test' },
  });
  const apiRes: any = await ForecastGET(apiReq as any);
  const apiJson = await apiRes.json();
  ok(
    apiRes.status === 200 && apiJson.success === true &&
    apiJson.data.some((d: any) => d.code === 'FC-RED' && d.level === 'RED_ALERT') &&
    apiJson.summary.RED_ALERT >= 1 &&
    apiJson.params.leadTimeDays === 30 && apiJson.params.redDays === 30,
    'API /api/forecast lọc RED + summary + tham số chuẩn'
  );

  console.log('\n========================================================');
  console.log(`🎉 HOÀN TẤT: ${passed}/${total} BÀI TEST DỰ BÁO TÁI BẢN ĐẠT 100%!`);
  console.log('========================================================\n');
}

runForecastTests().catch((err) => {
  console.error('❌ test-forecast thất bại:', err);
  process.exit(1);
});
