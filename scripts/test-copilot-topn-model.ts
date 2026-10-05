/**
 * Copilot: top-N bán chạy (định tuyến đúng) + chọn model + fallback khi nghẽn.
 * Heuristic path (không cần key LLM) qua POST thật trên DB cách ly.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db, editions, orders, orderItems } from '../src/db';
import { POST as postCopilot } from '../src/app/api/ai/copilot/route';
import { SESSION_COOKIE_NAME, signSession } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';

assertIsolatedTestDb('test-copilot-topn-model');

const readSrc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; assert.ok(cond, msg); };

async function run() {
  // --- 1. Source: định tuyến top-N + picker + fallback ---
  const guard = readSrc('src/services/ai/copilot-guardrails.ts');
  ok(/topEditionsBySales/.test(guard), 'heuristic top phải gọi catalog top-editions');
  ok(/top\\s\*\(\\d/.test(guard) || /parseTopN|topN/.test(guard), 'phải bóc số top-N từ câu hỏi');
  const route = readSrc('src/app/api/ai/copilot/route.ts');
  ok(/callGeminiWithFallback/.test(route), 'synth phải qua fallback khi nghẽn');
  ok(/GEMINI_FALLBACK/.test(readSrc('src/services/ai/llm-client.ts')), 'có model dự phòng khi 503');
  const drawer = readSrc('src/components/copilot/CopilotDrawer.tsx');
  ok(/copilotModel|chon.*model|Chọn.*AI/i.test(drawer), 'drawer phải có chọn model');
  console.log(`=== COPILOT TOPN/MODEL (source): PASS — ${checks} assertions ===\n`);

  // --- 2. Runtime: "top 7 sách bán chạy" → catalog top, đáp liệt kê, không JSON ---
  const eds: any[] = await db
    .select({ id: editions.id, code: editions.code, title: editions.title })
    .from(editions)
    .limit(3);
  assert.ok(eds.length >= 2, 'DB test phải có ít nhất 2 ấn bản');
  const stamp = Date.now();
  const mkOrder = (n: number, edId: string) => ({
    id: `ord-cptop-${stamp}-${n}`,
    orderCode: `CPT${stamp}${n}`,
    idempotencyKey: `idem-cptop-${stamp}-${n}`,
    warehouseId: 'wh-au-co',
    customerName: 'Khách top',
    subtotal: 50000,
    discountRate: 0,
    discountAmount: 0,
    finalAmount: 50000,
    paymentMethod: 'CASH',
    status: 'COMPLETED' as const,
    cashierId: 'staff-admin',
    createdAt: '2026-09-20T02:00:00.000Z',
  });
  await db.insert(orders).values([mkOrder(1, eds[0].id), mkOrder(2, eds[1].id)] as any);
  await db.insert(orderItems).values([
    { id: `oi-cptop-${stamp}-1`, orderId: `ord-cptop-${stamp}-1`, editionId: eds[0].id, productId: eds[0].id, quantity: 5, unitCoverPrice: 10000, unitSellingPrice: 10000, totalAmount: 50000, isGiftLine: false },
    { id: `oi-cptop-${stamp}-2`, orderId: `ord-cptop-${stamp}-2`, editionId: eds[1].id, productId: eds[1].id, quantity: 1, unitCoverPrice: 50000, unitSellingPrice: 50000, totalAmount: 50000, isGiftLine: false },
  ] as any);

  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  const token = await signSession({
    role: 'ROLE_OWNER',
    actorId: 'ADMIN-01',
    fullName: 'Copilot TopN',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  try {
    const req = new Request('http://localhost/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      body: JSON.stringify({ question: 'top 7 sách bán chạy là những cuốn nào?' }),
    });
    const response = await postCopilot(req as any);
    const payload = await response.json();
    assert.equal(response.status, 200, 'hỏi top phải 200');
    assert.equal(payload.data.toolUsed, 'query_catalog', 'phải vào tool danh mục (không phải tồn kho)');
    assert.match(payload.data.answer, new RegExp(eds[0].code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'đáp phải có mã bán chạy nhất');
    assert.doesNotMatch(payload.data.answer, /^\s*[\{\[]/, 'đáp không mở đầu JSON');
  } finally {
    const { sql } = await import('drizzle-orm');
    await db.run(sql`DELETE FROM order_items WHERE id LIKE ${`oi-cptop-${stamp}-%`}`);
    await db.run(sql`DELETE FROM orders WHERE id LIKE ${`ord-cptop-${stamp}-%`}`);
  }

// --- 2c. LLM bịa năm thì server thắng ---
  {
    const { CopilotGuardrails } = await import('../src/services/ai/copilot-guardrails');
    // "ngày 4/10" không kèm năm, giả vờ hôm nay 06/10/2026.
    const fakeNow = Date.parse('2026-10-06T02:00:00.000Z');
    assert.equal(
      CopilotGuardrails.parseVnDay('số sách bán được ngày 4/10?', fakeNow),
      '2026-10-04',
      'thiếu năm thì lấy năm hiện tại'
    );
    assert.equal(
      CopilotGuardrails.parseVnDay('ngày 4/10/2023?', fakeNow),
      '2023-10-04',
      'năm ghi rõ thì giữ nguyên'
    );
    assert.equal(CopilotGuardrails.parseVnDay('doanh thu tháng này?', fakeNow), null, 'không nhắc ngày thì null');
    // LLM bịa date 2023 nhưng câu hỏi không nhắc năm → server suy lại năm nay.
    const { ExecutiveQueryService } = await import('../src/services/executive-query.service');
    void ExecutiveQueryService;
    const { CopilotGuardrails: G } = await import('../src/services/ai/copilot-guardrails');
    const forced: any = await (G as any).executeToolSafely(
      'query_sales_summary',
      { date: '2023-10-04', q: 'số sách bán được ngày 4/10?', windowDays: 30, fiscalScope: 'ALL' },
      { staffId: 'ADMIN-01', role: 'ROLE_OWNER' }
    );
    const thisYear = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 4);
    assert.match(forced.scopeLabel, new RegExp(`ngày ${thisYear}-10-04`), 'server thắng năm bịa của LLM');
  }

// --- 3. Câu hóc búa: khung giờ X ngày Y ở kho Z → liệt kê món đã bán ---
  {
    const { CopilotGuardrails: G2 } = await import('../src/services/ai/copilot-guardrails');
    // Giả vờ hôm nay 06/10/2026: "2 ngày trước" = 04/10.
    const fakeNow2 = Date.parse('2026-10-06T02:00:00.000Z');
    const range = (G2 as any).parseVnRange('khung 15h 2 ngày trước bán được những cuốn nào?', fakeNow2);
    assert.ok(range, 'phải bóc được khung giờ');
    assert.equal(range.from, '2026-10-04T08:00:00.000Z', 'VN 15:00 = 08:00Z');
    assert.equal(range.to, '2026-10-04T08:59:59.999Z', 'hết giờ 15 VN');
    assert.equal((G2 as any).parseVnRange('hôm nay bán gì?', fakeNow2), null, 'không khung giờ thì null');
  }
  {
    const yest = new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);
    const stamp2 = Date.now();
    await db.insert(orders).values([
      {
        id: `ord-cpday-${stamp2}-1`, orderCode: `CPD${stamp2}1`, idempotencyKey: `idem-cpday-${stamp2}-1`,
        warehouseId: 'wh-au-co', customerName: 'Khách ngày', subtotal: 100000, discountRate: 0,
        discountAmount: 0, finalAmount: 100000, paymentMethod: 'CASH', status: 'COMPLETED' as const,
        cashierId: 'staff-admin', createdAt: `${yest}T02:00:00.000Z`,
      },
    ] as any);
    await db.insert(orderItems).values([
      { id: `oi-cpday-${stamp2}-1`, orderId: `ord-cpday-${stamp2}-1`, editionId: eds[0].id, productId: eds[0].id, quantity: 4, unitCoverPrice: 25000, unitSellingPrice: 25000, totalAmount: 100000, isGiftLine: false },
    ] as any);
    try {
      const reqDay = new Request('http://localhost/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}` },
        body: JSON.stringify({ question: 'hôm qua bán được bao nhiêu cuốn?' }),
      });
      const resDay = await postCopilot(reqDay as any);
      const payDay = await resDay.json();
      assert.equal(resDay.status, 200, 'hỏi theo ngày phải 200');
      assert.equal(payDay.data.toolUsed, 'query_sales_summary', 'phải vào tool doanh số');
      assert.match(payDay.data.answer, /4 cuốn/, 'đáp phải nêu đúng số cuốn bán hôm qua');
      assert.doesNotMatch(payDay.data.answer, /^\s*[\{\[]/, 'đáp không mở đầu JSON');
    } finally {
      const { sql } = await import('drizzle-orm');
      await db.run(sql`DELETE FROM order_items WHERE id LIKE ${`oi-cpday-${stamp2}-%`}`);
      await db.run(sql`DELETE FROM orders WHERE id LIKE ${`ord-cpday-${stamp2}-%`}`);
    }
  }

  // --- 3. Câu hóc búa: khung giờ cụ thể → liệt kê món (không vào tồn kho) ---
  {
    const twoDaysAgoVn = new Date(Date.now() + 7 * 3_600_000 - 2 * 86_400_000).toISOString().slice(0, 10);
    const inIso = `${twoDaysAgoVn}T08:30:00.000Z`; // 15:30 VN
    const outIso = `${twoDaysAgoVn}T01:00:00.000Z`; // 08:00 VN (ngoài khung)
    const stamp3 = Date.now();
    const targetEd = eds[0];
    const otherEd = eds[1] || eds[0];
    await db.insert(orders).values([
      {
        id: `ord-cpwin-${stamp3}-1`, orderCode: `CPW${stamp3}1`, idempotencyKey: `idem-cpwin-${stamp3}-1`,
        warehouseId: 'wh-au-co', customerName: 'Khách khung', subtotal: 50000, discountRate: 0,
        discountAmount: 0, finalAmount: 50000, paymentMethod: 'CASH', status: 'COMPLETED' as const,
        cashierId: 'staff-admin', createdAt: inIso,
      },
      {
        id: `ord-cpwin-${stamp3}-2`, orderCode: `CPW${stamp3}2`, idempotencyKey: `idem-cpwin-${stamp3}-2`,
        warehouseId: 'wh-au-co', customerName: 'Khách khung', subtotal: 90000, discountRate: 0,
        discountAmount: 0, finalAmount: 90000, paymentMethod: 'CASH', status: 'COMPLETED' as const,
        cashierId: 'staff-admin', createdAt: outIso,
      },
    ] as any);
    await db.insert(orderItems).values([
      { id: `oi-cpwin-${stamp3}-1`, orderId: `ord-cpwin-${stamp3}-1`, editionId: targetEd.id, productId: targetEd.id, quantity: 3, unitCoverPrice: 10000, unitSellingPrice: 10000, totalAmount: 30000, isGiftLine: false },
      { id: `oi-cpwin-${stamp3}-2`, orderId: `ord-cpwin-${stamp3}-2`, editionId: otherEd.id, productId: otherEd.id, quantity: 9, unitCoverPrice: 10000, unitSellingPrice: 10000, totalAmount: 90000, isGiftLine: false },
    ] as any);
    try {
      const reqWin = new Request('http://localhost/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}` },
        body: JSON.stringify({ question: 'khung 15h 2 ngày trước bán được những cuốn nào ở kho hồ gươm?' }),
      });
      const resWin = await postCopilot(reqWin as any);
      const payWin = await resWin.json();
      assert.equal(resWin.status, 200, 'hỏi khung giờ phải 200');
      assert.equal(payWin.data.toolUsed, 'query_sales_lines', 'phải vào tool dòng bán (không phải tồn kho)');
      assert.match(payWin.data.answer, new RegExp(targetEd.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'đáp phải có món trong khung');
      assert.doesNotMatch(payWin.data.answer, /^\s*[\{\[]/, 'đáp không mở đầu JSON');
    } finally {
      const { sql } = await import('drizzle-orm');
      await db.run(sql`DELETE FROM order_items WHERE id LIKE ${`oi-cpwin-${stamp3}-%`}`);
      await db.run(sql`DELETE FROM orders WHERE id LIKE ${`ord-cpwin-${stamp3}-%`}`);
    }
  }

  // --- 4. Groq tier: model picker + chuỗi dự phòng ---
  {
    ok(/callGroqChatJsonRaw|groq/i.test(route), 'synth phải thử Groq khi Gemini nghẽn');
    const drawerSrc2 = readSrc('src/components/copilot/CopilotDrawer.tsx');
    ok(/gpt-oss-120b/.test(drawerSrc2), 'picker phải có GPT-OSS 120B');
    ok(/GROQ/i.test(readSrc('src/services/ai/llm-client.ts')), 'llm-client phải biết Groq');
  }
}

run().catch((err) => {
  console.error('❌ Copilot topn-model test failed:', err);
  process.exit(1);
});
