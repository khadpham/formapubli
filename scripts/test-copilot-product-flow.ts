/**
 * Copilot: tool Nhịp Bán (giờ vàng 1 món) + chống rò JSON + Gemini 3.8.
 * Heuristic path (không cần key LLM) qua POST thật trên DB cách ly.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db, editions, orders, orderItems, products } from '../src/db';
import { POST as postCopilot } from '../src/app/api/ai/copilot/route';
import { SESSION_COOKIE_NAME, signSession } from '../src/lib/auth-session';
import { assertIsolatedTestDb } from './test-guard';
import { readCopilotSseResponse } from './copilot-sse-test-helper';

assertIsolatedTestDb('test-copilot-product-flow');

const readSrc = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');

async function run() {
  // --- 1. Source: tool mới được khai báo đủ 3 tầng ---
  const guard = readSrc('src/services/ai/copilot-guardrails.ts');
  assert.match(guard, /query_product_flow/, 'guardrails phải có tool query_product_flow');
  const route = readSrc('src/app/api/ai/copilot/route.ts');
  assert.match(route, /query_product_flow/, 'route phải format fallback cho tool mới');
  assert.match(route, /engine/, 'route phải báo engine viết câu trả lời');
  assert.match(
    readSrc('src/components/copilot/CopilotDrawer.tsx'),
    /msg\.engine/,
    'drawer phải hiện nhãn model'
  );
  // Sanitize cuối: còn { hoặc [ thì rơi về formatter, không bao giờ hiện JSON thô.
  assert.match(route, /fallback/i, 'route phải có đường rơi về formatter');
  const client = readSrc('src/services/ai/llm-client.ts');
  assert.doesNotMatch(
    client.match(/generationConfig: \{[^}]*\}/)?.[0] || '',
    /temperature/,
    'Gemini 3.6+ bỏ temperature trong generationConfig'
  );

  // --- 2. Runtime: hỏi giờ vàng → tool mới, đáp không JSON ---
  const [edition] = await db
    .select({ id: editions.id, code: editions.code, title: editions.title })
    .from(editions)
    .limit(1);
  assert.ok(edition?.id, 'DB test phải có ấn bản');
  const stamp = Date.now();
  const mkOrder = (n: number, iso: string) => ({
    id: `ord-cpflow-${stamp}-${n}`,
    orderCode: `CPF${stamp}${n}`,
    idempotencyKey: `idem-cpflow-${stamp}-${n}`,
    warehouseId: 'wh-au-co',
    customerName: 'Khách flow',
    subtotal: 50000,
    finalAmount: 50000,
    paymentMethod: 'CASH',
    status: 'COMPLETED' as const,
    cashierId: 'staff-admin',
    createdAt: iso,
  });
  await db.insert(orders).values([
    mkOrder(1, '2026-09-20T02:00:00.000Z'),
    mkOrder(2, '2026-09-20T03:00:00.000Z'),
  ] as any);
  await db.insert(orderItems).values([
    { id: `oi-cpflow-${stamp}-1`, orderId: `ord-cpflow-${stamp}-1`, editionId: edition.id, productId: edition.id, quantity: 2, unitCoverPrice: 25000, unitSellingPrice: 25000, totalAmount: 50000 },
    { id: `oi-cpflow-${stamp}-2`, orderId: `ord-cpflow-${stamp}-2`, editionId: edition.id, productId: edition.id, quantity: 1, unitCoverPrice: 25000, unitSellingPrice: 25000, totalAmount: 25000 },
  ] as any);

  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  const token = await signSession({
    role: 'ROLE_OWNER',
    actorId: 'ADMIN-01',
    fullName: 'Copilot Flow',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  try {
    const req = new Request('http://localhost/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      body: JSON.stringify({ question: `Giờ vàng bán cuốn ${edition.title} là mấy giờ?` }),
    });
    const response = await postCopilot(req as any);
    const payload = await readCopilotSseResponse(response as unknown as Response);
    assert.equal(response.status, 200, 'hỏi giờ vàng phải 200');
    assert.equal(payload.data.toolUsed, 'query_product_flow', 'phải định tuyến tool nhịp bán');
    assert.match(payload.data.answer, /[Gg]iờ/, 'đáp phải nêu giờ');
    assert.doesNotMatch(payload.data.answer, /^\s*[\{\[]/, 'đáp không được mở đầu bằng JSON');
    assert.equal(payload.data.engine, 'nội bộ', 'heuristic không LLM phải báo đúng engine');

    // Câu theo ý (không tên món): tự tìm món bán chạy nhất rồi xem giờ của nó.
    const req2 = new Request('http://localhost/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${token}` },
      body: JSON.stringify({ question: 'Giờ vàng của cuốn sách bán chạy nhất là mấy giờ?' }),
    });
    const response2 = await postCopilot(req2 as any);
    const payload2 = await readCopilotSseResponse(response2 as unknown as Response);
    assert.equal(response2.status, 200, 'hỏi bán chạy nhất phải 200');
    assert.equal(payload2.data.toolUsed, 'query_product_flow', 'câu theo ý cũng vào tool nhịp bán');
    assert.match(payload2.data.answer, /bán chạy nhất/, 'đáp phải nói rõ đang xem món bán chạy nhất');
    assert.match(payload2.data.answer, /[Gg]iờ vàng/, 'đáp phải nêu giờ vàng');
    assert.doesNotMatch(payload2.data.answer, /Không tìm thấy/, 'không được báo không tìm thấy');
  } finally {
    const { sql } = await import('drizzle-orm');
    await db.run(sql`DELETE FROM order_items WHERE id LIKE ${`oi-cpflow-${stamp}-%`}`);
    await db.run(sql`DELETE FROM orders WHERE id LIKE ${`ord-cpflow-${stamp}-%`}`);
  }

  console.log('✅ Copilot product-flow + sanitize passed');
}

run().catch((err) => {
  console.error('❌ Copilot product-flow test failed:', err);
  process.exit(1);
});
