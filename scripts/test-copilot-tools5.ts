/**
 * Copilot: 5 tool mới — sáng/chiều, so 2 kỳ, luân chuyển kho,
 * quà/trả hàng, tra đơn theo mã.
 *
 * Chạy trên DB cách ly; dữ liệu test TỰ TẠO trong test (không
 * phụ thuộc seed) → deterministic. Giá trị kỳ vọng lấy từ chính
 * dữ liệu test vừa insert, không ghi cứng số của code.
 */
import assert from 'node:assert/strict';
import {
  db, editions, orders, orderItems,
  transferShipments, transferShipmentItems,
  returnOrders, returnOrderItems,
} from '../src/db';
import { POST as postCopilot } from '../src/app/api/ai/copilot/route';
import { SESSION_COOKIE_NAME, signSession } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';
import { ExecutiveQueryService } from '../src/services/executive-query.service';
import { CopilotGuardrails } from '../src/services/ai/copilot-guardrails';

assertIsolatedTestDb('test-copilot-tools5');

let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  // Ép heuristic path (local): không gọi LLM thật.
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.CF_ACCOUNT_ID;

  // --- 1. parseVnWindow: bóc khung thời gian từ tiếng Việt ---
  ok(CopilotGuardrails.parseVnWindow('2 tuần qua', 30) === 14, '2 tuần = 14 ngày');
  ok(CopilotGuardrails.parseVnWindow('3 tháng', 30) === 90, '3 tháng = 90 ngày (trần 92)');
  ok(CopilotGuardrails.parseVnWindow('tuần này', 30) === 7, 'tuần này = 7 ngày');
  ok(CopilotGuardrails.parseVnWindow('tháng này', 30) === 30, 'tháng này = 30 ngày');
  ok(CopilotGuardrails.parseVnWindow('hôm nay', 30) === 1, 'hôm nay = 1 ngày');
  ok(CopilotGuardrails.parseVnWindow('cho xin báo cáo', 30) === 30, 'không nhắc thời gian = fallback 30');

  // --- 2. Seed dữ liệu riêng (lấy ấn bản thật từ catalog, không ghi cứng) ---
  const edRows = await db.select({ id: editions.id, code: editions.code, title: editions.title }).from(editions).limit(2);
  ok(edRows.length >= 2, 'DB test phải có ≥2 ấn bản');
  const ed0 = edRows[0];
  const ed1 = edRows[1];
  const ts = Date.now().toString(36);
  const todayVn = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const dayStamp = todayVn.replace(/-/g, '');

  // Đơn SÁNG hôm nay (8h VN = 01:00 UTC): 3 cuốn thường + 2 cuốn quà.
  const orderId1 = `ord-test-morning-${ts}`;
  const orderCode1 = `ORD-${dayStamp}-TM${ts.toUpperCase()}`;
  await db.insert(orders).values({
    id: orderId1, orderCode: orderCode1, warehouseId: 'wh-au-co',
    subtotal: 340000, discountAmount: 100000, finalAmount: 240000,
    customerName: 'Tools5 Test', cashierId: 'staff-admin',
    idempotencyKey: `idem-morning-${ts}`,
    createdAt: `${todayVn}T01:00:00.000Z`,
  });
  await db.insert(orderItems).values([
    { id: `oi-1a-${ts}`, orderId: orderId1, productId: ed0.id, editionId: ed0.id, quantity: 3, unitCoverPrice: 100000, unitSellingPrice: 80000, totalAmount: 240000 },
    { id: `oi-1b-${ts}`, orderId: orderId1, productId: ed1.id, editionId: ed1.id, quantity: 2, unitCoverPrice: 50000, unitSellingPrice: 50000, totalAmount: 100000, isGiftLine: true },
  ]);
  // Đơn CHIỀU hôm nay (15h VN = 08:00 UTC): 2 cuốn.
  const orderId2 = `ord-test-afternoon-${ts}`;
  await db.insert(orders).values({
    id: orderId2, orderCode: `ORD-${dayStamp}-TA${ts.toUpperCase()}`, warehouseId: 'wh-au-co',
    subtotal: 120000, finalAmount: 120000, customerName: 'Tools5 Test', cashierId: 'staff-admin',
    idempotencyKey: `idem-afternoon-${ts}`,
    createdAt: `${todayVn}T08:00:00.000Z`,
  });
  await db.insert(orderItems).values({
    id: `oi-2a-${ts}`, orderId: orderId2, productId: ed0.id, editionId: ed0.id,
    quantity: 2, unitCoverPrice: 60000, unitSellingPrice: 60000, totalAmount: 120000,
  });

  // Phiếu luân chuyển kho: gửi 15, nhận 13, thất lạc 2.
  const trfId = `TRF-TEST-${ts.toUpperCase()}`;
  await db.insert(transferShipments).values({
    id: trfId, fromWarehouseId: 'wh-au-co', toWarehouseId: 'wh-quynh-mai',
    dispatcherId: 'staff-admin', receiverId: 'staff-qm', status: 'RECEIVED_FULL',
    dispatchedAt: new Date().toISOString(), receivedAt: new Date().toISOString(),
  });
  await db.insert(transferShipmentItems).values([
    { id: `ti-1-${ts}`, shipmentId: trfId, editionId: ed0.id, dispatchedQty: 10, receivedQty: 8, lostQty: 2 },
    { id: `ti-2-${ts}`, shipmentId: trfId, editionId: ed1.id, dispatchedQty: 5, receivedQty: 5 },
  ]);

  // Phiếu trả hàng: hoàn 50.000 đ.
  const retId = `RET-TEST-${ts.toUpperCase()}`;
  await db.insert(returnOrders).values({
    id: retId, orderId: orderId1, returnCode: `RET-${dayStamp}-T${ts.toUpperCase()}`,
    returnType: 'REFUND', reason: 'CUSTOMER_CHANGE_MIND', status: 'COMPLETED',
    refundAmount: 50000, targetWarehouseId: 'wh-au-co', inventoryDisposition: 'RESTOCK',
    createdBy: 'staff-admin', idempotencyKey: `idem-ret-${ts}`,
  });
  await db.insert(returnOrderItems).values({
    id: `ri-1-${ts}`, returnId: retId, editionId: ed0.id, quantity: 1, unitRefund: 50000,
  });

  // --- 3. Service: sáng/chiều ---
  const split = await ExecutiveQueryService.queryShiftSplit({ date: todayVn, windowDays: 1, warehouseId: 'wh-au-co' });
  ok(split.morning.qty === 5, `sáng phải 5 cuốn (3 thường + 2 quà), thật: ${split.morning.qty}`);
  ok(split.afternoon.qty === 2, `chiều phải 2 cuốn, thật: ${split.afternoon.qty}`);
  ok(split.stronger === 'sang', `sáng mạnh hơn, thật: ${split.stronger}`);
  ok(split.morning.orders === 1 && split.afternoon.orders === 1, 'mỗi ca 1 đơn');
  ok(split.scopeLabel.includes('Âu Cơ'), `scopeLabel có tên kho thật: ${split.scopeLabel}`);

  // --- 4. Service: so 2 kỳ ---
  const cmp = await ExecutiveQueryService.queryPeriodCompare({ windowDays: 7 });
  ok(cmp.windowDays === 7, 'so kỳ 7 ngày');
  ok(cmp.current.from <= cmp.current.to, 'kỳ này range hợp lệ');
  ok(cmp.previous.to < cmp.current.from, 'kỳ trước kết thúc trước kỳ này');
  ok('ordersPct' in cmp.change && 'qtyPct' in cmp.change && 'revenuePct' in cmp.change, 'change có đủ 3 chỉ số');
  ok(cmp.current.orders >= 2, `kỳ này có ≥2 đơn test, thật: ${cmp.current.orders}`);

  // --- 5. Service: luân chuyển kho ---
  const trf = await ExecutiveQueryService.queryTransferHistory({ windowDays: 30 });
  ok(trf.total >= 1, `có ≥1 phiếu luân chuyển, thật: ${trf.total}`);
  const trfMine = trf.items.find((i) => i.id === trfId);
  ok(!!trfMine, 'tìm thấy phiếu test trong danh sách');
  ok(trfMine!.fromWarehouse.includes('Âu Cơ'), `kho gửi hiện TÊN THẬT: ${trfMine!.fromWarehouse}`);
  ok(trfMine!.toWarehouse.includes('Quỳnh Mai'), `kho nhận hiện TÊN THẬT: ${trfMine!.toWarehouse}`);
  ok(trfMine!.dispatchedQty === 15, `gửi 15 cuốn, thật: ${trfMine!.dispatchedQty}`);
  ok(trfMine!.receivedQty === 13, `nhận 13 cuốn, thật: ${trfMine!.receivedQty}`);
  ok(trfMine!.lostQty === 2, `thất lạc 2 cuốn, thật: ${trfMine!.lostQty}`);
  ok(trfMine!.receiverId === 'staff-qm', 'hiện người xác nhận nhận hàng');

  // --- 6. Service: quà + trả hàng ---
  const gr = await ExecutiveQueryService.queryGiftReturn({ windowDays: 30 });
  ok(gr.gifts.qty >= 2, `quà đã xuất ≥2 cuốn, thật: ${gr.gifts.qty}`);
  ok(gr.gifts.orders >= 1, `quà nằm trong ≥1 đơn, thật: ${gr.gifts.orders}`);
  ok(gr.gifts.top.some((t) => t.qty === 2 && t.code === ed1.code), `top quà khớp mã thật ${ed1.code}`);
  ok(gr.returns.count === 1, `1 phiếu trả, thật: ${gr.returns.count}`);
  ok(gr.returns.refundAmount === 50000, `hoàn 50.000 đ, thật: ${gr.returns.refundAmount}`);
  ok((gr.returns.byStatus['COMPLETED'] || 0) === 1, 'phiếu trả COMPLETED được đếm');

  // --- 7. Service: tra đơn theo mã ---
  const hit = await ExecutiveQueryService.queryOrderLookup({ q: `tra don ${orderCode1}` });
  ok(hit.found === true, 'tìm thấy đơn bằng mã trong câu hỏi');
  ok(hit.orderCode === orderCode1, `mã đơn đúng: ${hit.orderCode}`);
  ok(hit.items!.length === 2, `đơn có 2 dòng, thật: ${hit.items!.length}`);
  ok(hit.items![1].isGift === true, 'dòng quà được đánh dấu');
  ok(hit.items![0].code === ed0.code, `dòng hàng mang mã ấn bản thật: ${hit.items![0].code}`);
  ok(hit.order!.finalAmount === 240000, `thu 240.000 đ, thật: ${hit.order!.finalAmount}`);
  ok(hit.order!.warehouse.includes('Âu Cơ'), 'đơn hiện tên kho');

  const miss = await ExecutiveQueryService.queryOrderLookup({ q: 'tra don ORD-KHONGTONAT' });
  ok(miss.found === false, 'mã đơn không tồn tại → found=false');
  ok(!!miss.warning && miss.warning.includes('ORD-KHONGTONAT'), `warning nói rõ mã: ${miss.warning}`);
  const noCode = await ExecutiveQueryService.queryOrderLookup({ q: 'tra don' });
  ok(noCode.found === false && !!noCode.warning, 'không có mã → báo yêu cầu mã, không đoán');

  // --- 8. Routing heuristic (ép local): câu hỏi → đúng tool ---
  const session = await signSession({
    role: 'ROLE_OWNER', actorId: 'ADMIN-01', fullName: 'Tools5 Test',
    issuedAt: Date.now(), expiresAt: Date.now() + 60_000,
  });
  const cookie = `${SESSION_COOKIE_NAME}=${session}`;
  const ask = async (question: string) => {
    const res: any = await postCopilot(
      new Request('http://localhost/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ question, modelOverride: 'local' }),
      }) as any
    );
    return res.json();
  };

  const r1 = await ask('Sáng hay chiều mạnh hơn?');
  ok(r1.success === true, 'API sáng/chiều success');
  ok(r1.data?.toolUsed === 'query_shift_split', `sáng/chiều → query_shift_split, thật: ${r1.data?.toolUsed}`);
  ok(r1.data?.toolData?.morning?.qty === 5, `toolData sáng 5 cuốn, thật: ${r1.data?.toolData?.morning?.qty}`);
  ok(typeof r1.data?.answer === 'string' && r1.data.answer.length > 15, 'có câu trả lời tự nhiên');
  ok(!r1.data.answer.includes('{"'), 'đáp không dính JSON thô');

  const r2 = await ask('Doanh thu tháng này so với tháng trước tăng bao nhiêu?');
  ok(r2.data?.toolUsed === 'query_period_compare', `doanh thu so tháng trước → query_period_compare (KHÔNG rơi vào doanh số 1 kỳ), thật: ${r2.data?.toolUsed}`);
  ok(r2.data?.toolData?.windowDays === 30, `so kỳ mặc định 30 ngày, thật: ${r2.data?.toolData?.windowDays}`);

  const r3 = await ask('Cho xem lịch sử chuyển kho gần đây');
  ok(r3.data?.toolUsed === 'query_transfer_history', `chuyển kho → query_transfer_history (KHÔNG rơi vào tồn kho), thật: ${r3.data?.toolUsed}`);
  ok(r3.data?.toolData?.total >= 1, 'toolData có phiếu chuyển');

  const r4 = await ask('Quà đã xuất bao nhiêu cuốn?');
  ok(r4.data?.toolUsed === 'query_gift_return', `quà đã xuất → query_gift_return, thật: ${r4.data?.toolUsed}`);
  ok(r4.data?.toolData?.gifts?.qty >= 2, 'toolData quà ≥2 cuốn');

  const r5 = await ask(`Tra đơn ${orderCode1}`);
  ok(r5.data?.toolUsed === 'query_order_lookup', `tra đơn → query_order_lookup, thật: ${r5.data?.toolUsed}`);
  ok(r5.data?.toolData?.found === true, 'tra đơn tìm thấy trong toolData');
  ok(r5.data?.toolData?.orderCode === orderCode1, 'toolData đúng mã đơn');

  // --- 9. Câu nối (memory): đại từ "nó" sau tra đơn ---
  const r6 = await ask(`Tra đơn ${orderCode1}`);
  const r7 = await ask('Nó thu bao nhiêu tiền?');
  ok(r7.success === true, 'câu nối success');
  ok(typeof r7.data?.answer === 'string' && r7.data.answer.length > 10, 'câu nối có đáp');

  console.log(`\n✅ test-copilot-tools5: ${checks} assertions PASSED`);
}

run().catch((err) => {
  console.error(`\n❌ test-copilot-tools5 FAILED sau ${checks} checks:`, err);
  process.exit(1);
});
